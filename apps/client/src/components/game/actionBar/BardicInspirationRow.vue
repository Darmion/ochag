<script setup lang="ts">
import FeatureHead from './FeatureHead.vue';
import type { FeatureView } from '../../../actionBar/types';

defineProps<{ feature: FeatureView; working: boolean }>();
const emit = defineEmits<{ aim: [] }>();
</script>

<template>
  <div class="feature-row">
    <FeatureHead :feature="feature" />
    <button type="button" :disabled="working || !feature.available" title="Кого вдохновить — щелчком по фигуре на карте (до 60 футов)" @click="emit('aim')">Вдохновить…</button>
    <small v-if="feature.reason" class="muted">{{ feature.reason }}</small>
  </div>
</template>

<style scoped src="./actionPopover.css"></style>
