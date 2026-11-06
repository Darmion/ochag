import { knownChoices } from '../internal.ts';

export const METAMAGIC = [
  { id: 'quickened', nameRu: 'Ускоренное заклинание', pattern: /Ускоренн\S* заклинани|Quickened Spell/i },
  { id: 'twinned', nameRu: 'Удвоенное заклинание', pattern: /Удвоенн\S* заклинани|Twinned Spell/i },
  { id: 'careful', nameRu: 'Осторожное заклинание', pattern: /Осторожн\S* заклинани|Careful Spell/i },
  { id: 'heightened', nameRu: 'Повышенное заклинание', pattern: /Повышенн\S* заклинани|Heightened Spell/i },
  { id: 'empowered', nameRu: 'Усиленное заклинание', pattern: /Усиленн\S* заклинани|Empowered Spell/i },
  { id: 'distant', nameRu: 'Отдалённое заклинание', pattern: /Отдал[её]нн\S* заклинани|Distant Spell/i },
  { id: 'extended', nameRu: 'Продлённое заклинание', pattern: /Продл[её]нн\S* заклинани|Extended Spell/i },
  { id: 'subtle', nameRu: 'Неуловимое заклинание', pattern: /Неуловим\S* заклинани|Subtle Spell/i },
] as const;

export type MetamagicId = typeof METAMAGIC[number]['id'];

export function knownMetamagic(sheetExtra: any): string[] {
  return knownChoices(sheetExtra, 'metamagic', METAMAGIC);
}

export function metamagicCost(id: MetamagicId, slotLevel: number): number {
  return id === 'quickened' ? 2 : id === 'heightened' ? 3 : id === 'twinned' ? Math.max(1, slotLevel) : 1;
}

export function empowerDice(results: number[], sides: number, left: number, next: () => number): { results: number[]; rerolled: number; left: number } {
  const order = results.map((value, index) => ({ value, index })).filter(entry => entry.value <= sides / 2).sort((a, b) => a.value - b.value);
  const out = [...results];
  let rerolled = 0;
  for (const entry of order) {
    if (left <= 0) break;
    out[entry.index] = next();
    left -= 1;
    rerolled += 1;
  }
  return { results: out, rerolled, left };
}

export function knownAncestry(sheetExtra: any): string[] {
  if (Array.isArray(sheetExtra?.draconicAncestry)) return sheetExtra.draconicAncestry.map(String).slice(0, 1);
  return typeof sheetExtra?.builder?.ancestry === 'string' ? [sheetExtra.builder.ancestry] : [];
}

export const FLEXIBLE_CASTING_COST: Readonly<Record<number, number>> = { 1: 2, 2: 3, 3: 5, 4: 6, 5: 7 };

export const DRACONIC_PRESENCE_COST = 5;

export const DRACONIC_PRESENCE_FEET = 60;

export const DRACONIC_PRESENCE_ROUNDS = 10;
