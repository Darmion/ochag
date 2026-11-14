// Examining a creature or an object (complaint list 2026-11-11, item 2): the GM picks the skill, a DC, and a DC per part
// of what can be learned; one roll by the examining hero reveals every part whose DC it meets.
export const EXAMINE_PARTS = ['kind', 'hp', 'ac', 'abilities', 'defenses', 'conditions', 'text'] as const;
export type ExaminePart = typeof EXAMINE_PARTS[number];

export const EXAMINE_PART_LABELS: Record<ExaminePart, string> = {
  kind: 'Вид и уровень', hp: 'Хиты', ac: 'Класс доспеха', abilities: 'Характеристики',
  defenses: 'Сопротивления и иммунитеты', conditions: 'Состояния', text: 'Описание',
};

export const EXAMINE_SKILLS = ['perception', 'investigation', 'arcana', 'nature', 'religion', 'history', 'medicine', 'insight', 'survival'] as const;

export type ExamineSettings = { skill: string; dc: number; dcs: Partial<Record<ExaminePart, number>>; text: string };

// Without the GM's own numbers the obvious comes easier and the hidden harder than the base DC.
const OFFSETS: Record<ExaminePart, number> = { kind: -5, conditions: -5, hp: 0, ac: 0, text: 0, abilities: 2, defenses: 5 };

export function partDc(settings: ExamineSettings, part: ExaminePart): number {
  const own = settings.dcs[part];
  return typeof own === 'number' ? own : Math.max(1, settings.dc + OFFSETS[part]);
}

export function revealedParts(settings: ExamineSettings, total: number): ExaminePart[] {
  return EXAMINE_PARTS.filter(part => total >= partDc(settings, part));
}

// The usual SRD knowledge skill for a creature type; an object is studied with Investigation.
export function defaultExamineSkill(object: boolean, creatureType: string | null): string {
  if (object) return 'investigation';
  if (['aberration', 'construct', 'dragon', 'elemental', 'fey', 'monstrosity'].includes(creatureType ?? '')) return 'arcana';
  if (['beast', 'giant', 'ooze', 'plant'].includes(creatureType ?? '')) return 'nature';
  if (['celestial', 'fiend', 'undead'].includes(creatureType ?? '')) return 'religion';
  if (creatureType === 'humanoid') return 'history';
  return 'investigation';
}

export function defaultExamine(object: boolean, creatureType: string | null): ExamineSettings {
  return { skill: defaultExamineSkill(object, creatureType), dc: object ? 10 : 12, dcs: {}, text: '' };
}

export function cleanDcs(raw: unknown): Partial<Record<ExaminePart, number>> {
  const dcs: Partial<Record<ExaminePart, number>> = {};
  if (!raw || typeof raw !== 'object') return dcs;
  for (const part of EXAMINE_PARTS) {
    const value = (raw as Record<string, unknown>)[part];
    if (Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 40) dcs[part] = value as number;
  }
  return dcs;
}
