import type { Ref, ComputedRef } from 'vue';
import type { PanelId } from '../layout/gameHud';
import { toggleGameWindow } from '../layout/gameHud';

export const GAME_WINDOW_KEYS: Record<string, PanelId> = {
  Digit1: 'scenes', Digit2: 'objects', Digit3: 'combat', Digit4: 'gmNotes', Digit5: 'encounters', Digit6: 'audio', Digit7: 'triggers',
  Digit8: 'vision',
};

export type WindowKeysDeps = {
  gameUi: ComputedRef<boolean>;
  hudHidden: Ref<boolean>;
  compendiumOpen: Ref<boolean>;
  gameWindowAvailable: (id: PanelId) => boolean;
  openActorSheet: () => void;
};

export function useWindowKeys({ gameUi, hudHidden, compendiumOpen, gameWindowAvailable, openActorSheet }: WindowKeysDeps) {
  function handleGameKey(event: KeyboardEvent): boolean {
    if (!gameUi.value) return false;
    const target = GAME_WINDOW_KEYS[event.code];
    if (target) {
      if (gameWindowAvailable(target)) toggleGameWindow(target);
      return true;
    }
    if (event.code === 'KeyI') {
      openActorSheet();
      return true;
    }
    if (event.code === 'KeyJ') {
      toggleGameWindow('quests');
      return true;
    }
    if (event.code === 'KeyK' && !event.ctrlKey && !event.metaKey) {
      compendiumOpen.value = !compendiumOpen.value;
      return true;
    }
    if (event.code === 'KeyH' || event.code === 'KeyF') {
      hudHidden.value = !hudHidden.value;
      return true;
    }
    return false;
  }

  return { handleGameKey };
}
