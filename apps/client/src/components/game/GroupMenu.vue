<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

import { cssZoom } from '../../settings/uiScale';

const props = defineProps<{ at: { x: number; y: number } }>();
const emit = defineEmits<{ close: [] }>();

const root = ref<HTMLElement | null>(null);
const shift = ref({ x: 0, y: 0 });
const style = computed(() => {
  const zoom = cssZoom.value;
  return { left: `${props.at.x / zoom + 6}px`, top: `${props.at.y / zoom + 6}px`, translate: `${shift.value.x}px ${shift.value.y}px` };
});
async function fit() {
  await nextTick();
  const box = root.value?.getBoundingClientRect();
  if (!box) return;
  const zoom = cssZoom.value;
  shift.value = {
    x: Math.min(0, window.innerWidth - 8 - box.right) / zoom,
    y: Math.min(0, window.innerHeight - 8 - box.bottom) / zoom,
  };
}
function onDocument(event: PointerEvent) {
  if (root.value && !root.value.contains(event.target as Node)) emit('close');
}
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close');
}
onMounted(() => {
  void fit();
  document.addEventListener('pointerdown', onDocument, true);
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocument, true);
  window.removeEventListener('keydown', onKey);
});
</script>

<template>
  <div ref="root" class="group-menu" :style="style">
    <slot />
  </div>
</template>

<style scoped>
.group-menu{position:fixed;z-index:2600}
</style>
