<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';

const props = withDefaults(defineProps<{ label?: string; title?: string; disabled?: boolean; align?: 'left' | 'right'; up?: boolean; buttonClass?: string }>(), {
  label: '', title: '', disabled: false, align: 'left', up: false, buttonClass: '',
});
const open = ref(false);
const root = ref<HTMLElement | null>(null);

function close() {
  open.value = false;
  (root.value?.querySelector('button') as HTMLElement | null)?.focus();
}
function onOutside(event: PointerEvent) {
  if (root.value && !root.value.contains(event.target as Node)) open.value = false;
}
watch(open, async value => {
  if (value) {
    await nextTick();
    document.addEventListener('pointerdown', onOutside, true);
    (root.value?.querySelector('.inv-pop-panel input, .inv-pop-panel select, .inv-pop-panel button') as HTMLElement | null)?.focus();
  } else {
    document.removeEventListener('pointerdown', onOutside, true);
  }
});
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside, true));
defineExpose({ close });
</script>

<template>
  <span ref="root" class="inv-pop">
    <button
      type="button" :class="buttonClass" :disabled="disabled" :title="title || undefined" :aria-expanded="open"
      @click="open = !open"
    ><slot name="button">{{ label }}</slot></button>
    <div
      v-if="open" class="inv-pop-panel g-frame" :class="[`align-${props.align}`, { up: props.up }]" role="dialog" :aria-label="title || label"
      @keydown.esc.prevent.stop="close"
    >
      <div class="inv-pop-body"><slot :close="close" /></div>
    </div>
  </span>
</template>

<style scoped>
.inv-pop{position:relative;display:inline-flex}
.inv-pop-panel{position:absolute;top:calc(100% + 6px);z-index:40;box-sizing:border-box;width:min(320px,calc(100vw - 24px));min-width:0;padding:12px}
.inv-pop-body{display:flex;flex-direction:column;gap:8px;min-width:0;max-height:calc(100dvh - 56px);overflow-y:auto;overscroll-behavior:contain}
.inv-pop-panel.align-left{left:0}
.inv-pop-panel.align-right{right:0}
.inv-pop-panel.up{top:auto;bottom:calc(100% + 6px)}
</style>
