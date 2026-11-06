import { SRD_MONSTERS, type MonsterSize, type SrdMonster } from '../srd/monsters.ts';

export type SummonKind = 'familiar' | 'steed' | 'conjure-animals';
export type SpellSummon = { kind: SummonKind; forms: string[]; concentration: boolean };

export const FAMILIAR_FORMS = [
  'bat', 'cat', 'crab', 'frog', 'hawk', 'lizard', 'octopus', 'owl', 'poisonous-snake', 'quipper', 'rat', 'raven', 'sea-horse', 'spider', 'weasel',
];
export const STEED_FORMS = ['warhorse', 'pony', 'camel', 'elk', 'mastiff'];

export const CONJURE_OPTIONS: ReadonlyArray<{ cr: number; count: number }> = [
  { cr: 2, count: 1 }, { cr: 1, count: 2 }, { cr: 0.5, count: 4 }, { cr: 0.25, count: 8 },
];

const beasts = () => SRD_MONSTERS.filter(monster => monster.type === 'зверь');

export function spellSummon(index: string | null | undefined): SpellSummon | null {
  if (index === 'find-familiar') return { kind: 'familiar', forms: FAMILIAR_FORMS, concentration: false };
  if (index === 'find-steed') return { kind: 'steed', forms: STEED_FORMS, concentration: false };
  if (index === 'conjure-animals') return { kind: 'conjure-animals', forms: beasts().filter(beast => beast.cr <= 2).map(beast => beast.index), concentration: true };
  return null;
}

export function conjureCount(option: number, slotLevel: number): number | null {
  const base = CONJURE_OPTIONS[option];
  if (!base) return null;
  const times = slotLevel >= 9 ? 4 : slotLevel >= 7 ? 3 : slotLevel >= 5 ? 2 : 1;
  return base.count * times;
}

export function summonProblem(rule: SpellSummon, beast: SrdMonster | undefined, option: number | null): string | null {
  if (!beast || !rule.forms.includes(beast.index)) return 'такой формы у заклинания нет';
  if (rule.kind !== 'conjure-animals') return null;
  const chosen = CONJURE_OPTIONS[option ?? -1];
  if (!chosen) return 'выберите, сколько зверей';
  return beast.cr > chosen.cr ? `опасность зверя выше ${challengeLabel(chosen.cr)}` : null;
}

export type SpellShape = { kind: 'polymorph' | 'animal-shapes'; maxCr: number | null; maxSize: MonsterSize | null };

export function spellShape(index: string | null | undefined): SpellShape | null {
  if (index === 'polymorph') return { kind: 'polymorph', maxCr: null, maxSize: null };
  if (index === 'animal-shapes') return { kind: 'animal-shapes', maxCr: 4, maxSize: 'large' };
  return null;
}

const SIZES: MonsterSize[] = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'];

export function shapeForms(rule: SpellShape): SrdMonster[] {
  return beasts().filter(beast => (rule.maxCr === null || beast.cr <= rule.maxCr)
    && (rule.maxSize === null || SIZES.indexOf(beast.size) <= SIZES.indexOf(rule.maxSize)));
}

export function polymorphLimit(target: { challenge_rating?: number | string | null; level?: number | null }): number {
  const cr = Number(target.challenge_rating);
  if (target.challenge_rating !== null && target.challenge_rating !== undefined && Number.isFinite(cr)) return cr;
  return Math.max(0, Number(target.level ?? 0) || 0);
}

export function shapeProblem(rule: SpellShape, beast: SrdMonster | undefined, target: { challenge_rating?: number | string | null; level?: number | null }): string | null {
  if (!beast || !shapeForms(rule).some(form => form.index === beast.index)) return 'такого облика у заклинания нет';
  if (rule.kind === 'polymorph') {
    const limit = polymorphLimit(target);
    if (beast.cr > limit) return `опасность зверя (${challengeLabel(beast.cr)}) выше ${limit ? `опасности или уровня цели (${challengeLabel(limit)})` : 'нуля'}`;
  }
  return null;
}

export function challengeLabel(cr: number): string {
  return cr > 0 && cr < 1 ? `1/${Math.round(1 / cr)}` : String(cr);
}
