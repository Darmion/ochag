<script setup lang="ts">
import { GAME_ICONS, type GameIconName } from '../../ui/gameIcons';
import GameIcon from '../game/GameIcon.vue';

defineProps<{ name: GameIconName; image?: string | null; size?: number }>();
</script>

<template>
  <img v-if="image" class="condition-image" :src="image" :width="size ?? 22" :height="size ?? 22" alt="" draggable="false" />
  <GameIcon v-else :name="name in GAME_ICONS ? name : 'alert'" :size="size ?? 22" />
</template>

<style scoped>
.condition-image{display:inline-block;flex:none;object-fit:cover;border-radius:3px;vertical-align:middle}
</style>
