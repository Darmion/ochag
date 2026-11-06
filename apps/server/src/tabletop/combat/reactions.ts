import type { Queryable } from '../../db.ts';
import { classResourceOf, spendClassResource } from '../../rules/class-features.ts';
import { classFeaturesFor, knownManeuvers, superiorityDie, classLevelOf, bardicDie, knownSuperiorDefense, COUNTERCHARM_FEET } from '../../../../../packages/domain/character/class-features.ts';
import { deadCreatures } from './loot-routes.ts';
import { characterClassLevels } from '../../../../../packages/domain/character/classes.ts';
import { placementFactions, placementsAllied, placementsHostile } from '../../campaign/factions.ts';
import { acDelta } from '../../../../../packages/domain/spells/spell-mods.ts';
import { loadConditionState, addCondition, type Notice as ConditionNotice } from '../../rules/conditions.ts';
import { reactionBlocked, incapacitatedReason } from '../../../../../packages/domain/combat/conditions.ts';
import { infernalLegacySpell } from '../../../../../packages/domain/character/races.ts';
import { abilityModifier } from '../../../../../packages/domain/dice/dice.ts';

import { averageDamage } from '../auto-turn/planner.ts';
import { sceneSight, type SceneSight, seesCreature } from './sight.ts';
import type { TableContext } from '../context.ts';
import { notifyCampaign, notifyManagers, notifyUsers } from '../live/notify.ts';
import { insertRoll, rollDie } from '../rolls/dice.ts';
import { rollCheckAs } from '../rolls/roll-check.ts';
import { feetBetween, getScene } from '../scene/board.ts';
import { loadPlacements } from '../scene/placements.ts';
import type { Placement } from '../shared.ts';
import { type CastBody, castWithCounters } from '../spells/cast.ts';
import { autoCounterer, counterCandidates, counterCheck, spendCounter } from '../spells/counterspell.ts';
import { spellModsFor } from '../spells/rules.ts';

export async function shieldBonus(q: Queryable, campaignId: string, characterId: string) {
  const rows = (
    await q.query(`SELECT effect_code, parameters FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code IN ('shield_spell', 'ac_bonus', 'mage_armor', 'barkskin', 'hasted', 'slow_spell', 'warding_bond') AND active`, [campaignId, characterId])
  ).rows as Array<{ effect_code: string; parameters: any }>;
  let bonus = rows.reduce((sum, row) => sum + (row.effect_code === 'shield_spell' ? 5 : row.effect_code === 'ac_bonus' ? Number(row.parameters?.bonus ?? 0)
    : row.effect_code === 'hasted' ? 2 : row.effect_code === 'slow_spell' ? -2 : 0), 0);
  if (rows.some(row => row.effect_code === 'warding_bond')) bonus += 1;
  const armor = rows.find(row => row.effect_code === 'mage_armor');
  const bark = rows.some(row => row.effect_code === 'barkskin');
  if (armor || bark) {
    const self = (await q.query('SELECT armor_class, dexterity FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0] as any;
    if (self && armor) bonus += Math.max(0, Number(armor.parameters?.base ?? 13) + abilityModifier(Number(self.dexterity ?? 10)) - Number(self.armor_class ?? 10));
    if (self && bark) bonus = Math.max(bonus, 16 - Number(self.armor_class ?? 10));
  }
  const templated = (await spellModsFor(q, campaignId, characterId)).filter(mod => mod.kind === 'ac');
  if (templated.length) {
    const self = (await q.query('SELECT armor_class, dexterity FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0] as any;
    bonus += acDelta(templated, Number(self?.armor_class ?? 10) + bonus, abilityModifier(Number(self?.dexterity ?? 10))).delta;
  }
  return bonus;
}

export async function shieldRaised(q: Queryable, campaignId: string, characterId: string) {
  return Boolean((await q.query(`SELECT 1 FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='shield_spell' AND active`, [campaignId, characterId])).rows[0]);
}

export async function tryAutoShield(
  ctx: TableContext, q: Queryable, campaignId: string, userId: string, sceneId: string | null, target: { id: string; name: string }, total: number, ac: number,
): Promise<{ spent: string; counteredBy: string | null } | null> {
  if (total >= ac + 5) return null;
  if (await shieldRaised(q, campaignId, target.id)) return null;
  const own = (
    await q.query('SELECT auto_reactions, pact_slots_current, pact_slot_level FROM characters WHERE campaign_id=$1 AND id=$2 FOR UPDATE', [campaignId, target.id])
  ).rows[0];
  if (!own || !(own.auto_reactions ?? []).includes('shield')) return null;
  const known = (
    await q.query(`SELECT 1 FROM character_spells WHERE campaign_id=$1 AND character_id=$2 AND source='srd' AND srd_index='shield'`, [campaignId, target.id])
  ).rows[0];
  if (!known) return null;
  if (reactionBlocked(await loadConditionState(q, campaignId, target.id))) return null;
  const entry = sceneId ? (
    await q.query('SELECT id, reaction_used FROM initiative_entries WHERE campaign_id=$1 AND scene_id=$2 AND character_id=$3 FOR UPDATE', [campaignId, sceneId, target.id])
  ).rows[0] : null;
  if (entry?.reaction_used) return null;
  const slot = (
    await q.query(
      'SELECT level FROM character_spell_slots WHERE campaign_id=$1 AND character_id=$2 AND level >= 1 AND current > 0 ORDER BY level LIMIT 1 FOR UPDATE',
      [campaignId, target.id],
    )
  ).rows[0];
  let spent: string;
  let level: number;
  if (slot) {
    await q.query('UPDATE character_spell_slots SET current = current - 1 WHERE campaign_id=$1 AND character_id=$2 AND level=$3', [campaignId, target.id, slot.level]);
    spent = `ячейка ${slot.level} ур.`;
    level = Number(slot.level);
  } else if (Number(own.pact_slots_current ?? 0) > 0) {
    await q.query('UPDATE characters SET pact_slots_current = pact_slots_current - 1 WHERE campaign_id=$1 AND id=$2', [campaignId, target.id]);
    spent = `ячейка договора ${own.pact_slot_level} ур.`;
    level = Number(own.pact_slot_level);
  } else {
    return null;
  }
  if (entry) await q.query('UPDATE initiative_entries SET reaction_used=true WHERE id=$1', [entry.id]);
  if (sceneId) {
    const counterer = await autoCounterer(q, campaignId, await counterCandidates(q, campaignId, sceneId, target.id), level);
    if (counterer) {
      const answer = await spendCounter(ctx, q, campaignId, counterer.characterId, sceneId, { enforce: false, prefer: level });
      const check = await counterCheck(q, campaignId, userId, answer, level, 'Щит');
      if (check.success) return { spent, counteredBy: answer.byName };
    }
  }
  await addCondition(q, campaignId, target.id, 'shield_spell', { source: 'reaction', spellName: 'Щит', spellLevel: level });
  return { spent, counteredBy: null };
}

export const REACTION_RANGE_FEET = 60;

export async function reactionSlots(q: Queryable, campaignId: string, characterId: string, minLevel: number) {
  const levels = (
    await q.query(
      'SELECT level FROM character_spell_slots WHERE campaign_id=$1 AND character_id=$2 AND level >= $3 AND current > 0 ORDER BY level',
      [campaignId, characterId, minLevel],
    )
  ).rows.map(row => Number(row.level));
  const own = (await q.query('SELECT pact_slots_current, pact_slot_level FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0];
  const pact = own && Number(own.pact_slots_current ?? 0) > 0 && Number(own.pact_slot_level ?? 0) >= minLevel ? Number(own.pact_slot_level) : null;
  return { levels, pact };
}

export type ReactionCandidate = {
  characterId: string; name: string; ownerUserId: string | null; spellEntryId: string; slots: number[]; pact: number | null;
  racial?: boolean;
};

export async function reactionCandidates(
  q: Queryable, campaignId: string, sceneId: string, actorId: string, srdIndex: string, minLevel: number,
  filter: (reactor: Placement, actor: Placement) => boolean,
): Promise<ReactionCandidate[]> {
  const knowing = (
    await q.query(
      `SELECT cs.id, cs.character_id, c.owner_user_id FROM character_spells cs JOIN characters c ON c.id = cs.character_id
         WHERE cs.campaign_id=$1 AND cs.source='srd' AND cs.srd_index=$2`,
      [campaignId, srdIndex],
    )
  ).rows as Array<{ id: string; character_id: string; owner_user_id: string | null }>;
  if (!knowing.length) return [];
  const scene = await getScene(q, campaignId, sceneId, false);
  const placements = await loadPlacements(q, campaignId, sceneId);
  const actor = placements.find(entry => entry.character_id === actorId && !entry.parent_object_id);
  if (!actor) return [];
  const byCharacter = new Map(knowing.map(row => [row.character_id, row]));
  const reactors = placements.filter(entry =>
    !entry.parent_object_id && entry.kind !== 'object' && entry.character_id !== actorId && byCharacter.has(entry.character_id) && filter(entry, actor));
  if (!reactors.length) return [];
  const fallen = await deadCreatures(q, campaignId, reactors.map(entry => entry.character_id));
  const spent = new Set(
    (await q.query('SELECT character_id FROM initiative_entries WHERE campaign_id=$1 AND scene_id=$2 AND reaction_used AND character_id IS NOT NULL', [campaignId, sceneId]))
      .rows.map(row => row.character_id as string),
  );
  let sight: SceneSight | null = null;
  const found: ReactionCandidate[] = [];
  for (const reactor of reactors) {
    if (fallen.has(reactor.character_id) || spent.has(reactor.character_id)) continue;
    if (reactionBlocked(await loadConditionState(q, campaignId, reactor.character_id))) continue;
    if (feetBetween(scene, reactor, actor) > REACTION_RANGE_FEET) continue;
    const slots = await reactionSlots(q, campaignId, reactor.character_id, minLevel);
    let racial = false;
    if (srdIndex === 'hellish-rebuke') {
      const self = (await q.query('SELECT level, sheet_extra FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, reactor.character_id])).rows[0] as any;
      const legacy = self ? infernalLegacySpell(self, srdIndex) : null;
      if (legacy?.resource) {
        const charge = (await q.query(`SELECT current FROM character_resources WHERE campaign_id=$1 AND character_id=$2 AND name=$3`, [campaignId, reactor.character_id, legacy.resource])).rows[0];
        racial = !charge || Number(charge.current) > 0;
      }
    }
    if (!slots.levels.length && slots.pact === null && !racial) continue;
    sight ??= await sceneSight(q, campaignId, scene, placements);
    if (!(await seesCreature(q, campaignId, sight, reactor, actor))) continue;
    const row = byCharacter.get(reactor.character_id)!;
    found.push({ characterId: reactor.character_id, name: reactor.name, ownerUserId: row.owner_user_id, spellEntryId: row.id, slots: slots.levels, pact: slots.pact, ...(racial ? { racial } : {}) });
  }
  return found;
}

export async function askControllers(ctx: TableContext, campaignId: string, owners: Array<string | null>, message: Record<string, unknown>) {
  await notifyUsers(ctx, campaignId, owners.filter((owner): owner is string => Boolean(owner)), message);
  await notifyManagers(ctx, campaignId, message);
}

export async function sharedScene(q: Queryable, campaignId: string, a: string, b: string): Promise<string | null> {
  return (
    await q.query(
      `SELECT scene_id FROM scene_objects WHERE campaign_id=$1 AND character_id = ANY($2::uuid[]) AND parent_object_id IS NULL
         GROUP BY scene_id HAVING count(DISTINCT character_id) = 2 LIMIT 1`,
      [campaignId, [a, b]],
    )
  ).rows[0]?.scene_id ?? null;
}

export async function offerRebukes(ctx: TableContext, campaignId: string, sceneId: string | null, attackerId: string, woundedIds: string[]) {
  const { db } = ctx;
  try {
    for (const woundedId of new Set(woundedIds)) {
      if (woundedId === attackerId) continue;
      const where = sceneId ?? await sharedScene(db, campaignId, attackerId, woundedId);
      if (!where) continue;
      const candidates = await reactionCandidates(db, campaignId, where, attackerId, 'hellish-rebuke', 1, reactor => reactor.character_id === woundedId);
      if (!candidates.length) continue;
      const attacker = (await db.query('SELECT name FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, attackerId])).rows[0];
      for (const candidate of candidates) {
        const ready = (await db.query(`SELECT 1 FROM characters WHERE campaign_id=$1 AND id=$2 AND 'hellish-rebuke' = ANY(auto_reactions)`, [campaignId, candidate.characterId])).rows[0];
        if (ready) {
          const owner = (await db.query('SELECT owner_user_id FROM campaigns WHERE id=$1', [campaignId])).rows[0]?.owner_user_id as string;
          const body: CastBody = {
            targetIds: [attackerId], sceneId: where,
            ...(candidate.racial ? { racial: true } : candidate.slots.length ? (candidate.slots[0]! > 1 ? { slotLevel: candidate.slots[0]! } : {}) : candidate.pact ? { pact: true } : {}),
          };
          try {
            const done = await castWithCounters(ctx, owner, { campaignId, characterId: candidate.characterId, characterSpellId: candidate.spellEntryId }, body);
            const hit = (done.body?.targets ?? []).find((entry: any) => entry.characterId === attackerId);
            void notifyCampaign(ctx, campaignId, {
              type: 'notice', title: `${candidate.name}: «Адское возмездие»`, tone: 'info',
              detail: done.status === 202 ? 'Наготове — ждём ответа на «Контрзаклинание».' : `Наготове — по «${attacker?.name ?? ''}»${hit?.damage !== undefined ? `: ${hit.damage} урона` : ''}.`,
            });
            continue;
          } catch {
          }
        }
        await askControllers(ctx, campaignId, [candidate.ownerUserId], {
          type: 'reaction-offer', kind: 'hellish-rebuke', sceneId: where,
          reactorId: candidate.characterId, reactorName: candidate.name, triggerId: attackerId, triggerName: attacker?.name ?? '',
          spellEntryId: candidate.spellEntryId, slots: candidate.slots, pact: candidate.pact, ...(candidate.racial ? { racial: true } : {}),
        });
      }
    }
  } catch {
  }
}

export async function parryBlow(q: Queryable, campaignId: string, sceneId: string | null, targetId: string) {
  const row = (
    await q.query(`SELECT id, name, level, class_name, sheet_extra, dexterity, charisma FROM characters WHERE campaign_id=$1 AND id=$2 AND 'parry' = ANY(auto_reactions)`, [campaignId, targetId])
  ).rows[0] as any;
  if (!row) return null;
  const classes = characterClassLevels(row).classes;
  if (!classFeaturesFor(classes).some(feature => feature.id === 'combat-superiority') || !knownManeuvers(row.sheet_extra).includes('parry')) return null;
  if (reactionBlocked(await loadConditionState(q, campaignId, targetId))) return null;
  const entry = sceneId ? (await q.query('SELECT id, reaction_used FROM initiative_entries WHERE campaign_id=$1 AND scene_id=$2 AND character_id=$3 FOR UPDATE', [campaignId, sceneId, targetId])).rows[0] : null;
  if (entry?.reaction_used) return null;
  const dice = await classResourceOf(q, campaignId, row, 'Кости превосходства', false);
  if (!dice || Number(dice.current) <= 0) return null;
  await spendClassResource(q, campaignId, row, 'Кости превосходства');
  if (entry) await q.query('UPDATE initiative_entries SET reaction_used=true WHERE id=$1', [entry.id]);
  return { name: row.name as string, value: Math.max(0, rollDie(superiorityDie(classLevelOf(classes, 'fighter', row.level))) + abilityModifier(Number(row.dexterity ?? 10))) };
}

export async function cuttingWords(q: Queryable, campaignId: string, userId: string, sceneId: string, attackerId: string, targetId: string, total: number, ac: number) {
  const bards = (
    await q.query(`SELECT id, name, level, class_name, sheet_extra, charisma FROM characters WHERE campaign_id=$1 AND 'cutting-words' = ANY(auto_reactions)`, [campaignId])
  ).rows as any[];
  if (!bards.length) return null;
  const scene = await getScene(q, campaignId, sceneId, false);
  const sight = await sceneSight(q, campaignId, scene);
  const pick = (id: string) => sight.placements.find(entry => entry.character_id === id && !entry.parent_object_id);
  const attacker = pick(attackerId);
  const target = pick(targetId);
  if (!attacker || !target || !placementFactions(target).length || placementsAllied(target, attacker)) return null;
  for (const bard of bards) {
    const at = pick(bard.id);
    if (!at || !placementsAllied(at, target)) continue;
    const classes = characterClassLevels(bard).classes;
    if (!classFeaturesFor(classes).some(feature => feature.id === 'cutting-words')) continue;
    const die = bardicDie(classLevelOf(classes, 'bard', bard.level));
    if (total - die >= ac || feetBetween(scene, at, attacker) > 60) continue;
    const state = await loadConditionState(q, campaignId, bard.id);
    if (reactionBlocked(state) || incapacitatedReason(state)) continue;
    if (!(await seesCreature(q, campaignId, sight, at, attacker))) continue;
    const entry = (await q.query('SELECT id, reaction_used FROM initiative_entries WHERE campaign_id=$1 AND scene_id=$2 AND character_id=$3 FOR UPDATE', [campaignId, sceneId, bard.id])).rows[0];
    if (entry?.reaction_used) continue;
    const inspiration = await classResourceOf(q, campaignId, bard, 'Вдохновение барда', false);
    if (!inspiration || Number(inspiration.current) <= 0) continue;
    await spendClassResource(q, campaignId, bard, 'Вдохновение барда');
    if (entry) await q.query('UPDATE initiative_entries SET reaction_used=true WHERE id=$1', [entry.id]);
    const value = rollDie(die);
    await insertRoll(q, campaignId, userId, bard.id, `Острое словцо → ${attacker.name}`.slice(0, 100), `1d${die}`, [value], 0, value, false, null, { kind: 'cutting-words', target: { id: attackerId, name: attacker.name } });
    return { id: bard.id as string, name: bard.name as string, value };
  }
  return null;
}

export async function tryRiposte(ctx: TableContext, campaignId: string, sceneId: string, reactorId: string, attackerId: string) {
  const { db } = ctx;
  try {
    const row = (
      await db.query(`SELECT id, name, level, class_name, sheet_extra, charisma FROM characters WHERE campaign_id=$1 AND id=$2 AND 'riposte' = ANY(auto_reactions)`, [campaignId, reactorId])
    ).rows[0] as any;
    if (!row) return null;
    const classes = characterClassLevels(row).classes;
    if (!classFeaturesFor(classes).some(feature => feature.id === 'combat-superiority') || !knownManeuvers(row.sheet_extra).includes('riposte')) return null;
    const dice = await classResourceOf(db, campaignId, row, 'Кости превосходства', false);
    if (!dice || Number(dice.current) <= 0) return null;
    const state = await loadConditionState(db, campaignId, reactorId);
    if (reactionBlocked(state) || incapacitatedReason(state)) return null;
    const entry = (await db.query('SELECT reaction_used FROM initiative_entries WHERE campaign_id=$1 AND scene_id=$2 AND character_id=$3', [campaignId, sceneId, reactorId])).rows[0];
    if (!entry || entry.reaction_used) return null;
    const scene = await getScene(db, campaignId, sceneId, false);
    const placements = await loadPlacements(db, campaignId, sceneId);
    const self = placements.find(item => item.character_id === reactorId && !item.parent_object_id);
    const foe = placements.find(item => item.character_id === attackerId && !item.parent_object_id);
    if (!self || !foe) return null;
    const feet = feetBetween(scene, self, foe);
    const weapons = (
      await db.query(`SELECT id, name, damage_formula, range_feet FROM character_weapons WHERE campaign_id=$1 AND character_id=$2 AND weapon_kind IS DISTINCT FROM 'ranged'`, [campaignId, reactorId])
    ).rows as any[];
    const weapon = weapons.filter(item => Number(item.range_feet ?? 5) >= feet).sort((a, b) => averageDamage(b.damage_formula) - averageDamage(a.damage_formula))[0];
    if (!weapon) return null;
    const owner = (await db.query('SELECT owner_user_id FROM campaigns WHERE id=$1', [campaignId])).rows[0]?.owner_user_id as string;
    const done: any = await rollCheckAs(ctx, owner, campaignId, { characterId: reactorId, kind: 'attack', key: weapon.id, targetCharacterId: attackerId, sceneId, using: 'reaction' }, { riposte: true });
    const hit = done.outcome?.hit === true;
    void notifyCampaign(ctx, campaignId, {
      type: 'notice', title: `${row.name}: «Ответный удар»`, tone: 'info',
      detail: `Промах по нему — реакцией ${weapon.name}: ${hit ? `попадание${done.damage ? `, ${done.damage.applied} урона` : ''}` : 'промах'}.`,
    });
    return { name: row.name as string, weapon: weapon.name as string, hit, damage: done.damage?.applied ?? null };
  } catch {
    return null;
  }
}

export async function hurlReturns(ctx: TableContext, q: Queryable, campaignId: string, userId: string, warlockId: string) {
  const { featureApi } = ctx;
  const hurled = (
    await q.query(
      `SELECT e.id, e.character_id, e.parameters, c.name FROM character_effects e JOIN characters c ON c.campaign_id=e.campaign_id AND c.id=e.character_id
         WHERE e.campaign_id=$1 AND e.effect_code='hurled' AND e.active AND e.parameters->>'sourceCharacterId' = $2`,
      [campaignId, warlockId],
    )
  ).rows as Array<{ id: string; character_id: string; parameters: any; name: string }>;
  const notices: ConditionNotice[] = [];
  for (const entry of hurled) {
    const left = Number(entry.parameters?.returnsAfter ?? 1) - 1;
    if (left > 0) {
      await q.query(`UPDATE character_effects SET parameters = jsonb_set(parameters, '{returnsAfter}', to_jsonb($2::int)) WHERE id=$1`, [entry.id, left]);
      continue;
    }
    await q.query('DELETE FROM character_effects WHERE id=$1', [entry.id]);
    await q.query(
      `DELETE FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='incapacitated' AND parameters->>'sourceName' = 'Бросок через ад'`,
      [campaignId, entry.character_id],
    );
    const placed = Array.isArray(entry.parameters?.placements) ? entry.parameters.placements.map(String) : [];
    if (placed.length) {
      await q.query('UPDATE scene_objects SET hidden=false, revision=revision+1 WHERE campaign_id=$1 AND id = ANY($2::uuid[])', [campaignId, placed]);
      await q.query('UPDATE scenes SET revision=revision+1 WHERE campaign_id=$1 AND id IN (SELECT scene_id FROM scene_objects WHERE campaign_id=$1 AND id = ANY($2::uuid[]))', [campaignId, placed]);
    }
    const back = await featureApi.hurlBack(q, campaignId, userId, warlockId, entry.character_id);
    notices.push({ title: `${entry.name} возвращается из ада`, detail: `«Бросок через ад»: ${back.text}`, characterId: entry.character_id });
  }
  return notices;
}

export async function reactionReady(ctx: TableContext, campaignId: string, sceneId: string, reactorId: string) {
  const { db } = ctx;
  const state = await loadConditionState(db, campaignId, reactorId);
  if (reactionBlocked(state) || incapacitatedReason(state)) return null;
  const entry = (await db.query('SELECT id, reaction_used FROM initiative_entries WHERE campaign_id=$1 AND scene_id=$2 AND character_id=$3', [campaignId, sceneId, reactorId])).rows[0];
  return !entry || entry.reaction_used ? null : entry as { id: string };
}

export async function tryRetaliation(ctx: TableContext, campaignId: string, sceneId: string, berserkerId: string, attackerId: string) {
  const { db } = ctx;
  if (berserkerId === attackerId) return null;
  try {
    const row = (
      await db.query(`SELECT id, name, level, class_name, sheet_extra, hp_current FROM characters WHERE campaign_id=$1 AND id=$2 AND 'retaliation' = ANY(auto_reactions)`, [campaignId, berserkerId])
    ).rows[0] as any;
    if (!row || Number(row.hp_current ?? 0) <= 0) return null;
    if (!classFeaturesFor(characterClassLevels(row).classes).some(feature => feature.id === 'retaliation')) return null;
    if (!(await reactionReady(ctx, campaignId, sceneId, berserkerId))) return null;
    const scene = await getScene(db, campaignId, sceneId, false);
    const placements = await loadPlacements(db, campaignId, sceneId);
    const self = placements.find(item => item.character_id === berserkerId && !item.parent_object_id);
    const foe = placements.find(item => item.character_id === attackerId && !item.parent_object_id);
    if (!self || !foe || feetBetween(scene, self, foe) > 5) return null;
    const weapons = (
      await db.query(`SELECT id, name, damage_formula, range_feet FROM character_weapons WHERE campaign_id=$1 AND character_id=$2 AND weapon_kind IS DISTINCT FROM 'ranged'`, [campaignId, berserkerId])
    ).rows as any[];
    const weapon = weapons.sort((a, b) => averageDamage(b.damage_formula) - averageDamage(a.damage_formula))[0];
    if (!weapon) return null;
    const owner = (await db.query('SELECT owner_user_id FROM campaigns WHERE id=$1', [campaignId])).rows[0]?.owner_user_id as string;
    const done: any = await rollCheckAs(ctx, owner, campaignId, { characterId: berserkerId, kind: 'attack', key: weapon.id, targetCharacterId: attackerId, sceneId, using: 'reaction' }, { reacted: true });
    const hit = done.outcome?.hit === true;
    void notifyCampaign(ctx, campaignId, {
      type: 'notice', title: `${row.name}: «Ответный удар»`, tone: 'info',
      detail: `Ранен в упор — реакцией ${weapon.name}: ${hit ? `попадание${done.damage ? `, ${done.damage.applied} урона` : ''}` : 'промах'}.`,
    });
    return { name: row.name as string, weapon: weapon.name as string, hit, damage: done.damage?.applied ?? null };
  } catch {
    return null;
  }
}

export async function tryStandAgainstTide(ctx: TableContext, campaignId: string, sceneId: string, hunterId: string, attackerId: string, weaponKey: string) {
  const { db } = ctx;
  try {
    const row = (await db.query('SELECT id, name, level, class_name, sheet_extra FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, hunterId])).rows[0] as any;
    if (!row) return null;
    if (!classFeaturesFor(characterClassLevels(row).classes).some(feature => feature.id === 'superior-hunters-defense')) return null;
    if (!knownSuperiorDefense(row.sheet_extra).includes('stand-against-the-tide')) return null;
    const entry = await reactionReady(ctx, campaignId, sceneId, hunterId);
    if (!entry) return null;
    const scene = await getScene(db, campaignId, sceneId, false);
    const placements = await loadPlacements(db, campaignId, sceneId);
    const hunter = placements.find(item => item.character_id === hunterId && !item.parent_object_id);
    const attacker = placements.find(item => item.character_id === attackerId && !item.parent_object_id);
    if (!hunter || !attacker || !placementsHostile(hunter, attacker)) return null;
    const reach = Number((await db.query('SELECT range_feet FROM character_weapons WHERE campaign_id=$1 AND id=$2', [campaignId, weaponKey])).rows[0]?.range_feet ?? 5);
    const fallen = await deadCreatures(db, campaignId, placements.map(item => item.character_id));
    const victim = placements
      .filter(item => !item.parent_object_id && item.kind !== 'object' && item.character_id !== hunterId && item.character_id !== attackerId
        && !item.hidden && !fallen.has(item.character_id) && placementsHostile(item, hunter) && feetBetween(scene, attacker, item) <= Math.max(5, reach))
      .sort((a, b) => feetBetween(scene, attacker, a) - feetBetween(scene, attacker, b))[0];
    if (!victim) return null;
    await db.query('UPDATE initiative_entries SET reaction_used=true WHERE id=$1', [entry.id]);
    const owner = (await db.query('SELECT owner_user_id FROM campaigns WHERE id=$1', [campaignId])).rows[0]?.owner_user_id as string;
    const done: any = await rollCheckAs(ctx, owner, campaignId, { characterId: attackerId, kind: 'attack', key: weaponKey, targetCharacterId: victim.character_id, sceneId }, { free: true, tide: true });
    const hit = done.outcome?.hit === true;
    void notifyCampaign(ctx, campaignId, { type: 'initiative', sceneId });
    void notifyCampaign(ctx, campaignId, {
      type: 'notice', title: `${row.name}: «Против течения»`, tone: 'info',
      detail: `Промах по охотнику — реакцией удар уходит в «${victim.name}»: ${hit ? `попадание${done.damage ? `, ${done.damage.applied} урона` : ''}` : 'промах'}.`,
    });
    return { name: row.name as string, victim: victim.name as string, hit, damage: done.damage?.applied ?? null };
  } catch {
    return null;
  }
}

export async function uncannyDodge(q: Queryable, campaignId: string, sceneId: string | null, attackerId: string, targetId: string) {
  const row = (
    await q.query(`SELECT id, name, level, class_name, sheet_extra, auto_reactions FROM characters WHERE campaign_id=$1 AND id=$2`, [campaignId, targetId])
  ).rows[0] as any;
  if (!row) return null;
  const dodgeFeatures = classFeaturesFor(characterClassLevels(row).classes);
  const ready = (row.auto_reactions ?? []).includes('uncanny-dodge') && dodgeFeatures.some(feature => feature.id === 'uncanny-dodge');
  const hunter = dodgeFeatures.some(feature => feature.id === 'superior-hunters-defense') && knownSuperiorDefense(row.sheet_extra).includes('uncanny-dodge');
  if (!ready && !hunter) return null;
  if (reactionBlocked(await loadConditionState(q, campaignId, targetId))) return null;
  const entry = sceneId ? (await q.query('SELECT id, reaction_used FROM initiative_entries WHERE campaign_id=$1 AND scene_id=$2 AND character_id=$3 FOR UPDATE', [campaignId, sceneId, targetId])).rows[0] : null;
  if (entry?.reaction_used) return null;
  if (sceneId) {
    const sight = await sceneSight(q, campaignId, await getScene(q, campaignId, sceneId, false));
    const self = sight.placements.find(entry => entry.character_id === targetId && !entry.parent_object_id);
    const attacker = sight.placements.find(entry => entry.character_id === attackerId && !entry.parent_object_id);
    if (self && attacker && !(await seesCreature(q, campaignId, sight, self, attacker))) return null;
  }
  if (entry) await q.query('UPDATE initiative_entries SET reaction_used=true WHERE id=$1', [entry.id]);
  return { name: row.name as string };
}

export async function deflectMissiles(q: Queryable, campaignId: string, sceneId: string | null, targetId: string) {
  const row = (
    await q.query(`SELECT id, name, level, class_name, sheet_extra, dexterity FROM characters WHERE campaign_id=$1 AND id=$2 AND 'deflect-missiles' = ANY(auto_reactions)`, [campaignId, targetId])
  ).rows[0] as any;
  if (!row) return null;
  const classes = characterClassLevels(row).classes;
  if (!classFeaturesFor(classes).some(feature => feature.id === 'deflect-missiles')) return null;
  if (reactionBlocked(await loadConditionState(q, campaignId, targetId))) return null;
  const entry = sceneId ? (await q.query('SELECT id, reaction_used FROM initiative_entries WHERE campaign_id=$1 AND scene_id=$2 AND character_id=$3 FOR UPDATE', [campaignId, sceneId, targetId])).rows[0] : null;
  if (entry?.reaction_used) return null;
  if (entry) await q.query('UPDATE initiative_entries SET reaction_used=true WHERE id=$1', [entry.id]);
  const value = Math.max(0, rollDie(10) + abilityModifier(Number(row.dexterity ?? 10)) + classLevelOf(classes, 'monk', row.level));
  return { name: row.name as string, value };
}

export async function protectionStyle(q: Queryable, campaignId: string, sceneId: string | null, attackerId: string, targetId: string) {
  if (!sceneId) return null;
  const placements = await loadPlacements(q, campaignId, sceneId);
  const target = placements.find(entry => entry.character_id === targetId && !entry.parent_object_id);
  const attacker = placements.find(entry => entry.character_id === attackerId && !entry.parent_object_id);
  if (!target || !attacker || !placementFactions(target).length) return null;
  const ready = (
    await q.query(`SELECT id, name FROM characters WHERE campaign_id=$1 AND 'protection' = ANY(auto_reactions) AND id <> $2 AND id <> $3`, [campaignId, targetId, attackerId])
  ).rows as Array<{ id: string; name: string }>;
  if (!ready.length) return null;
  const scene = await getScene(q, campaignId, sceneId, false);
  let sight: SceneSight | null = null;
  for (const row of ready) {
    const guard = placements.find(entry => entry.character_id === row.id && !entry.parent_object_id);
    if (!guard || !placementsAllied(guard, target) || feetBetween(scene, guard, target) > 5) continue;
    if (reactionBlocked(await loadConditionState(q, campaignId, row.id))) continue;
    if ((await deadCreatures(q, campaignId, [row.id])).has(row.id)) continue;
    const entry = (await q.query('SELECT id, reaction_used FROM initiative_entries WHERE campaign_id=$1 AND scene_id=$2 AND character_id=$3 FOR UPDATE', [campaignId, sceneId, row.id])).rows[0];
    if (entry?.reaction_used) continue;
    sight ??= await sceneSight(q, campaignId, scene, placements);
    if (!(await seesCreature(q, campaignId, sight, guard, attacker))) continue;
    if (entry) await q.query('UPDATE initiative_entries SET reaction_used=true WHERE id=$1', [entry.id]);
    return { id: row.id, name: row.name };
  }
  return null;
}
export async function countercharmNear(q: Queryable, campaignId: string, characterId: string): Promise<string | null> {
  const bards = (
    await q.query(
      `SELECT e.character_id, c.name FROM character_effects e JOIN characters c ON c.campaign_id=e.campaign_id AND c.id=e.character_id
         WHERE e.campaign_id=$1 AND e.effect_code='countercharm' AND e.active`,
      [campaignId],
    )
  ).rows as Array<{ character_id: string; name: string }>;
  for (const bard of bards) {
    if (bard.character_id === characterId) return bard.name;
    const where = await sharedScene(q, campaignId, bard.character_id, characterId);
    if (!where) continue;
    const scene = await getScene(q, campaignId, where, false);
    const placements = await loadPlacements(q, campaignId, where);
    const self = placements.find(item => item.character_id === characterId && !item.parent_object_id);
    const singer = placements.find(item => item.character_id === bard.character_id && !item.parent_object_id);
    if (self && singer && placementsAllied(self, singer) && feetBetween(scene, self, singer) <= COUNTERCHARM_FEET) return bard.name;
  }
  return null;
}
