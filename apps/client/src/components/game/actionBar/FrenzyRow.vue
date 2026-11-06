<script setup lang="ts">
import FeatureHead from './FeatureHead.vue';
import type { FeatureView } from '../../../actionBar/types';

defineProps<{ feature: FeatureView; working: boolean; targetId: string }>();
const emit = defineEmits<{ aim: [] }>();
const rageFrenzy = defineModel<boolean>('rageFrenzy', { required: true });
</script>

<template>
  <div class="feature-row">
    <FeatureHead :feature="feature" />
    <button v-if="feature.active" type="button" :disabled="working || !feature.available" title="Цель — щелчком по фигуре на карте" @click="emit('aim')">
      Атака бешенства…
    </button>
    <label v-else class="checkbox-label" title="После ярости — уровень истощения">
      <input v-model="rageFrenzy" type="checkbox" :disabled="working" /> ярость — в бешенство
    </label>
    <small v-if="feature.reason && feature.active" class="muted">{{ feature.reason }}</small>
    <small v-else-if="feature.active && !targetId" class="muted">выберите цель атаки</small>
  </div>
</template>

<style scoped src="./actionPopover.css"></style>
