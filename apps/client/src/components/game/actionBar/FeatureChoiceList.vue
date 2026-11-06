<script setup lang="ts">
import { computed } from 'vue';
import { choiceHead, choiceInput, type CardFeature } from '../../../actionBar/featureCards';
import GameIcon from '../GameIcon.vue';

const props = defineProps<{ feature: CardFeature; working: boolean }>();
const emit = defineEmits<{ toggle: [value: string, on: boolean] }>();
const head = computed(() => choiceHead(props.feature));
</script>

<template>
  <span>
    <b class="feature-icon"><GameIcon class="inline-icon" :name="head.icon" :size="16" /></b> {{ head.label }}
    <small v-if="head.points" class="muted"> · {{ head.points }}</small>
    <small v-if="head.detail !== null" class="muted"> · {{ head.detail }}</small>
  </span>
  <label v-for="choice in feature.choices ?? []" :key="choice.value" class="checkbox-label">
    <input :type="choiceInput(feature.id)" :name="`choice-${feature.id}`" :checked="Boolean(choice.active)" :disabled="working" @change="emit('toggle', choice.value, !choice.active)" />
    {{ choice.label }}
  </label>
</template>

<style scoped src="./actionPopover.css"></style>
