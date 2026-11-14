import { featEffects } from './feats.ts';
import { characterRaceTraits, raceEffects, raceResistances } from './races.ts';
import { traitResistances, type SourcedEffect } from './traits.ts';

export function characterTraitEffects(character: { sheet_extra?: unknown }): SourcedEffect[] {
  return [...raceEffects(characterRaceTraits(character)), ...featEffects(character.sheet_extra)];
}

export function characterResistances(character: { sheet_extra?: unknown }): string[] {
  return [...new Set([...raceResistances(character), ...traitResistances(featEffects(character.sheet_extra))])];
}
