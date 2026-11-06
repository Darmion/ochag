import type { SeenLight } from '../map/light.ts';
import type { Cover } from './targeting.ts';

export function passiveScore(modifier: number, obscured: boolean): number {
  return 10 + modifier - (obscured ? 5 : 0);
}

export function notices(score: number, stealthTotal: number): boolean {
  return score >= stealthTotal;
}

export function seesClearly(seen: SeenLight | null, cover: Cover): boolean {
  return seen === 'bright' && cover === 'none';
}
