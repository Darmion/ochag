import { ref, watch, computed, onMounted, onBeforeUnmount, nextTick, type Ref, type ComputedRef } from 'vue';
import { gameWindows, windowWidth } from '../layout/gameHud';
import type { SceneDetail } from './types';

export type RailLayoutDeps = {
  railScroll: Ref<HTMLElement | null>;
  gameUi: ComputedRef<boolean>;
  sceneDetail: Ref<SceneDetail | null>;
  builderMode: Ref<boolean>;
  canBuild: ComputedRef<boolean>;
  altHeld: Ref<boolean>;
};

export function useRailLayout({ railScroll, gameUi, sceneDetail, builderMode, canBuild, altHeld }: RailLayoutDeps) {
  const RAIL_KEY = 'ttrpg.railCollapsed.v3';
  const railCollapsed = ref((() => { try { return localStorage.getItem(RAIL_KEY) !== '0'; } catch { return true; } })());
  watch(railCollapsed, value => { try { localStorage.setItem(RAIL_KEY, value ? '1' : '0'); } catch {  } });
  const railAutoCompact = ref(false);
  const railLabelsForced = ref(false);
  let railCompactHeight = 0;
  const railWide = computed(() => gameUi.value && ((!railCollapsed.value && !railAutoCompact.value) || altHeld.value));
  function onRailResize() {
    if (railLabelsForced.value && Math.abs(window.innerHeight - railCompactHeight) > 40) railLabelsForced.value = false;
    if (railAutoCompact.value && window.innerHeight > railCompactHeight + 60) railAutoCompact.value = false;
  }
  onMounted(() => window.addEventListener('resize', onRailResize));
  onBeforeUnmount(() => window.removeEventListener('resize', onRailResize));
  function toggleRail() {
    if (railAutoCompact.value) {
      railAutoCompact.value = false;
      railLabelsForced.value = true;
      railCompactHeight = window.innerHeight;
      return;
    }
    railCollapsed.value = !railCollapsed.value;
  }
  const railSpace = computed(() => (railWide.value ? 268 : 118));
  const hintShift = computed(() => {
    const left = gameWindows.left ? railSpace.value + windowWidth(gameWindows.left) : 0;
    const right = gameWindows.right ? 112 + windowWidth(gameWindows.right) : 0;
    return `${Math.round((left - right) / 2)}px`;
  });
  const railMore = ref(false);
  function updateRailMore() {
    const box = railScroll.value;
    if (box && box.scrollHeight > box.clientHeight + 4 && railWide.value && !altHeld.value && !railLabelsForced.value) {
      railAutoCompact.value = true;
      railCompactHeight = window.innerHeight;
    }
    railMore.value = Boolean(box && box.scrollTop + box.clientHeight < box.scrollHeight - 4);
  }
  let railObserver: ResizeObserver | null = null;
  onMounted(() => {
    if (typeof ResizeObserver === 'undefined') return;
    railObserver = new ResizeObserver(updateRailMore);
    if (railScroll.value) railObserver.observe(railScroll.value);
    updateRailMore();
  });
  onBeforeUnmount(() => railObserver?.disconnect());
  watch(() => [railWide.value, sceneDetail.value?.canManage], async () => { await nextTick(); updateRailMore(); });

  watch(railWide, value => { document.documentElement.dataset.rail = value ? 'wide' : ''; }, { immediate: true });
  watch(railSpace, value => { document.documentElement.style.setProperty('--rail-space', `${value}px`); }, { immediate: true });
  watch(canBuild, can => { if (!can) builderMode.value = false; });
  onBeforeUnmount(() => {
    document.documentElement.dataset.rail = '';
    document.documentElement.style.removeProperty('--rail-space');
  });

  return { railCollapsed, railAutoCompact, railWide, toggleRail, hintShift, railMore, updateRailMore };
}
