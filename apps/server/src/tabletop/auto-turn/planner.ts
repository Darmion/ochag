import type { Queryable } from '../../db.ts';
import { knownInvocations } from '../../../../../packages/domain/character/class-features.ts';
import { deadCreatures } from '../combat/loot-routes.ts';
import { rangeBand } from '../../../../../packages/domain/combat/targeting.ts';
import { placementsHostile } from '../../campaign/factions.ts';
import { type EffectiveSpellMechanics, mergeSpellMechanics, deriveSpellMechanics, spellRangeFeet, cantripDiceMultiplier } from '../../../../../packages/domain/spells/spell-mechanics.ts';
import { type SpellArea, AREA_SPELL, spellArea } from '../../../../../packages/domain/map/area-placement.ts';
import { hitPointPool, spellRiders, projectileRule, projectileCount } from '../../../../../packages/domain/spells/spell-riders.ts';
import { castingUse } from '../../../../../packages/domain/combat/conditions.ts';
import { abilityModifier } from '../../../../../packages/domain/dice/dice.ts';
import { findSrdSpell, srdSpellName } from '../../rules/srd-data.ts';

import { weaponRanges } from '../combat/attack.ts';
import type { TableContext } from '../context.ts';
import { feetBetween, getScene } from '../scene/board.ts';
import { loadPlacements } from '../scene/placements.ts';

export const AUTO_TARGETS = ['nearest', 'weakest', 'threat'] as const;
export type AutoTarget = (typeof AUTO_TARGETS)[number];
export type AutoOption = {
  kind: 'weapon' | 'spell' | 'area' | 'heal' | 'control' | 'support'; id: string; name: string;
  expected: number;
  reach: number;
  weapon?: any; level?: number; slotLevel?: number | null; pact?: boolean;
  area?: SpellArea; bonus?: boolean;
  condition?: string; pool?: number | null; concentration?: boolean; desc?: string;
  support?: 'dispel' | 'restore'; restores?: string[];
};

export const BUFF_VALUE: Record<string, number> = {
  invisible: 6, blessed: 6, sanctuary: 6, heroism: 4, ac_bonus: 4, truesight: 3, mage_armor: 3, aid: 3, see_invisibility: 2, shield_spell: 1,
};
export const CONTROL_VALUE: Record<string, number> = {
  paralyzed: 12, stunned: 12, unconscious: 10, incapacitated: 8, petrified: 12, restrained: 6, blinded: 5,
  frightened: 4, charmed: 4, poisoned: 3, prone: 2, deafened: 1,
};

export function averageDamage(formula: string | null | undefined, multiplier = 1) {
  const text = String(formula ?? '').toLowerCase().replace(/\s+/g, '').replace(/к/g, 'd').replace(/@\w+/g, '');
  let total = 0;
  for (const match of text.matchAll(/([+-]?)(\d*)d(\d+)/g)) {
    total += (match[1] === '-' ? -1 : 1) * Number(match[2] || 1) * multiplier * (Number(match[3]) + 1) / 2;
  }
  for (const match of text.replace(/[+-]?\d*d\d+/g, '').matchAll(/([+-]?)(\d+)/g)) total += (match[1] === '-' ? -1 : 1) * Number(match[2]);
  return Math.max(0, total);
}

export async function autoOptions(q: Queryable, campaignId: string, characterId: string): Promise<AutoOption[]> {
  const options: AutoOption[] = [];
  const weapons = (
    await q.query(
      `SELECT id, name, ability, damage_formula, range_feet, weapon_kind, long_range_feet, thrown_range_feet
         FROM character_weapons WHERE campaign_id=$1 AND character_id=$2`,
      [campaignId, characterId],
    )
  ).rows as any[];
  for (const weapon of weapons) {
    options.push({ kind: 'weapon', id: weapon.id, name: weapon.name, expected: averageDamage(weapon.damage_formula) * 0.65, reach: Number(weapon.range_feet ?? 5), weapon });
  }
  const known = (
    await q.query('SELECT id, source, srd_index, custom_spell_id, slotless FROM character_spells WHERE campaign_id=$1 AND character_id=$2', [campaignId, characterId])
  ).rows as any[];
  if (!known.length) return options;
  if ((await q.query(`SELECT 1 FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='wild_shape' AND active`, [campaignId, characterId])).rows[0]) return options;
  const caster = (
    await q.query('SELECT level, pact_slots_current, pact_slot_level, charisma, sheet_extra FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])
  ).rows[0] as any;
  const free = (
    await q.query('SELECT level FROM character_spell_slots WHERE campaign_id=$1 AND character_id=$2 AND level >= 1 AND current > 0 ORDER BY level', [campaignId, characterId])
  ).rows.map(row => Number(row.level));
  for (const entry of known) {
    let name: string;
    let level: number;
    let range: string | null;
    let desc: string;
    let castingTime: string | null;
    let mechanics: EffectiveSpellMechanics;
    let higherLevel: string | null = null;
    let concentration = false;
    if (entry.source === 'srd') {
      const spell = findSrdSpell(entry.srd_index);
      if (!spell) continue;
      higherLevel = spell.higherLevel ?? null;
      concentration = spell.concentration === true;
      const overlay = (await q.query('SELECT * FROM srd_spell_mechanics WHERE srd_index=$1', [entry.srd_index])).rows[0] as any;
      mechanics = mergeSpellMechanics(deriveSpellMechanics(spell), overlay ?? null);
      name = srdSpellName(entry.srd_index);
      level = spell.level;
      range = spell.range ?? null;
      desc = `${spell.desc ?? ''}`;
      castingTime = spell.castingTime ?? null;
    } else {
      const custom = (await q.query('SELECT * FROM campaign_spells WHERE campaign_id=$1 AND id=$2', [campaignId, entry.custom_spell_id])).rows[0] as any;
      if (!custom) continue;
      mechanics = mergeSpellMechanics(null, custom);
      concentration = custom.concentration === true;
      name = custom.name;
      level = custom.level;
      range = custom.range ?? null;
      desc = `${custom.description ?? ''}`;
      castingTime = custom.casting_time ?? null;
    }
    const healing = Boolean(mechanics.healingFormula && !mechanics.damageFormula && !mechanics.attack && !mechanics.save);
    const sleepPool = hitPointPool({ desc, higherLevel });
    const control = !mechanics.damageFormula && !healing && Boolean((mechanics.condition && mechanics.save && CONTROL_VALUE[mechanics.condition]) || sleepPool);
    const helper = !mechanics.damageFormula && !healing && !control
      ? spellRiders(desc).find(rider => rider.kind === 'dispel' || rider.kind === 'restore') ?? null : null;
    if (!mechanics.damageFormula && !healing && !control && !helper) continue;
    const area = (mechanics.damageFormula || control) && AREA_SPELL.test(desc) ? spellArea(desc, range) : null;
    if ((mechanics.damageFormula || control) && AREA_SPELL.test(desc) && !area) continue;
    const reach = area?.fromSelf ? 0 : spellRangeFeet(range);
    if (reach === null) continue;
    let slotLevel: number | null = null;
    let pact = false;
    if (level > 0 && !entry.slotless) {
      const lowest = free.find(slot => slot >= level);
      if (lowest !== undefined) slotLevel = lowest;
      else if (Number(caster?.pact_slots_current ?? 0) > 0 && Number(caster?.pact_slot_level ?? 0) >= level) pact = true;
      else continue;
    }
    const multiplier = level === 0 && mechanics.cantripScaling ? cantripDiceMultiplier(caster?.level ?? null) : 1;
    const bonus = castingUse(castingTime) === 'bonus';
    if (healing) {
      options.push({ kind: 'heal', id: entry.id, name, expected: averageDamage(mechanics.healingFormula), reach, level, slotLevel, pact, bonus, concentration });
      continue;
    }
    if (helper) {
      options.push({
        kind: 'support', id: entry.id, name, expected: 0, reach: reach || 5, level, slotLevel, pact, bonus, concentration,
        support: helper.kind as 'dispel' | 'restore', ...(helper.kind === 'restore' ? { restores: helper.conditions } : {}),
      });
      continue;
    }
    if (control) {
      const extra = sleepPool?.perSlot && slotLevel ? averageDamage(sleepPool.perSlot) * Math.max(0, slotLevel - level) : 0;
      options.push({
        kind: 'control', id: entry.id, name, expected: sleepPool ? CONTROL_VALUE.unconscious! : CONTROL_VALUE[mechanics.condition!]! * 0.5,
        reach, level, slotLevel, pact, bonus, condition: sleepPool ? 'unconscious' : mechanics.condition!, pool: sleepPool ? averageDamage(sleepPool.dice) + extra : null,
        concentration, desc, ...(area ? { area } : {}),
      });
      continue;
    }
    const share = mechanics.attack ? 0.65 : mechanics.save ? (mechanics.halfOnSave ? 0.75 : 0.5) : 1;
    const rule = projectileRule({ desc, higherLevel });
    const shots = rule ? projectileCount(rule, slotLevel ?? (pact ? Number(caster?.pact_slot_level ?? level) : level), caster?.level ?? null) : 1;
    const agonizing = entry.source === 'srd' && entry.srd_index === 'eldritch-blast' && knownInvocations(caster?.sheet_extra).includes('agonizing-blast')
      ? Math.max(0, abilityModifier(Number(caster?.charisma ?? 10))) : 0;
    options.push({
      kind: area ? 'area' : 'spell', id: entry.id, name, expected: (averageDamage(mechanics.damageFormula, multiplier) + agonizing) * share * shots, reach, level, slotLevel, pact, bonus,
      concentration, ...(area ? { area } : {}),
    });
  }
  return options;
}

export const NO_ACTION = {
  target: null, moved: null, weapon: null, spell: null, area: null, bonusHeal: null, actionHeal: null, perAction: 1,
  sequence: [] as Array<{ weapon: any; disadvantage: boolean }>,
  fled: null as { from: { x: number; z: number }; to: { x: number; z: number }; dashed: boolean; from_name: string } | null,
  control: null as { option: AutoOption; targetId: string | null; placement: any; value: number } | null,
  support: null as { option: AutoOption; targetId: string; value: number; name: string } | null,
} as const;

export async function nextVictim(ctx: TableContext, campaignId: string, sceneId: string, attackerId: string, weapon: any, droppedId: string) {
  const { db } = ctx;
  const scene = await getScene(db, campaignId, sceneId, false);
  const placements = await loadPlacements(db, campaignId, sceneId);
  const attacker = placements.find(entry => entry.character_id === attackerId && !entry.parent_object_id);
  if (!attacker) return null;
  const foes = placements.filter(entry => !entry.parent_object_id && entry.character_id !== droppedId && placementsHostile(entry, attacker));
  const fallen = await deadCreatures(db, campaignId, foes.map(entry => entry.character_id));
  const hp = new Map(
    (await db.query('SELECT id, hp_current FROM characters WHERE campaign_id=$1 AND id = ANY($2::uuid[])', [campaignId, foes.map(entry => entry.character_id)]))
      .rows.map(row => [row.id as string, Number(row.hp_current ?? 0)]),
  );
  const next = foes
    .filter(entry => !fallen.has(entry.character_id) && (hp.get(entry.character_id) ?? 0) > 0 && rangeBand(weaponRanges(weapon), feetBetween(scene, attacker, entry)).ok)
    .sort((a, b) => feetBetween(scene, attacker, a) - feetBetween(scene, attacker, b))[0];
  return next ? { id: next.character_id, name: next.name } : null;
}

export const AUTO_PACES = {
  fast: { move: 0, step: 0, end: 0 },
  normal: { move: 350, step: 750, end: 900 },
  slow: { move: 900, step: 1500, end: 1700 },
} as const;
export type AutoPace = keyof typeof AUTO_PACES;
export const glideMs = (from: { x: number; z: number }, to: { x: number; z: number }) =>
  Math.round(Math.min(2400, Math.max(250, Math.hypot(to.x - from.x, to.z - from.z) * 260)));
export const pauseMs = (ms: number) => (ms > 0 ? new Promise<void>(resolve => setTimeout(resolve, ms)) : Promise.resolve());
