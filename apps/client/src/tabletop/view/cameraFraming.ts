import { computed, nextTick, type Ref, type ComputedRef } from 'vue';
import type { Tabletop } from '../scene';
import { insetsFromPanels } from '../cameraFit';
import type { SceneObjectDTO, InitiativeEntry } from './types';

export type CameraFramingDeps = {
  viewOnly: boolean;
  gameUi: ComputedRef<boolean>;
  hudHidden: Ref<boolean>;
  canvas: Ref<HTMLCanvasElement | null>;
  sceneId: Ref<string>;
  objects: Ref<SceneObjectDTO[]>;
  initiativeEntries: Ref<InitiativeEntry[]>;
  table: () => Tabletop | undefined;
  cameraMenuOpen: Ref<boolean>;
  activeObject: ComputedRef<SceneObjectDTO | undefined>;
};

export function useCameraFraming({ viewOnly, gameUi, hudHidden, canvas, sceneId, objects, initiativeEntries, table, cameraMenuOpen, activeObject }: CameraFramingDeps) {
  function focusActiveObject() {
    const object = activeObject.value;
    if (object) table()?.focusOn({ x: object.world_x, z: object.world_z });
  }

  const HUD_PANELS = ['.game-tool-rail', '.game-window', '.game-location', '.game-initiative', '.vision-chip', '.game-portraits', '.game-console'];
  function hudInsets() {
    const element = canvas.value;
    if (!element || viewOnly || !gameUi.value || hudHidden.value) return { left: 0, top: 0, right: 0, bottom: 0 };
    const box = element.getBoundingClientRect();
    const scale = element.clientWidth ? box.width / element.clientWidth : 1;
    const panels = [...document.querySelectorAll<HTMLElement>(HUD_PANELS.join(','))]
      .map(panel => panel.getBoundingClientRect())
      .filter(rect => rect.width && rect.height)
      .map(rect => ({ left: (rect.left - box.left) / scale, top: (rect.top - box.top) / scale, right: (rect.right - box.left) / scale, bottom: (rect.bottom - box.top) / scale }));
    return insetsFromPanels({ width: element.clientWidth, height: element.clientHeight }, panels);
  }

  const combatantObjectIds = computed(() => {
    const fighting = new Set(initiativeEntries.value.map(entry => entry.character_id).filter(Boolean));
    return objects.value.filter(object => object.kind !== 'object' && !object.parent_object_id && fighting.has(object.character_id)).map(object => object.id);
  });

  function frameCamera(what: 'board' | 'top' | 'combat', animate = true) {
    cameraMenuOpen.value = false;
    autoFrame = null;
    const board = table();
    if (!board) return;
    if (what === 'combat' && combatantObjectIds.value.length && board.frameView(combatantObjectIds.value, hudInsets(), animate)) return;
    if (!board.frameView(what === 'top' ? 'top' : 'board', hudInsets(), animate)) board.resetCamera();
  }

  let framedSceneId = '';
  let autoFrame: { sceneId: string; stamp: number; at: number } | null = null;
  function resetFraming() {
    framedSceneId = '';
  }

  function frameOnOpen(id: string) {
    if (framedSceneId === id || !table()) return;
    framedSceneId = id;
    void nextTick(() => requestAnimationFrame(() => {
      const board = table();
      if (sceneId.value !== id || !board) return;
      if (!board.frameView('board', hudInsets(), false)) {
        framedSceneId = '';
        return;
      }
      autoFrame = { sceneId: id, stamp: board.userCameraStamp(), at: performance.now() };
    }));
  }
  function reframeForHud() {
    const pending = autoFrame;
    if (!pending || pending.sceneId !== sceneId.value || performance.now() - pending.at > 5000) return;
    void nextTick(() => requestAnimationFrame(() => {
      const board = table();
      if (!board || autoFrame !== pending || board.userCameraStamp() !== pending.stamp) return;
      board.frameView('board', hudInsets(), false);
    }));
  }

  return { focusActiveObject, combatantObjectIds, frameCamera, resetFraming, frameOnOpen, reframeForHud };
}
