<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { lockNearestScroll } from '../../ui/scrollLock';

// Popover teleported to body with position:fixed, as in VisibilityControl.vue, so scrolling parents do not clip it.
type Option = { id: string; label: string };

const props = defineProps<{
  label: string;
  options: Option[];
  modelValue: string[];
  disabled?: boolean;
  emptyText?: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [string[]] }>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLElement | null>(null);
const popover = ref<HTMLElement | null>(null);
const popoverStyle = ref<{ left: string; top: string }>({ left: '0px', top: '0px' });

async function positionPopover() {
  await nextTick();
  if (!trigger.value || !popover.value) return;

  const margin = 6;
  const triggerRect = trigger.value.getBoundingClientRect();
  const popoverRect = popover.value.getBoundingClientRect();

  let left = triggerRect.left;
  left = Math.min(left, window.innerWidth - margin - popoverRect.width);
  left = Math.max(margin, left);

  let top = triggerRect.bottom + 4;
  if (top + popoverRect.height > window.innerHeight - margin) {
    top = triggerRect.top - popoverRect.height - 4;
  }
  top = Math.max(margin, top);

  popoverStyle.value = { left: `${left}px`, top: `${top}px` };
}

function onDocPointerDown(event: PointerEvent) {
  const target = event.target as Node;
  if (root.value?.contains(target)) return;
  if (popover.value?.contains(target)) return;
  open.value = false;
}
function onReposition() { void positionPopover(); }
function onKey(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !open.value) return;
  open.value = false;
  event.preventDefault();
}
function listen(on: boolean) {
  const method = on ? 'addEventListener' : 'removeEventListener';
  document[method]('pointerdown', onDocPointerDown as EventListener);
  document[method]('keydown', onKey as EventListener);
  window[method]('scroll', onReposition, true);
  window[method]('resize', onReposition);
}
let unlockScroll: () => void = () => {};
watch(open, isOpen => {
  listen(isOpen);
  if (isOpen) {
    void positionPopover();
    unlockScroll = lockNearestScroll(root.value);
  } else {
    unlockScroll();
  }
});
onBeforeUnmount(() => { listen(false); unlockScroll(); });

function toggle(id: string) {
  const next = props.modelValue.includes(id) ? props.modelValue.filter(entry => entry !== id) : [...props.modelValue, id];
  emit('update:modelValue', next);
}

const summary = computed(() => {
  if (!props.modelValue.length) return props.emptyText ?? 'нет';
  return props.modelValue.map(id => props.options.find(option => option.id === id)?.label ?? id).join(', ');
});
</script>

<template>
  <span ref="root" class="chip-multi-select">
    <button
      ref="trigger" type="button" class="chip-trigger" :class="{ filled: modelValue.length }"
      :disabled="disabled" :title="`${label}: ${summary}`" @click="open = !open"
    >
      <span class="chip-label">{{ label }}</span>
      <span class="chip-summary">{{ summary }}</span>
      <span class="chip-caret" aria-hidden="true">▾</span>
    </button>

    <teleport to="body">
      <div v-if="open" ref="popover" class="chip-popover" role="dialog" :aria-label="label" :style="popoverStyle">
        <label v-for="option in options" :key="option.id" class="checkbox-label">
          <input type="checkbox" :checked="modelValue.includes(option.id)" :disabled="disabled" @change="toggle(option.id)" />
          {{ option.label }}
        </label>
      </div>
    </teleport>
  </span>
</template>

<style scoped>
.chip-multi-select{position:relative;display:inline-block}
.chip-trigger{display:inline-flex;align-items:center;gap:6px;min-height:34px;padding:4px 10px;font-size:13px;max-width:100%;text-align:left}
.chip-trigger.filled{border-color:var(--gold-light)}
.chip-label{font-weight:600;white-space:nowrap}
.chip-summary{color:var(--ink);opacity:.8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px}
.chip-caret{opacity:.7;font-size:11px}
.chip-popover{position:fixed;z-index:5000;display:grid;grid-template-columns:repeat(2,minmax(120px,1fr));gap:2px 12px;padding:10px;max-width:min(360px,92vw);max-height:60vh;overflow-y:auto;background:var(--parchment-background);color:var(--ink);border:1px solid var(--brass);border-radius:4px;box-shadow:0 8px 20px #0006}
.chip-popover .checkbox-label{margin:0;font-size:12px;font-weight:400}
</style>
