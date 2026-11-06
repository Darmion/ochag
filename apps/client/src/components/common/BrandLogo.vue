<script setup lang="ts">
import { ref, watch } from 'vue';

import { brandImages, branding } from '../../ui/branding';

const props = withDefaults(defineProps<{ variant?: 'logo' | 'emblem' | 'monochrome' }>(), { variant: 'logo' });
const failed = ref(false);
watch(() => props.variant, () => { failed.value = false; });
</script>

<template>
  <span class="brand-logo" :class="`brand-logo-${props.variant}`">
    <img v-if="!failed" :src="brandImages[props.variant]" :alt="branding.appName" draggable="false" @error="failed = true" />
    <span v-else class="brand-logo-fallback">{{ branding.appName }}</span>
  </span>
</template>

<style scoped>
.brand-logo{display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;flex-shrink:0;max-width:100%}
.brand-logo img{display:block;width:100%;height:100%;object-fit:contain}
.brand-logo-fallback{font:700 24px var(--heading-font,serif);color:var(--g-gold-hi,var(--ink));white-space:nowrap}
</style>
