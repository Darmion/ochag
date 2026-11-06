import type { ClassId, ClassLevel } from '../character/classes.ts';

const FULL_CASTER: number[][] = [
  [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

const FULL: ClassId[] = ['bard', 'cleric', 'druid', 'sorcerer', 'wizard'];
const HALF: ClassId[] = ['paladin', 'ranger'];

function pad(slots: number[]): number[] {
  return Array.from({ length: 9 }, (_, index) => slots[index] ?? 0);
}

export function pactMagic(level: number): { count: number; slotLevel: number } {
  const value = Math.max(1, Math.min(20, Math.trunc(level)));
  const count = value === 1 ? 1 : value <= 10 ? 2 : value <= 16 ? 3 : 4;
  const slotLevel = Math.min(5, Math.ceil(value / 2));
  return { count, slotLevel };
}

export function spellSlotsFor(classId: ClassId | null, level: number | null | undefined): number[] | null {
  const value = Math.max(1, Math.min(20, Math.trunc(level ?? 1)));
  if (classId && FULL.includes(classId)) return pad(FULL_CASTER[value - 1]!);
  if (classId && HALF.includes(classId)) return value < 2 ? pad([]) : pad(FULL_CASTER[Math.ceil(value / 2) - 1]!);
  if (classId === 'warlock') {
    const { count, slotLevel } = pactMagic(value);
    return Array.from({ length: 9 }, (_, index) => (index + 1 === slotLevel ? count : 0));
  }
  return null;
}

export function isPactCaster(classId: ClassId | null) {
  return classId === 'warlock';
}

export type MulticlassSlots = {
  slots: number[];
  pact: { count: number; slotLevel: number } | null;
  casters: number;
};

export function multiclassSpellSlots(classes: ClassLevel[]): MulticlassSlots | null {
  const regular = classes.filter(entry => FULL.includes(entry.id) || HALF.includes(entry.id));
  const warlock = classes.find(entry => entry.id === 'warlock');
  if (!regular.length && !warlock) return null;
  let slots = pad([]);
  if (regular.length === 1) slots = spellSlotsFor(regular[0]!.id, regular[0]!.level)!;
  else if (regular.length > 1) {
    const casterLevel = regular.reduce((sum, entry) => sum + (FULL.includes(entry.id) ? entry.level : Math.floor(entry.level / 2)), 0);
    slots = casterLevel >= 1 ? pad(FULL_CASTER[Math.min(20, casterLevel) - 1]!) : pad([]);
  }
  return { slots, pact: warlock ? pactMagic(warlock.level) : null, casters: regular.length + (warlock ? 1 : 0) };
}
