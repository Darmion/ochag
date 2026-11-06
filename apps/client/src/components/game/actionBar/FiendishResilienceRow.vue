<script setup lang="ts">
import FeatureHead from './FeatureHead.vue';
import type { FeatureView } from '../../../actionBar/types';

defineProps<{ feature: FeatureView; working: boolean }>();
const emit = defineEmits<{ pick: [event: Event] }>();
</script>

<template>
  <div class="feature-row">
    <FeatureHead :feature="feature" />
    <select
      class="sense-select" :value="feature.choices?.find(choice => choice.active)?.value ?? ''" :disabled="working || Boolean(feature.reason)"
      aria-label="Вид урона для сопротивления" @change="emit('pick', $event)"
    >
      <option value="" disabled>— вид урона —</option>
      <option v-for="choice in feature.choices ?? []" :key="choice.value" :value="choice.value">{{ choice.label }}</option>
    </select>
    <small v-if="feature.reason" class="muted">{{ feature.reason }}</small>
  </div>
</template>

<style scoped src="./actionPopover.css"></style>
