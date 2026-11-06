<script setup lang="ts">
import { computed } from 'vue';
import { featureHead, type CardFeature } from '../../../actionBar/featureCards';
import GameIcon from '../GameIcon.vue';

const props = defineProps<{ feature: CardFeature }>();
const head = computed(() => featureHead(props.feature));
</script>

<template>
  <span v-if="head.note === null"><b class="feature-icon"><GameIcon class="inline-icon" :name="head.icon" :size="16" /></b> {{ head.label }}</span>
  <span v-else><b class="feature-icon"><GameIcon class="inline-icon" :name="head.icon" :size="16" /></b> {{ head.label }} <small class="muted">{{ head.note }}</small></span>
</template>

<style scoped src="./actionPopover.css"></style>
