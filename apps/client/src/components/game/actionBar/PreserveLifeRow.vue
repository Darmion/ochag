<script setup lang="ts">
import FeatureHead from './FeatureHead.vue';
import type { FeatureView } from '../../../actionBar/types';

defineProps<{ feature: FeatureView; working: boolean; sum: number }>();
const emit = defineEmits<{ spread: []; preserve: [] }>();
const pick = defineModel<Record<string, number>>('pick', { required: true });
</script>

<template>
  <div class="feature-row">
    <FeatureHead :feature="feature" />
    <template v-if="feature.available">
      <label v-for="choice in feature.choices ?? []" :key="choice.value" class="target-select">
        {{ choice.label }}
        <input v-model.number="pick[choice.value]" class="hands-amount" type="number" min="0" :max="choice.count ?? 0" :placeholder="`до ${choice.count}`" :disabled="working" :aria-label="`Сколько хитов: ${choice.label}`" />
      </label>
      <small class="muted">всего {{ sum }} из {{ feature.limit ?? 0 }}</small>
      <button type="button" :disabled="working" @click="emit('spread')">Распределить</button>
      <button type="button" class="primary" :disabled="working || !sum || sum > (feature.limit ?? 0)" @click="emit('preserve')">Сохранить жизнь</button>
    </template>
    <small v-if="feature.reason" class="muted">{{ feature.reason }}</small>
  </div>
</template>

<style scoped src="./actionPopover.css"></style>
