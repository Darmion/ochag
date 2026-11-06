<script setup lang="ts">
import { nextTick, reactive, ref, watch } from 'vue';

import GameIcon from './GameIcon.vue';

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
  busy: boolean;
  loadImage: (assetId: string) => Promise<string>;
}>();
const emit = defineEmits<{
  select: [sceneId: string];
  create: [name: string];
  rename: [payload: { sceneId: string; name: string }];
  settings: [sceneId: string];
}>();

const thumbs = reactive<Record<string, string>>({});
watch(() => props.scenes.map(scene => scene.background_asset_id ?? '').join('|'), () => {
  for (const scene of props.scenes) {
    const id = scene.background_asset_id;
    if (!id || id in thumbs) continue;
    thumbs[id] = '';
    void props.loadImage(id).then(url => { thumbs[id] = url; }).catch(() => {});
  }
}, { immediate: true });

const creating = ref(false);
const newName = ref('');
const createInput = ref<HTMLInputElement | null>(null);
async function openCreate() {
  creating.value = true;
  newName.value = '';
  await nextTick();
  createInput.value?.focus();
}
function submitCreate() {
  if (!newName.value.trim()) return;
  emit('create', newName.value.trim());
  creating.value = false;
}

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

const sizeText = (scene: SceneCard) => (scene.width_cells && scene.height_cells
  ? `${scene.width_cells}×${scene.height_cells} кл.${scene.feet_per_unit ? `, ${scene.feet_per_unit} фт.` : ''}`
  : '');
</script>

<template>
  <div class="scene-cards">
    <div class="scene-cards-head">
      <span class="muted">{{ scenes.length ? `Сцен: ${scenes.length}` : 'Сцен пока нет.' }}</span>
      <button v-if="canCreate && !creating" type="button" class="primary new-scene" :disabled="busy" @click="openCreate">
        <GameIcon name="plus" :size="16" /> Новая сцена
      </button>
    </div>
    <form v-if="creating" class="scene-popover new-scene-form g-frame" @submit.prevent="submitCreate" @keydown.esc.stop="creating = false">
      <label>
        Название новой сцены
        <input ref="createInput" v-model="newName" maxlength="200" placeholder="Например: Пещера гоблинов" :disabled="busy" />
      </label>
      <div class="popover-actions">
        <button type="submit" class="primary" :disabled="busy || !newName.trim()">Создать</button>
        <button type="button" @click="creating = false">Отмена</button>
      </div>
    </form>

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
              <strong>{{ scene.name }}</strong>
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
          v-if="canCreate && renaming !== scene.id" type="button" class="scene-more" :aria-expanded="menuFor === scene.id"
          :aria-label="`Ещё: ${scene.name}`" title="Переименовать, настройки карты" @click="menuFor = menuFor === scene.id ? null : scene.id"
        >⋯</button>
        <div v-if="menuFor === scene.id" class="scene-popover scene-menu g-frame" role="menu" @keydown.esc.stop="menuFor = null">
          <button v-if="scene.id !== currentId" type="button" role="menuitem" :disabled="busy" @click="go(scene)">Перейти</button>
          <button type="button" role="menuitem" :disabled="busy" @click="startRename(scene)">Переименовать…</button>
          <button
            type="button" role="menuitem" :disabled="busy || !canManage"
            :title="scene.id === currentId ? 'Размер карты и её картинка' : 'Откроет сцену и её настройки'"
            @click="openSettings(scene)"
          >Настройки карты…</button>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.scene-cards{display:flex;flex-direction:column;gap:10px}
.scene-cards-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
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
.scene-card:has(.rename-form) .scene-more{display:none}
.rename-form{flex:1 1 100%;display:flex;gap:6px;margin-top:4px}
.rename-form input{flex:1 1 auto;min-width:0}
.scene-popover{z-index:5;display:flex;flex-direction:column;gap:6px;padding:10px;background:var(--g-panel,#1c130c);box-shadow:0 10px 24px #000c}
.scene-menu{position:absolute;right:4px;top:calc(100% - 4px);min-width:190px}
.scene-menu button{justify-content:flex-start;text-align:left}
.new-scene-form label{display:flex;flex-direction:column;gap:4px;margin:0}
.popover-actions{display:flex;gap:6px}
</style>
