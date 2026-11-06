<script setup lang="ts">
import FeatureHead from './FeatureHead.vue';
import type { FeatureView } from '../../../actionBar/types';

defineProps<{ feature: FeatureView; working: boolean }>();
const emit = defineEmits<{ convert: [mode: 'to-points' | 'to-slot'] }>();
const level = defineModel<number>('level', { required: true });
</script>

<template>
  <div class="feature-row">
    <FeatureHead :feature="feature" />
    <select v-model.number="level" class="sense-select" :disabled="working" aria-label="Уровень ячейки">
      <option :value="0" disabled>— ячейка —</option>
      <option v-for="choice in feature.choices ?? []" :key="choice.value" :value="Number(choice.value)">{{ choice.label }} · есть {{ choice.count }}{{ choice.hint ? ` · создать за ${choice.hint}` : '' }}</option>
    </select>
    <button type="button" :disabled="working || !feature.available || !level" title="Потратить ячейку — получить столько очков, каков её уровень" @click="emit('convert', 'to-points')">Ячейку → очки</button>
    <button type="button" :disabled="working || !feature.available || !level || level > 5" title="Создать ячейку (до 5-го уровня): 2, 3, 5, 6, 7 очков" @click="emit('convert', 'to-slot')">Очки → ячейку</button>
    <small v-if="feature.reason" class="muted">{{ feature.reason }}</small>
  </div>
</template>

<style scoped src="./actionPopover.css"></style>
