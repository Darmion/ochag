<script setup lang="ts">
import type { SummaryLine } from '../../../actionBar/castSummary';
// The cost of the cast about to happen, right above its button.
defineProps<{ lines: SummaryLine[] }>();
</script>

<template>
  <ul v-if="lines.length" class="cast-summary" aria-label="Итог сотворения">
    <li v-for="(line, index) in lines" :key="index" :class="{ warn: line.warn }">
      {{ line.text }}<template v-if="line.names"> <span translate="no">{{ line.names.join(', ') }}</span></template>
    </li>
  </ul>
</template>

<style scoped>
.cast-summary{list-style:none;margin:4px 0 2px;padding:7px 10px;display:grid;gap:3px;border-left:3px solid var(--g-gold,var(--brass));background:var(--surface-inset);font-size:12px;line-height:1.45}
.cast-summary .warn{color:var(--g-warn,#e0a14c);font-weight:600}
</style>
