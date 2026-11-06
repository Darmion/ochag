import type { ClassLevel } from '../../classes.ts';
import { knownChoices } from '../internal.ts';

export function critRange(classes: ClassLevel[]): number {
  const entry = classes.find(item => item.id === 'fighter');
  if (!entry || (entry.subclass && entry.subclass !== 'champion')) return 20;
  return entry.level >= 15 ? 18 : entry.level >= 3 ? 19 : 20;
}

export const MANEUVERS = [
  { id: 'trip', nameRu: 'Атака с подсечкой', pattern: /подсечк|Trip Attack/i },
  { id: 'pushing', nameRu: 'Толкающая атака', pattern: /Толкающ\S* атак|Pushing Attack/i },
  { id: 'menacing', nameRu: 'Угрожающая атака', pattern: /Угрожающ\S* атак|Menacing Attack/i },
  { id: 'distracting', nameRu: 'Отвлекающий удар', pattern: /Отвлекающ\S* удар|Distracting Strike/i },
  { id: 'precision', nameRu: 'Точная атака', pattern: /Точн\S* атак|Precision Attack/i },
  { id: 'parry', nameRu: 'Парирование', pattern: /Парировани|Parry/i },
  { id: 'riposte', nameRu: 'Ответный удар', pattern: /Ответн\S* удар|Riposte/i },
] as const;

export type ManeuverId = typeof MANEUVERS[number]['id'];

export const HIT_MANEUVERS: ManeuverId[] = ['trip', 'pushing', 'menacing', 'distracting'];

export function knownManeuvers(sheetExtra: any): string[] {
  return knownChoices(sheetExtra, 'maneuvers', MANEUVERS);
}

export function superiorityDie(fighterLevel: number): number {
  return fighterLevel >= 18 ? 12 : fighterLevel >= 10 ? 10 : 8;
}

export function maneuverDc(proficiency: number, strengthModifier: number, dexterityModifier: number): number {
  return 8 + proficiency + Math.max(strengthModifier, dexterityModifier);
}

export function survivorHeal(hpCurrent: number, hpMax: number, constitutionModifier: number): number {
  if (hpCurrent <= 0 || hpCurrent > hpMax / 2) return 0;
  return Math.max(0, Math.min(hpMax - hpCurrent, 5 + constitutionModifier));
}
