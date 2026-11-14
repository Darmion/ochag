<script setup lang="ts">
import { computed } from 'vue';
import { GAME_ICONS, SECONDARY_OPACITY, iconPath, type GameIconName } from '../../ui/gameIcons';

const props = defineProps<{ name: GameIconName; size?: number; title?: string }>();
const paths = computed(() => (GAME_ICONS[props.name] ?? []).map(iconPath));
</script>


<template>
  <svg
    class="game-icon"
    :width="props.size ?? 22"
    :height="props.size ?? 22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    :aria-hidden="props.title ? undefined : 'true'"
    :role="props.title ? 'img' : undefined"
  >
    <title v-if="props.title">{{ props.title }}</title>
    <path
      v-for="(path, index) in paths" :key="index" :d="path.d" :fill="path.filled ? 'currentColor' : undefined"
      :opacity="path.secondary ? SECONDARY_OPACITY : undefined"
    />
  </svg>
</template>
