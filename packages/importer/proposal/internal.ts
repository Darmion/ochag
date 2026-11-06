export function object(value: unknown): Record<string, any> {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

export function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

export function readPath(
  root: Record<string, any>,
  path: string,
): unknown {
  let current: unknown = root;

  for (const segment of path.split('.')) {
    if (
      current === null ||
      typeof current !== 'object' ||
      !Object.hasOwn(current, segment)
    ) {
      return null;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current ?? null;
}

export const ABILITY_BY_SHORT: Record<string, string> = {
  str: 'strength', dex: 'dexterity', con: 'constitution', int: 'intelligence', wis: 'wisdom', cha: 'charisma',
};

export const ABILITY_NAMES = Object.values(ABILITY_BY_SHORT);

export const SKILLS = [
  'acrobatics', 'animal-handling', 'arcana', 'athletics', 'deception', 'history', 'insight', 'intimidation', 'investigation',
  'medicine', 'nature', 'perception', 'performance', 'persuasion', 'religion', 'sleight-of-hand', 'stealth', 'survival',
];

export const DAMAGE_WORDS: Array<[RegExp, string]> = [
  [/рубящ|slash/i, 'slashing'], [/кол[юя]щ|pierc/i, 'piercing'], [/дробящ|bludg/i, 'bludgeoning'],
  [/огн|fire/i, 'fire'], [/холод|cold/i, 'cold'], [/молни|electr|lightning/i, 'lightning'], [/звук|гром|thunder/i, 'thunder'],
  [/кислот|acid/i, 'acid'], [/яд|poison/i, 'poison'], [/некрот|necrot/i, 'necrotic'], [/излуч|свет|radiant/i, 'radiant'],
  [/силов|force/i, 'force'], [/психич|psychic/i, 'psychic'],
];

export function valueOf(entry: unknown): unknown {
  return entry !== null && typeof entry === 'object' && !Array.isArray(entry) && 'value' in (entry as object)
    ? (entry as Record<string, unknown>).value
    : entry;
}

export function text(entry: unknown, max = 100): string | null {
  const value = valueOf(entry);
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export function integer(entry: unknown, min: number, max: number): number | null {
  const value = numberOrNull(valueOf(entry));
  if (value === null) return null;
  const rounded = Math.round(value);
  return rounded >= min && rounded <= max ? rounded : null;
}

export function abilityName(entry: unknown): string | null {
  const value = text(entry, 20)?.toLowerCase() ?? null;
  if (!value) return null;
  if (ABILITY_NAMES.includes(value)) return value;
  return ABILITY_BY_SHORT[value.slice(0, 3)] ?? null;
}

export const SPELL_REF_ID = /^[0-9a-f]{24}$/;

export const SLUG = /^[a-z0-9_]{1,80}$/;

export function idList(entry: unknown): string[] {
  return [...new Set((Array.isArray(entry) ? entry : []).filter((id): id is string => typeof id === 'string' && SPELL_REF_ID.test(id)))].slice(0, 300);
}

export function signedNumber(entry: unknown, min: number, max: number): number | null {
  const value = text(entry, 10)?.replace(/^\+/, '').replace(',', '.');
  return value && /^-?\d+$/.test(value) ? integer(Number(value), min, max) : null;
}

export function damageFormula(entry: unknown): string | null {
  const value = text(entry, 60);
  if (!value) return null;
  const compact = value.toLowerCase().replace(/\s+/g, '')
    .replace(/\[(?:str|dex|con|int|wis|cha|сил|лов|тел|инт|мдр|муд|хар)\]/g, '@mod')
    .replace(/к/g, 'd');
  return /^\d{0,2}d\d{1,3}(?:[+-](?:\d{1,2}d\d{1,3}|\d{1,3}|@mod))*/.exec(compact)?.[0] ?? null;
}
