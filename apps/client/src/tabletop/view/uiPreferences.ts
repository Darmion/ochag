import { cursorCss } from '../../settings/cursorSettings';
import { readTablePrefs, writeTablePrefs } from '../../settings/tablePrefs';
import { watch, type Ref } from 'vue';
import type { Tabletop } from '../scene';
import type { LocalAudioSettings } from '../audio';
import GameActionBar from '../../components/game/actionBar/GameActionBar.vue';
import type { SceneDetail } from './types';

export type UiPreferencesDeps = {
  viewOnly: boolean;
  canvas: Ref<HTMLCanvasElement | null>;
  sceneDetail: Ref<SceneDetail | null>;
  actionBar: Ref<InstanceType<typeof GameActionBar> | null>;
  table: () => Tabletop | undefined;
  mapFullscreen: Ref<boolean>;
  showOverlayInterface: Ref<boolean>;
  showHpBars: Ref<boolean>;
  followTurn: Ref<boolean>;
  showGizmo: Ref<boolean>;
  showWeather: Ref<boolean>;
  shareRuler: Ref<boolean>;
  localAudio: Ref<LocalAudioSettings>;
  DRAW_COLORS: string[];
  drawColor: Ref<string>;
};

export function useUiPreferences({ viewOnly, canvas, sceneDetail, actionBar, table, mapFullscreen, showOverlayInterface, showHpBars, followTurn, showGizmo, showWeather, shareRuler, localAudio, DRAW_COLORS, drawColor }: UiPreferencesDeps) {
  function loadUiPreferences() {
    const saved = readTablePrefs();
    if (typeof saved.showOverlayInterface === 'boolean') showOverlayInterface.value = saved.showOverlayInterface;
    if (typeof saved.shareRuler === 'boolean') shareRuler.value = saved.shareRuler;
    if (typeof saved.drawColor === 'string' && DRAW_COLORS.includes(saved.drawColor)) drawColor.value = saved.drawColor;
    if (saved.audio && typeof saved.audio === 'object') {
      const audio = saved.audio as Record<string, unknown>;
      localAudio.value = {
        music: typeof audio.music === 'number' ? audio.music : 0.7,
        effects: typeof audio.effects === 'number' ? audio.effects : 0.8,
        muted: audio.muted === true,
      };
    }
  }

  function saveUiPreferences() {
    writeTablePrefs({
      showOverlayInterface: showOverlayInterface.value,
      shareRuler: shareRuler.value,
      drawColor: drawColor.value,
      audio: localAudio.value,
    });
  }

  loadUiPreferences();

  if (viewOnly) {
    mapFullscreen.value = true;
    showOverlayInterface.value = false;
    followTurn.value = true;
  } else {
    watch([showOverlayInterface, shareRuler, drawColor, localAudio], saveUiPreferences);
  }
  // A stale async cursor must not bring the aim cursor back after Escape.
  watch([() => actionBar.value?.targetingCursor, canvas], async ([src, element], _, onCleanup) => {
    if (!element) return;
    let cancelled = false;
    onCleanup(() => { cancelled = true; table()?.setAimCursor(null); });
    if (!src) { table()?.setAimCursor(null); return; }
    table()?.setAimCursor('crosshair');
    try {
      const image = await cursorCss(src, 32);
      if (!cancelled) table()?.setAimCursor(image + ', crosshair');
    } catch {  }
  }, { immediate: true });
  watch(showHpBars, show => table()?.setShowHitPoints(show));
  watch(showGizmo, show => table()?.setShowGizmo(show));
  watch(() => sceneDetail.value?.effective_lighting ?? sceneDetail.value?.lighting, level => table()?.setLighting(level ?? 'bright'));
  watch([() => sceneDetail.value?.weather, showWeather], ([weather, show]) => table()?.setWeather(show ? weather ?? 'clear' : 'clear'));
  watch(drawColor, color => table()?.setDrawStyle({ color, width: 0.08 }));
}
