<script setup lang="ts">
import { cropStyle } from '../../art/imageCrop';

const props = defineProps<{
  name: string;
  imageUrl: string | null;
  imageCrop?: unknown;
  crest?: string | null;
}>();
</script>

<template>
  <img v-if="props.imageUrl" class="hud-portrait-image" :src="props.imageUrl" alt="" :style="cropStyle(props.imageCrop)" />
  <span v-else-if="props.crest" class="hud-portrait-crest">
    <img :src="props.crest" alt="" />
    <span class="hud-portrait-letter" translate="no">{{ props.name.slice(0, 1) }}</span>
  </span>
  <span v-else class="monogram" translate="no">{{ props.name.slice(0, 1) || '?' }}</span>
</template>

<style scoped>
.hud-portrait-image{width:100%;height:100%;object-fit:cover;object-position:top}
.hud-portrait-crest{position:relative;display:grid;place-items:center;width:100%;height:100%}
.hud-portrait-crest img{width:62%;height:62%;object-fit:contain;filter:drop-shadow(0 2px 4px #000c) drop-shadow(0 0 8px color-mix(in srgb,var(--g-gold-hi,#f0c86a) 30%,transparent))}
.hud-portrait-letter{position:absolute;right:12%;bottom:8%;font:400 var(--portrait-letter,14px) var(--g-title-font);line-height:1;color:var(--g-gold-hi);text-shadow:0 1px 2px #000,0 0 4px #000}
</style>
