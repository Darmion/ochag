<script setup lang="ts">
import { passiveIcon } from '../../../actionBar/featureCards';
import { passiveNote } from '../../../actionBar/featureNotes';
import type { FeatureView } from '../../../actionBar/types';
import GameIcon from '../GameIcon.vue';

defineProps<{ feature: FeatureView }>();
</script>

<template>
  <p class="feature-note" :title="feature.text">
    <b class="feature-icon"><GameIcon class="inline-icon" :name="passiveIcon(feature)" :size="16" /></b> <b>{{ feature.name }}</b>{{ feature.detail ? ` — ${feature.detail}` : '' }}{{ feature.reason ? ` · ${feature.reason}` : '' }}
    <small class="muted">{{ passiveNote(feature.id) }}</small>
  </p>
</template>

<style scoped src="./actionPopover.css"></style>
<style scoped>
.feature-note{margin:2px 0;font-size:13px;line-height:1.35}
.feature-note small{display:block}
.action-popover .command-body .feature-note{margin:0;padding:12px;border-left:2px solid var(--brass);background:var(--surface-inset);color:var(--ink);font:13px/1.5 var(--g-body-font,Georgia)}
</style>
