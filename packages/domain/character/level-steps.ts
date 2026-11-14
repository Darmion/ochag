import type { Ability } from './level-up.ts';

export type LevelStepResource = { name: string; before: { current: number; max: number; recharge: string | null } | null };

export type LevelStep = {
  from: number;
  to: number;
  hpGain: number;
  classBefore: string | null;
  classId: string | null;
  scores: Partial<Record<Ability, number>>;
  armorClass: number;
  subclass: { classId: string; before: string | null } | null;
  feat: string | null;
  levelsText: string | null;
  profText: string | null;
  skills: Array<{ index: string; created: boolean }>;
  expertise: string[];
  spells: string[];
  restoreSpell: string | null;
  weapons: { proficient: string[]; archery: string[]; dueling: string[] };
  resources: LevelStepResource[];
};

export const LEVEL_STEPS_KEPT = 20;

export function simpleLevelStep(from: number, to: number, hpGain: number, classBefore: string | null, classId: string | null): LevelStep {
  return {
    from, to, hpGain, classBefore, classId, scores: {}, armorClass: 0, subclass: null, feat: null, levelsText: null, profText: null,
    skills: [], expertise: [], spells: [], restoreSpell: null, weapons: { proficient: [], archery: [], dueling: [] }, resources: [],
  };
}

export function levelSteps(raw: unknown): LevelStep[] {
  return Array.isArray(raw)
    ? raw.filter((step): step is LevelStep => Boolean(step) && typeof step === 'object' && Number.isInteger(step.from) && Number.isInteger(step.to))
    : [];
}

export function withLevelStep(raw: unknown, step: LevelStep): LevelStep[] {
  return [...levelSteps(raw).filter(entry => entry.to <= step.from), step].slice(-LEVEL_STEPS_KEPT);
}

export function lastLevelStep(raw: unknown, level: number): LevelStep | null {
  const steps = levelSteps(raw);
  const last = steps[steps.length - 1];
  return last && last.to === level && last.from === level - 1 ? last : null;
}

export function withoutLastLevelStep(raw: unknown, level: number): LevelStep[] {
  return levelSteps(raw).filter(step => step.to < level);
}

export function averageLevelHp(hitDie: number, constitutionModifier: number, extraPerLevel = 0): number {
  return Math.max(1, hitDie / 2 + 1 + constitutionModifier) + extraPerLevel;
}

export function hpAfterLevelDown(current: number, max: number, hpGain: number): { current: number; max: number } {
  const nextMax = Math.max(1, max - hpGain);
  return { max: nextMax, current: current > 0 ? Math.max(1, Math.min(nextMax, current - hpGain)) : current };
}
