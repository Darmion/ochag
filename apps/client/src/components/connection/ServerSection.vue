<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';

import GameIcon from '../game/GameIcon.vue';
import type { GameIconName } from '../../ui/gameIcons';

export type SectionTone = 'ok' | 'warn' | 'bad' | 'off' | 'info';

const props = defineProps<{
  id: string;
  title: string;
  icon: GameIconName;
  eyebrow?: string;
  summary?: string;
  status?: string;
  tone?: SectionTone;
  defaultOpen?: boolean;
  attention?: boolean;
}>();

const emit = defineEmits<{ toggle: [open: boolean] }>();

const KEY = 'ochag.serverSections.v1';
function readStored(): Record<string, boolean> {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
function store(open: boolean) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readStored(), [props.id]: open }));
  } catch {
  }
}

const root = ref<HTMLDetailsElement | null>(null);
const open = ref(readStored()[props.id] ?? props.defaultOpen ?? false);

function onToggle() {
  const now = root.value?.open ?? false;
  if (now !== open.value) {
    open.value = now;
    store(now);
  }
  emit('toggle', now);
}

watch(() => props.attention, value => { if (value) open.value = true; }, { immediate: true });

async function reveal() {
  open.value = true;
  await nextTick();
  root.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  root.value?.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
}

defineExpose({ reveal });
</script>

<template>
  <details ref="root" class="server-section" :data-tone="props.tone ?? 'info'" :open="open" @toggle="onToggle">
    <summary class="section-summary">
      <span class="section-icon" aria-hidden="true"><GameIcon :name="props.icon" :size="18" /></span>
      <span class="section-head">
        <small v-if="props.eyebrow" class="section-eyebrow">{{ props.eyebrow }}</small>
        <strong class="section-title">{{ props.title }}</strong>
        <small v-if="props.summary" class="section-line">{{ props.summary }}</small>
      </span>
      <span v-if="props.status" class="section-status"><i aria-hidden="true" />{{ props.status }}</span>
      <span class="section-chevron" aria-hidden="true">▾</span>
    </summary>
    <div class="section-body"><slot /></div>
  </details>
</template>

<style scoped>
.server-section{--tone:var(--g-gold-lo);position:relative;margin:10px 0;border:1px solid var(--brass-light);border-radius:8px;background:linear-gradient(145deg,#ffffff08,transparent 40%),var(--surface-inset);box-shadow:inset 3px 0 var(--tone),inset 0 1px #ffffff0a;scroll-margin-top:calc(var(--game-top,56px) + 14px)}
.server-section[data-tone="ok"]{--tone:var(--g-good)}
.server-section[data-tone="warn"]{--tone:var(--g-warn)}
.server-section[data-tone="bad"]{--tone:var(--g-bad);border-color:color-mix(in srgb,var(--g-bad) 55%,var(--brass-light))}
.server-section[data-tone="off"]{--tone:var(--g-text-faint)}
.server-section>summary.section-summary::before{display:none}
.section-summary{display:flex;align-items:center;gap:12px;padding:12px 14px 12px 16px;cursor:pointer;border-radius:8px;text-shadow:none}
.section-summary:hover{background:#ffffff07}
.section-icon{display:grid;place-items:center;width:36px;height:36px;flex:none;border:1px solid var(--brass-light);border-radius:50%;font-size:17px;color:var(--g-gold);background:radial-gradient(circle,#ffffff0d,transparent 65%),#0003}
.section-head{display:flex;flex:1;min-width:0;flex-direction:column;gap:1px}
.section-eyebrow{font:700 9.5px var(--g-title-font,serif);letter-spacing:.16em;color:var(--g-gold-lo)}
.section-title{font:700 17px var(--g-title-font,serif);color:var(--g-gold);text-shadow:0 1px 0 #000}
.section-line{overflow:hidden;font:13px var(--g-body-font,inherit);color:var(--g-text-dim);text-overflow:ellipsis;white-space:nowrap}
.section-status{display:inline-flex;align-items:center;gap:6px;flex:none;max-width:42%;padding:3px 10px;border:1px solid color-mix(in srgb,var(--tone) 70%,transparent);border-radius:12px;font:700 11px var(--g-body-font,inherit);letter-spacing:.04em;color:var(--tone);background:color-mix(in srgb,var(--tone) 12%,transparent);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.section-status i{width:8px;height:8px;flex:none;border-radius:50%;background:var(--tone);box-shadow:0 0 8px color-mix(in srgb,var(--tone) 70%,transparent)}
.server-section[data-tone="off"] .section-status{color:var(--g-text-dim)}
.section-chevron{flex:none;font-size:14px;color:var(--g-gold-lo);transition:transform .15s ease}
.server-section[open]>summary .section-chevron{transform:rotate(180deg);color:var(--g-gold-hi)}
.section-body{padding:2px 16px 14px 18px;border-top:1px solid color-mix(in srgb,var(--brass-light) 60%,transparent)}
@media (max-width:720px){.section-summary{flex-wrap:wrap}.section-status{order:3;max-width:none;margin-left:48px}}

.server-section{--tone:var(--brass);border-radius:9px;box-shadow:inset 0 1px #ffffff0a;background:linear-gradient(125deg,color-mix(in srgb,var(--brass) 6%,transparent),transparent 55%),var(--surface-inset)}
.section-summary{display:grid;grid-template-columns:40px minmax(0,1fr) 16px;gap:5px 12px;padding:16px;list-style:none}
.section-summary::-webkit-details-marker{display:none}
.section-icon{grid-row:1/3;width:38px;height:44px;border-radius:20px 20px 6px 6px;color:var(--brass)}
.section-head{gap:4px}
.section-eyebrow{margin:0;font:600 9px/1.4 var(--g-body-font,'Segoe UI',sans-serif);letter-spacing:1.3px;color:var(--muted-ink)}
.section-title{font:16px/1.4 var(--g-title-font,Georgia,serif);color:var(--ink);text-shadow:none}
.section-line{margin:0;font:12px/1.5 var(--g-body-font,'Segoe UI',sans-serif);color:var(--muted-ink);white-space:normal;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.section-status{grid-column:2;grid-row:2;justify-self:start;max-width:100%;box-sizing:border-box;margin:4px 0 0;padding:3px 8px;font:600 10px/1.4 var(--g-body-font,'Segoe UI',sans-serif);white-space:normal}
.section-status i{width:6px;height:6px;box-shadow:none}
.section-chevron{grid-column:3;grid-row:1/3;color:var(--brass)}
.section-body{padding:14px 18px 18px}
.section-summary:focus-visible{outline:2px solid var(--brass);outline-offset:3px}
.server-section[open]{border-color:color-mix(in srgb,var(--brass) 60%,var(--brass-light))}
.server-section[open]>.section-summary{background:linear-gradient(90deg,color-mix(in srgb,var(--brass) 8%,transparent),transparent)}
@media(prefers-reduced-motion:reduce){.section-chevron{transition:none}}
</style>
