import { escapeOpen } from '../../ui/escapeStack';
import { watch, ref, type Ref, type ComputedRef } from 'vue';
import type { Tabletop, TableTool } from '../scene';
import type { Position } from '../grid';
import { windowZoom } from '../../settings/uiScale';
import { cameraScheme, altMode, altRotates, altShowsRail } from '../../settings/cameraControls';
import { hotkeys } from '../../settings/hotkeys';
import GameActionBar from '../../components/game/actionBar/GameActionBar.vue';
import { gameWindows, closeAllGameWindows } from '../layout/gameHud';
import type { WallTool, SceneObjectDTO } from './types';

export type TableKeysDeps = {
  viewOnly: boolean;
  gameUi: ComputedRef<boolean>;
  hudHidden: Ref<boolean>;
  actionBar: Ref<InstanceType<typeof GameActionBar> | null>;
  wallTool: Ref<WallTool | null>;
  wallPopover: Ref<{ at: { x: number; y: number }; wallId: string; tile: number; edit: boolean } | null>;
  terrainMode: Ref<boolean>;
  wallFirstPoint: Ref<Position | null>;
  notesCanManage: Ref<boolean>;
  table: () => Tabletop | undefined;
  mapFullscreen: Ref<boolean>;
  settingsOpen: Ref<boolean>;
  hotkeysOpen: Ref<boolean>;
  factionsOpen: Ref<boolean>;
  soundPopoverOpen: Ref<boolean>;
  clockOpen: Ref<boolean>;
  railMoreOpen: Ref<boolean>;
  builderMode: Ref<boolean>;
  multiCount: ComputedRef<number>;
  movingTemplateId: Ref<string | null>;
  paletteOpen: Ref<boolean>;
  tool: Ref<TableTool>;
  cameraMenuOpen: Ref<boolean>;
  sectionsOpen: Ref<boolean>;
  activeObject: ComputedRef<SceneObjectDTO | undefined>;
  frameCamera: (what: "board" | "top" | "combat", animate?: boolean) => void;
  focusActiveObject: () => void;
  removeFromScene: () => Promise<void>;
  stepHistory: (direction: "undo" | "redo") => Promise<void> | undefined;
  trapPopover: Ref<{ at: { x: number; y: number; }; triggerId: string; } | null>;
  moveSelection: (dx: number, dz: number) => Promise<void> | undefined;
  clearSelection: () => void;
  deselectActor: () => void;
  actorObject: ComputedRef<SceneObjectDTO | null>;
  tokenMenu: Ref<{ at: { x: number; y: number }; objectId: string } | null>;
  areaPopover: Ref<{ at: { x: number; y: number }; templateId: string } | null>;
  handleGameKey: (event: KeyboardEvent) => boolean;
};

export function useTableKeys({ viewOnly, gameUi, hudHidden, actionBar, wallTool, wallPopover, terrainMode, wallFirstPoint, notesCanManage, table, mapFullscreen, settingsOpen, hotkeysOpen, factionsOpen, soundPopoverOpen, clockOpen, railMoreOpen, builderMode, multiCount, movingTemplateId, paletteOpen, tool, cameraMenuOpen, sectionsOpen, activeObject, frameCamera, focusActiveObject, removeFromScene, stepHistory, trapPopover, moveSelection, clearSelection, deselectActor, actorObject, tokenMenu, areaPopover, handleGameKey }: TableKeysDeps) {
  function toggleMapFullscreen() {
    mapFullscreen.value = !mapFullscreen.value;
  }

  const PAN_KEYS: Record<string, [number, number]> = {
    KeyW: [0, 1], KeyS: [0, -1], KeyA: [-1, 0], KeyD: [1, 0],
    ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  };
  const heldPanKeys = new Set<string>();

  watch(windowZoom, zoom => table()?.setWindowZoom(zoom));
  watch([cameraScheme, altMode], ([scheme]) => table()?.setCameraControls({ scheme, altRotate: altRotates() }));

  const altHeld = ref(false);
  function handleAlt(event: KeyboardEvent, down: boolean) {
    if (event.key !== 'Alt') return false;
    if (down && (event.ctrlKey || event.metaKey || event.shiftKey)) return false;
    altHeld.value = down && altShowsRail();
    event.preventDefault();
    return true;
  }

  function applyPan() {
    let right = 0;
    let forward = 0;
    for (const code of heldPanKeys) {
      right += PAN_KEYS[code]![0];
      forward += PAN_KEYS[code]![1];
    }
    table()?.setCameraPan(Math.sign(right), Math.sign(forward));
  }

  function handlePanKey(event: KeyboardEvent, down: boolean) {
    if (!(event.code in PAN_KEYS)) return false;
    if (down && event.code.startsWith('Arrow') && (cameraScheme.value !== 'tts' || multiCount.value > 0)) return false;
    if (down) {
      const typing = (event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]');
      if (typing || event.ctrlKey || event.altKey || event.metaKey || hotkeysOpen.value || settingsOpen.value || factionsOpen.value) return false;
      heldPanKeys.add(event.code);
    } else {
      heldPanKeys.delete(event.code);
    }
    applyPan();
    return true;
  }

  function releasePanKeys() {
    heldPanKeys.clear();
    applyPan();
    altHeld.value = false;
  }

  function handleKeyUp(event: KeyboardEvent) {
    handlePanKey(event, false);
    handleAlt(event, false);
  }

  function handleKey(event: KeyboardEvent) {
    if (handleAlt(event, true)) return;
    if (handlePanKey(event, true)) {
      event.preventDefault();
      return;
    }
    if (viewOnly) {
      if (event.code === 'KeyC') frameCamera('board');
      if (event.code === 'KeyF' || event.code === 'F11') {
        event.preventDefault();
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen().catch(() => {});
      }
      return;
    }

    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.code === 'KeyK' && gameUi.value) {
      event.preventDefault();
      paletteOpen.value = !paletteOpen.value;
      return;
    }

    if (multiCount.value && event.key.startsWith('Arrow') && !(event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]')) {
      event.preventDefault();
      const step: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const [dx, dz] = step[event.key] ?? [0, 0];
      void moveSelection(dx, dz);
      return;
    }

    if (event.key === 'Escape') {
      if (escapeOpen()) return;
      if (table()?.cancelGesture()) return;
      if (paletteOpen.value) paletteOpen.value = false;
      else if (actionBar.value?.cancelStep()) return;
      else if (multiCount.value) clearSelection();
      else if (movingTemplateId.value) movingTemplateId.value = null;
      else if (tokenMenu.value || areaPopover.value || trapPopover.value) {
        tokenMenu.value = null;
        areaPopover.value = null;
        trapPopover.value = null;
      } else if (hotkeysOpen.value) hotkeysOpen.value = false;
      else if (settingsOpen.value) settingsOpen.value = false;
      else if (gameUi.value && hudHidden.value) hudHidden.value = false;
      else if (wallPopover.value) wallPopover.value = null;
      else if (gameUi.value && tool.value === 'select' && !wallTool.value && !terrainMode.value && (gameWindows.left || gameWindows.right)) closeAllGameWindows();
      else if (wallTool.value || terrainMode.value) {
        if (wallFirstPoint.value) wallFirstPoint.value = null;
        else {
          wallTool.value = null;
          terrainMode.value = false;
        }
      } else if (tool.value !== 'select') tool.value = 'select';
      else if (railMoreOpen.value || cameraMenuOpen.value || sectionsOpen.value || clockOpen.value || soundPopoverOpen.value) {
        railMoreOpen.value = false;
        cameraMenuOpen.value = false;
        sectionsOpen.value = false;
        clockOpen.value = false;
        soundPopoverOpen.value = false;
      }
      else if (builderMode.value) builderMode.value = false;
      else if (actorObject.value) deselectActor();
      else if (mapFullscreen.value) mapFullscreen.value = false;
      return;
    }

    const typing = (event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]');

    if ((event.ctrlKey || event.metaKey) && !event.altKey && !typing && !hotkeysOpen.value && !settingsOpen.value &&
        (event.code === 'KeyZ' || event.code === 'KeyY')) {
      event.preventDefault();
      void stepHistory(event.code === 'KeyY' || event.shiftKey ? 'redo' : 'undo');
      return;
    }

    if (typing || event.ctrlKey || event.altKey || event.metaKey) return;
    if (hotkeysOpen.value || settingsOpen.value || factionsOpen.value) return;

    if (event.key === 'Delete') {
      if (activeObject.value?.canEdit) {
        event.preventDefault();
        void removeFromScene();
      }
      return;
    }

    if (event.key === '?' || event.code === 'F1') {
      event.preventDefault();
      hotkeysOpen.value = true;
      return;
    }

    if (event.repeat) return;

    if (handleGameKey(event)) {
      event.preventDefault();
      return;
    }

    const keys = hotkeys.value;
    switch (event.code) {
      case keys.select:
        tool.value = 'select';
        break;
      case keys.measure:
        tool.value = tool.value === 'measure' ? 'select' : 'measure';
        break;
      case keys.ping:
        tool.value = tool.value === 'ping' ? 'select' : 'ping';
        break;
      case keys.draw:
        tool.value = tool.value === 'draw' ? 'select' : 'draw';
        break;
      case keys.text:
        tool.value = tool.value === 'text' ? 'select' : 'text';
        break;
      case keys.erase:
        tool.value = tool.value === 'erase' ? 'select' : 'erase';
        break;
      case keys.pin:
        if (notesCanManage.value) tool.value = tool.value === 'pin' ? 'select' : 'pin';
        break;
      case 'KeyF':
        toggleMapFullscreen();
        break;
      case keys.template:
        tool.value = tool.value === 'template' ? 'select' : 'template';
        break;
      case keys.resetCamera:
        frameCamera('board');
        break;
      case keys.focus:
        focusActiveObject();
        break;
      default:
        return;
    }

    event.preventDefault();
  }

  return { altHeld, releasePanKeys, handleKeyUp, handleKey };
}
