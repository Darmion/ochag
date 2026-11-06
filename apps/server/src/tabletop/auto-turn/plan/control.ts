import { pathBlocked } from '../../../../../../packages/domain/map/blockers.ts';
import { spellTargetRules, targetTypeProblem } from '../../../../../../packages/domain/spells/spell-targets.ts';
import { type AreaBody, bestAreaPlacement } from '../../../../../../packages/domain/map/area-placement.ts';
import { loadConditionState } from '../../../rules/conditions.ts';
import { type AutoOption, autoOptions } from '../planner.ts';
import { feetBetween } from '../../scene/board.ts';
import { creatureTypeOf } from '../../spells/rules.ts';
import type { Queryable } from '../../../db.ts';
import type { TurnBoard, TurnInput, PostMovePosition } from './types.ts';
import type { TargetChoice } from './target.ts';
import type { HealChoice } from './heal.ts';

export async function planControl(
  q: Queryable, { campaignId }: TurnInput, { scene, npc, npcState, alive, options }: TurnBoard, { pathGrid, hpOf }: TargetChoice,
  { position, here, sees }: PostMovePosition, { allowed }: HealChoice, bodies: AreaBody[],
) {
  const concentrating = npcState.codes.has('concentration');
  let controlPlan: { option: AutoOption; targetId: string | null; placement: NonNullable<ReturnType<typeof bestAreaPlacement>> | null; value: number } | null = null;
  const controlOptions = options.filter(option => option.kind === 'control' && allowed(option) && !(concentrating && option.concentration));
  if (controlOptions.length) {
    const enemyStates = new Map<string, Set<string>>();
    for (const entry of alive) enemyStates.set(entry.character_id, (await loadConditionState(q, campaignId, entry.character_id)).codes);
    const danger = new Map<string, number>();
    for (const entry of alive) {
      danger.set(entry.character_id, Math.max(0, ...(await autoOptions(q, campaignId, entry.character_id)).filter(option => option.kind !== 'heal' && option.kind !== 'control').map(option => option.expected)));
    }
    for (const option of controlOptions) {
      if (option.area) {
        const placement = bestAreaPlacement({
          dims: { widthCells: scene.width_cells, heightCells: scene.height_cells }, feetPerUnit: scene.feet_per_unit,
          caster: { id: npc.character_id, x: position.x, z: position.z, size: npc.size }, area: option.area,
          rangeFeet: option.area.fromSelf ? null : option.reach,
          bodies: bodies.filter(body => body.side !== 'enemy' || !enemyStates.get(body.id)?.has(option.condition!)),
          blocked: (a, b) => pathBlocked(a, b, pathGrid.edges),
        });
        if (!placement) continue;
        let value = option.expected * placement.enemies.length;
        if (option.pool) {
          const hits = placement.enemies.map(id => hpOf.get(id) ?? 0).sort((a, b) => a - b);
          let left = option.pool;
          let count = 0;
          for (const value of hits) if (value <= left) { left -= value; count += 1; } else break;
          value = option.expected * count;
        }
        if (value > 0 && (!controlPlan || value > controlPlan.value)) controlPlan = { option, targetId: null, placement, value };
        continue;
      }
      const rules = spellTargetRules(option.desc ?? '');
      for (const entry of alive) {
        if (enemyStates.get(entry.character_id)?.has(option.condition!)) continue;
        if (feetBetween(scene, here, entry) > option.reach || !sees(entry)) continue;
        if (targetTypeProblem(rules, await creatureTypeOf(q, campaignId, entry.character_id))) continue;
        const value = option.expected * (1 + (danger.get(entry.character_id) ?? 0) / 20);
        if (!controlPlan || value > controlPlan.value) controlPlan = { option, targetId: entry.character_id, placement: null, value };
      }
    }
  }
  return controlPlan;
}
