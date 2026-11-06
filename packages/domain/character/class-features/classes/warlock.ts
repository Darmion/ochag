import { knownChoices } from '../internal.ts';

export const INVOCATIONS = [
  { id: 'agonizing-blast', nameRu: 'Мучительный взрыв', pattern: /Мучительн\S* взрыв|Agonizing Blast/i },
  { id: 'repelling-blast', nameRu: 'Отталкивающий взрыв', pattern: /Отталкивающ\S* взрыв|Repelling Blast/i },
  { id: 'devils-sight', nameRu: 'Дьявольское зрение', pattern: /Дьявольск\S* зрени|Devil'?s Sight/i },
] as const;

export function knownInvocations(sheetExtra: any): string[] {
  return knownChoices(sheetExtra, 'invocations', INVOCATIONS);
}

export function darkBlessingHp(charismaModifier: number, warlockLevel: number): number {
  return Math.max(1, charismaModifier + warlockLevel);
}

export function mysticArcanumLevels(warlockLevel: number): number[] {
  return [[6, 11], [7, 13], [8, 15], [9, 17]].filter(([, from]) => warlockLevel >= from!).map(([level]) => level!);
}

export function darkLuckCanSave(total: number, dc: number): boolean {
  return total < dc && total + 10 >= dc;
}

export const HURL_THROUGH_HELL_DAMAGE = '10d10';

export const FIENDISH_RESILIENCE_TYPES = [
  { id: 'acid', nameRu: 'кислота' }, { id: 'bludgeoning', nameRu: 'дробящий' }, { id: 'cold', nameRu: 'холод' }, { id: 'fire', nameRu: 'огонь' },
  { id: 'force', nameRu: 'силовое поле' }, { id: 'lightning', nameRu: 'электричество' }, { id: 'necrotic', nameRu: 'некротическая энергия' },
  { id: 'piercing', nameRu: 'колющий' }, { id: 'poison', nameRu: 'яд' }, { id: 'psychic', nameRu: 'психическая энергия' },
  { id: 'radiant', nameRu: 'излучение' }, { id: 'slashing', nameRu: 'рубящий' }, { id: 'thunder', nameRu: 'звук' },
] as const;

export function knownFiendishResilience(sheetExtra: any): string[] {
  const list = Array.isArray(sheetExtra?.fiendishResilience) ? sheetExtra.fiendishResilience.map(String) : [];
  return list.filter((id: string) => FIENDISH_RESILIENCE_TYPES.some(entry => entry.id === id)).slice(0, 1);
}
