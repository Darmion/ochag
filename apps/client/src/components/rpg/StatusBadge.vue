<script setup lang="ts">
import type { GameIconName } from '../../ui/gameIcons';
import GameIcon from '../game/GameIcon.vue';

defineProps<{
  label: string;
  icon?: GameIconName;
  active: boolean;
  readOnly?: boolean;
}>();

const emit = defineEmits<{ toggle: [] }>();
</script>

<template>
  <div class="status-badge" :class="{ 'is-active': active }">
    <button
      type="button"
      class="status-badge-toggle"
      role="switch"
      :aria-checked="active"
      :disabled="readOnly"
      @click="emit('toggle')"
    >
      <GameIcon v-if="icon" class="ui-icon" :name="icon" :size="18" />
      <span v-else class="status-badge-dot" aria-hidden="true" />
      {{ label }}
    </button>
    <span v-if="$slots.default" class="status-badge-actions"><slot /></span>
  </div>
</template>

<style scoped>
.status-badge{display:inline-flex;align-items:center;gap:2px;border:1px solid var(--brass);border-radius:999px;padding:2px;background:var(--surface-inset);opacity:.6}
.status-badge.is-active{opacity:1;border-color:var(--burgundy)}
.status-badge-toggle{display:flex;align-items:center;gap:6px;min-height:auto;padding:4px 10px;border:none;background:transparent;box-shadow:none;font-size:12px;font-weight:700;border-radius:999px;color:var(--ink)}
.status-badge-dot{width:8px;height:8px;border-radius:50%;background:var(--muted-ink);flex-shrink:0}
.status-badge.is-active .status-badge-dot{background:var(--burgundy)}
.status-badge-actions{display:flex;align-items:center;gap:4px;padding-right:4px}
</style>
