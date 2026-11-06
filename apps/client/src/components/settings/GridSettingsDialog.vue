<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';

import { useEscapeClose } from '../../ui/escapeStack';
import { DEFAULT_GRID, gridPrefs, normalizeGrid, type GridLook } from '../../settings/gridSettings';
import { t } from '../../i18n/i18n';
import GridLookFields from './GridLookFields.vue';
import GameIcon from '../game/GameIcon.vue';

const props = defineProps<{
  sceneGrid: unknown;
  sceneName: string;
  canManage: boolean;
  busy: boolean;
  themeColor: string;
}>();
const emit = defineEmits<{
  close: [];
  preview: [look: GridLook | null];
  save: [look: GridLook | null];
}>();
useEscapeClose(() => emit('close'));

const sceneDraft = ref<GridLook>(normalizeGrid(props.sceneGrid));
watch(() => props.sceneGrid, value => { sceneDraft.value = normalizeGrid(value); });
const dirty = computed(() => JSON.stringify(sceneDraft.value) !== JSON.stringify(normalizeGrid(props.sceneGrid)));
watch([sceneDraft, dirty], () => emit('preview', dirty.value ? sceneDraft.value : null), { deep: true });
onBeforeUnmount(() => emit('preview', null));

const isDefault = computed(() => JSON.stringify(normalizeGrid(props.sceneGrid)) === JSON.stringify(DEFAULT_GRID));

function save() {
  emit('save', sceneDraft.value);
}
function resetScene() {
  sceneDraft.value = { ...DEFAULT_GRID };
  emit('save', null);
}
</script>

<template>
  <div class="grid-dialog" role="dialog" :aria-label="t('Сетка стола')">
    <div class="modal-card g-frame">
      <header class="modal-header">
        <h3>{{ t('Сетка стола') }}</h3>
        <button type="button" class="modal-close" :aria-label="t('Закрыть')" @click="emit('close')"><GameIcon class="inline-icon" name="close" :size="16" /></button>
      </header>
      <p class="hint">{{ t('Только вид линий: клетки, привязка фигур и движение не меняются.') }}</p>

      <section v-if="canManage" class="grid-section">
        <h4>{{ t('Для всех на сцене «{name}»', { name: sceneName }) }}</h4>
        <GridLookFields v-model="sceneDraft" :disabled="busy" :theme-color="themeColor" />
        <p v-if="gridPrefs.mode !== 'scene'" class="hint warn">{{ t('У вас своя сетка (в «Настройках»), поэтому общий вид сетки виден вам только во время правки.') }}</p>
        <div class="actions">
          <button type="button" :disabled="busy || isDefault" @click="resetScene">{{ t('Сбросить вид сетки') }}</button>
          <button type="button" class="primary" :disabled="busy || !dirty" @click="save">{{ t('Сохранить для всех') }}</button>
        </div>
      </section>
      <p v-else class="hint">{{ t('Вид сетки сцены задаёт мастер. Свою сетку — показать, цвет, скрыть — выберите в «Настройках».') }}</p>
    </div>
  </div>
</template>

<style scoped>
.grid-dialog{position:fixed;right:112px;top:calc(var(--game-top,54px) + 14px);z-index:3000;width:min(360px,calc(100vw - 140px));max-height:calc(100vh - var(--game-top,54px) - 190px);display:flex;pointer-events:none}
.modal-card{pointer-events:auto;width:100%;max-height:100%;overflow-y:auto;padding:16px 18px;background:var(--parchment-background);color:var(--ink);border:1px solid var(--brass);border-radius:4px;box-shadow:0 12px 28px #0009}
.modal-header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}
.modal-header h3{margin:0}
.modal-close{min-height:32px;width:32px;padding:0}
.hint{margin:0 0 12px;font-size:13px;color:var(--muted-ink)}
.hint.warn{color:var(--burgundy);margin:10px 0 0}
.grid-section{padding:12px 0;border-top:1px solid var(--brass-light)}
.grid-section h4{margin:0 0 10px}
.mode{display:flex;flex-direction:column;gap:4px;margin:0 0 12px;font-size:13px;font-weight:600}
.actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
.actions button{min-height:34px;padding:4px 14px}
</style>
