<script setup lang="ts">
import FeatureHead from './FeatureHead.vue';
import type { FeatureView } from '../../../actionBar/types';

defineProps<{ feature: FeatureView; working: boolean; sum: number }>();
const emit = defineEmits<{ recover: [] }>();
const pick = defineModel<Record<string, number>>('pick', { required: true });
</script>

<template>
  <div class="feature-row">
    <FeatureHead :feature="feature" />
    <template v-if="feature.available">
      <label v-for="choice in feature.choices ?? []" :key="choice.value" class="target-select">
        {{ choice.label }}
        <select v-model.number="pick[choice.value]" :disabled="working" :aria-label="`Сколько ячеек ${choice.label}`">
          <option v-for="count in (choice.count ?? 0) + 1" :key="count" :value="count - 1">{{ count - 1 }}</option>
        </select>
      </label>
      <small class="muted">сумма {{ sum }} из {{ feature.limit ?? 0 }}</small>
      <button type="button" :disabled="working || !sum || sum > (feature.limit ?? 0)" @click="emit('recover')">Вернуть ячейки</button>
    </template>
    <small v-if="feature.reason" class="muted">{{ feature.reason }}</small>
  </div>
</template>

<style scoped src="./actionPopover.css"></style>
