<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import HudPortrait from './HudPortrait.vue';
import GameIcon from './GameIcon.vue';
import type { GameIconName } from '../../ui/gameIcons';
export type PortraitEntry = {
  id: string;
  characterId: string;
  name: string;
  imageUrl: string | null;
  imageCrop?: unknown;
  crest?: string | null;
  side: string;
  hp: { current: number; max: number; temp: number } | null;
  isCurrent: boolean;
  isSelected: boolean;
  conditions?: Array<{ code: string; label: string; icon: GameIconName }>;
  inspired?: boolean;
};

const props = defineProps<{ entries: PortraitEntry[] }>();
const emit = defineEmits<{ select: [id: string]; open: [characterId: string] }>();

function hpPercent(entry: PortraitEntry) {
  return entry.hp && entry.hp.max > 0 ? Math.max(0, Math.min(100, (entry.hp.current / entry.hp.max) * 100)) : null;
}

const root = ref<HTMLElement | null>(null);
const overflowing = ref(false);
function measure() {
  const box = root.value;
  overflowing.value = Boolean(box && box.scrollHeight > box.clientHeight + 2);
}
let observer: ResizeObserver | null = null;
watch(root, element => {
  observer?.disconnect();
  observer = null;
  if (element && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(measure);
    observer.observe(element);
  }
  measure();
});
onMounted(measure);
onBeforeUnmount(() => observer?.disconnect());
watch(() => props.entries.length, () => void nextTick(measure));

function hpState(entry: PortraitEntry) {
  const value = hpPercent(entry);
  return value === null ? '' : value <= 0 ? 'down' : value <= 25 ? 'low' : value <= 60 ? 'mid' : 'high';
}
</script>

<template>
  <aside v-if="props.entries.length" ref="root" class="game-portraits" :class="{ overflowing }" aria-label="Отряд">
    <button
      v-for="entry in props.entries"
      :key="entry.id"
      type="button"
      class="portrait"
      :class="[`side-${entry.side}`, hpState(entry), { current: entry.isCurrent, selected: entry.isSelected }]"
      :title="`${entry.name}${entry.hp ? ` — ${entry.hp.current}/${entry.hp.max}` : ''}. Щелчок — выбрать, двойной — лист`"
      @click="emit('select', entry.id)"
      @dblclick="emit('open', entry.characterId)"
    >
      <span class="portrait-image">
        <HudPortrait :name="entry.name" :image-url="entry.imageUrl" :image-crop="entry.imageCrop" :crest="entry.crest" />
        <span v-if="hpPercent(entry) !== null" class="wound" :style="{ height: `${100 - hpPercent(entry)!}%` }" />
        <span v-if="entry.isCurrent" class="turn-badge" aria-label="Сейчас ходит"><GameIcon class="inline-icon" name="swords" :size="12" /></span>
        <span v-if="entry.inspired" class="inspired-badge" title="Вдохновение: преимущество в одном броске"><GameIcon class="inline-icon" name="sparkle" :size="12" /></span>
        <span v-if="entry.conditions?.length" class="conditions">
          <span v-for="condition in entry.conditions.slice(0, 4)" :key="condition.code" class="condition" :title="condition.label"><GameIcon class="inline-icon" :name="condition.icon" :size="14" /></span>
        </span>
      </span>
      <span class="portrait-name">{{ entry.name }}</span>
      <span v-if="hpPercent(entry) !== null" class="hp-bar"><span :style="{ width: `${hpPercent(entry)}%` }" /></span>
    </button>
  </aside>
</template>

<style scoped>
.game-portraits{position:fixed;right:2px;top:calc(var(--game-top,54px) + 10px);bottom:calc(var(--game-bottom,150px) + 10px);z-index:2090;display:flex;flex-direction:column;gap:12px;width:106px;box-sizing:border-box;overflow-y:auto;overflow-x:hidden;padding:8px 12px 14px;scrollbar-width:none}
/* scrollbar-width:none is ignored by Chromium/Electron; ::-webkit-scrollbar hides it. */
.game-portraits::-webkit-scrollbar{display:none}
@media (max-height:700px){
  .game-portraits{gap:8px}
  .portrait-image{height:70px}
}
@media (max-height:560px){
  .portrait-image{height:54px}
  .portrait-name{font-size:11px}
}
.game-portraits.overflowing{scrollbar-width:thin;scrollbar-color:var(--g-gold-lo,#6b5233) transparent}
.portrait{display:flex;flex-direction:column;align-items:stretch;gap:3px;width:82px;min-height:0;padding:0;background:none;border:0;box-shadow:none;flex-shrink:0}
.portrait:hover:not(:disabled){box-shadow:none;background:none}
.portrait-image{position:relative;display:grid;place-items:center;height:96px;border-radius:4px;overflow:hidden;background:radial-gradient(circle at 50% 35%,var(--g-stone-1),var(--g-stone-3));box-shadow:inset 0 0 0 1px #000,0 0 0 1px var(--g-gold-hi),0 0 0 3px var(--g-gold),0 0 0 4px var(--g-gold-lo),0 0 0 5px #000,0 6px 12px #000c;transition:box-shadow .15s ease}
.portrait:hover .portrait-image{box-shadow:inset 0 0 0 1px #000,0 0 0 1px var(--g-gold-hi),0 0 0 3px var(--g-gold),0 0 0 4px var(--g-gold-lo),0 0 0 5px #000,0 0 14px var(--g-glow)}
.portrait.selected .portrait-image{box-shadow:inset 0 0 0 1px #000,0 0 0 2px #fff4c8,0 0 0 4px var(--g-gold-hi),0 0 0 5px #000,0 0 18px var(--g-glow)}
.portrait.current .portrait-image{animation:turn-glow 1.8s ease-in-out infinite}
@keyframes turn-glow{0%,100%{filter:none}50%{filter:drop-shadow(0 0 8px #ffbf5a)}}
.portrait-image img{width:100%;height:100%;object-fit:cover;object-position:top}
.monogram{font:400 40px var(--g-title-font);color:var(--g-gold-hi);text-shadow:0 2px 0 #000}
.portrait-image{--portrait-letter:18px}
.portrait-image :deep(.hud-portrait-crest img){width:72%;height:72%}
.side-mine .portrait-image{background:radial-gradient(circle at 50% 35%,#3a6b51,#0f2219)}
.side-party .portrait-image{background:radial-gradient(circle at 50% 35%,#3b5384,#0e1628)}
.side-hostile .portrait-image{background:radial-gradient(circle at 50% 35%,#7a2b28,#250a09)}
.side-neutral .portrait-image{background:radial-gradient(circle at 50% 35%,#7a6430,#241b0a)}
.side-friendly .portrait-image{background:radial-gradient(circle at 50% 35%,#2b6e6a,#0a2423)}
.wound{position:absolute;left:0;right:0;top:0;background:linear-gradient(180deg,#8a0d0d99,#5a0505bb);mix-blend-mode:multiply;pointer-events:none;transition:height .3s ease}
.portrait.down .portrait-image img,.portrait.down .monogram,.portrait.down .hud-portrait-crest{filter:grayscale(1) brightness(.5)}
.portrait.down .portrait-name{text-decoration:line-through;text-decoration-thickness:2px;color:#e7b9b4}
.turn-badge{position:absolute;top:3px;right:4px;font-size:15px;color:#ffd77a;text-shadow:0 0 6px #000,0 0 6px #ff9a2a}
.inspired-badge{position:absolute;top:3px;left:4px;font-size:16px;color:#ffe9a0;text-shadow:0 0 6px #000,0 0 8px #ffcf4a}
.conditions{position:absolute;left:3px;bottom:3px;display:flex;gap:2px}
.condition{display:grid;place-items:center;width:18px;height:18px;border-radius:50%;font-size:11px;background:#000c;box-shadow:0 0 0 1px var(--g-gold-lo)}
.portrait-name{font:600 12px/1.2 var(--g-title-font);color:var(--g-gold-hi);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 0 #000,0 0 4px #000}
.hp-bar{display:block;height:5px;background:#000a;border-radius:2px;overflow:hidden;box-shadow:0 0 0 1px #000}
.hp-bar span{display:block;height:100%;background:linear-gradient(180deg,#7fd086,#3e8a45);transition:width .4s ease}
.portrait.mid .hp-bar span{background:linear-gradient(180deg,#f2cf74,#b98a24)}
.portrait.low .hp-bar span,.portrait.down .hp-bar span{background:linear-gradient(180deg,#ff8a7a,#a8261c)}
</style>
