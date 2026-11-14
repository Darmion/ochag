import type { Queryable } from '../../../db.ts';
import { classFeaturesFor } from '../../../../../../packages/domain/character/class-features.ts';
import { characterClassLevels } from '../../../../../../packages/domain/character/classes.ts';
import { factionBonusOf } from '../../../campaign/factions.ts';
import { characterTraitEffects } from '../../../../../../packages/domain/character/hero-traits.ts';
import { traitRollBonus } from '../../../../../../packages/domain/character/traits.ts';
import { rollMods } from '../../../../../../packages/domain/spells/spell-mods.ts';
import { loadConditionState } from '../../../rules/conditions.ts';
import { conditionRollBonus, incapacitatedReason, type Ability as ConditionAbility, type ConditionState, type D20Kind } from '../../../../../../packages/domain/combat/conditions.ts';
import { ruleOf } from '../../../../../../packages/domain/combat/condition-rules.ts';
import { protectionAura } from '../../combat/auras.ts';
import { rollDie } from '../dice.ts';
import { fearSourceInSight } from '../../scene/movement.ts';
import { reject, type SaveBonus } from '../../shared.ts';
import { spellModsFor } from '../../spells/rules.ts';

// A clause that holds only while the source is in sight rests while every source of that condition is out of it.
export async function ownRollState(q: Queryable, campaignId: string, characterId: string) {
  const state = await loadConditionState(q, campaignId, characterId);
  const watched = [...state.codes].filter(code => ruleOf(state.rules, code)?.clauses.some(clause => clause.values.whileSourceSeen === true));
  if (!watched.length) return state;
  const outOfSight = new Set<string>();
  for (const code of watched) {
    const sources = (
      await q.query(
        `SELECT parameters->>'sourceCharacterId' AS source_id FROM character_effects
           WHERE campaign_id=$1 AND character_id=$2 AND effect_code=$3 AND active`,
        [campaignId, characterId, code],
      )
    ).rows.map(row => row.source_id as string | null);
    if (!sources.length || sources.some(source => !source)) continue;
    if (!(await fearSourceInSight(q, campaignId, characterId, sources as string[], state.codes.has('blinded')))) outOfSight.add(code);
  }
  return outOfSight.size ? { ...state, outOfSight } : state;
}

export async function rollRiders(
  q: Queryable, campaignId: string, characterId: string, kind: string, bardic: boolean, ability: string | null = null, skill: string | null = null,
  sense: 'sight' | 'hearing' | null = null,
) {
  const effects = (
    await q.query(
      `SELECT id, effect_code, parameters FROM character_effects
         WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code IN ('blessed', 'baned', 'bardic_inspiration', 'guidance', 'resistance_die')`,
      [campaignId, characterId],
    )
  ).rows as Array<{ id: string; effect_code: string; parameters: any }>;
  const list: Array<{ label: string; die: string; value: number }> = [];
  if (kind === 'attack' || kind === 'save') {
    for (const [code, label, sign] of [['blessed', 'благословение', 1], ['baned', 'порча', -1]] as const) {
      const effect = effects.find(entry => entry.effect_code === code);
      if (!effect) continue;
      const sides = Number(effect.parameters?.die ?? 4);
      list.push({ label, die: `${sign > 0 ? '+' : '−'}к${sides}`, value: sign * rollDie(sides) });
    }
  }
  const once = kind === 'skill' || kind === 'ability' ? effects.find(entry => entry.effect_code === 'guidance')
    : kind === 'save' ? effects.find(entry => entry.effect_code === 'resistance_die') : undefined;
  if (once) {
    list.push({ label: once.effect_code === 'guidance' ? 'указание' : 'сопротивление', die: '+к4', value: rollDie(4) });
    await q.query('DELETE FROM character_effects WHERE id=$1', [once.id]);
  }
  if (bardic) {
    const effect = effects.find(entry => entry.effect_code === 'bardic_inspiration');
    if (!effect) reject(400, 'Кости «Вдохновения барда» нет — её даёт бард бонусным действием.');
    const sides = Number(effect.parameters?.die ?? 6);
    list.push({ label: `вдохновение барда${effect.parameters?.sourceName ? ` (${effect.parameters.sourceName})` : ''}`, die: `+к${sides}`, value: rollDie(sides) });
    await q.query('DELETE FROM character_effects WHERE id=$1', [effect.id]);
  }
  const templated = rollMods(await spellModsFor(q, campaignId, characterId), kind === 'attack' ? 'attack' : kind === 'save' ? 'save' : 'check', ability, skill);
  for (const die of templated.dice) list.push({ label: die.label, die: `${die.sign > 0 ? '+' : '−'}к${die.sides}`, value: die.sign * rollDie(die.sides) });
  if (templated.flat) list.push({ label: 'заклинание', die: `${templated.flat > 0 ? '+' : '−'}${Math.abs(templated.flat)}`, value: templated.flat });
  if (templated.spentDice.length) await q.query('DELETE FROM character_effects WHERE id = ANY($1::uuid[])', [templated.spentDice]);
  const d20Kind: D20Kind | null = kind === 'attack' || kind === 'save' || kind === 'ability' || kind === 'skill' ? kind : null;
  const held = d20Kind ? conditionRollBonus(await loadConditionState(q, campaignId, characterId), d20Kind, ability as ConditionAbility | null, sense) : null;
  if (held?.value) list.push({ label: held.reasons.join(', '), die: `${held.value > 0 ? '+' : '−'}${Math.abs(held.value)}`, value: held.value });
  if (d20Kind) {
    const owner = (await q.query(`SELECT sheet_extra FROM characters WHERE campaign_id=$1 AND id=$2 AND kind <> 'object'`, [campaignId, characterId])).rows[0];
    const traits = owner ? traitRollBonus(characterTraitEffects(owner), d20Kind, ability) : null;
    if (traits?.value) list.push({ label: traits.reasons.map(reason => reason.replace(/ [+−]\d+$/, '')).join(', '), die: `${traits.value > 0 ? '+' : '−'}${Math.abs(traits.value)}`, value: traits.value });
  }
  const value = list.reduce((sum, entry) => sum + entry.value, 0);
  const formula = list.filter(entry => entry.die.includes('к')).map(entry => `${entry.die.startsWith('−') ? '-' : '+'}1d${entry.die.replace(/^[+−]к/, '')}`).join('');
  const reasons = list.map(entry => `${entry.label} ${entry.die}: ${entry.value >= 0 ? '+' : ''}${entry.value}`);
  return { value, formula, list, reasons };
}

export async function bardicOnFailedSave(q: Queryable, campaignId: string, characterId: string, shortBy: number) {
  const rule = (await q.query(`SELECT value FROM campaign_rules WHERE campaign_id=$1 AND key='bardic_saves' AND kind='text'`, [campaignId])).rows[0]?.value;
  if (rule === 'manual') return null;
  const effect = (
    await q.query(`SELECT id, parameters FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='bardic_inspiration' AND active LIMIT 1`, [campaignId, characterId])
  ).rows[0] as { id: string; parameters: any } | undefined;
  if (!effect) return null;
  const sides = Number(effect.parameters?.die ?? 6);
  if (shortBy > sides) return null;
  await q.query('DELETE FROM character_effects WHERE id=$1', [effect.id]);
  return { label: `вдохновение барда${effect.parameters?.sourceName ? ` (${effect.parameters.sourceName})` : ''}`, die: `+к${sides}`, value: rollDie(sides) };
}

export async function saveAids(
  q: Queryable, campaignId: string, characterId: string, ability: ConditionAbility, own: ConditionState,
): Promise<{ bonus: SaveBonus | null; advantages: string[] }> {
  const advantages: string[] = [];
  if (ability === 'dexterity' && !own.codes.has('blinded') && !own.codes.has('deafened') && !incapacitatedReason(own)) {
    const row = (await q.query('SELECT id, level, class_name, sheet_extra FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0] as any;
    if (row && classFeaturesFor(characterClassLevels(row).classes).some(feature => feature.id === 'danger-sense')) advantages.push('опасное чутьё');
  }
  const aura = await protectionAura(q, campaignId, characterId);
  const faction = await factionBonusOf(q, campaignId, characterId, 'save');
  const parts = [
    ...(aura ? [{ value: aura.bonus, reason: `аура защиты${aura.name ? ` (${aura.name})` : ''} +${aura.bonus}` }] : []),
    ...(faction.value ? [{ value: faction.value, reason: faction.reasons.join(', ') }] : []),
    ...(ability === 'dexterity' && own.codes.has('slow_spell') ? [{ value: -2, reason: 'замедление: −2' }] : []),
    ...(own.codes.has('warding_bond') ? [{ value: 1, reason: 'охраняющая связь +1' }] : []),
  ];
  const bonus = parts.length ? { value: parts.reduce((sum, part) => sum + part.value, 0), reason: parts.map(part => part.reason).join(', ') } : null;
  return { bonus, advantages };
}
