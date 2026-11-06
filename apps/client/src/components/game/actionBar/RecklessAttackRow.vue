<script setup lang="ts">
import FeatureHead from './FeatureHead.vue';
import type { FeatureView } from '../../../actionBar/types';

defineProps<{ feature: FeatureView; working: boolean }>();
const emit = defineEmits<{ use: [] }>();
</script>

<template>
  <div class="feature-row">
    <FeatureHead :feature="feature" />
    <button type="button" :disabled="working || !feature.available || feature.active" @click="emit('use')">{{ feature.active ? 'Безрассудно — в этот ход' : 'Атаковать безрассудно' }}</button>
    <small v-if="feature.reason" class="muted">{{ feature.reason }}</small>
  </div>
</template>

<style scoped src="./actionPopover.css"></style>
