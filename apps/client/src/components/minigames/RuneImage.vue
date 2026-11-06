<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue';
const props = defineProps<{ assetId?: string | null; campaignId: string; request: (path: string) => Promise<any> }>();
const url = ref(''); let generation = 0;
function clear() { if (url.value) URL.revokeObjectURL(url.value); url.value = ''; }
watch(() => [props.assetId, props.campaignId], async () => {
  const ticket = ++generation; clear();
  if (!props.assetId) return;
  try { const blob = await props.request(`/campaigns/${props.campaignId}/assets/${props.assetId}`); if (ticket === generation) url.value = URL.createObjectURL(blob); } catch {  }
}, { immediate: true });
onBeforeUnmount(() => { generation++; clear(); });
</script>
<template><img v-if="url" :src="url" alt="" class="rune-image" /><slot v-else /></template>
<style scoped>.rune-image{width:56px;height:56px;object-fit:contain;border-radius:8px;max-width:80%}</style>
