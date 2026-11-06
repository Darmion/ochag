<script setup lang="ts">
import { GAME_ICONS, type GameIconName } from '../../ui/gameIcons';

const props = defineProps<{ name: GameIconName; size?: number; title?: string }>();
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
    <path v-for="(d, index) in GAME_ICONS[props.name]" :key="index" :d="d.replace(/^\*/, '')" :fill="d.startsWith('*') ? 'currentColor' : undefined" />
  </svg>
</template>
