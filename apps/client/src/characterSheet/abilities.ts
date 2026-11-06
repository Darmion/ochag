export const ABILITIES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'] as const;
export type Ability = typeof ABILITIES[number];

export const ABILITY_LABELS: Record<string, string> = {
  strength: 'Сила', dexterity: 'Ловкость', constitution: 'Телосложение',
  intelligence: 'Интеллект', wisdom: 'Мудрость', charisma: 'Харизма',
};

export const ABILITY_BY_INDEX: Record<string, Ability> = {
  str: 'strength', dex: 'dexterity', con: 'constitution',
  int: 'intelligence', wis: 'wisdom', cha: 'charisma',
};

export function modifierValue(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function formatSigned(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

export function modifier(score: number): string {
  return formatSigned(modifierValue(score));
}
