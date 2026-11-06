<script setup lang="ts">
import { ref } from 'vue';

import ItemArt from './ItemArt.vue';
import GameIcon from '../game/GameIcon.vue';
import type { GameIconName } from '../../ui/gameIcons';

const props = withDefaults(defineProps<{
  icon?: GameIconName;
  art?: string | null;
  title: string;
  tags?: string[];
  compact?: boolean;
  summary?: string;
}>(), { icon: 'sparkle', art: null, tags: () => [], compact: false, summary: '' });

const expanded = ref(false);
</script>

<template>
  <article class="item-card" :class="{ 'is-compact': compact }">
    <button type="button" class="item-card-head" @click="expanded = !expanded">
      <ItemArt v-if="art" :src="art" :size="compact ? 28 : 34" :fallback-icon="icon" />
      <span v-else class="item-card-icon" aria-hidden="true"><GameIcon class="inline-icon" :name="icon" :size="16" /></span>
      <span class="item-card-text">
        <span class="item-card-title">{{ title }}</span>
        <span v-if="summary" class="item-card-summary">{{ summary }}</span>
      </span>
      <span v-if="tags.length" class="item-card-tags">{{ tags.join(' · ') }}</span>
      <span v-if="$slots.default" class="item-card-caret" aria-hidden="true">{{ expanded ? '▾' : '▸' }}</span>
    </button>
    <div v-if="expanded && $slots.default" class="item-card-body"><slot /></div>
    <div v-if="$slots.footer" class="item-card-footer"><slot name="footer" /></div>
  </article>
</template>

<style scoped>
.item-card{border:1px solid var(--brass);border-radius:6px;background:var(--surface-inset);overflow:hidden}
.item-card-head{width:100%;display:flex;align-items:center;gap:8px;padding:10px 12px;background:transparent;border:none;box-shadow:none;text-align:left;color:var(--ink);min-height:auto;border-radius:0}
.item-card-head:hover{filter:none;background:#00000010}
.item-card-icon{font-size:16px;flex-shrink:0}
.item-card-text{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}
.item-card-title{font-weight:700;overflow-wrap:break-word}
.item-card-summary{font-size:12px;color:var(--muted-ink);line-height:1.35}
.item-card-tags{font-size:11px;color:var(--muted-ink);white-space:nowrap}
.item-card-caret{flex-shrink:0;opacity:.7}
.item-card-body{padding:0 12px 12px 38px;line-height:1.5;font-size:13px}
.item-card-footer{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 12px;border-top:1px solid var(--brass-light)}
.item-card.is-compact .item-card-head{padding:6px 10px}
.item-card.is-compact .item-card-footer{padding:6px 10px}
</style>
