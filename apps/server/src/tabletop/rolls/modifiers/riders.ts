import type { Queryable } from '../../../db.ts';
import { classFeaturesFor } from '../../../../../../packages/domain/character/class-features.ts';
import { characterClassLevels } from '../../../../../../packages/domain/character/classes.ts';
import { factionBonusOf } from '../../../campaign/factions.ts';
import { rollMods } from '../../../../../../packages/domain/spells/spell-mods.ts';
import { loadConditionState } from '../../../rules/conditions.ts';
import { incapacitatedReason, conditionState, type Ability as ConditionAbility } from '../../../../../../packages/domain/combat/conditions.ts';
import { protectionAura } from '../../combat/auras.ts';
import { rollDie } from '../dice.ts';
import { fearSourceInSight } from '../../scene/movement.ts';
import { reject, type SaveBonus } from '../../shared.ts';
import { spellModsFor } from '../../spells/rules.ts';

export async function ownRollState(q: Queryable, campaignId: string, characterId: string) {
  const state = await loadConditionState(q, campaignId, characterId);
  if (!state.codes.has('frightened')) return state;
  const sources = (
    await q.query(
      `SELECT parameters->>'sourceCharacterId' AS source_id FROM character_effects
         WHERE campaign_id=$1 AND character_id=$2 AND effect_code='frightened' AND active`,
      [campaignId, characterId],
    )
  ).rows.map(row => row.source_id as string | null);
  if (!sources.length || sources.some(source => !source)) return state;
  if (!(await fearSourceInSight(q, campaignId, characterId, sources as string[], state.codes.has('blinded')))) {
    return { ...conditionState([...state.codes].filter(code => code !== 'frightened')), exhaustion: state.exhaustion };
  }
  return state;
}

export async function rollRiders(q: Queryable, campaignId: string, characterId: string, kind: string, bardic: boolean, ability: string | null = null, skill: string | null = null) {
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
  q: Queryable, campaignId: string, characterId: string, ability: ConditionAbility, own: ReturnType<typeof conditionState>,
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
