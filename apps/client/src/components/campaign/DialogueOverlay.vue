<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onCampaignEvent } from '../../campaign/campaignEvents';
import { libraryUrl, npcPortraitPath } from '../../art/portraitArt';
import { cropStyle } from '../../art/imageCrop';

type Option = { id: string; label: string; check: { skill: string; label: string; dc?: number } | null };
type View = {
  active: boolean;
  title?: string;
  npc?: { id: string; name: string; imageAssetId: string | null; imageCrop?: unknown } | null;
  node?: { id: string; speaker: string | null; text: string; options: Option[] };
  history?: Array<{ speaker: string | null; text: string; answer: string; by: string; check?: string; total?: number; success?: boolean }>;
};

const props = defineProps<{
  campaignId: string;
  currentUserId: string;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();

const view = ref<View>({ active: false });
const actors = ref<Array<{ id: string; name: string }>>([]);
const actorId = ref('');
const working = ref(false);
const error = ref('');
const portrait = ref('');
const manager = computed(() => Boolean(view.value.node?.options.some(option => option.check?.dc !== undefined)) || isManager.value);
const isManager = ref(false);
let portraitFor = '';

async function load() {
  try {
    view.value = await props.request(`/campaigns/${props.campaignId}/dialogue`);
    error.value = '';
  } catch {
    view.value = { active: false };
  }
  if (view.value.active) {
    await loadActors();
    await loadPortrait();
  }
}

async function loadActors() {
  if (actors.value.length) return;
  try {
    const roster = await props.request(`/campaigns/${props.campaignId}/characters`);
    isManager.value = roster.canManage === true;
    actors.value = (roster.characters as Array<any>)
      .filter(character => character.kind === 'character' && (isManager.value || character.owner_user_id === props.currentUserId))
      .map(character => ({ id: character.id as string, name: character.name as string }));
    if (!actors.value.some(actor => actor.id === actorId.value)) actorId.value = actors.value[0]?.id ?? '';
  } catch {
    actors.value = [];
  }
}

async function loadPortrait() {
  const assetId = view.value.npc?.imageAssetId ?? '';
  const fallback = assetId ? '' : npcPortraitPath(view.value.npc?.name) ?? '';
  if ((assetId || fallback) === portraitFor) return;
  portraitFor = assetId || fallback;
  if (portrait.value.startsWith('blob:')) URL.revokeObjectURL(portrait.value);
  portrait.value = fallback ? libraryUrl(fallback) : '';
  if (!assetId) return;
  try {
    portrait.value = URL.createObjectURL(await props.request(`/campaigns/${props.campaignId}/assets/${assetId}`) as Blob);
  } catch {
    portrait.value = '';
  }
}

async function choose(option: Option) {
  const node = view.value.node;
  if (!node || working.value) return;
  working.value = true;
  error.value = '';
  try {
    await props.request(`/campaigns/${props.campaignId}/dialogue/choose`, 'POST', {
      nodeId: node.id, optionId: option.id, ...(actorId.value ? { characterId: actorId.value } : {}),
    });
    await load();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
    await load();
  } finally {
    working.value = false;
  }
}

async function end() {
  working.value = true;
  try {
    await props.request(`/campaigns/${props.campaignId}/dialogue/end`, 'POST', {});
    await load();
  } finally {
    working.value = false;
  }
}

function onKey(event: KeyboardEvent) {
  if (!view.value.active || !view.value.node) return;
  const target = event.target as HTMLElement | null;
  if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
  const index = Number(event.key) - 1;
  const option = view.value.node.options[index];
  if (Number.isInteger(index) && option) {
    event.preventDefault();
    void choose(option);
  }
}

let stop: (() => void) | null = null;
watch(() => props.campaignId, () => {
  actors.value = [];
  void load();
});
onMounted(() => {
  void load();
  stop = onCampaignEvent('dialogue', () => void load());
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  stop?.();
  window.removeEventListener('keydown', onKey);
  if (portrait.value.startsWith('blob:')) URL.revokeObjectURL(portrait.value);
});
</script>

<template>
  <section v-if="view.active && view.node" class="dialogue" role="dialog" :aria-label="view.title">
    <div class="dialogue-portrait" aria-hidden="true">
      <img v-if="portrait" :src="portrait" alt="" :style="view.npc?.imageAssetId ? cropStyle(view.npc.imageCrop) : {}" />
      <span v-else>{{ (view.node.speaker ?? '…').slice(0, 1) }}</span>
    </div>
    <div class="dialogue-main">
      <header>
        <strong>{{ view.node.speaker ?? 'Рассказчик' }}</strong>
        <small class="muted">{{ view.title }}</small>
        <button v-if="manager" type="button" class="end" :disabled="working" @click="end">Закончить разговор</button>
      </header>
      <p class="dialogue-text">{{ view.node.text }}</p>
      <ol class="dialogue-options">
        <li v-for="(option, index) in view.node.options" :key="option.id">
          <button type="button" :disabled="working" @click="choose(option)">
            <span class="key">{{ index + 1 }}.</span> {{ option.label }}
            <span v-if="option.check" class="check">[{{ option.check.label }}{{ option.check.dc ? ` СЛ ${option.check.dc}` : '' }}]</span>
          </button>
        </li>
        <li v-if="!view.node.options.length" class="muted">Ответов нет — разговор закончит мастер.</li>
      </ol>
      <div class="dialogue-footer">
        <label v-if="actors.length">Отвечает
          <select v-model="actorId" :disabled="working">
            <option v-for="actor in actors" :key="actor.id" :value="actor.id">{{ actor.name }}</option>
          </select>
        </label>
        <details v-if="view.history?.length">
          <summary>Что было сказано ({{ view.history.length }})</summary>
          <ol class="history">
            <li v-for="(entry, index) in view.history" :key="index">
              <em>{{ entry.speaker ?? 'Рассказчик' }}:</em> {{ entry.text }} — <strong>{{ entry.by }}:</strong> {{ entry.answer }}
              <span v-if="entry.check" class="muted">({{ entry.check }} {{ entry.total }} — {{ entry.success ? 'успех' : 'провал' }})</span>
            </li>
          </ol>
        </details>
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </div>
  </section>
</template>

<style scoped>
.dialogue{position:fixed;left:50%;bottom:calc(var(--game-bottom,150px) + 16px);translate:-50% 0;z-index:3200;display:flex;gap:16px;width:min(880px,calc(100vw - 32px));max-height:min(62vh,560px);padding:16px 18px;background:linear-gradient(180deg,#1d140dfa,#120c08fa);color:#f1e4c5;border:1px solid var(--brass,#b08a4a);border-radius:8px;box-shadow:0 18px 48px #000c}
.dialogue-portrait{flex:0 0 96px;height:120px;display:grid;place-items:center;overflow:hidden;border-radius:6px;background:radial-gradient(circle at 50% 35%,#5a4630,#1c130b);box-shadow:inset 0 0 0 1px #000,0 0 0 1px var(--brass,#b08a4a);font:400 44px var(--heading-font, serif);color:#f3d48b}
.dialogue-portrait img{width:100%;height:100%;object-fit:cover;object-position:top}
.dialogue-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px;overflow-y:auto}
.dialogue-main header{display:flex;align-items:baseline;gap:10px}
.dialogue-main header strong{font-size:17px;color:#f3d48b}
.dialogue-main header .end{margin-left:auto;min-height:26px;padding:2px 10px;font-size:12px}
.dialogue-text{margin:0;font-size:16px;line-height:1.5;white-space:pre-line}
.dialogue-options{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.dialogue-options button{width:100%;text-align:left;min-height:32px;padding:4px 12px;font-size:14px;background:#0004;color:#f1e4c5;border:1px solid #b08a4a66}
.dialogue-options button:hover:not(:disabled){background:#b08a4a33}
.key{color:#f3d48b;margin-right:4px}
.check{margin-left:6px;color:#9fc6ff;font-size:12px}
.dialogue-footer{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start;font-size:13px}
.dialogue-footer label{display:flex;gap:6px;align-items:center;margin:0}
.history{margin:6px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:3px}
.error{color:#ff9c8c;margin:0}
.muted{opacity:.75}
</style>
