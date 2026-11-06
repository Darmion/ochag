<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';

import {
  closeGameWindow, GAME_DOCK, GAME_WINDOW_ICON, isGameWindowOpen, type PanelId, setWindowWidth, WINDOW_PRESETS, WINDOW_WIDTH, windowWidth,
} from '../../tabletop/layout/gameHud';
import { cssZoom } from '../../settings/uiScale';
import GameIcon from './GameIcon.vue';

const props = defineProps<{ id: PanelId; title: string; bodyStyle?: Record<string, string> }>();

const open = computed(() => isGameWindowOpen(props.id));
const body = ref<HTMLElement | null>(null);

type Section = { element: HTMLElement; title: string };
const sections = ref<Section[]>([]);
const hasMain = ref(false);
const activeTabs = reactive<Record<string, number>>({});
const activeTab = computed({
  get: () => activeTabs[props.id] ?? 0,
  set: value => { activeTabs[props.id] = value; },
});

function container(): HTMLElement | null {
  let node = body.value;
  for (let depth = 0; node && depth < 3; depth += 1) {
    const children = [...node.children] as HTMLElement[];
    if (children.some(child => child.tagName === 'DETAILS' || (child.tagName === 'SECTION' && child.getAttribute('aria-label')))) return node;
    const visible = children.filter(child => child.tagName !== 'TEMPLATE');
    if (visible.length !== 1) return node;
    node = visible[0]!;
  }
  return node;
}

function titleOf(element: HTMLElement) {
  if (element.tagName === 'DETAILS') return element.querySelector(':scope > summary')?.textContent?.trim() ?? '';
  return element.getAttribute('aria-label') ?? '';
}

let applying = false;
function apply() {
  const root = container();
  if (!root || applying) return;
  applying = true;
  const blocks = [...root.children] as HTMLElement[];
  const found = blocks.filter(element => (element.tagName === 'DETAILS' || (element.tagName === 'SECTION' && element.getAttribute('aria-label'))) && titleOf(element))
    .map(element => ({ element, title: titleOf(element) }));
  const rest = blocks.filter(element => !found.some(section => section.element === element) && element.textContent?.trim());
  sections.value = found;
  hasMain.value = rest.length > 0;
  const tabs = found.length > 0;
  if (tabs && activeTab.value > found.length - (hasMain.value ? 0 : 1)) activeTab.value = 0;
  const shown = tabs ? (hasMain.value ? activeTab.value - 1 : activeTab.value) : -2;
  for (const element of blocks) {
    const index = found.findIndex(section => section.element === element);
    const hide = tabs && (index === -1 ? shown !== -1 : index !== shown);
    if (hide) element.dataset.fmtHide = '';
    else delete element.dataset.fmtHide;
    if (tabs && index !== -1) element.classList.add('fmt-tab-section');
    else element.classList.remove('fmt-tab-section');
    if (tabs && index === shown && element.tagName === 'DETAILS') (element as HTMLDetailsElement).open = true;
  }
  void nextTick(() => { applying = false; });
}

let observer: MutationObserver | null = null;
onMounted(() => {
  if (!body.value) return;
  observer = new MutationObserver(() => { if (!applying) apply(); });
  observer.observe(body.value, { childList: true, subtree: true });
  apply();
});
onBeforeUnmount(() => {
  observer?.disconnect();
});
watch([activeTab, open], () => apply());

const width = computed(() => windowWidth(props.id));
const sizeMenu = ref(false);
let drag: { x: number; width: number } | null = null;
function resizeDown(event: PointerEvent) {
  drag = { x: event.clientX, width: width.value };
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}
function resizeMove(event: PointerEvent) {
  if (!drag) return;
  const dx = (event.clientX - drag.x) / (cssZoom.value || 1);
  setWindowWidth(props.id, drag.width + (GAME_DOCK[props.id] === 'left' ? dx : -dx));
}
function resizeUp() { drag = null; }
function resizeKey(event: KeyboardEvent) {
  const step = event.shiftKey ? 60 : 20;
  const grow = GAME_DOCK[props.id] === 'left' ? 'ArrowRight' : 'ArrowLeft';
  const shrink = GAME_DOCK[props.id] === 'left' ? 'ArrowLeft' : 'ArrowRight';
  if (event.key !== grow && event.key !== shrink) return;
  event.preventDefault();
  setWindowWidth(props.id, width.value + (event.key === grow ? step : -step));
}
function pickSize(value: number | null) {
  setWindowWidth(props.id, value);
  sizeMenu.value = false;
}

const tabList = computed(() => [
  ...(hasMain.value ? ['Главное'] : []),
  ...sections.value.map(section => section.title.replace(/\s*\(.*\)\s*$/, '')),
]);
</script>

<template>
  <section
    v-show="open"
    class="game-window g-frame"
    :data-dock="GAME_DOCK[props.id]"
    :data-panel-id="props.id"
    :aria-label="props.title"
    :style="{ '--window-width': `${width}px` }"
  >
    <div
      class="window-resize" role="separator" aria-orientation="vertical" tabindex="0"
      :aria-valuemin="WINDOW_WIDTH.min" :aria-valuemax="WINDOW_WIDTH.max" :aria-valuenow="width"
      :aria-label="`Ширина окна «${props.title}»`" title="Потяните, чтобы сделать окно шире или уже; двойной щелчок — ширина по умолчанию"
      @pointerdown="resizeDown" @pointermove="resizeMove" @pointerup="resizeUp" @pointercancel="resizeUp"
      @dblclick="pickSize(null)" @keydown="resizeKey"
    />
    <header class="game-window-title">
      <GameIcon :name="GAME_WINDOW_ICON[props.id]" :size="20" />
      <h3>{{ props.title }}</h3>
      <span class="window-size-wrap">
        <button type="button" class="game-window-size" :aria-expanded="sizeMenu" aria-label="Ширина окна" :title="`Ширина: ${width} px`" @click="sizeMenu = !sizeMenu">
          <GameIcon name="resize" :size="15" />
        </button>
        <span v-if="sizeMenu" class="window-size-menu g-frame" role="menu" @keydown.esc.stop="sizeMenu = false">
          <button
            v-for="preset in WINDOW_PRESETS" :key="preset.id" type="button" role="menuitemradio"
            :aria-checked="width === preset.width" @click="pickSize(preset.width)"
          >{{ preset.label }} <small>{{ preset.width }} px</small></button>
          <small class="size-hint">или тяните за край окна</small>
        </span>
      </span>
      <button type="button" class="game-window-close" aria-label="Закрыть окно" @click="closeGameWindow(props.id)">
        <GameIcon name="close" :size="16" />
      </button>
    </header>
    <div v-if="tabList.length > 1" class="window-tabs" role="tablist" :aria-label="`Разделы: ${props.title}`">
      <button
        v-for="(tab, index) in tabList" :key="`${index}:${tab}`" type="button" role="tab"
        :aria-selected="activeTab === index" @click="activeTab = index"
      >{{ tab }}</button>
    </div>
    <div ref="body" class="game-window-body" :style="props.bodyStyle">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.game-window{position:fixed;top:calc(var(--game-top,54px) + 14px);bottom:calc(var(--game-bottom,150px) + 14px);width:min(var(--window-width,400px),calc(100vw - var(--rail-space,78px) - 140px));z-index:2100;display:flex;flex-direction:column}
.window-resize{position:absolute;top:24px;bottom:24px;width:10px;z-index:3;cursor:ew-resize;touch-action:none;border-radius:4px}
.game-window[data-dock="left"] .window-resize{right:-6px}
.game-window[data-dock="right"] .window-resize{left:-6px}
.window-resize:hover,.window-resize:focus-visible,.window-resize:active{background:linear-gradient(90deg,transparent 3px,var(--g-gold-lo) 3px,var(--g-gold-lo) 7px,transparent 7px)}
.window-size-wrap{position:relative}
.game-window-size{display:grid;place-items:center;width:30px;min-height:30px;height:30px;padding:0;border-radius:50%}
.window-size-menu{position:absolute;right:0;top:calc(100% + 6px);z-index:5;display:flex;flex-direction:column;gap:3px;min-width:170px;padding:8px;background:linear-gradient(110deg,#24170ff8,#100a07f5);box-shadow:0 10px 24px #000c}
.window-size-menu button{display:flex;justify-content:space-between;gap:10px;min-height:30px;padding:2px 10px;font-size:13px}
.window-size-menu button[aria-checked="true"]{color:var(--g-gold-hi);box-shadow:inset 0 0 0 1px var(--g-gold-lo)}
.size-hint{padding:2px 4px 0;font-size:11px;color:var(--g-text-dim)}
.game-window-body{container-type:inline-size}
.game-window[data-dock="left"]{left:var(--rail-space,78px);bottom:calc(var(--game-bottom,150px) + 14px + max(0px, var(--chat-height,120px) - var(--game-bottom,156px) + 36px))}
.game-window[data-dock="right"]{right:112px}
.game-window-title{display:flex;align-items:center;gap:10px;padding:10px 12px 10px 16px;color:var(--g-gold);background:linear-gradient(180deg,#ffffff0c,#0000),linear-gradient(90deg,transparent,var(--g-gold-lo),transparent) bottom/100% 1px no-repeat;flex-shrink:0}
.game-window-title h3{flex:1;margin:0;font-size:19px;line-height:1.2}
.game-window-close{display:grid;place-items:center;width:30px;min-height:30px;height:30px;padding:0;border-radius:50%}
.window-tabs{display:flex;gap:2px;padding:4px 10px 0;flex-shrink:0;overflow-x:auto;scrollbar-width:thin;box-shadow:inset 0 -1px 0 var(--g-gold-lo)}
.window-tabs button{flex:0 0 auto;max-width:170px;min-height:32px;padding:2px 10px;font:600 13px var(--g-title-font);background:transparent;box-shadow:none;border-radius:4px 4px 0 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.window-tabs button[aria-selected="true"]{color:var(--g-gold-hi);box-shadow:inset 0 -2px 0 var(--g-gold-hi)}
.game-window-body{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:14px 16px 18px}
.game-window-body :deep(h3){font-size:20px;margin:14px 0 8px}
.game-window-body :deep(label){margin:10px 0}
.game-window-body :deep([data-fmt-hide]){display:none !important}
.game-window .game-window-body :deep(details.fmt-tab-section > summary){display:none}
</style>
