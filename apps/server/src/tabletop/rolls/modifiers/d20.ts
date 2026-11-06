import { hasFeat } from '../../../../../../packages/domain/character/feats.ts';
import { halfProficiency, classFeaturesFor } from '../../../../../../packages/domain/character/class-features.ts';
import { characterClassLevels } from '../../../../../../packages/domain/character/classes.ts';
import { hasRaceTrait, characterRace, adjustD20 } from '../../../../../../packages/domain/character/races.ts';
import { abilityModifier, proficiencyOf, type Advantage, rollCheck } from '../../../../../../packages/domain/dice/dice.ts';
import { rollDie } from '../dice.ts';
import { d20Formula } from './check-modifier.ts';

export function d20Traits(actor: any, kind: string, results: number[], advantage: Advantage, skillProficient: boolean) {
  const lucky = ['attack', 'save', 'skill', 'ability'].includes(kind) && hasRaceTrait(characterRace(actor), 'lucky');
  const floor10 = kind === 'skill' && skillProficient && classFeaturesFor(characterClassLevels(actor).classes).some(feature => feature.id === 'reliable-talent');
  return adjustD20(results, advantage, { lucky, floor10 }, rollDie);
}

export function mightFloor(actor: any, kind: string, ability: string, total: number): { total: number; note: string | null } {
  if ((kind !== 'skill' && kind !== 'ability') || ability !== 'strength') return { total, note: null };
  const score = Number(actor.strength ?? 0);
  if (total >= score || !classFeaturesFor(characterClassLevels(actor).classes).some(feature => feature.id === 'indomitable-might')) return { total, note: null };
  return { total: score, note: `неукротимая мощь: ${total} → ${score}` };
}

export function initiativeRoll(character: any) {
  const classes = characterClassLevels(character).classes;
  const proficiency = proficiencyOf(character);
  const half = proficiency !== null ? halfProficiency(classes, 'dexterity', proficiency) : null;
  const alert = hasFeat(character.sheet_extra, 'alert') ? 5 : 0;
  const modifier = abilityModifier(character.dexterity) + (half?.value ?? 0) + alert;
  const advantage: Advantage = classFeaturesFor(classes).some(feature => feature.id === 'feral-instinct') ? 'adv' : 'none';
  const traits = d20Traits(character, 'ability', rollCheck(modifier, advantage, rollDie).results, advantage, false);
  const reasons = [...(advantage === 'adv' ? ['преимущество: дикий инстинкт'] : []), ...(half ? [half.reason] : []), ...(alert ? ['настороженный +5'] : []), ...traits.notes];
  return {
    formula: d20Formula(modifier, advantage), results: traits.results, modifier, total: traits.kept + modifier,
    outcome: reasons.length ? { kind: 'initiative', advantage, reasons } : null,
  };
}
