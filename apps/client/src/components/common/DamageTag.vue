<script setup lang="ts">
import { computed } from 'vue';
import GameIcon from '../game/GameIcon.vue';
import { DAMAGE_NAMES, damageIcon } from '../../rules/damageIcons';

const props = withDefaults(defineProps<{ type: string; label?: string | null; iconOnly?: boolean; size?: number }>(), { label: null, iconOnly: false, size: 14 });
const icon = computed(() => damageIcon(props.type));
const text = computed(() => props.label ?? DAMAGE_NAMES[props.type] ?? props.type);
</script>

<template>
  <span class="damage-tag" :class="`damage-${type}`" :title="iconOnly ? text : undefined">
    <span v-if="icon" class="damage-ring" :style="{ width: `${size + 8}px`, height: `${size + 8}px` }"><GameIcon :name="icon" :size="size - 2" /></span>
    <span v-if="!iconOnly">{{ text }}</span>
    <span v-else class="sr-only">{{ text }}</span>
  </span>
</template>

<style scoped>
.damage-tag{display:inline-flex;align-items:center;gap:4px;white-space:nowrap;vertical-align:middle}
.damage-ring{
  --damage-ink:light-dark(color-mix(in srgb,var(--damage-color) 82%,#000),color-mix(in srgb,var(--damage-color) 70%,#fff));
  display:inline-grid;place-items:center;flex:none;border-radius:50%;color:var(--damage-ink);
  background:color-mix(in srgb,var(--damage-color) 22%,transparent);box-shadow:inset 0 0 0 1.5px var(--damage-ink);
}
.damage-ring :deep(svg){flex:none}
.damage-acid{--damage-color:#628c0e}
.damage-bludgeoning{--damage-color:#a0522d}
.damage-cold{--damage-color:#1a85a3}
.damage-fire{--damage-color:#d8432a}
.damage-force{--damage-color:#9846cf}
.damage-lightning{--damage-color:#3673dc}
.damage-necrotic{--damage-color:#584e64}
.damage-piercing{--damage-color:#66778a}
.damage-poison{--damage-color:#258a40}
.damage-psychic{--damage-color:#cc4590}
.damage-radiant{--damage-color:#a27306}
.damage-slashing{--damage-color:#9e2f3d}
.damage-thunder{--damage-color:#5a4ecb}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
</style>
