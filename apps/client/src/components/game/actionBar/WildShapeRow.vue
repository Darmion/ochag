<script setup lang="ts">
import FeatureHead from './FeatureHead.vue';
import type { FeatureCall, FeatureView } from '../../../actionBar/types';

defineProps<{ feature: FeatureView; working: boolean }>();
const emit = defineEmits<{ use: [id: FeatureCall, extra?: Record<string, unknown>] }>();
const beast = defineModel<string>('beast', { required: true });
</script>

<template>
  <div class="feature-row">
    <FeatureHead :feature="feature" />
    <template v-if="feature.active">
      <button type="button" :disabled="working" @click="emit('use', 'end-wild-shape')">Вернуться в свой облик</button>
    </template>
    <template v-else>
      <select v-model="beast" class="sense-select" :disabled="working" aria-label="Какой зверь">
        <option value="">— зверь —</option>
        <option v-for="choice in feature.choices ?? []" :key="choice.value" :value="choice.value">{{ choice.label }}</option>
      </select>
      <button type="button" :disabled="working || !feature.available || !beast" @click="emit('use', 'wild-shape', { beast })">Обернуться</button>
    </template>
    <small v-if="feature.reason" class="muted">{{ feature.reason }}</small>
  </div>
</template>

<style scoped src="./actionPopover.css"></style>
