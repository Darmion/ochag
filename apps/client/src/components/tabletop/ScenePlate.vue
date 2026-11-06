<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import GameIcon from '../game/GameIcon.vue';
import { toggleGameWindow } from '../../tabletop/layout/gameHud';
import type { GameIconName } from '../../ui/gameIcons';

defineProps<{
  status: string;
  sceneName: string | null;
  worldClock: { phase: GameIconName; text: string; weather: GameIconName | null } | null;
  canSetClock: boolean;
}>();
const clockOpen = defineModel<boolean>('clockOpen', { required: true });

const plateEl = ref<HTMLElement | null>(null);
let plateObserver: ResizeObserver | null = null;
watch(plateEl, element => {
  plateObserver?.disconnect();
  if (!element || typeof ResizeObserver === 'undefined') return;
  plateObserver = new ResizeObserver(() => {
    document.documentElement.style.setProperty('--plate-height', `${Math.round(element.offsetHeight)}px`);
  });
  plateObserver.observe(element);
});
onBeforeUnmount(() => {
  plateObserver?.disconnect();
  document.documentElement.style.removeProperty('--plate-height');
});
</script>

<template>
  <div ref="plateEl" class="game-location g-plate">
    <div class="location-row">
      <button type="button" class="location-main" :title="`${status}. Щелчок — окно сцен (1)`" @click="toggleGameWindow('scenes')">
        <GameIcon name="map" :size="18" />
        <span class="location-copy">
          <span class="location-name">{{ sceneName ?? 'Сцена не выбрана' }}</span>
          <span class="location-meta">
            <span v-if="worldClock" class="location-time"><GameIcon class="inline-icon" :name="worldClock.phase" :size="13" /> {{ worldClock.text }}<template v-if="worldClock.weather"> <GameIcon class="inline-icon" :name="worldClock.weather" :size="13" /></template></span>
            <span v-if="!status.startsWith('Синхронизация подключена')" class="location-connection">нет связи</span>
          </span>
        </span>
        <span class="sync-dot" :class="{ ok: status.startsWith('Синхронизация подключена') }" :aria-label="status" />
      </button>
      <button
        v-if="canSetClock" type="button" class="location-clock"
        :aria-expanded="clockOpen" title="Время и погода: +10 мин, +1 ч, утро, вечер, дождь…" aria-label="Время и погода" @click="clockOpen = !clockOpen"
      ><GameIcon name="clock" :size="17" /></button>
    </div>
    <slot />
  </div>
</template>

<style scoped>
.game-location{position:fixed;top:calc(var(--game-top,54px) + 12px);left:var(--rail-space,78px);z-index:2095;display:flex;flex-direction:column;align-items:stretch;gap:5px;max-width:min(460px,40vw);min-height:48px;padding:6px 10px 6px 14px;color:var(--g-gold-hi);background:linear-gradient(105deg,#0009,#0003),var(--g-plate);border:0;text-align:left}
.location-row{display:flex;align-items:center;gap:6px;min-width:0}
.location-main{flex:1 1 auto;display:flex;align-items:center;gap:10px;min-width:0;min-height:36px;padding:0;color:inherit;text-align:left;background:none;border:0;box-shadow:none}
.location-main:hover:not(:disabled){background:none;box-shadow:none;color:var(--g-gold-hi)}
.location-main > svg{flex-shrink:0}
.location-clock{flex:none;width:32px;height:32px;min-height:32px;padding:0;display:grid;place-items:center}
.location-copy{display:flex;flex-direction:column;min-width:0;gap:2px}
.location-name{font:600 15px var(--g-title-font);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.location-meta{display:flex;align-items:center;gap:7px;min-width:0;font:400 12px var(--g-body-font);color:var(--g-text-dim);white-space:nowrap}
.location-connection{color:#e88}
.location-connection::before{content:"·";margin-right:7px;color:var(--g-gold-lo)}
.game-location > svg{flex-shrink:0}
.is-game.in-combat .game-location{max-width:var(--combat-plate)}
.is-game.in-combat .game-location .location-meta{display:none}
.location-time{flex:none}
.sync-dot{width:9px;height:9px;flex-shrink:0;border-radius:50%;background:#d9a43a;box-shadow:0 0 6px #d9a43a}
.sync-dot.ok{background:#6fcf7a;box-shadow:0 0 6px #6fcf7a}
</style>
