<script setup lang="ts">
import type { LibraryAsset } from '../../tabletop/view/types';

defineProps<{
  busy: boolean;
  canCreate: boolean;
  library: LibraryAsset[];
}>();

const emit = defineEmits<{
  file: [event: Event];
  create: [];
}>();

const assetId = defineModel<string>('assetId', { required: true });
const name = defineModel<string>('name', { required: true });
</script>

<template>
  <details>
    <summary>Быстро: объект из 3D-модели</summary>

    <label>
      Модель из библиотеки кампании
      <select v-model="assetId" :disabled="busy">
        <option value="">Выберите модель</option>
        <option v-for="asset in library" :key="asset.id" :value="asset.id">
          {{ asset.original_filename || asset.id }}
        </option>
      </select>
    </label>

    <label>
      Загрузить новую модель — GLB, до 25 МБ
      <input type="file" accept=".glb,model/gltf-binary" :disabled="busy" @change="emit('file', $event)" />
    </label>

    <label>
      Название объекта
      <input v-model="name" maxlength="100" placeholder="Например: Факел" :disabled="busy" />
    </label>

    <button type="button" :disabled="busy || !canCreate || !assetId" @click="emit('create')">
      Создать и поставить
    </button>
  </details>
</template>
