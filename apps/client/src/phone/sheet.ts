export type Campaign = { id: string; name: string; owner_user_id: string; is_full_gm: boolean };
export type RosterEntry = { id: string; name: string; owner_user_id: string; owner_display_name: string; kind: 'character' | 'npc' | 'object' };
export type Weapon = {
  id: string; name: string; ability: string; proficient: boolean;
  damage_formula: string | null; damage_type: string | null; weapon_kind: 'melee' | 'ranged';
  versatile_formula: string | null; attack_bonus: number;
};
export type Resource = { id: string; name: string; current: number; max: number; recharge: 'none' | 'short' | 'long' };
export type SkillState = { index: string; proficient: boolean; expertise: boolean };
export type SaveState = { ability: string; hidden: boolean; proficient: boolean | null; customBonus: number | null };
export type SpellSlot = { level: number; current: number; max: number };
export type KnownSpell = {
  id: string; prepared: boolean;
  spell: { name: string; nameRu: string | null; level: number } | null;
};

export const ABILITIES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'] as const;
export const ABILITY_LABELS: Record<string, string> = {
  strength: 'Сила', dexterity: 'Ловкость', constitution: 'Телосложение',
  intelligence: 'Интеллект', wisdom: 'Мудрость', charisma: 'Харизма',
};

const ABILITY_BY_CODE: Record<string, string> = {
  str: 'strength', dex: 'dexterity', con: 'constitution',
  int: 'intelligence', wis: 'wisdom', cha: 'charisma',
};

export function abilityForSkill(code: string): string {
  return ABILITY_BY_CODE[code] ?? 'dexterity';
}

// Same formula as packages/domain proficiencyBonusForLevel: the client does not import packages/domain.
export function proficiencyForLevel(level: number): number {
  return Math.ceil(level / 4) + 1;
}

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}
export function formatSigned(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

export function skillTotalFor(skill: SkillState, score: number, proficiency: number): number {
  const bonus = skill.proficient ? proficiency * (skill.expertise ? 2 : 1) : 0;
  return abilityModifier(score) + bonus;
}

export function saveTotalFor(save: SaveState, score: number, proficiency: number): number | null {
  if (save.hidden || save.proficient === null) return null;
  return abilityModifier(score) + (save.proficient ? proficiency : 0) + (save.customBonus ?? 0);
}

export function describeRoll(result: any): string {
  const parts = [`${result.label ?? 'Бросок'}: ${formatSigned(result.total)}`.replace('+', '')];
  const outcome = result.outcome ?? {};
  if (outcome.target) parts.push(outcome.critical ? 'КРИТ!' : outcome.hit ? 'попадание' : 'промах');
  if (result.damage) parts.push(`урон ${result.damage.roll?.total ?? result.damage.applied}`);
  return parts.join(' — ');
}
