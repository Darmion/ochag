<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';

import GameIcon from './GameIcon.vue';
import type { SceneBackup, SceneContents, ScenePreset } from '../../tabletop/view/sceneWindow';

export type SceneCard = {
  id: string;
  name: string;
  width_cells?: number;
  height_cells?: number;
  feet_per_unit?: number;
  background_asset_id?: string | null;
  background_rotation?: number | null;
};

const props = defineProps<{
  scenes: SceneCard[];
  currentId: string;
  canCreate: boolean;
  canManage: boolean;
  canUseFiles: boolean;
  busy: boolean;
  loadImage: (assetId: string) => Promise<string>;
  loadContents: (sceneId: string) => Promise<SceneContents>;
  loadBackups: () => Promise<SceneBackup[]>;
}>();
const emit = defineEmits<{
  select: [sceneId: string];
  create: [payload: { name: string; preset: ScenePreset | null }];
  rename: [payload: { sceneId: string; name: string }];
  settings: [sceneId: string];
  copy: [payload: { sceneId: string; name: string; creatures: boolean }];
  remove: [sceneId: string];
  restore: [backupId: string];
  export: [payload: { sceneId: string; name: string; creatures: boolean }];
  import: [];
}>();

const PRESETS: Array<{ id: ScenePreset | null; label: string; hint: string }> = [
  { id: null, label: 'Пустая сетка', hint: 'Пустая карта 20×20 клеток: стены и местность рисуете сами.' },
  { id: 'tavern', label: 'Таверна', hint: 'Зал со столами и стойкой, кухня и кладовая, четыре двери и окна. 16×12 клеток.' },
  { id: 'cave', label: 'Пещера', hint: 'Природный камень: залы, каменные столбы, осыпи, уступ в 10 футов и подземное озеро, вход с юга. Сумрак. 24×20 клеток.' },
  { id: 'glade', label: 'Лесная поляна', hint: 'Поляна в кольце кустов с тремя тропами, пруд, холм, валуны и подлесок. Небо — по времени суток. 20×20 клеток.' },
  { id: 'road', label: 'Тракт', hint: 'Дорога между живыми изгородями: брод через ручей, лужа, канавы, валуны в полях. Небо — по времени суток. 30×12 клеток.' },
];

const thumbs = reactive<Record<string, string>>({});
watch(() => props.scenes.map(scene => scene.background_asset_id ?? '').join('|'), () => {
  for (const scene of props.scenes) {
    const id = scene.background_asset_id;
    if (!id || id in thumbs) continue;
    thumbs[id] = '';
    void props.loadImage(id).then(url => { thumbs[id] = url; }).catch(() => {});
  }
}, { immediate: true });

const root = ref<HTMLElement | null>(null);
// A panel opens below what was clicked; inside a scrolled window it may start past the bottom edge.
async function reveal(selector: string) {
  await nextTick();
  root.value?.querySelector(selector)?.scrollIntoView({ block: 'nearest' });
}

const headPanel = ref<'create' | 'more' | 'backups' | null>(null);
const newName = ref('');
const newPreset = ref<ScenePreset | null>(null);
const createInput = ref<HTMLInputElement | null>(null);
const presetHint = computed(() => PRESETS.find(preset => preset.id === newPreset.value)?.hint ?? '');
async function openCreate() {
  headPanel.value = 'create';
  newName.value = '';
  newPreset.value = null;
  await reveal('.scene-form');
  createInput.value?.focus();
}
watch(newPreset, (preset, before) => {
  const label = (id: ScenePreset | null) => PRESETS.find(entry => entry.id === id)?.label ?? '';
  if (preset && (!newName.value.trim() || newName.value === label(before))) newName.value = label(preset);
});
function submitCreate() {
  if (!newName.value.trim()) return;
  emit('create', { name: newName.value.trim(), preset: newPreset.value });
  headPanel.value = null;
}

const backups = ref<SceneBackup[] | null>(null);
const backupsError = ref('');
async function openBackups() {
  headPanel.value = 'backups';
  backups.value = null;
  backupsError.value = '';
  void reveal('.scene-form');
  try {
    backups.value = await props.loadBackups();
  } catch (cause) {
    backupsError.value = cause instanceof Error ? cause.message : 'Не удалось загрузить список. Попробуйте ещё раз.';
  }
  void reveal('.scene-form');
}
function restore(backup: SceneBackup) {
  headPanel.value = null;
  emit('restore', backup.id);
}
function importFile() {
  headPanel.value = null;
  emit('import');
}
const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const menuFor = ref<string | null>(null);
const renaming = ref<string | null>(null);
const renameValue = ref('');
const renameInput = ref<HTMLInputElement[] | HTMLInputElement | null>(null);
async function startRename(scene: SceneCard) {
  menuFor.value = null;
  renaming.value = scene.id;
  renameValue.value = scene.name;
  await nextTick();
  const input = Array.isArray(renameInput.value) ? renameInput.value[0] : renameInput.value;
  input?.focus();
  input?.select();
}
function submitRename(scene: SceneCard) {
  const name = renameValue.value.trim();
  renaming.value = null;
  if (name && name !== scene.name) emit('rename', { sceneId: scene.id, name });
}
function openSettings(scene: SceneCard) {
  menuFor.value = null;
  emit('settings', scene.id);
}
function go(scene: SceneCard) {
  menuFor.value = null;
  if (scene.id !== props.currentId) emit('select', scene.id);
}

const cardPanel = ref<{ kind: 'copy' | 'export' | 'remove'; sceneId: string } | null>(null);
const copyName = ref('');
const withCreatures = ref(false);
const contents = ref<SceneContents | null>(null);
const contentsError = ref('');
const panelOf = (scene: SceneCard) => (cardPanel.value?.sceneId === scene.id ? cardPanel.value.kind : null);
function openPanel(scene: SceneCard, kind: 'copy' | 'export' | 'remove') {
  menuFor.value = null;
  cardPanel.value = { kind, sceneId: scene.id };
  withCreatures.value = false;
  copyName.value = `${scene.name.replace(/\s+\d+$/, '')} ${Number(/\s(\d+)$/.exec(scene.name)?.[1] ?? 1) + 1}`.slice(0, 200);
  contents.value = null;
  contentsError.value = '';
  void reveal('.card-panel');
  if (kind === 'remove') {
    props.loadContents(scene.id).then(found => { if (cardPanel.value?.sceneId === scene.id) contents.value = found; }).catch(cause => {
      contentsError.value = cause instanceof Error ? cause.message : 'Не удалось узнать, что на сцене. Попробуйте ещё раз.';
    }).finally(() => void reveal('.card-panel'));
  }
}
function submitCopy(scene: SceneCard) {
  if (!copyName.value.trim()) return;
  emit('copy', { sceneId: scene.id, name: copyName.value.trim(), creatures: withCreatures.value });
  cardPanel.value = null;
}
function submitExport(scene: SceneCard) {
  emit('export', { sceneId: scene.id, name: scene.name, creatures: withCreatures.value });
  cardPanel.value = null;
}
function submitRemove(scene: SceneCard) {
  emit('remove', scene.id);
  cardPanel.value = null;
}
const CONTENT_LABELS: Array<[keyof Omit<SceneContents, 'combat'>, string]> = [
  ['walls', 'Стены'], ['doors', 'Двери'], ['windows', 'Окна'], ['objects', 'Предметы'], ['npcs', 'НПС'], ['characters', 'Персонажи игроков'],
  ['traps', 'Ловушки'], ['pins', 'Булавки'], ['drawings', 'Рисунки'], ['counters', 'Счётчики'],
];
const contentRows = computed(() => CONTENT_LABELS.filter(([key]) => (contents.value?.[key] ?? 0) > 0).map(([key, label]) => ({ key, label, value: contents.value![key] })));

const sizeText = (scene: SceneCard) => (scene.width_cells && scene.height_cells
  ? `${scene.width_cells}×${scene.height_cells} кл.${scene.feet_per_unit ? `, ${scene.feet_per_unit} фт.` : ''}`
  : '');
</script>

<template>
  <div ref="root" class="scene-cards">
    <div class="scene-cards-head">
      <span class="muted">{{ scenes.length ? `Сцен: ${scenes.length}` : 'Сцен пока нет.' }}</span>
      <div v-if="canCreate" class="head-actions">
        <button v-if="headPanel !== 'create'" type="button" class="primary new-scene" :disabled="busy" @click="openCreate">
          <GameIcon name="plus" :size="16" /> Новая сцена
        </button>
        <button
          type="button" class="scene-more head-more" :aria-expanded="headPanel === 'more'" aria-label="Ещё: сцены из файла и удалённые сцены"
          title="Загрузить сцену из файла, вернуть удалённую" :disabled="busy" @click="headPanel = headPanel === 'more' ? null : 'more'"
        >⋯</button>
        <div v-if="headPanel === 'more'" class="scene-popover head-menu g-frame" role="menu" @keydown.esc.stop="headPanel = null">
          <button v-if="canUseFiles" type="button" role="menuitem" :disabled="busy" title="Файл .ochag-scene — сохранённый в этой или другой кампании" @click="importFile">Загрузить сцену из файла…</button>
          <button type="button" role="menuitem" :disabled="busy" @click="openBackups">Удалённые сцены…</button>
        </div>
      </div>
    </div>

    <form v-if="headPanel === 'create'" class="scene-popover scene-form g-frame" @submit.prevent="submitCreate" @keydown.esc.stop="headPanel = null">
      <label>
        Основа
        <select v-model="newPreset" :disabled="busy">
          <option v-for="preset in PRESETS" :key="preset.id ?? 'empty'" :value="preset.id">{{ preset.label }}</option>
        </select>
      </label>
      <small class="muted">{{ presetHint }}</small>
      <label>
        Название новой сцены
        <input ref="createInput" v-model="newName" maxlength="200" placeholder="Например: Пещера гоблинов" :disabled="busy" />
      </label>
      <div class="popover-actions">
        <button type="submit" class="primary" :disabled="busy || !newName.trim()">Создать</button>
        <button type="button" @click="headPanel = null">Отмена</button>
      </div>
    </form>

    <div v-if="headPanel === 'backups'" class="scene-popover scene-form g-frame" @keydown.esc.stop="headPanel = null">
      <strong>Удалённые сцены</strong>
      <small class="muted">Хранятся 10 последних. Вернётся сцена со всем, что на ней было: предметы, НПС и персонажи встанут на свои места, если их не удалили из кампании.</small>
      <p v-if="backupsError" class="error">{{ backupsError }}</p>
      <p v-else-if="!backups" class="muted">Загружаю список…</p>
      <p v-else-if="!backups.length" class="muted">Удалённых сцен нет.</p>
      <ul v-else class="backup-list">
        <li v-for="backup in backups" :key="backup.id">
          <span class="backup-copy">
            <strong translate="no">{{ backup.name }}</strong>
            <small class="muted">{{ when(backup.deletedAt) }}</small>
          </span>
          <button type="button" :disabled="busy" @click="restore(backup)">Вернуть</button>
        </li>
      </ul>
      <div class="popover-actions">
        <button type="button" @click="headPanel = null">Закрыть</button>
      </div>
    </div>

    <ul class="scene-card-list">
      <li
        v-for="scene in scenes" :key="scene.id"
        class="scene-card" :class="{ current: scene.id === currentId }"
      >
        <button type="button" class="scene-card-main" :disabled="busy" :aria-current="scene.id === currentId ? 'true' : undefined" :title="scene.id === currentId ? 'Вы на этой сцене' : `Перейти на сцену «${scene.name}»`" @click="go(scene)">
          <span class="scene-thumb" aria-hidden="true">
            <img
              v-if="scene.background_asset_id && thumbs[scene.background_asset_id]"
              :src="thumbs[scene.background_asset_id]" alt=""
              :style="scene.background_rotation ? { transform: `rotate(${scene.background_rotation}deg)` } : undefined"
            />
            <GameIcon v-else name="map" :size="22" />
          </span>
          <span class="scene-copy">
            <template v-if="renaming !== scene.id">
              <strong translate="no">{{ scene.name }}</strong>
              <small>{{ sizeText(scene) }}</small>
            </template>
          </span>
          <span v-if="scene.id === currentId" class="here-badge">вы здесь</span>
        </button>
        <form v-if="renaming === scene.id" class="rename-form" @submit.prevent="submitRename(scene)" @keydown.esc.stop="renaming = null">
          <input ref="renameInput" v-model="renameValue" maxlength="200" aria-label="Новое название сцены" :disabled="busy" />
          <button type="submit" class="primary" :disabled="busy || !renameValue.trim()">Сохранить</button>
          <button type="button" @click="renaming = null">Отмена</button>
        </form>
        <button
          v-if="canCreate && renaming !== scene.id && !panelOf(scene)" type="button" class="scene-more" :aria-expanded="menuFor === scene.id"
          :aria-label="`Ещё: ${scene.name}`" title="Переименовать, копировать, сохранить в файл, удалить" @click="menuFor = menuFor === scene.id ? null : scene.id"
        >⋯</button>
        <div v-if="menuFor === scene.id" class="scene-popover scene-menu g-frame" role="menu" @keydown.esc.stop="menuFor = null">
          <button v-if="scene.id !== currentId" type="button" role="menuitem" :disabled="busy" @click="go(scene)">Перейти</button>
          <button type="button" role="menuitem" :disabled="busy" @click="startRename(scene)">Переименовать…</button>
          <button
            type="button" role="menuitem" :disabled="busy || !canManage"
            :title="scene.id === currentId ? 'Размер карты и её картинка' : 'Откроет сцену и её настройки'"
            @click="openSettings(scene)"
          >Настройки карты…</button>
          <button type="button" role="menuitem" :disabled="busy" @click="openPanel(scene, 'copy')">Копировать…</button>
          <button v-if="canUseFiles" type="button" role="menuitem" :disabled="busy" @click="openPanel(scene, 'export')">Сохранить в файл…</button>
          <button type="button" role="menuitem" class="danger-item" :disabled="busy" @click="openPanel(scene, 'remove')">Удалить…</button>
        </div>

        <form v-if="panelOf(scene) === 'copy'" class="card-panel" @submit.prevent="submitCopy(scene)" @keydown.esc.stop="cardPanel = null">
          <label>
            Название копии
            <input v-model="copyName" maxlength="200" :disabled="busy" translate="no" />
          </label>
          <label>
            Существа
            <select v-model="withCreatures" :disabled="busy">
              <option :value="false">Без существ</option>
              <option :value="true">С НПС — их копии</option>
            </select>
          </label>
          <small class="muted">Копируются стены, местность, свет, ловушки, булавки, рисунки и предметы — как новые объекты. Персонажи игроков не копируются.</small>
          <div class="popover-actions">
            <button type="submit" class="primary" :disabled="busy || !copyName.trim()">Копировать</button>
            <button type="button" @click="cardPanel = null">Отмена</button>
          </div>
        </form>

        <form v-if="panelOf(scene) === 'export'" class="card-panel" @submit.prevent="submitExport(scene)" @keydown.esc.stop="cardPanel = null">
          <label>
            Существа
            <select v-model="withCreatures" :disabled="busy">
              <option :value="false">Без существ</option>
              <option :value="true">С НПС</option>
            </select>
          </label>
          <small class="muted">В файл .ochag-scene попадут карта, её картинки, модели и музыка. Персонажи игроков в файл не попадут.</small>
          <div class="popover-actions">
            <button type="submit" class="primary" :disabled="busy">Сохранить в файл…</button>
            <button type="button" @click="cardPanel = null">Отмена</button>
          </div>
        </form>

        <div v-if="panelOf(scene) === 'remove'" class="card-panel remove-panel" role="alertdialog" aria-label="Удалить сцену" @keydown.esc.stop="cardPanel = null">
          <strong>Удалить эту сцену?</strong>
          <p v-if="contentsError" class="error">{{ contentsError }}</p>
          <p v-else-if="!contents" class="muted">Смотрю, что на сцене…</p>
          <template v-else>
            <dl v-if="contentRows.length" class="contents-list">
              <div v-for="row in contentRows" :key="row.key"><dt>{{ row.label }}</dt><dd>{{ row.value }}</dd></div>
            </dl>
            <p v-else class="muted">Сцена пустая.</p>
            <p v-if="contents.combat" class="error">На сцене идёт бой. Завершите его, чтобы удалить сцену.</p>
          </template>
          <small class="muted">Предметы, НПС и персонажи останутся в кампании. Перед удалением я сохраню копию сцены — вернуть её можно в меню «⋯» → «Удалённые сцены».</small>
          <div class="popover-actions">
            <button type="button" class="danger" :disabled="busy || !contents || contents.combat" @click="submitRemove(scene)">Удалить сцену</button>
            <button type="button" @click="cardPanel = null">Отмена</button>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.scene-cards{display:flex;flex-direction:column;gap:10px}
.scene-cards-head{position:relative;display:flex;align-items:center;justify-content:space-between;gap:8px}
.head-actions{display:flex;align-items:center;gap:6px}
.new-scene{display:inline-flex;align-items:center;gap:6px}
.scene-card-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.scene-card{position:relative;display:flex;flex-wrap:wrap;align-items:stretch;gap:0}
.scene-card-main{flex:1 1 auto;display:flex;align-items:center;gap:10px;min-width:0;min-height:64px;padding:6px 40px 6px 6px;text-align:left;justify-content:flex-start}
.scene-card.current .scene-card-main{box-shadow:inset 3px 0 0 var(--g-gold-hi,#e8c26a),inset 0 0 0 1px var(--g-gold,#b08d57)}
.scene-thumb{flex:none;display:grid;place-items:center;width:72px;height:52px;overflow:hidden;border-radius:3px;background:repeating-linear-gradient(0deg,#0000 0 11px,#ffffff10 11px 12px),repeating-linear-gradient(90deg,#0000 0 11px,#ffffff10 11px 12px),#00000055;color:var(--g-text-dim,#bba)}
.scene-thumb img{width:100%;height:100%;object-fit:cover}
.scene-copy{display:flex;flex-direction:column;gap:2px;min-width:0}
.scene-copy strong{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.scene-copy small{opacity:.75;font-size:11px}
.here-badge{margin-left:auto;flex:none;padding:1px 7px;border-radius:9px;font-size:10px;letter-spacing:.04em;color:#1a1208;background:var(--g-gold-hi,#e8c26a)}
.scene-more{position:absolute;right:4px;top:50%;transform:translateY(-50%);width:30px;min-width:30px;height:30px;min-height:30px;padding:0;font-size:16px;line-height:1}
.head-more{position:static;transform:none}
.scene-card:has(.rename-form) .scene-more{display:none}
.rename-form{flex:1 1 100%;display:flex;gap:6px;margin-top:4px}
.rename-form input{flex:1 1 auto;min-width:0}
.scene-popover{z-index:5;display:flex;flex-direction:column;gap:6px;padding:10px;background:var(--g-panel,#1c130c);box-shadow:0 10px 24px #000c}
.scene-menu{position:absolute;right:4px;top:calc(100% - 4px);min-width:190px}
.head-menu{position:absolute;right:0;top:calc(100% + 4px);min-width:220px}
.scene-menu button,.head-menu button{justify-content:flex-start;text-align:left}
.danger-item{color:var(--g-danger,#e88)}
.scene-form label,.card-panel label{display:flex;flex-direction:column;gap:4px;margin:0}
.card-panel{flex:1 1 100%;display:flex;flex-direction:column;gap:6px;margin-top:4px;padding:8px;border:1px solid var(--g-gold,#b08d57);border-radius:4px;background:#00000040}
.contents-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:2px 12px;margin:0}
.contents-list div{display:flex;justify-content:space-between;gap:8px}
.contents-list dt{opacity:.8}
.contents-list dd{margin:0;font-variant-numeric:tabular-nums}
.backup-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px;max-height:260px;overflow:auto}
.backup-list li{display:flex;align-items:center;justify-content:space-between;gap:8px}
.backup-copy{display:flex;flex-direction:column;min-width:0}
.backup-copy strong{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.popover-actions{display:flex;gap:6px}
.error{color:var(--g-danger,#e88);margin:0}
</style>
