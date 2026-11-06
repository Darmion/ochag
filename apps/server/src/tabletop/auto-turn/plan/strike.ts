import { rangeBand } from '../../../../../../packages/domain/combat/targeting.ts';
import { routinesOf } from '../npc.ts';
import type { AutoOption } from '../planner.ts';
import { attacksPerActionFor, weaponRanges, weaponReaches } from '../../combat/attack.ts';
import { feetBetween } from '../../scene/board.ts';
import type { Queryable } from '../../../db.ts';
import type { TurnBoard, TurnInput, PostMovePosition } from './types.ts';
import type { TargetChoice } from './target.ts';
import type { HealChoice } from './heal.ts';

export async function planStrike(
  q: Queryable, { campaignId }: TurnInput, { scene, npc, options, strikes }: TurnBoard, { target }: TargetChoice,
  { here, sees }: PostMovePosition, { allowed }: HealChoice,
) {
  const distance = feetBetween(scene, here, target);
  const clear = sees(target);
  const perAction = await attacksPerActionFor(q, campaignId, npc.character_id);
  const weaponStrikes = strikes.filter(option => option.kind === 'weapon' && rangeBand(weaponRanges(option.weapon), distance).ok);
  let sequence: Array<{ weapon: any; disadvantage: boolean; expected: number }> = [];
  const routines = await routinesOf(q, campaignId, npc.character_id, options.filter(option => option.kind === 'weapon').map(option => option.weapon));
  for (const routine of routines) {
    const steps: typeof sequence = [];
    const used = new Set<string>();
    for (const step of routine.steps) {
      const fits = (option: AutoOption) => weaponReaches(option.weapon, distance, step.mode) && !(routine.distinct && used.has(option.id));
      const pick = step.weaponId
        ? options.find(option => option.kind === 'weapon' && option.id === step.weaponId && fits(option))
        : options.filter(option => option.kind === 'weapon' && fits(option)).sort((a, b) => b.expected - a.expected)[0];
      if (!pick) continue;
      const count = routine.distinct && !step.weaponId ? 1 : step.count;
      for (let index = 0; index < count; index += 1) {
        steps.push({ weapon: pick.weapon, disadvantage: routine.disadvantageAfterFirst && steps.length > 0, expected: pick.expected * (routine.disadvantageAfterFirst && steps.length > 0 ? 0.6 : 1) });
      }
      used.add(pick.id);
      if (routine.distinct && !step.weaponId) {
        for (const other of options.filter(option => option.kind === 'weapon' && fits(option)).sort((a, b) => b.expected - a.expected).slice(0, step.count - 1)) {
          steps.push({ weapon: other.weapon, disadvantage: false, expected: other.expected });
          used.add(other.id);
        }
      }
    }
    const value = steps.reduce((sum, entry) => sum + entry.expected, 0);
    if (value > sequence.reduce((sum, entry) => sum + entry.expected, 0) + 1e-9) sequence = steps;
  }
  const bestWeapon = weaponStrikes.sort((a, b) => b.expected - a.expected)[0] ?? null;
  if (!sequence.length && bestWeapon) {
    sequence = Array.from({ length: Math.max(1, perAction) }, () => ({ weapon: bestWeapon.weapon, disadvantage: false, expected: bestWeapon.expected }));
  }
  const weaponValue = sequence.reduce((sum, entry) => sum + entry.expected, 0);
  const bestSpell = strikes
    .filter(allowed)
    .filter(option => option.kind === 'spell' && clear && distance <= option.reach)
    .sort((a, b) => b.expected - a.expected)[0] ?? null;
  const usable: AutoOption | null = sequence.length && (!bestSpell || weaponValue >= bestSpell.expected)
    ? { ...options.find(option => option.kind === 'weapon' && option.id === sequence[0]!.weapon.id)!, expected: weaponValue }
    : bestSpell;
  return { perAction, sequence, usable };
}
