<script setup lang="ts">
import FeatureHead from './FeatureHead.vue';
import type { FeatureView } from '../../../actionBar/types';

defineProps<{ feature: FeatureView; working: boolean }>();
const flurryTechnique = defineModel<'' | 'prone' | 'push' | 'no-reactions'>('flurryTechnique', { required: true });
</script>

<template>
  <label class="target-select feature-row">
    <FeatureHead :feature="feature" />
    <select v-model="flurryTechnique" :disabled="working" aria-label="Техника открытой ладони">
      <option value="">— без техники —</option>
      <option value="prone">сбить с ног (спасбросок ЛОВ)</option>
      <option value="push">оттолкнуть на 15 фт. (СИЛ)</option>
      <option value="no-reactions">без реакций до конца вашего хода</option>
    </select>
  </label>
</template>

<style scoped src="./actionPopover.css"></style>
