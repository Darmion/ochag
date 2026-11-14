<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

import GameIcon from './GameIcon.vue';
import { normalizeFormula } from '../../rules/dice';

type Macro = { id: string; label: string; formula: string; characterId: string | null; hidden: boolean };
type Draft = { id: string | null; label: string; formula: string; characterId: string; hidden: boolean };

const props = defineProps<{
  campaignId: string;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
  heroes: Array<{ id: string; name: string }>;
  speakerId: string | null;
  canHide: boolean;
  busy: boolean;
}>();
const emit = defineEmits<{ roll: [{ formula: string; label: string; hidden: boolean; characterId?: string }] }>();

const open = ref(false);
const macros = ref<Macro[]>([]);
const loaded = ref(false);
const working = ref(false);
const error = ref('');
const draft = ref<Draft | null>(null);
const root = ref<HTMLElement | null>(null);
const opener = ref<HTMLButtonElement | null>(null);

const path = () => `/campaigns/${props.campaignId}/roll-macros`;
const heroName = (id: string | null) => props.heroes.find(hero => hero.id === id)?.name ?? '';

async function act(action: () => Promise<void>) {
  working.value = true;
  error.value = '';
  try {
    await action();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не получилось. Проверьте связь с сервером и повторите.';
  } finally {
    working.value = false;
  }
}

async function load() {
  await act(async () => {
    macros.value = (await props.request(path())).macros ?? [];
    loaded.value = true;
  });
}

watch(() => props.campaignId, () => { loaded.value = false; macros.value = []; draft.value = null; });
watch(open, value => { if (value && !loaded.value) void load(); });

function close() {
  if (!open.value) return;
  open.value = false;
  draft.value = null;
  opener.value?.focus();
}
function onOutside(event: PointerEvent) {
  if (open.value && root.value && !root.value.contains(event.target as Node)) {
    open.value = false;
    draft.value = null;
  }
}
onMounted(() => document.addEventListener('pointerdown', onOutside, true));
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside, true));

function roll(macro: Macro) {
  const characterId = macro.characterId ?? (macro.formula.includes('@') ? props.speakerId : null);
  emit('roll', { formula: macro.formula, label: macro.label, hidden: macro.hidden && props.canHide, ...(characterId ? { characterId } : {}) });
}

function startNew() {
  draft.value = { id: null, label: '', formula: '1d20+@dex', characterId: props.speakerId ?? '', hidden: false };
}
function startEdit(macro: Macro) {
  draft.value = { id: macro.id, label: macro.label, formula: macro.formula, characterId: macro.characterId ?? '', hidden: macro.hidden };
}

function save() {
  const current = draft.value;
  if (!current) return;
  return act(async () => {
    const body = { label: current.label.trim(), formula: normalizeFormula(current.formula.trim()), characterId: current.characterId || null, hidden: current.hidden };
    const saved: Macro = current.id
      ? await props.request(`${path()}/${current.id}`, 'PUT', body)
      : await props.request(path(), 'POST', body);
    macros.value = current.id ? macros.value.map(entry => (entry.id === saved.id ? saved : entry)) : [...macros.value, saved];
    draft.value = null;
  });
}

function remove(macro: Macro) {
  return act(async () => {
    await props.request(`${path()}/${macro.id}`, 'DELETE');
    macros.value = macros.value.filter(entry => entry.id !== macro.id);
    if (draft.value?.id === macro.id) draft.value = null;
  });
}
</script>

<template>
  <span ref="root" class="macros-wrap" @keydown.esc.stop="close">
    <button
      ref="opener" type="button" class="macros-open icon-only" :aria-expanded="open" aria-label="Свои броски"
      title="Свои броски: кнопки с подписью и формулой" @click="open = !open"
    ><GameIcon name="d20" :size="15" /></button>
    <div v-if="open" class="macros-popover g-frame" role="dialog" aria-label="Свои броски">
      <header class="macros-head">
        <strong>Свои броски</strong>
        <button v-if="!draft" type="button" class="macros-add" :disabled="working || busy" @click="startNew"><GameIcon name="plus" :size="13" /> Новый</button>
      </header>
      <p v-if="loaded && !macros.length && !draft" class="muted macros-empty">
        Здесь будут ваши кнопки: подпись и формула, например «Ловкость» и 1d20+@dex. Видите их только вы.
      </p>
      <ul v-if="macros.length" class="macros-list">
        <li v-for="macro in macros" :key="macro.id">
          <button type="button" class="macro-roll" :disabled="busy || working" :title="`Бросить ${macro.formula}${heroName(macro.characterId) ? ` от лица «${heroName(macro.characterId)}»` : ''}`" @click="roll(macro)">
            <span class="macro-label" translate="no">{{ macro.label }}</span>
            <small class="macro-formula">{{ macro.formula }}<template v-if="heroName(macro.characterId)"> · <span translate="no">{{ heroName(macro.characterId) }}</span></template></small>
          </button>
          <button type="button" class="icon-only" :disabled="working" :aria-label="`Изменить «${macro.label}»`" title="Изменить" @click="startEdit(macro)"><GameIcon name="pencil" :size="13" /></button>
          <button type="button" class="icon-only danger-icon" :disabled="working" :aria-label="`Удалить «${macro.label}»`" title="Удалить кнопку" @click="remove(macro)"><GameIcon name="trash" :size="13" /></button>
        </li>
      </ul>
      <form v-if="draft" class="macro-form" @submit.prevent="save">
        <label>
          Подпись
          <input v-model="draft.label" maxlength="40" placeholder="Ловкость" translate="no" :disabled="working" />
        </label>
        <label>
          Формула
          <input v-model="draft.formula" maxlength="100" placeholder="1d20+@dex" :disabled="working" />
        </label>
        <label v-if="heroes.length">
          От лица
          <select v-model="draft.characterId" :disabled="working">
            <option value="">того, кто сейчас выбран</option>
            <option v-for="hero in heroes" :key="hero.id" :value="hero.id" translate="no">{{ hero.name }}</option>
          </select>
        </label>
        <label v-if="canHide" class="macro-check">
          <input v-model="draft.hidden" type="checkbox" :disabled="working" /> Тайный бросок
        </label>
        <div class="macro-actions">
          <button type="submit" class="primary" :disabled="working || !draft.label.trim() || !draft.formula.trim()">{{ draft.id ? 'Сохранить' : 'Добавить кнопку' }}</button>
          <button type="button" :disabled="working" @click="draft = null">Отмена</button>
        </div>
      </form>
      <p v-if="error" class="macros-error" role="alert">{{ error }}</p>
    </div>
  </span>
</template>

<style scoped>
.macros-wrap{position:relative;flex:none;display:flex}
.macros-open{display:grid;place-items:center;width:30px;padding:0 !important}
.macros-popover{position:absolute;right:-76px;bottom:calc(100% + 8px);z-index:20;display:flex;flex-direction:column;gap:8px;width:290px;max-height:360px;overflow-y:auto;padding:10px 12px;color:var(--g-text);background:var(--g-panel,#1c130c);box-shadow:0 10px 24px #000c;font-size:12px}
.macros-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.macros-head strong{color:var(--g-gold-hi)}
.macros-add{display:inline-flex;align-items:center;gap:4px;min-height:26px !important;padding:0 8px !important;font-size:12px !important}
.macros-empty{margin:0;line-height:1.4}
.macros-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.macros-list li{display:flex;align-items:stretch;gap:4px}
.macro-roll{flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:1px;min-height:34px !important;padding:3px 8px !important;text-align:left}
.macro-label{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;color:var(--g-gold-hi)}
.macro-formula{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--g-text-dim);font-family:ui-monospace,Consolas,monospace;font-size:11px}
.icon-only{display:grid;place-items:center;width:28px;min-width:28px;min-height:28px;padding:0 !important}
.danger-icon{color:#d9867c}
.macro-form{display:flex;flex-direction:column;gap:6px;padding-top:6px;border-top:1px solid var(--g-gold-lo,#8a6a35)}
.macro-form label{display:flex;flex-direction:column;gap:3px;margin:0}
.macro-form .macro-check{flex-direction:row;align-items:center;gap:6px}
.macro-form input,.macro-form select{min-height:28px;font-size:12px}
.macro-actions{display:flex;gap:6px}
.macro-actions button{flex:1;min-height:28px !important;font-size:12px !important}
.macros-error{margin:0;color:#ff9c8c}
</style>
