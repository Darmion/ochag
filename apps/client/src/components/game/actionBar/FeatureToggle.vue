<script setup lang="ts">
import type { FeatureToggleCard } from '../../../actionBar/featureCards';
import GameIcon from '../GameIcon.vue';

defineProps<{ card: FeatureToggleCard; working: boolean; title: string }>();
const emit = defineEmits<{ toggle: [] }>();
</script>

<template>
  <label class="checkbox-label feature-row" :title="title">
    <input type="checkbox" :checked="card.active" :disabled="working" @change="emit('toggle')" />
    <b class="feature-icon"><GameIcon class="inline-icon" :name="card.icon" :size="16" /></b> {{ card.label }} — наготове <small v-if="card.note !== null" class="muted">{{ card.note }}</small>
  </label>
</template>

<style scoped src="./actionPopover.css"></style>
