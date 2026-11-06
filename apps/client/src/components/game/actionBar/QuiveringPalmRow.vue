<script setup lang="ts">
import FeatureHead from './FeatureHead.vue';
import type { FeatureView } from '../../../actionBar/types';

defineProps<{ feature: FeatureView; working: boolean }>();
const emit = defineEmits<{ aim: [] }>();
</script>

<template>
  <div class="feature-row">
    <FeatureHead :feature="feature" />
    <template v-if="feature.active">
      <button type="button" :disabled="working || !feature.available" :title="(feature.choices ?? []).length > 1 ? 'В ком оборвать — щелчком по отмеченной фигуре на карте' : ''" @click="emit('aim')">Оборвать дрожь{{ (feature.choices ?? []).length > 1 ? '…' : '' }}</button>
    </template>
    <small v-if="feature.reason" class="muted">{{ feature.reason }}</small>
  </div>
</template>

<style scoped src="./actionPopover.css"></style>
