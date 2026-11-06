<script setup lang="ts">
import type { GizmoMode } from '../../tabletop/scene';
import type { SceneObjectDTO } from '../../tabletop/view/types';

defineProps<{
  object: SceneObjectDTO;
  busy: boolean;
  canManage: boolean;
  parents: Array<{ id: string; name: string }>;
  animations: string[];
}>();

const emit = defineEmits<{
  save: [];
  remove: [];
  share: [shared: boolean];
}>();

const showGizmo = defineModel<boolean>('showGizmo', { required: true });
const gizmoMode = defineModel<GizmoMode>('gizmoMode', { required: true });
const y = defineModel<number>('y', { required: true });
const rotation = defineModel<number>('rotation', { required: true });
const scale = defineModel<number>('scale', { required: true });
const snap = defineModel<boolean>('snap', { required: true });
const hidden = defineModel<boolean>('hidden', { required: true });
const parentId = defineModel<string>('parentId', { required: true });
const animationName = defineModel<string>('animationName', { required: true });
</script>

<template>
  <div class="object-transform-form">
    <template v-if="object.canMove">
      <p class="muted">
        Пока объект выбран, щелчок по клетке переставляет его; тащить можно и за сам
        объект. Если тянут несколько человек, усилия складываются.
      </p>
      <label class="checkbox-label">
        <input v-model="showGizmo" type="checkbox" />
        Стрелки: поворот, масштаб, высота
      </label>

      <div v-if="showGizmo" class="gizmo-mode-buttons">
        <button type="button" :aria-pressed="gizmoMode === 'move'" :disabled="busy" @click="gizmoMode = 'move'">
          Двигать
        </button>
        <button type="button" :aria-pressed="gizmoMode === 'rotate'" :disabled="busy" @click="gizmoMode = 'rotate'">
          Вращать
        </button>
        <button type="button" :aria-pressed="gizmoMode === 'scale'" :disabled="busy" @click="gizmoMode = 'scale'">
          Масштабировать
        </button>
      </div>
    </template>

    <template v-if="object.canEdit">
      <label>
        Высота над полом, фут.
        <input v-model.number="y" type="number" step="0.1" :disabled="busy" />
      </label>

      <label>
        Поворот, °
        <input v-model.number="rotation" type="number" min="0" max="359" step="1" :disabled="busy" />
      </label>

      <label>
        Масштаб
        <input v-model.number="scale" type="number" min="0.1" max="50" step="0.1" :disabled="busy" />
      </label>

      <label class="checkbox-label">
        <input v-model="snap" type="checkbox" :disabled="busy" />
        Крепление к сетке
      </label>

      <label class="checkbox-label">
        <input v-model="hidden" type="checkbox" :disabled="busy" />
        {{ canManage ? 'Скрыт от игроков' : 'Скрыт от остальных' }} — видят только мастер и те, кто им управляет
      </label>

      <label>
        Прикрепить к объекту
        <select v-model="parentId" :disabled="busy">
          <option value="">— свободно —</option>
          <option v-for="other in parents" :key="other.id" :value="other.id">{{ other.name }}</option>
        </select>
      </label>

      <label v-if="animations.length">
        Анимационный клип
        <select v-model="animationName" :disabled="busy">
          <option value="">— без анимации —</option>
          <option v-for="clip in animations" :key="clip" :value="clip">{{ clip }}</option>
        </select>
      </label>
      <p v-else-if="object.model_asset_id" class="muted">У этой модели нет анимационных клипов.</p>

      <button type="button" :disabled="busy" @click="emit('save')">
        Сохранить
      </button>

      <button type="button" :disabled="busy" @click="emit('remove')">
        Убрать со сцены
      </button>
      <small class="muted">Или клавиша Delete. Сам объект останется в кампании.</small>
    </template>

    <label v-if="object.canShare" class="checkbox-label shared-toggle">
      <input
        type="checkbox"
        :checked="object.shared"
        :disabled="busy"
        @change="emit('share', ($event.target as HTMLInputElement).checked)"
      />
      Общий объект — двигать могут все участники, в том числе вместе
    </label>
  </div>
</template>

<style scoped>
p{line-height:1.5}
.muted{font-size:13px}
.shared-toggle{gap:8px;font-weight:600}
</style>
