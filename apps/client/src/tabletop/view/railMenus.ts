import { computed, ref, nextTick, type Ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { cssZoom } from '../../settings/uiScale';
import { labelForCode, hotkeys } from '../../settings/hotkeys';
import { openGameWindow } from '../layout/gameHud';
import type { SoundTab } from './types';

export type RailMenusDeps = {
  sectionsSearch: Ref<HTMLInputElement | null>;
  soundPopoverOpen: Ref<boolean>;
  soundPopoverTop: Ref<number>;
  soundTab: Ref<SoundTab>;
  railMoreOpen: Ref<boolean>;
  railMoreTop: Ref<number>;
  paletteOpen: Ref<boolean>;
  audioCanManage: Ref<boolean>;
};

export function useRailMenus({ sectionsSearch, soundPopoverOpen, soundPopoverTop, soundTab, railMoreOpen, railMoreTop, paletteOpen, audioCanManage }: RailMenusDeps) {
  const cameraKeys = computed(() => ({ board: labelForCode(hotkeys.value.resetCamera), focus: labelForCode(hotkeys.value.focus) }));
  const cameraMenuOpen = ref(false);
  const cameraMenuTop = ref(0);
  function openCameraMenu(event: MouseEvent) {
    soundPopoverOpen.value = false;
    railMoreOpen.value = false;
    sectionsOpen.value = false;
    const button = event.currentTarget as HTMLElement;
    const rail = button.closest('.game-tool-rail') as HTMLElement | null;
    cameraMenuTop.value = rail ? (button.getBoundingClientRect().top - rail.getBoundingClientRect().top) / cssZoom.value : 0;
    cameraMenuOpen.value = !cameraMenuOpen.value;
    if (cameraMenuOpen.value) void nextTick(() => fitRailPopup('.rail-camera-menu', cameraMenuTop));
  }

  function openSoundPopover(event: MouseEvent) {
    const button = event.currentTarget as HTMLElement;
    const rail = button.closest('.game-tool-rail') as HTMLElement | null;
    soundPopoverTop.value = rail ? (button.getBoundingClientRect().top - rail.getBoundingClientRect().top) / cssZoom.value : 0;
    railMoreOpen.value = false;
    cameraMenuOpen.value = false;
    sectionsOpen.value = false;
    soundPopoverOpen.value = !soundPopoverOpen.value;
    if (soundPopoverOpen.value) void nextTick(() => fitRailPopup('.sound-popover', soundPopoverTop));
  }
  function fitRailPopup(selector: string, top: Ref<number>) {
    const popup = document.querySelector(selector) as HTMLElement | null;
    if (!popup) return;
    const zoom = cssZoom.value;
    const floor = (document.querySelector('.game-console')?.getBoundingClientRect().top ?? window.innerHeight) - 8;
    const ceiling = (document.querySelector('.game-topbar')?.getBoundingClientRect().bottom ?? 0) + 8;
    popup.style.maxHeight = '';
    popup.style.overflowY = '';
    let rect = popup.getBoundingClientRect();
    if (rect.height > floor - ceiling) {
      popup.style.maxHeight = `${(floor - ceiling) / zoom}px`;
      popup.style.overflowY = 'auto';
      rect = popup.getBoundingClientRect();
    }
    let shift = 0;
    if (rect.bottom > floor) shift = floor - rect.bottom;
    if (rect.top + shift < ceiling) shift = ceiling - rect.top;
    if (shift) top.value += shift / zoom;
  }
  function openSoundWindow(tab: SoundTab) {
    soundTab.value = tab === 'effects' && !audioCanManage.value ? 'music' : tab;
    soundPopoverOpen.value = false;
    openGameWindow('audio');
  }

  function onRailMoreOutside(event: PointerEvent) {
    const target = event.target as Element | null;
    const inside = (menu: string, button: string) => Boolean(target?.closest?.(menu) || target?.closest?.(`.game-tool-rail [data-rail="${button}"]`));
    if (railMoreOpen.value && !inside('.rail-more-list', 'more')) railMoreOpen.value = false;
    if (cameraMenuOpen.value && !inside('.rail-camera-menu', 'camera')) cameraMenuOpen.value = false;
    if (sectionsOpen.value && !inside('.rail-sections-menu', 'sections')) sectionsOpen.value = false;
  }
  onMounted(() => document.addEventListener('pointerdown', onRailMoreOutside, true));
  onBeforeUnmount(() => document.removeEventListener('pointerdown', onRailMoreOutside, true));

  function openRailMore(event: MouseEvent) {
    soundPopoverOpen.value = false;
    cameraMenuOpen.value = false;
    sectionsOpen.value = false;
    const button = event.currentTarget as HTMLElement;
    const rail = button.closest('.game-tool-rail') as HTMLElement | null;
    railMoreTop.value = rail ? (button.getBoundingClientRect().top - rail.getBoundingClientRect().top) / cssZoom.value : 0;
    railMoreOpen.value = !railMoreOpen.value;
    if (railMoreOpen.value) void nextTick(() => fitRailPopup('.rail-more-list', railMoreTop));
  }

  const sectionsOpen = ref(false);
  const sectionsTop = ref(0);
  function openSections(event: MouseEvent) {
    soundPopoverOpen.value = false;
    railMoreOpen.value = false;
    cameraMenuOpen.value = false;
    const button = event.currentTarget as HTMLElement;
    const rail = button.closest('.game-tool-rail') as HTMLElement | null;
    sectionsTop.value = rail ? (button.getBoundingClientRect().top - rail.getBoundingClientRect().top) / cssZoom.value : 0;
    sectionsOpen.value = !sectionsOpen.value;
    const fromKeyboard = event.detail === 0;
    if (sectionsOpen.value) void nextTick(() => {
      fitRailPopup('.rail-sections-menu', sectionsTop);
      if (fromKeyboard) sectionsSearch.value?.focus();
    });
  }
  const paletteQuery = ref('');
  watch(paletteOpen, open => { if (!open) paletteQuery.value = ''; });
  function searchFromSections(event: Event) {
    if ((event as InputEvent | KeyboardEvent).isComposing) return;
    event.preventDefault();
    paletteQuery.value = (event.target as HTMLInputElement).value;
    sectionsOpen.value = false;
    paletteOpen.value = true;
  }

  return { cameraKeys, cameraMenuOpen, cameraMenuTop, openCameraMenu, openSoundPopover, openSoundWindow, openRailMore, sectionsOpen, sectionsTop, openSections, paletteQuery, searchFromSections };
}
