// A hero's skill check inside a mini-game (roadmap 4.4): the GM picks the skill and the DC, the server rolls,
// and each hero tries once per game.
export const CHECK_SKILLS = {
  'rune-lock': ['arcana', 'investigation'],
  'map-fragments': ['history', 'survival', 'investigation'],
  'dragon-dice': ['sleight-of-hand'],
} as const;
// With the ability, so the label is its own translation key: a bare «Магия» is also the spells button («Magic»).
export const CHECK_SKILL_NAMES: Record<string, string> = {
  arcana: 'Магия (Интеллект)', investigation: 'Расследование (Интеллект)', history: 'История (Интеллект)',
  survival: 'Выживание (Мудрость)', 'sleight-of-hand': 'Ловкость рук (Ловкость)',
};
export type CheckActor = { id: string; name: string };
export type SkillCheck = { skill: string; dc: number; tried: CheckActor[] };

export function validDc(dc: unknown): dc is number {
  return Number.isInteger(dc) && (dc as number) >= 5 && (dc as number) <= 30;
}

export function newCheck(kind: keyof typeof CHECK_SKILLS, skill: string | undefined, dc: number | undefined): SkillCheck | null {
  if (!skill) return null;
  if (!(CHECK_SKILLS[kind] as readonly string[]).includes(skill)) throw new Error('Этот навык не подходит для мини-игры.');
  if (!validDc(dc)) throw new Error('СЛ проверки: от 5 до 30.');
  return { skill, dc, tried: [] };
}

export function assertFreshTry(tried: CheckActor[], actor: CheckActor) {
  if (tried.some(entry => entry.id === actor.id)) throw new Error(`У «${actor.name}» уже была попытка: каждый герой пробует один раз.`);
}
