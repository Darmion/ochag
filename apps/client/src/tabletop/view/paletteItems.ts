import { computed, type Ref, type ComputedRef } from 'vue';
import type { TableTool } from '../scene';
import type { PanelId } from '../layout/gameHud';
import { KIND_GROUP_LABELS } from '../../campaign/objects';
import type { GameIconName } from '../../ui/gameIcons';
import type { PaletteItem } from '../../components/game/CommandPalette.vue';
import GameActionBar from '../../components/game/actionBar/GameActionBar.vue';
import type { MenuButton } from '../../actionBar/types';
import { GAME_WINDOW_LABEL, GAME_WINDOW_ICON, toggleGameWindow } from '../layout/gameHud';
import type { SceneInfo, SceneDetail, SceneObjectDTO, SoundTab } from './types';
import type { ActionActor } from '../../actionBar/types';

export type PaletteItemsDeps = {
  hudHidden: Ref<boolean>;
  scenes: Ref<SceneInfo[]>;
  sceneId: Ref<string>;
  sceneDetail: Ref<SceneDetail | null>;
  actionBar: Ref<InstanceType<typeof GameActionBar> | null>;
  objects: Ref<SceneObjectDTO[]>;
  gridDialogOpen: Ref<boolean>;
  tool: Ref<TableTool>;
  cameraKeys: ComputedRef<{ board: string; focus: string; }>;
  openSoundWindow: (tab: SoundTab) => void;
  frameCamera: (what: "board" | "top" | "combat", animate?: boolean) => void;
  combatantObjectIds: ComputedRef<string[]>;
  selectPlacement: (placementId: string) => void;
  actionActor: ComputedRef<ActionActor | null>;
  gameWindowAvailable: (id: PanelId) => boolean;
  windowHotkey: (id: PanelId) => string;
  gameMenu: ComputedRef<MenuButton[]>;
  onGameMenu: (id: string) => void;
};

export function usePaletteItems({ hudHidden, scenes, sceneId, sceneDetail, actionBar, objects, gridDialogOpen, tool, cameraKeys, openSoundWindow, frameCamera, combatantObjectIds, selectPlacement, actionActor, gameWindowAvailable, windowHotkey, gameMenu, onGameMenu }: PaletteItemsDeps) {
  const paletteItems = computed<PaletteItem[]>(() => {
    const items: PaletteItem[] = [];
    for (const item of gameMenu.value) {
      items.push({ id: `window:${item.id}`, group: 'Окна', label: item.label, icon: item.icon, hotkey: item.hotkey, run: () => onGameMenu(item.id) });
    }
    for (const id of (['triggers', 'vision'] as PanelId[]).filter(gameWindowAvailable)) {
      items.push({ id: `window:${id}`, group: 'Окна', label: GAME_WINDOW_LABEL[id], icon: GAME_WINDOW_ICON[id], hotkey: windowHotkey(id), run: () => toggleGameWindow(id) });
    }
    if (actionActor.value && actionBar.value) {
      const bar = actionBar.value;
      const actions: Array<[string, string, GameIconName, Parameters<typeof bar.openPopover>[0]]> = [
        ['attack', 'Атака', 'sword', 'attack'], ['spell', 'Магия — заклинания', 'sparkle', 'spell'], ['skill', 'Проверка навыка', 'star', 'skill'],
        ['save', 'Спасбросок', 'shield', 'save'], ['ability', 'Проверка характеристики', 'target', 'ability'], ['actions', 'Действия: рывок, отход, уклонение, спрятаться', 'run', 'actions'],
        ['rest', 'Отдых', 'moon', 'rest'], ['dice', 'Кубики — лоток', 'dice', 'dice'],
      ];
      for (const [id, label, icon, popover] of actions) {
        items.push({ id: `action:${id}`, group: `Действия — ${actionActor.value.name}`, label, icon, run: () => bar.openPopover(popover) });
      }
    }
    const tools: Array<[string, string, GameIconName, typeof tool.value]> = [
      ['select', 'Выбор и перемещение', 'pointer', 'select'], ['measure', 'Линейка', 'ruler', 'measure'], ['ping', 'Указка', 'ping', 'ping'],
      ['template', 'Область заклинания', 'burst', 'template'], ['draw', 'Рисовать', 'quill', 'draw'], ['text', 'Подпись на карте', 'letter', 'text'], ['erase', 'Ластик', 'eraser', 'erase'],
    ];
    for (const [id, label, icon, value] of tools) items.push({ id: `tool:${id}`, group: 'Инструменты', label, icon, run: () => { tool.value = value; } });
    items.push({ id: 'tool:camera', group: 'Инструменты', label: 'Камера: вся доска', icon: 'crosshair', keywords: 'вернуть камеру вписать', hotkey: cameraKeys.value.board, run: () => frameCamera('board') });
    items.push({ id: 'tool:camera-top', group: 'Инструменты', label: 'Камера: сверху', icon: 'map', keywords: 'карта вид сверху', run: () => frameCamera('top') });
    if (combatantObjectIds.value.length) items.push({ id: 'tool:camera-combat', group: 'Инструменты', label: 'Камера: участники боя', icon: 'swords', keywords: 'бой камера', run: () => frameCamera('combat') });
    if (sceneDetail.value?.canManage) items.push({ id: 'tool:grid', group: 'Инструменты', label: 'Сетка сцены для всех: вид, скрыть', icon: 'grid', keywords: 'клетки сетка', run: () => { gridDialogOpen.value = true; } });
    items.push({ id: 'tool:sounds', group: 'Инструменты', label: 'Звук: музыка, разовые звуки, фон места, звуки событий', icon: 'speaker', keywords: 'звук музыка громкость шаги фон плейлист', run: () => openSoundWindow('music') });
    items.push({ id: 'tool:hud', group: 'Инструменты', label: 'Скрыть интерфейс', icon: 'eye', hotkey: 'H', run: () => { hudHidden.value = true; } });
    for (const object of objects.value.filter(entry => !entry.parent_object_id)) {
      items.push({
        id: `object:${object.id}`, group: 'Объекты на сцене', label: object.name, userText: true,
        sub: object.hp ? `${object.hp.current}/${object.hp.max}` : KIND_GROUP_LABELS[object.kind], icon: object.kind === 'object' ? 'chest' : 'helm',
        run: () => selectPlacement(object.id),
      });
    }
    for (const scene of scenes.value) {
      if (scene.id !== sceneId.value) items.push({ id: `scene:${scene.id}`, group: 'Сцены', label: `Перейти: ${scene.name}`, icon: 'map', run: () => { sceneId.value = scene.id; } });
    }
    return items;
  });

  return { paletteItems };
}
