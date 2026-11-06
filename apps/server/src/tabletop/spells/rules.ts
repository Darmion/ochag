import type { Queryable } from '../../db.ts';
import { startOf } from '../../campaign/encounter-routes.ts';
import { type CreatureType, creatureTypeFromText, spellTargetRules, targetTypeProblem, CREATURE_TYPE_LABELS } from '../../../../../packages/domain/spells/spell-targets.ts';
import type { CastPlan } from '../../../../../packages/domain/spells/spell-template-engine.ts';
import { spellModsOf } from '../../../../../packages/domain/spells/spell-mods.ts';
import { findMonster } from '../../../../../packages/domain/world/bestiary.ts';
import { type ParsedFormula, parseFormula, rollDice } from '../../../../../packages/domain/dice/dice.ts';
import { type FormulaContext, resolveFormula } from '../../../../../packages/domain/dice/formula.ts';
import { footprintCells, occupiedCells } from '../../../../../packages/domain/map/footprint.ts';

import { sceneSight, type SceneSight, seenFrom, seesCreature } from '../combat/sight.ts';
import { campaignFlag, rollDie } from '../rolls/dice.ts';
import { getScene } from '../scene/board.ts';
import { reject } from '../shared.ts';

export function resolveSpellFormula(formulaText: string | null, label: string, context: FormulaContext) {
  if (!formulaText) return null;
  const resolved = resolveFormula(formulaText, context);
  if (!resolved.ok) {
    const reason =
      resolved.reason === 'unknown-token' ? `неизвестная переменная @${resolved.token}`
      : resolved.reason === 'missing-value' ? `нет значения для @${resolved.token}`
      : 'некорректный формат';
    reject(400, `${label}: ${reason}.`);
  }
  return resolved;
}

// Upcast dice are rolled, not multiplied from the result: multiplying would double the modifier too.
export function applyUpcast(
  base: { results: number[]; total: number },
  baseParsed: ParsedFormula,
  baseFormula: string,
  upcastFormula: string | null,
  extraLevels: number,
  die: (sides: number) => number = rollDie,
): { results: number[]; total: number; modifier: number; formula: string } {
  if (extraLevels <= 0 || !upcastFormula) {
    return { results: base.results, total: base.total, modifier: baseParsed.modifier, formula: baseFormula };
  }

  const upcastParsed = parseFormula(upcastFormula);
  if (!upcastParsed) reject(400, 'Формула повышения ячейки повреждена — обратитесь к тому, кто её вписал.');
  if (upcastParsed.sides !== baseParsed.sides) {
    reject(400, 'Формула повышения ячейки использует кости другого типа, чем основная формула — применить нельзя.');
  }

  const extraCount = upcastParsed.count * extraLevels;
  const extra = rollDice({ count: extraCount, sides: upcastParsed.sides, modifier: 0 }, die);
  const finalCount = baseParsed.count + extraCount;
  const signedModifier = baseParsed.modifier === 0 ? '' : baseParsed.modifier > 0 ? `+${baseParsed.modifier}` : `${baseParsed.modifier}`;

  return {
    results: [...base.results, ...extra.results],
    total: base.total + extra.total,
    modifier: baseParsed.modifier,
    formula: `${finalCount}d${baseParsed.sides}${signedModifier}`,
  };
}

export async function creatureTypeOf(q: Queryable, campaignId: string, characterId: string): Promise<CreatureType | null> {
  const row = (await q.query('SELECT kind, sheet_extra FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0] as any;
  if (!row) return null;
  const own = creatureTypeFromText(row.sheet_extra?.creatureType);
  if (own) return own;
  const monster = typeof row.sheet_extra?.srdMonster === 'string' ? findMonster(row.sheet_extra.srdMonster) : undefined;
  if (monster) return creatureTypeFromText(monster.type);
  return row.kind === 'character' ? 'humanoid' : null;
}

export async function assertSpellTargets(
  q: Queryable, campaignId: string, casterId: string, sceneId: string | null, targetIds: string[], spellName: string, desc: string,
) {
  const others = targetIds.filter(id => id !== casterId);
  if (!others.length || (await campaignFlag(q, campaignId, 'spell_targets')) === false) return;
  const rules = spellTargetRules(desc);
  if (!rules.only && !rules.excluded.length && !rules.mustSee) return;
  let sight: SceneSight | null = null;
  for (const targetId of others) {
    const name = (await q.query('SELECT name FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, targetId])).rows[0]?.name ?? 'цель';
    const problem = targetTypeProblem(rules, await creatureTypeOf(q, campaignId, targetId));
    if (problem) reject(400, `«${spellName}» ${problem}: «${name}».`);
    if (rules.mustSee && sceneId) {
      sight ??= await sceneSight(q, campaignId, await getScene(q, campaignId, sceneId, false));
      const caster = sight.placements.find(entry => entry.character_id === casterId && !entry.parent_object_id);
      const target = sight.placements.find(entry => entry.character_id === targetId && !entry.parent_object_id);
      if (caster && target && !(await seesCreature(q, campaignId, sight, caster, target))) {
        reject(400, `${caster.name} не видит «${name}» — «${spellName}» требует видеть цель.`);
      }
    }
  }
}

export const SPELL_EFFECTS: Record<string, { code: string; rounds: number; self?: boolean; parameters?: Record<string, unknown> }> = {
  invisibility: { code: 'invisible', rounds: 600, parameters: { endsOnAttack: true } },
  'greater-invisibility': { code: 'invisible', rounds: 10 },
  'see-invisibility': { code: 'see_invisibility', rounds: 600, self: true },
  'true-seeing': { code: 'truesight', rounds: 600, parameters: { feet: 120 } },
  guidance: { code: 'guidance', rounds: 10 },
  resistance: { code: 'resistance_die', rounds: 10 },
  'true-strike': { code: 'true_strike', rounds: 2, self: true },
  barkskin: { code: 'barkskin', rounds: 600 },
  longstrider: { code: 'longstrider', rounds: 600 },
  'expeditious-retreat': { code: 'expeditious', rounds: 100, self: true },
  blur: { code: 'blurred', rounds: 10, self: true },
  'protection-from-energy': { code: 'energy_ward', rounds: 600 },
  stoneskin: { code: 'stoneskin', rounds: 600 },
  'death-ward': { code: 'death_ward', rounds: 4800 },
  'mirror-image': { code: 'mirror_images', rounds: 10, self: true, parameters: { images: 3 } },
  shillelagh: { code: 'shillelagh', rounds: 10, self: true },
  'magic-weapon': { code: 'magic_weapon', rounds: 600 },
  'warding-bond': { code: 'warding_bond', rounds: 600 },
  'beacon-of-hope': { code: 'beacon_of_hope', rounds: 10 },
  darkvision: { code: 'darkvision_spell', rounds: 4800 },
};
export const ENERGY_TYPES = ['acid', 'cold', 'fire', 'lightning', 'thunder'] as const;

export async function spellModsFor(q: Queryable, campaignId: string, characterId: string) {
  return spellModsOf((await q.query(
    `SELECT id, parameters FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code='spell_mod'`,
    [campaignId, characterId],
  )).rows as Array<{ id: string; parameters: any }>);
}

export async function assertTemplateTargets(
  q: Queryable, campaignId: string, casterId: string, sceneId: string | null, targetIds: string[], spellName: string, rules: CastPlan['rules'],
) {
  const others = targetIds.filter(id => id !== casterId);
  if (!others.length || (await campaignFlag(q, campaignId, 'spell_targets')) === false) return;
  let sight: SceneSight | null = null;
  const label = (type: string) => CREATURE_TYPE_LABELS[type as CreatureType] ?? type;
  for (const targetId of others) {
    const name = (await q.query('SELECT name FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, targetId])).rows[0]?.name ?? 'цель';
    const type = await creatureTypeOf(q, campaignId, targetId);
    if (type && rules.only.length && !rules.only.includes(type)) reject(400, `«${spellName}» — только на: ${rules.only.map(label).join(', ')}; «${name}» — ${label(type)}.`);
    if (type && rules.excluded.includes(type)) reject(400, `«${spellName}» не действует на: ${label(type)} — «${name}».`);
    if (rules.mustSee && sceneId) {
      sight ??= await sceneSight(q, campaignId, await getScene(q, campaignId, sceneId, false));
      const caster = sight.placements.find(entry => entry.character_id === casterId && !entry.parent_object_id);
      const target = sight.placements.find(entry => entry.character_id === targetId && !entry.parent_object_id);
      if (caster && target && !(await seesCreature(q, campaignId, sight, caster, target))) reject(400, `${caster.name} не видит «${name}» — «${spellName}» требует видеть цель.`);
    }
  }
}

export async function mistyStep(q: Queryable, campaignId: string, sceneId: string, characterId: string, place: { x: number; z: number }, spellName: string, range = 30) {
  const scene = (await getScene(q, campaignId, sceneId, true)) as any;
  const sight = await sceneSight(q, campaignId, scene);
  const me = sight.placements.find(entry => entry.character_id === characterId && !entry.parent_object_id);
  if (!me) reject(400, `«${spellName}»: заклинателя нет на этой сцене.`);
  const n = footprintCells(me!.size);
  const origin = startOf(scene, place.x, place.z, n);
  if (origin.col < 0 || origin.row < 0 || origin.col + n > scene.width_cells || origin.row + n > scene.height_cells) reject(400, `«${spellName}»: место за краем карты.`);
  const to = { x: origin.col + n / 2 - scene.width_cells / 2, z: origin.row + n / 2 - scene.height_cells / 2 };
  const feet = Math.max(Math.abs(to.x - me!.world_x), Math.abs(to.z - me!.world_z)) * scene.feet_per_unit;
  if (feet > range + 1e-6) reject(400, `«${spellName}»: дальше ${range} фт.`);
  if (feet < 1e-6) reject(400, `«${spellName}»: выберите другое место.`);
  const occupied = new Set(sight.placements.filter(entry => entry.id !== me!.id && !entry.parent_object_id)
    .flatMap(entry => occupiedCells(scene, entry.world_x, entry.world_z, footprintCells(entry.size)).map(cell => `${cell.col}:${cell.row}`)));
  for (let r = origin.row; r < origin.row + n; r += 1) for (let c = origin.col; c < origin.col + n; c += 1) {
    if (occupied.has(`${c}:${r}`)) reject(400, `«${spellName}»: место занято.`);
  }
  if (!seenFrom(sight, me!, to.x, to.z)) reject(400, `«${spellName}»: этого места не видно — стена, темнота или туман.`);
  await q.query('UPDATE scene_objects SET x=$3, z=$4, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, me!.id, to.x, to.z]);
  await q.query('UPDATE scenes SET revision=revision+1 WHERE id=$1', [sceneId]);
  return Math.round(feet);
}
