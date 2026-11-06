<script setup lang="ts">
import type { FeatureButtonCard } from '../../../actionBar/featureCards';
import GameIcon from '../GameIcon.vue';

defineProps<{ card: FeatureButtonCard; working: boolean; title: string }>();
const emit = defineEmits<{ activate: [] }>();
</script>

<template>
  <button type="button" class="feature" :class="{ active: card.active }" :disabled="working || card.blocked" :title="title" @click="emit('activate')">
    <b class="feature-icon"><GameIcon class="inline-icon" :name="card.icon" :size="16" /></b> {{ card.label }}
    <small class="muted spell-mech">{{ card.note }}</small>
  </button>
</template>

<style scoped src="./actionPopover.css"></style>
<style scoped>
.action-popover .feature.active{box-shadow:inset 0 0 0 1px #e0522f}
.action-popover .command-body .feature.active{border-color:var(--g-gold,var(--brass));box-shadow:inset 3px 0 var(--g-gold,var(--brass));background:color-mix(in srgb,var(--brass) 22%,transparent)}
</style>
