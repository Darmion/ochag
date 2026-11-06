import { DAMAGE_WORDS, abilityName, damageFormula, integer, numberOrNull, object, text } from '../../../packages/importer/proposal/internal.ts';
import type { ImportedWeapon } from '../../../packages/importer/proposal/structure.ts';

const RANGED_WEAPON = /лук|арбалет|праща|дротик|духов\S* трубк|bow|crossbow|sling|dart|blowgun/i;

const FINESSE_WEAPON = /рапир|кинжал|коротк\S* меч|скимитар|кнут|rapier|dagger|short ?sword|scimitar|whip/i;

function weaponAbility(ability: string | null, name: string): ImportedWeapon['ability'] {
  if (ability === 'dexterity' || ability === 'strength') return ability;
  if (RANGED_WEAPON.test(name)) return 'dexterity';
  if (FINESSE_WEAPON.test(name)) return 'finesse';
  return 'strength';
}

export function lssWeapon(raw: unknown, modifier: (ability: string) => number, proficiencyBonus: number): ImportedWeapon | null {
  const entry = object(raw);
  const name = text(entry.name) ?? (typeof raw === 'string' ? raw : null);
  if (!name) return null;
  const ability = weaponAbility(abilityName(entry.ability), name);
  const proficient = entry.isProf !== false;
  const abilityMod = ability === 'finesse' ? Math.max(modifier('strength'), modifier('dexterity')) : modifier(ability);
  const expected = abilityMod + (proficient ? proficiencyBonus : 0);
  const extra = integer(entry.modBonus, -10, 20);
  const shown = numberOrNull(text(entry.mod)?.replace('+', '') ?? null);
  const attackBonus = extra ?? (shown === null || shown === 0 ? 0 : shown >= expected ? shown - expected : shown);
  const dmg = text(entry.dmg, 60);
  const notes = `${text(entry.notes, 200) ?? ''} ${text(entry.dmgType, 40) ?? ''} ${dmg ?? ''}`;
  const damageType = DAMAGE_WORDS.find(([pattern]) => pattern.test(notes))?.[1] ?? null;
  return { name, ability, proficient, damageFormula: dmg, damageType, attackBonus: Math.max(-10, Math.min(20, Math.round(attackBonus))) };
}

export function legacyLssWeapon(raw: unknown, modifier: (ability: string) => number, proficiencyBonus: number) {
  const entry = object(raw);
  const name = text(entry.name) ?? (typeof raw === 'string' ? raw : null);
  if (!name) return null;
  const ability = abilityName(entry.ability) === 'dexterity' ? 'dexterity' : 'strength';
  const proficient = entry.isProf !== false;
  const total = numberOrNull(text(entry.mod)?.replace('+', '') ?? null);
  const attackBonus = total === null ? 0 : Math.max(-10, Math.min(20, Math.round(total - modifier(ability) - (proficient ? proficiencyBonus : 0))));
  const value = text(entry.dmg, 60);
  const compact = value ? value.toLowerCase().replace(/\s+/g, '').replace(/к/g, 'd') : '';
  const damageFormula = /^(\d{0,2}d\d{1,3})([+-](\d{1,2}d\d{1,3}|\d{1,3}))*$/.test(compact) ? compact : null;
  return { name, ability, attackBonus, damageFormula };
}

export const normalizeLssDamage = (value: unknown) => damageFormula(value);
