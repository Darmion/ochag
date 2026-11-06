import { computed, watch, nextTick, onMounted, onBeforeUnmount, type Ref } from 'vue';
import { visualMods, visualModsOff } from '../../settings/visualMods';
import type { Tabletop } from '../scene';
import { GAME_BOARD_COLORS, gameSkin } from '../../settings/uiMode';
import { effectiveGrid, type GridLook, gridPayload } from '../../settings/gridSettings';
import { bodyFont, textSize } from '../../settings/textSettings';
import type { TabletopProps, SceneDetail } from './types';

export type BoardLookDeps = {
  props: TabletopProps;
  sceneId: Ref<string>;
  sceneDetail: Ref<SceneDetail | null>;
  table: () => Tabletop | undefined;
  gridPreview: Ref<GridLook | null>;
  basePath: () => string;
  refresh: () => Promise<void>;
  run: (action: () => Promise<void>) => Promise<void>;
};

export function useBoardLook({ props, sceneId, sceneDetail, table, gridPreview, basePath, refresh, run }: BoardLookDeps) {
  const boardColors = computed(() => GAME_BOARD_COLORS[gameSkin.value]);

  watch(boardColors, colors => {
    table()?.setTheme(colors);
  });

  let colorProbe: CanvasRenderingContext2D | null = null;
  function surroundingsColors() {
    const style = getComputedStyle(document.documentElement);
    colorProbe ??= document.createElement('canvas').getContext('2d');
    const hex = (name: string, fallback: string) => {
      const value = style.getPropertyValue(name).trim();
      if (!value || !colorProbe) return fallback;
      colorProbe.fillStyle = fallback;
      colorProbe.fillStyle = value;
      const parsed = String(colorProbe.fillStyle);
      if (/^#[0-9a-f]{6}$/i.test(parsed)) return parsed;
      const rgb = parsed.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      return rgb ? `#${rgb.slice(1, 4).map(part => Number(part).toString(16).padStart(2, '0')).join('')}` : fallback;
    };
    return { table: hex('--g-table', '#45301f'), void: hex('--g-void', '#130c08') };
  }
  watch([boardColors, visualMods, visualModsOff], async () => {
    await nextTick();
    table()?.setSurroundings(surroundingsColors());
    table()?.invalidateLabelSizes();
  }, { deep: true });
  watch([bodyFont, textSize], async () => {
    await nextTick();
    table()?.invalidateLabelSizes();
  });
  const onFontsLoaded = () => table()?.invalidateLabelSizes();
  onMounted(() => document.fonts?.addEventListener?.('loadingdone', onFontsLoaded));
  onBeforeUnmount(() => document.fonts?.removeEventListener?.('loadingdone', onFontsLoaded));

  const gridLook = computed(() => gridPreview.value ?? effectiveGrid(sceneDetail.value?.grid));
  watch(gridLook, look => table()?.setGrid(look), { deep: true });

  function saveSceneGrid(look: GridLook | null) {
    return run(async () => {
      if (!sceneId.value) return;
      await props.request(basePath(), 'PATCH', { grid: look ? gridPayload(look) : {} });
      gridPreview.value = null;
      await refresh();
    });
  }

  return { boardColors, surroundingsColors, gridLook, saveSceneGrid };
}
