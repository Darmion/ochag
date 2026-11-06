import type { Ref, ComputedRef, WritableComputedRef } from 'vue';
import type { Position } from '../grid';
import type { WallTool } from './types';

export type GroundClickDeps = {
  targetingActive: ComputedRef<boolean>;
  activeObjectId: Ref<string>;
  wallTool: Ref<WallTool | null>;
  wallDrawMode: WritableComputedRef<boolean, boolean>;
  terrainMode: Ref<boolean>;
  movingTemplateId: Ref<string | null>;
  moveObject: (point: Position) => void;
  placeWallPoint: (point: Position) => Promise<void> | undefined;
  groupMoveActive: ComputedRef<boolean>;
  moveSelectionTo: (point: Position) => Promise<void> | undefined;
  moveTemplateTo: (point: Position) => Promise<void> | undefined;
};

export function useGroundClick({ targetingActive, activeObjectId, wallTool, wallDrawMode, terrainMode, movingTemplateId, moveObject, placeWallPoint, groupMoveActive, moveSelectionTo, moveTemplateTo }: GroundClickDeps) {
  function handleGroundClick(point: Position) {
    if (targetingActive.value) return;
    if (movingTemplateId.value) {
      void moveTemplateTo(point);
      return;
    }
    if (groupMoveActive.value) {
      void moveSelectionTo(point);
      return;
    }
    if (terrainMode.value || wallTool.value === 'pick') return;

    if (wallDrawMode.value) {
      void placeWallPoint(point);
    } else if (activeObjectId.value) {
      void moveObject(point);
    }
  }

  return { handleGroundClick };
}
