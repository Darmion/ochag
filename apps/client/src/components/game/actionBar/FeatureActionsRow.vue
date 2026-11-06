<script setup lang="ts">
import { computed } from 'vue';
import FeatureHead from './FeatureHead.vue';
import GameIcon from '../GameIcon.vue';
import { rowActions, type RowCall } from '../../../actionBar/featureCards';
import type { FeatureView } from '../../../actionBar/types';

const props = defineProps<{ feature: FeatureView; working: boolean }>();
const emit = defineEmits<{ act: [call: RowCall] }>();
const actions = computed(() => rowActions(props.feature.id));
</script>

<template>
  <div class="feature-row">
    <FeatureHead :feature="feature" />
    <button v-for="action in actions" :key="action.label" type="button" :disabled="working || !feature.available" @click="emit('act', action.call)">
      <GameIcon v-if="action.icon" :name="action.icon" :size="20" /><span v-if="action.icon">{{ action.label }}</span><template v-else>{{ action.label }}</template>
    </button>
    <small v-if="feature.reason" class="muted">{{ feature.reason }}</small>
  </div>
</template>

<style scoped src="./actionPopover.css"></style>
