<script setup lang="ts">
import FeatureHead from './FeatureHead.vue';
import type { FeatureView } from '../../../actionBar/types';

defineProps<{ feature: FeatureView; working: boolean }>();
const emit = defineEmits<{ aim: [] }>();
const handsAmount = defineModel<number | ''>('handsAmount', { required: true });
const handsCure = defineModel<boolean>('handsCure', { required: true });
</script>

<template>
  <div class="feature-row">
    <FeatureHead :feature="feature" />
    <input v-model.number="handsAmount" class="hands-amount" type="number" min="1" :max="feature.resource?.max ?? 100" placeholder="сколько" aria-label="Сколько хитов" :disabled="working" />
    <label class="checkbox-label"><input v-model="handsCure" type="checkbox" :disabled="working" /> снять яд (5)</label>
    <button type="button" :disabled="working || !feature.available" title="Кому — щелчком по фигуре на карте (касание; можно себя)" @click="emit('aim')">Наложить…</button>
    <small v-if="feature.reason" class="muted">{{ feature.reason }}</small>
  </div>
</template>

<style scoped src="./actionPopover.css"></style>
