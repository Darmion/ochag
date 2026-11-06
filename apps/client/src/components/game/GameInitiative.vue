<script setup lang="ts">
import HudPortrait from './HudPortrait.vue';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import GameIcon from './GameIcon.vue';

export type InitiativeMedal = {
  id: string;
  characterId: string | null;
  name: string;
  score: number;
  isCurrent: boolean;
  imageUrl: string | null;
  imageCrop?: unknown;
  crest?: string | null;
  side: string;
  legendary?: { max: number; used: number } | null;
  dead?: boolean;
};

const props = defineProps<{
  entries: InitiativeMedal[];
  round: number;
  canManage: boolean;
  busy: boolean;
  groupTurns?: boolean;
}>();

const emit = defineEmits<{ advance: []; end: []; focus: [characterId: string]; legendary: [entryId: string]; 'group-turns': [value: boolean] }>();

const current = computed(() => props.entries.find(entry => entry.isCurrent) ?? null);
const currentNames = computed(() => props.entries.filter(entry => entry.isCurrent).map(entry => entry.name).join(', '));
const turnKey = computed(() => `${props.round}:${props.entries.filter(entry => entry.isCurrent).map(entry => entry.id).join(',')}`);
const scrollMotion = (): ScrollBehavior => (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

const medals = ref<HTMLOListElement | null>(null);
watch(() => current.value?.id, async () => {
  await nextTick();
  const list = medals.value;
  const active = list?.querySelector<HTMLElement>('li.is-current');
  active?.scrollIntoView({ behavior: scrollMotion(), inline: 'center', block: 'nearest' });
  updateEdges();
});

const canLeft = ref(false);
const canRight = ref(false);
function updateEdges() {
  const list = medals.value;
  if (!list) return;
  canLeft.value = list.scrollLeft > 2;
  canRight.value = list.scrollLeft + list.clientWidth < list.scrollWidth - 2;
}
function scrollBy(direction: number) {
  medals.value?.scrollBy({ left: direction * 160, behavior: scrollMotion() });
}
let observer: ResizeObserver | null = null;
watch(medals, list => {
  observer?.disconnect();
  observer = null;
  if (list && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(updateEdges);
    observer.observe(list);
  }
  updateEdges();
});
onBeforeUnmount(() => observer?.disconnect());
watch(() => props.entries.length, async () => { await nextTick(); updateEdges(); });

const bar = ref<HTMLElement | null>(null);
const tight = ref(0);
let fitting = false;
let fittedFor = '';
async function fit() {
  if (fitting || !bar.value) return;
  fitting = true;
  if (medals.value) medals.value.style.maxWidth = '';
  try {
    for (let level = 0; level <= 2; level++) {
      tight.value = level;
      await nextTick();
      const element = bar.value;
      const list = medals.value;
      if (!element) return;
      const overflow = element.scrollWidth > element.clientWidth + 1;
      const squeezed = list ? list.clientWidth < Math.min(list.scrollWidth, 150) : false;
      if (!overflow && !squeezed) break;
    }
    snapMedals();
  } finally {
    fitting = false;
    updateEdges();
  }
}
function snapMedals() {
  const list = medals.value;
  if (!list || list.scrollWidth <= list.clientWidth + 2) return;
  const padding = parseFloat(getComputedStyle(list).paddingRight) || 0;
  const origin = list.getBoundingClientRect().left + list.clientLeft - list.scrollLeft;
  let edge = 0;
  for (const item of list.children as HTMLCollectionOf<HTMLElement>) {
    const right = item.getBoundingClientRect().right - origin;
    if (right > list.clientWidth - padding + 1) break;
    edge = right;
  }
  if (edge) list.style.maxWidth = `${Math.ceil(edge + padding)}px`;
}
function refit() {
  publishBottom();
  const key = `${window.innerWidth}|${document.documentElement.style.getPropertyValue('--rail-space')}`;
  if (key === fittedFor) return;
  fittedFor = key;
  void fit();
}
let styleObserver: MutationObserver | null = null;
onMounted(() => {
  window.addEventListener('resize', refit);
  if (typeof MutationObserver !== 'undefined') {
    styleObserver = new MutationObserver(refit);
    styleObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
  }
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', refit);
  styleObserver?.disconnect();
});
watch(() => [bar.value, props.entries.length, currentNames.value, props.canManage] as const, () => { void fit(); });

let barObserver: ResizeObserver | null = null;
let publishedBottom = '';
function publishBottom() {
  const element = bar.value;
  const bottom = element ? `${Math.round(element.getBoundingClientRect().bottom)}px` : '';
  // Same value: leave <html> alone, otherwise the style observer (refit) calls this again.
  if (bottom === publishedBottom) return;
  publishedBottom = bottom;
  if (bottom) document.documentElement.style.setProperty('--initiative-bottom', bottom);
  else document.documentElement.style.removeProperty('--initiative-bottom');
}
watch(bar, element => {
  barObserver?.disconnect();
  barObserver = null;
  if (element && typeof ResizeObserver !== 'undefined') {
    barObserver = new ResizeObserver(publishBottom);
    barObserver.observe(element);
  }
  publishBottom();
});
onBeforeUnmount(() => {
  barObserver?.disconnect();
  publishedBottom = '';
  document.documentElement.style.removeProperty('--initiative-bottom');
});
</script>

<template>
  <div v-if="props.entries.length" ref="bar" class="game-initiative" :class="tight ? `tight-${tight}` : ''" aria-label="Очередь хода">
    <div class="round-plate g-plate">
      <small>Раунд</small>
      <strong>{{ props.round }}</strong>
    </div>
    <button v-if="canLeft" type="button" class="edge-arrow" aria-label="Раньше в очереди" @click="scrollBy(-1)">‹</button>
    <ol ref="medals" class="medals" @scroll.passive="updateEdges">
      <li v-for="entry in props.entries" :key="entry.id" :class="{ 'is-current': entry.isCurrent }">
        <button
          type="button"
          class="medal"
          :class="[`side-${entry.side}`, { current: entry.isCurrent, dead: entry.dead }]"
          :title="`${entry.name}${entry.dead ? ' — мёртв' : ''} — инициатива ${entry.score}`"
          :disabled="!entry.characterId"
          @click="entry.characterId && emit('focus', entry.characterId)"
        >
          <HudPortrait :name="entry.name" :image-url="entry.imageUrl" :image-crop="entry.imageCrop" :crest="entry.crest" />
          <span class="score">{{ entry.score }}</span>
          <span v-if="entry.dead" class="dead-mark" aria-label="Мёртв"><GameIcon name="skull" :size="14" /></span>
        </button>
        <button
          v-if="entry.legendary && props.canManage" type="button" class="legendary" :class="{ spent: entry.legendary.used >= entry.legendary.max }"
          :disabled="!props.canManage || entry.isCurrent"
          :title="`Легендарные действия: осталось ${entry.legendary.max - entry.legendary.used} из ${entry.legendary.max}${props.canManage && !entry.isCurrent ? ' — щелчок выбирает' : ''}`"
          @click="emit('legendary', entry.id)"
        ><GameIcon class="inline-icon" name="crown" :size="13" />{{ entry.legendary.max - entry.legendary.used }}</button>
      </li>
    </ol>
    <button v-if="canRight" type="button" class="edge-arrow" aria-label="Дальше в очереди" @click="scrollBy(1)">›</button>
    <div class="turn-name">
      <small>{{ props.entries.filter(entry => entry.isCurrent).length > 1 ? 'Ходят вместе' : 'Ходит' }}</small>
      <strong :key="turnKey" :title="currentNames">{{ currentNames || '—' }}</strong>
    </div>
    <div v-if="props.canManage" class="gm-turn">
      <select
        class="turn-mode" :value="props.groupTurns === false ? 'single' : 'group'" :disabled="props.busy"
        title="Как ходят союзники (и враги), идущие в очереди подряд: по одному или группой — одновременно"
        aria-label="Порядок хода" @change="emit('group-turns', ($event.target as HTMLSelectElement).value === 'group')"
      >
        <option value="single">По одному</option>
        <option value="group">Группами</option>
      </select>
      <button type="button" :disabled="props.busy" title="Следующий ход" @click="emit('advance')"><GameIcon name="hourglass" :size="16" /><span class="gm-label"> Дальше</span></button>
      <button type="button" :disabled="props.busy" title="Завершить бой" @click="emit('end')"><GameIcon name="close" :size="16" /></button>
    </div>
  </div>
</template>

<style scoped>
.game-initiative{position:fixed;top:calc(var(--game-top,54px) + 10px);left:calc(var(--rail-space,78px) + var(--combat-plate,240px) + 16px);right:112px;width:fit-content;max-width:calc(100% - var(--rail-space,78px) - var(--combat-plate,240px) - 128px);margin-inline:auto;z-index:2095;display:flex;align-items:center;gap:14px;padding:8px 16px;border-radius:40px;background:linear-gradient(180deg,#0009,#0006);box-shadow:inset 0 0 0 1px #000,0 0 0 1px var(--g-gold-lo),0 8px 20px #000a;backdrop-filter:blur(3px)}
.round-plate{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;padding:3px 12px;line-height:1.05}
.round-plate small,.turn-name small{margin:0;white-space:nowrap;font:600 11px var(--g-body-font);letter-spacing:.12em;text-transform:uppercase;color:var(--g-text-dim)}
.round-plate strong{font:400 22px var(--g-title-font);color:var(--g-gold-hi)}
/* Own scrollbar track: scrollbar-width:none alone does not hide the scrollbar in Chromium/Electron. */
.medals{flex:0 1 auto;min-width:82px;display:flex;align-items:center;gap:12px;margin:-10px 0;padding:12px 12px;list-style:none;overflow-x:auto;scroll-behavior:smooth;scrollbar-width:none}
.edge-arrow{flex:none;display:grid;place-items:center;width:26px;height:26px;min-height:0;padding:0;border-radius:50%;font:700 18px/1 var(--g-title-font)}
.medals::-webkit-scrollbar{display:none}
.medal{position:relative;display:grid;place-items:center;width:44px;height:44px;min-height:0;padding:0;border-radius:50%;overflow:visible;background:radial-gradient(circle,var(--g-stone-1),var(--g-stone-3));box-shadow:inset 0 0 0 1px #000,0 0 0 1px var(--g-gold),0 0 0 2px var(--g-gold-lo),0 0 0 3px #000}
.medal img{width:100%;height:100%;border-radius:50%;object-fit:cover;object-position:top}
.medal.dead img,.medal.dead .monogram,.medal.dead .hud-portrait-crest{filter:grayscale(1) brightness(.45)}
.medal :deep(.hud-portrait-letter){display:none}
.medal :deep(.hud-portrait-crest img){width:80%;height:80%}
.dead-mark{position:absolute;inset:0;display:grid;place-items:center;font-size:24px;color:#ff6b5e;text-shadow:0 0 4px #000,0 0 2px #000;pointer-events:none}
.medal.current{width:58px;height:58px;box-shadow:inset 0 0 0 1px #000,0 0 0 2px #fff0c0,0 0 0 4px var(--g-gold),0 0 0 5px #000,0 0 18px #ffb84a}
.medal.side-mine{background:radial-gradient(circle,#3a6b51,#0f2219)}
.medal.side-party{background:radial-gradient(circle,#3b5384,#0e1628)}
.medal.side-hostile{background:radial-gradient(circle,#7a2b28,#250a09)}
.medal.side-neutral{background:radial-gradient(circle,#7a6430,#241b0a)}
.medal.side-friendly{background:radial-gradient(circle,#2b6e6a,#0a2423)}
.medal:disabled{opacity:1;filter:none}
.monogram{font:400 20px var(--g-title-font);color:var(--g-gold-hi)}
.medal.current .monogram{font-size:26px}
.medal.current{animation:turn-pop .42s ease-out}
@keyframes turn-pop{0%{transform:scale(.8);filter:brightness(1.6)}55%{transform:scale(1.08);filter:brightness(1.25)}100%{transform:none;filter:none}}
.turn-name strong{animation:name-in .3s ease-out}
@keyframes name-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.score{position:absolute;bottom:-6px;right:-6px;display:grid;place-items:center;min-width:20px;height:20px;padding:0 4px;border-radius:10px;font:700 12px var(--g-body-font);color:#fff3d1;background:#000;box-shadow:0 0 0 1px var(--g-gold-lo)}
.medals li{position:relative}
.legendary{position:absolute;top:-6px;left:-6px;display:grid;place-items:center;min-width:22px;height:20px;min-height:0;padding:0 4px;border-radius:10px;font:700 12px var(--g-body-font);color:#ffe6a0;background:#3a1d05;box-shadow:0 0 0 1px var(--g-gold)}
.legendary.spent{color:#8a7a60;background:#1a120a;box-shadow:0 0 0 1px var(--g-gold-lo)}
.legendary:disabled{opacity:1;filter:none;cursor:default}
.turn-name{flex:0 0 150px;width:150px;display:flex;flex-direction:column;line-height:1.15;padding-left:10px;box-shadow:inset 1px 0 0 var(--g-gold-lo)}
.turn-name strong{font:600 14px var(--g-title-font);color:var(--g-gold-hi);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.gm-turn{flex:0 0 auto;display:flex;align-items:center;gap:6px}
.turn-mode{width:auto;min-height:32px;padding:2px 8px;font-size:12px;border-radius:16px;max-width:150px}
.gm-turn button{display:inline-flex;align-items:center;gap:4px;min-height:32px;padding:2px 10px;font-size:13px;border-radius:16px}
.game-initiative.tight-1,.game-initiative.tight-2{gap:10px;padding:8px 12px}
.tight-1 .turn-name{flex-basis:118px;width:118px}
.tight-1 .turn-mode{max-width:120px}
.tight-1 .gm-label,.tight-2 .gm-label{display:none}
.tight-2 .turn-name{display:none}
.tight-2 .round-plate{padding:2px 6px}
.tight-2 .turn-mode{max-width:84px;padding:2px 4px;font-size:11px}
</style>
