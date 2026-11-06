import { knownFightingStyles } from '../feats.ts';
import { type ClassId, type ClassLevel, SUBCLASSES } from '../classes.ts';
import type { ClassFeature, FeatureId } from './catalog.ts';
import { classFeaturesFor } from './lookup.ts';

export function halfProficiency(
  classes: ClassLevel[], ability: string, proficiencyBonus: number,
): { value: number; reason: string } | null {
  const ids = new Set(classFeaturesFor(classes).map(feature => feature.id));
  const athlete = ids.has('remarkable-athlete') && ['strength', 'dexterity', 'constitution'].includes(ability) ? Math.ceil(proficiencyBonus / 2) : 0;
  const jack = ids.has('jack-of-all-trades') ? Math.floor(proficiencyBonus / 2) : 0;
  if (athlete <= 0 && jack <= 0) return null;
  return athlete >= jack ? { value: athlete, reason: `выдающийся атлет +${athlete}` } : { value: jack, reason: `мастер на все руки +${jack}` };
}

export function featureSaveProficiency(classes: ClassLevel[], ability: string): string | null {
  const ids = new Set(classFeaturesFor(classes).map(feature => feature.id));
  if (ids.has('diamond-soul')) return 'алмазная душа';
  if (ids.has('slippery-mind') && ability === 'wisdom') return 'скользкий ум';
  return null;
}

export const PROTECTION_STYLE: ClassFeature = {
  id: 'protection-style', classId: 'fighter', level: 1, name: 'Боевой стиль «Защита»', resource: null, use: 'passive',
  text: 'Со щитом: существо, которое вы видите, атакует союзника в 5 футах от вас — реакцией помеха этой атаке. «Наготове» — сама, без вопроса.',
};

export function hasProtectionStyle(sheetExtra: any): boolean {
  return knownFightingStyles(sheetExtra).ids.includes('protection');
}

export type UnarmoredDefense = { classId: ClassId; ability: 'constitution' | 'wisdom' | null; shield: boolean; ac: number };

export function unarmoredDefense(
  classes: ClassLevel[], scores: { dexterity: number; constitution: number; wisdom: number },
): UnarmoredDefense | null {
  const mod = (score: number) => Math.floor((score - 10) / 2);
  for (const entry of classes) {
    if (entry.id === 'barbarian') return { classId: 'barbarian', ability: 'constitution', shield: true, ac: 10 + mod(scores.dexterity) + mod(scores.constitution) };
    if (entry.id === 'monk') return { classId: 'monk', ability: 'wisdom', shield: false, ac: 10 + mod(scores.dexterity) + mod(scores.wisdom) };
    if (entry.id === 'sorcerer' && (entry.subclass ?? SUBCLASSES.sorcerer?.default) === 'draconic') {
      return { classId: 'sorcerer', ability: null, shield: true, ac: 13 + mod(scores.dexterity) };
    }
  }
  return null;
}

export function unarmoredAfterLevel(input: {
  ac: number;
  before: { classes: ClassLevel[]; scores: { dexterity: number; constitution: number; wisdom: number } };
  after: { classes: ClassLevel[]; scores: { dexterity: number; constitution: number; wisdom: number } };
}): number | null {
  const next = unarmoredDefense(input.after.classes, input.after.scores);
  if (!next) return null;
  const old = unarmoredDefense(input.before.classes, input.before.scores);
  const plain = 10 + Math.floor((input.before.scores.dexterity - 10) / 2);
  const base = old ? old.ac : plain;
  const shielded = input.ac === base + 2 && (old ? old.shield : true);
  if (input.ac !== base && !shielded) return null;
  const value = next.ac + (shielded && next.shield ? 2 : 0);
  if (!old && value < input.ac) return null;
  return value === input.ac ? null : value;
}

export const PROTECTION_FROM_EVIL_TYPES = ['aberration', 'celestial', 'elemental', 'fey', 'fiend', 'undead'] as const;

export const INITIATIVE_REFILLS: ReadonlyArray<{ feature: FeatureId; resource: string; amount: number; note: string }> = [
  { feature: 'superior-inspiration', resource: 'Вдохновение барда', amount: 1, note: 'превосходное вдохновение: +1 кость вдохновения' },
  { feature: 'perfect-self', resource: 'Ци', amount: 4, note: 'совершенство: +4 ци' },
];

export const FALL_DICE_MAX = 20;

export function fallDamageDice(feet: number): number {
  return Math.max(0, Math.min(FALL_DICE_MAX, Math.floor(feet / 10)));
}
