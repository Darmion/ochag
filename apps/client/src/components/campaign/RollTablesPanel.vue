<script setup lang="ts">
import { confirmAction } from '../../ui/confirmDialog';
import { computed, onMounted, ref } from 'vue';
import { ensureSrdMonsters, type SrdMonster } from '../../rules/srd';
import type { BestiaryPlacement } from '../rules/BestiaryModal.vue';
import GameIcon from '../game/GameIcon.vue';

type TableMonster = { index: string; count: string };
type TableEntry = { from: number; to: number; text: string; monsters?: TableMonster[] };
type RollTable = { id: string; name: string; formula: string; entries: TableEntry[]; secret: boolean; revision: number };
type Rolled = { total: number; text: string; monsters: Array<{ index: string; nameRu: string; count: number }> };
type Draft = { id?: string; revision?: number; name: string; formula: string; secret: boolean; entries: Array<{ from: number; to: number; text: string; monsters: TableMonster[] }> };

const props = defineProps<{
  campaignId: string;
  sceneId: string;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();

const emit = defineEmits<{ place: [placement: BestiaryPlacement] }>();

const tables = ref<RollTable[]>([]);
const presets = ref<Array<{ id: string; name: string; formula: string }>>([]);
const monsters = ref<SrdMonster[]>([]);
const results = ref<Record<string, Rolled>>({});
const draft = ref<Draft | null>(null);
const preset = ref('');
const working = ref(false);
const error = ref('');

const base = () => `/campaigns/${props.campaignId}/tables`;
const monsterName = (index: string) => monsters.value.find(monster => monster.index === index)?.nameRu ?? index;

async function load() {
  try {
    const result = await props.request(base());
    tables.value = result.tables;
    presets.value = result.presets;
    error.value = '';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}

onMounted(async () => {
  await load();
  try { monsters.value = (await ensureSrdMonsters(props.request)).monsters; } catch {  }
});

async function act(action: () => Promise<void>) {
  working.value = true;
  error.value = '';
  try {
    await action();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    working.value = false;
  }
}

const addPreset = () => act(async () => {
  if (!preset.value) return;
  await props.request(base(), 'POST', { preset: preset.value });
  preset.value = '';
  await load();
});

const roll = (table: RollTable) => act(async () => {
  const result = await props.request(`${base()}/${table.id}/roll`, 'POST', {});
  results.value = { ...results.value, [table.id]: { total: result.roll.total, text: result.entry?.text ?? '—', monsters: result.monsters } };
});

function place(rolled: Rolled) {
  emit('place', {
    monsters: rolled.monsters.map(monster => ({ index: monster.index, count: monster.count })),
    hp: 'average', disposition: 'hostile', hidden: false,
    label: rolled.monsters.map(monster => (monster.count > 1 ? `${monster.nameRu} ×${monster.count}` : monster.nameRu)).join(', '),
  });
}

const remove = async (table: RollTable) => {
  if (!(await confirmAction(`Удалить таблицу «${table.name}»?`, { title: 'Удалить', confirmLabel: 'Удалить', danger: true }))) return;
  void act(async () => {
    await props.request(`${base()}/${table.id}`, 'DELETE');
    await load();
  });
};

function startNew() {
  draft.value = { name: '', formula: '1d6', secret: false, entries: [{ from: 1, to: 6, text: '', monsters: [] }] };
}

function edit(table: RollTable) {
  draft.value = {
    id: table.id, revision: table.revision, name: table.name, formula: table.formula, secret: table.secret,
    entries: table.entries.map(entry => ({ from: entry.from, to: entry.to, text: entry.text, monsters: (entry.monsters ?? []).map(monster => ({ ...monster })) })),
  };
}

function addRow() {
  const value = draft.value;
  if (!value) return;
  const last = value.entries[value.entries.length - 1];
  const next = last ? last.to + 1 : 1;
  value.entries.push({ from: next, to: next, text: '', monsters: [] });
}

const save = () => act(async () => {
  const value = draft.value;
  if (!value) return;
  const body = {
    name: value.name.trim(), formula: value.formula.trim(), secret: value.secret,
    entries: value.entries.map(entry => ({
      from: Number(entry.from), to: Number(entry.to), text: entry.text.trim(),
      ...(entry.monsters.length ? { monsters: entry.monsters.filter(monster => monster.index).map(monster => ({ index: monster.index, count: String(monster.count).trim() || '1' })) } : {}),
    })),
  };
  if (value.id) await props.request(`${base()}/${value.id}`, 'PUT', { ...body, revision: value.revision });
  else await props.request(base(), 'POST', body);
  draft.value = null;
  await load();
});

const sortedMonsters = computed(() => [...monsters.value].sort((a, b) => a.cr - b.cr || a.nameRu.localeCompare(b.nameRu)));
</script>

<template>
  <div class="roll-tables">
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <template v-if="!draft">
      <div class="add-row">
        <select v-model="preset" :disabled="working" aria-label="Готовая таблица">
          <option value="">— готовая таблица —</option>
          <option v-for="entry in presets" :key="entry.id" :value="entry.id">{{ entry.name }} ({{ entry.formula }})</option>
        </select>
        <button type="button" :disabled="working || !preset" @click="addPreset">Добавить</button>
        <button type="button" :disabled="working" @click="startNew">+ Своя</button>
      </div>

      <ul v-if="tables.length" class="table-list">
        <li v-for="table in tables" :key="table.id">
          <div class="table-head">
            <strong>{{ table.name }}</strong>
            <small class="muted">{{ table.formula }}{{ table.secret ? ' · тайная' : '' }}</small>
          </div>
          <div class="table-actions">
            <button type="button" class="primary" :disabled="working" :title="table.secret ? 'Результат увидят только мастера' : 'Результат увидят все в журнале'" @click="roll(table)"><GameIcon class="inline-icon" name="d20" :size="16" /> Бросить</button>
            <button type="button" :disabled="working" @click="edit(table)">Править</button>
            <button type="button" :disabled="working" aria-label="Удалить" @click="remove(table)"><GameIcon class="inline-icon" name="close" :size="16" /></button>
          </div>
          <div v-if="results[table.id]" class="rolled" role="status">
            <span class="total">{{ results[table.id]!.total }}</span>
            <span>{{ results[table.id]!.text }}</span>
            <template v-if="results[table.id]!.monsters.length">
              <small class="muted">— {{ results[table.id]!.monsters.map(m => (m.count > 1 ? `${m.nameRu} ×${m.count}` : m.nameRu)).join(', ') }}</small>
              <button v-if="sceneId" type="button" class="primary" :disabled="working" title="Затем щёлкните по клетке карты" @click="place(results[table.id]!)">Поставить на стол</button>
            </template>
          </div>
        </li>
      </ul>
      <p v-else class="muted">Таблиц пока нет — добавьте готовую или свою.</p>
    </template>

    <form v-else class="editor" @submit.prevent="save">
      <label>Название <input v-model="draft.name" maxlength="120" required /></label>
      <div class="editor-row">
        <label>Кость <input v-model="draft.formula" maxlength="12" placeholder="1d6, 2d6, 1d100" required /></label>
        <label class="checkbox-label"><input v-model="draft.secret" type="checkbox" /> тайная (видят мастера)</label>
      </div>
      <div v-for="(entry, index) in draft.entries" :key="index" class="entry">
        <div class="entry-line">
          <input v-model.number="entry.from" type="number" min="1" max="1000" aria-label="От" />
          <span>–</span>
          <input v-model.number="entry.to" type="number" min="1" max="1000" aria-label="До" />
          <input v-model="entry.text" class="entry-text" maxlength="500" placeholder="Что выпало" aria-label="Текст" />
          <button type="button" aria-label="Убрать строку" @click="draft.entries.splice(index, 1)"><GameIcon class="inline-icon" name="close" :size="16" /></button>
        </div>
        <div class="entry-monsters">
          <span v-for="(monster, mIndex) in entry.monsters" :key="mIndex" class="monster-pick">
            <select v-model="monster.index" aria-label="Монстр">
              <option value="">— монстр —</option>
              <option v-for="option in sortedMonsters" :key="option.index" :value="option.index">{{ option.nameRu }} ({{ option.crText }})</option>
            </select>
            <input v-model="monster.count" maxlength="12" placeholder="1d4" aria-label="Сколько" title="Сколько: число или кости, например 1d4+1" />
            <button type="button" :aria-label="`Убрать: ${monsterName(monster.index)}`" @click="entry.monsters.splice(mIndex, 1)"><GameIcon class="inline-icon" name="close" :size="16" /></button>
          </span>
          <button v-if="entry.monsters.length < 4" type="button" class="link-button" @click="entry.monsters.push({ index: '', count: '1' })">+ монстры из бестиария</button>
        </div>
      </div>
      <button type="button" class="link-button" @click="addRow">+ строка</button>
      <div class="editor-actions">
        <button type="submit" class="primary" :disabled="working || !draft.name.trim()">Сохранить</button>
        <button type="button" :disabled="working" @click="draft = null">Отмена</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.roll-tables{display:flex;flex-direction:column;gap:8px;font-size:13px}
.add-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.add-row select{flex:1 1 160px;min-width:0}
.table-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.table-list li{display:flex;flex-direction:column;gap:4px;padding:6px 8px;border:1px solid var(--line,#8a6a3f55);border-radius:4px}
.table-head{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.table-actions{display:flex;gap:4px;flex-wrap:wrap}
.table-actions button,.rolled button{min-height:28px;padding:2px 10px;font-size:12px}
.rolled{display:flex;flex-wrap:wrap;gap:6px;align-items:baseline;padding:4px 6px;border-left:3px solid var(--g-gold,#c9a227);background:#c9a2271a}
.rolled .total{font-weight:700;font-size:15px}
.editor{display:flex;flex-direction:column;gap:6px}
.editor label{display:flex;flex-direction:column;gap:2px;margin:0}
.editor .checkbox-label{flex-direction:row;align-items:center;gap:6px}
.editor-row{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}
.editor-row label:first-child{width:120px}
.entry{display:flex;flex-direction:column;gap:3px;padding-bottom:4px;border-bottom:1px dashed var(--line,#8a6a3f55)}
.entry-line{display:flex;gap:4px;align-items:center}
.entry-line input[type=number]{width:56px;min-width:0}
.entry-text{flex:1;min-width:0}
.entry-line button,.monster-pick button{min-height:26px;width:26px;padding:0}
.entry-monsters{display:flex;flex-wrap:wrap;gap:4px;align-items:center;padding-left:8px}
.monster-pick{display:inline-flex;gap:3px;align-items:center}
.monster-pick select{max-width:170px}
.monster-pick input{width:60px}
.editor-actions{display:flex;gap:6px}
.link-button{align-self:flex-start}
.error{color:#c0392b;margin:0}
</style>
