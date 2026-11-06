<script setup lang="ts">
import FeatureHead from './FeatureHead.vue';
import type { FeatureView } from '../../../actionBar/types';

defineProps<{ feature: FeatureView; working: boolean; sceneId: string }>();
const emit = defineEmits<{ ancestry: [value: string]; aim: [] }>();
</script>

<template>
  <div class="feature-row">
    <FeatureHead :feature="feature" />
    <select class="sense-select" :disabled="working" aria-label="Дракон-предок" :value="feature.choices?.find(choice => choice.active)?.value ?? ''" @change="emit('ancestry', ($event.target as HTMLSelectElement).value)">
      <option value="" disabled>— дракон-предок —</option>
      <option v-for="choice in feature.choices ?? []" :key="choice.value" :value="choice.value">{{ choice.label }}</option>
    </select>
    <button type="button" :disabled="working || !feature.available || !sceneId" title="Щелчок по фигуре на карте — дыхание пойдёт в её сторону" @click="emit('aim')">
      Выдохнуть…
    </button>
    <small v-if="feature.reason" class="muted">{{ feature.reason }}</small>
  </div>
</template>

<style scoped src="./actionPopover.css"></style>
