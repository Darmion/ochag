import { pathBlocked } from '../../../../../../packages/domain/map/blockers.ts';
import { placementsHostile, placementsAllied } from '../../../campaign/factions.ts';
import { type AreaBody, bestAreaPlacement } from '../../../../../../packages/domain/map/area-placement.ts';
import type { AutoOption } from '../planner.ts';
import type { TurnBoard, PostMovePosition } from './types.ts';
import type { TargetChoice } from './target.ts';
import type { HealChoice } from './heal.ts';

export function planArea(
  { scene, placements, npc, fallen, options }: TurnBoard, { pathGrid }: TargetChoice, { position }: PostMovePosition,
  { friendsDead, allowed }: HealChoice,
) {
  const bodies: AreaBody[] = placements
    .filter(entry => !entry.parent_object_id && entry.kind !== 'object' && entry.id !== npc.id && !fallen.has(entry.character_id) && !friendsDead.has(entry.character_id))
    .map(entry => ({
      id: entry.character_id, x: entry.world_x, z: entry.world_z, size: entry.size,
      side: placementsAllied(entry, npc) ? 'ally' : placementsHostile(entry, npc) ? 'enemy' : 'neutral',
    }));
  let areaPlan: { option: AutoOption; placement: NonNullable<ReturnType<typeof bestAreaPlacement>> } | null = null;
  for (const option of options.filter(entry => entry.kind === 'area' && entry.area && allowed(entry))) {
    const placement = bestAreaPlacement({
      dims: { widthCells: scene.width_cells, heightCells: scene.height_cells }, feetPerUnit: scene.feet_per_unit,
      caster: { id: npc.character_id, x: position.x, z: position.z, size: npc.size }, area: option.area!,
      rangeFeet: option.area!.fromSelf ? null : option.reach, bodies,
      blocked: (a, b) => pathBlocked(a, b, pathGrid.edges),
    });
    if (!placement) continue;
    const value = option.expected * placement.enemies.length;
    if (!areaPlan || value > areaPlan.option.expected * areaPlan.placement.enemies.length) areaPlan = { option, placement };
  }
  return { bodies, areaPlan };
}
