import type { Ref, ComputedRef } from 'vue';
import type { WallSegment } from '../scene';
import { wallSteps } from '../../components/game/WallPopover.vue';
import type { TabletopProps, SceneObjectDTO } from './types';

export type WallStrikeDeps = {
  props: TabletopProps;
  wallPopover: Ref<{ at: { x: number; y: number }; wallId: string; tile: number; edit: boolean } | null>;
  basePath: () => string;
  loadRolls: () => Promise<void>;
  loadInitiative: () => Promise<void>;
  refresh: () => Promise<void>;
  run: (action: () => Promise<void>) => Promise<void>;
  wallPopoverWall: ComputedRef<WallSegment | null>;
  actorObject: ComputedRef<SceneObjectDTO | null>;
};

export function useWallStrike({ props, wallPopover, basePath, loadRolls, loadInitiative, refresh, run, wallPopoverWall, actorObject }: WallStrikeDeps) {
  function wallPopoverStrike(weaponId: string) {
    const popover = wallPopover.value;
    const wall = wallPopoverWall.value;
    const actor = actorObject.value;
    if (!popover || !wall || !actor) return;
    return run(async () => {
      const result = await props.request(`${basePath()}/walls/${wall.id}/strike`, 'POST', {
        characterId: actor.character_id, weaponId, ...(wallSteps(wall) > 1 ? { tile: popover.tile } : {}),
      });
      if (wallPopover.value) wallPopover.value = { ...wallPopover.value, wallId: result.wallId, tile: 0 };
      await Promise.all([refresh(), loadRolls(), loadInitiative()]);
    });
  }

  return { wallPopoverStrike };
}
