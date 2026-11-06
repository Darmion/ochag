import { ref, computed, type Ref, type ComputedRef } from 'vue';
import type { MenuButton } from '../../actionBar/types';
import { GAME_WINDOW_LABEL, GAME_WINDOW_ICON, isGameWindowOpen, toggleGameWindow } from '../layout/gameHud';
import type { PanelId } from '../layout/gameHud';
import type { SceneDetail, NoteSummary, SceneObjectDTO } from './types';
import { GAME_WINDOW_KEYS } from './windowKeys';

export type GameMenuDeps = {
  emit: (event: 'open-character-sheet', characterId: string) => void;
  sceneDetail: Ref<SceneDetail | null>;
  compendiumOpen: Ref<boolean>;
  notes: Ref<NoteSummary[]>;
  notesCanManage: Ref<boolean>;
  settingsOpen: Ref<boolean>;
  hotkeysOpen: Ref<boolean>;
  factionsOpen: Ref<boolean>;
  paletteOpen: Ref<boolean>;
  actorObject: ComputedRef<SceneObjectDTO | null>;
};

export function useGameMenu({ emit, sceneDetail, compendiumOpen, notes, notesCanManage, settingsOpen, hotkeysOpen, factionsOpen, paletteOpen, actorObject }: GameMenuDeps) {
  function gameWindowAvailable(id: PanelId) {
    const manage = Boolean(sceneDetail.value?.canManage);
    if (id === 'triggers' || id === 'vision' || id === 'encounters') return manage;
    if (id === 'gmNotes') return notesCanManage.value || notes.value.length > 0;
    return true;
  }
  const windowHotkey = (id: PanelId) => Object.entries(GAME_WINDOW_KEYS).find(([, panel]) => panel === id)?.[0].replace('Digit', '') ?? '';

  const minigameOpen = ref(false);
  const gameMenu = computed<MenuButton[]>(() => {
    const windows = (['scenes', 'objects', 'gmNotes', 'encounters'] as PanelId[]).filter(gameWindowAvailable);
    return [
      ...windows.map(id => ({
        id,
        label: GAME_WINDOW_LABEL[id],
        icon: GAME_WINDOW_ICON[id],
        pressed: isGameWindowOpen(id),
        hotkey: windowHotkey(id),
      })),
      { id: 'quests', label: GAME_WINDOW_LABEL.quests, icon: GAME_WINDOW_ICON.quests, pressed: isGameWindowOpen('quests'), hotkey: 'J' },
      ...(sceneDetail.value?.canManage ? [{ id: 'factions', label: 'Фракции', icon: 'group' as const, pressed: factionsOpen.value }] : []),
      { id: 'compendium', label: 'Справочник', icon: 'tome' as const, pressed: compendiumOpen.value, hotkey: 'K' },
      { id: 'minigames', label: 'Мини-игры', icon: 'dice' as const, pressed: minigameOpen.value },
      { id: 'sheet', label: 'Лист персонажа', icon: 'helm' as const, pressed: false, hotkey: 'I' },
    ];
  });

  function onGameMenu(id: string) {
    if (id === 'palette') paletteOpen.value = true;
    else if (id === 'minigames') minigameOpen.value = true;
    else if (id === 'compendium') compendiumOpen.value = !compendiumOpen.value;
    else if (id === 'sheet') openActorSheet();
    else if (id === 'settings') settingsOpen.value = true;
    else if (id === 'hotkeys') hotkeysOpen.value = true;
    else if (id === 'factions') factionsOpen.value = !factionsOpen.value;
    else toggleGameWindow(id as PanelId);
  }

  function openActorSheet() {
    const object = actorObject.value;
    if (object) emit('open-character-sheet', object.character_id);
  }

  return { gameWindowAvailable, windowHotkey, minigameOpen, gameMenu, onGameMenu, openActorSheet };
}
