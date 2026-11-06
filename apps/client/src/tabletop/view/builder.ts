import { watch, computed, type Ref, type ComputedRef } from 'vue';
import type { WallKind, Tabletop, TableTool } from '../scene';
import type { Position } from '../grid';
import type { BuilderTool, SceneDetail, WallTool } from './types';

export type BuilderDeps = {
  gameUi: ComputedRef<boolean>;
  sceneId: Ref<string>;
  sceneDetail: Ref<SceneDetail | null>;
  targetingActive: ComputedRef<boolean>;
  templateAsTrigger: Ref<boolean>;
  wallTool: Ref<WallTool | null>;
  wallKind: Ref<WallKind>;
  wallPopover: Ref<{ at: { x: number; y: number }; wallId: string; tile: number; edit: boolean } | null>;
  terrainMode: Ref<boolean>;
  wallFirstPoint: Ref<Position | null>;
  table: () => Tabletop | undefined;
  railMoreOpen: Ref<boolean>;
  builderMode: Ref<boolean>;
  tool: Ref<TableTool>;
};

export function useBuilder({ gameUi, sceneId, sceneDetail, targetingActive, templateAsTrigger, wallTool, wallKind, wallPopover, terrainMode, wallFirstPoint, table, railMoreOpen, builderMode, tool }: BuilderDeps) {
  watch(targetingActive, active => {
    if (!active) return;
    tool.value = 'select';
    wallTool.value = null;
    terrainMode.value = false;
    table()?.setTool('select');
    table()?.setSelectionEnabled(true);
  });

  function applyBuildModes() {
    const mode = wallTool.value;
    table()?.setSelectionEnabled(!mode && !terrainMode.value);
    table()?.setWallDrawMode(mode === 'chain' || mode === 'room');
    table()?.setWallShape(mode === 'room' ? 'room' : 'chain');
    table()?.setWallPickMode(mode === 'pick' || mode === 'opening');
    table()?.setTerrainBrush(terrainMode.value);
  }
  watch(wallTool, mode => {
    wallFirstPoint.value = null;
    wallPopover.value = null;
    if (mode) {
      tool.value = 'select';
      terrainMode.value = false;
    }
    applyBuildModes();
  });
  watch(terrainMode, on => {
    if (on) {
      tool.value = 'select';
      wallTool.value = null;
    }
    applyBuildModes();
  });
  watch(wallPopover, popover => table()?.setWallHighlight(popover ? [popover.wallId] : []));

  watch(wallFirstPoint, point => table()?.setWallFirstPoint(point));

  const canBuild = computed(() => gameUi.value && Boolean(sceneDetail.value?.canManage) && Boolean(sceneId.value));
  const builderActive = computed<BuilderTool | null>(() => {
    if (wallTool.value) return wallTool.value === 'opening' ? 'doors' : 'walls';
    if (terrainMode.value) return 'terrain';
    if (tool.value === 'template' && templateAsTrigger.value) return 'traps';
    return null;
  });
  function leaveBuilderTools() {
    wallTool.value = null;
    terrainMode.value = false;
    if (tool.value === 'template' && templateAsTrigger.value) {
      templateAsTrigger.value = false;
      tool.value = 'select';
    }
  }
  function toggleBuilder() {
    if (builderMode.value) leaveBuilderTools();
    builderMode.value = !builderMode.value;
    railMoreOpen.value = false;
  }
  function builderTool(kind: BuilderTool) {
    if (builderActive.value === kind) {
      leaveBuilderTools();
      return;
    }
    if (kind === 'walls') {
      wallKind.value = 'wall';
      wallTool.value = wallTool.value && wallTool.value !== 'opening' ? wallTool.value : 'chain';
    } else if (kind === 'doors') {
      wallTool.value = 'opening';
    } else if (kind === 'terrain') {
      terrainMode.value = true;
    } else {
      templateAsTrigger.value = true;
      tool.value = 'template';
    }
  }

  return { applyBuildModes, canBuild, builderActive, leaveBuilderTools, toggleBuilder, builderTool };
}
