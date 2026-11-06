<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';

import { confirmState, settleConfirm } from '../../ui/confirmDialog';

const confirmButton = ref<HTMLButtonElement | null>(null);
const cancelButton = ref<HTMLButtonElement | null>(null);

watch(() => confirmState.current, async request => {
  if (!request) return;
  await nextTick();
  (request.danger ? cancelButton.value : confirmButton.value)?.focus();
}, { immediate: true });

function onKey(event: KeyboardEvent) {
  if (!confirmState.current) return;
  if (event.key === 'Tab') return;
  event.stopPropagation();
  if (event.key === 'Escape') {
    event.preventDefault();
    settleConfirm(false);
  } else if (event.key === 'Enter' && !confirmState.current.danger) {
    event.preventDefault();
    settleConfirm(true);
  }
}
document.addEventListener('keydown', onKey, true);
onBeforeUnmount(() => document.removeEventListener('keydown', onKey, true));
</script>

<template>
  <div v-if="confirmState.current" class="modal-overlay confirm-overlay" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" @click.self="settleConfirm(false)">
    <section class="modal-card confirm-card g-frame">
      <h3 id="confirm-title">{{ confirmState.current.title }}</h3>
      <p class="confirm-message">{{ confirmState.current.message }}</p>
      <div class="confirm-buttons">
        <button ref="cancelButton" type="button" @click="settleConfirm(false)">{{ confirmState.current.cancelLabel }}</button>
        <button ref="confirmButton" type="button" :class="confirmState.current.danger ? 'danger' : 'primary'" @click="settleConfirm(true)">
          {{ confirmState.current.confirmLabel }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.confirm-overlay{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;padding:20px;background:#0b0704cc}
.confirm-card{width:min(460px,100%);padding:22px 24px;background:var(--parchment-background);color:var(--ink);border:1px solid var(--brass);border-radius:6px;box-shadow:0 16px 40px #000a}
.confirm-card h3{margin:0 0 10px}
.confirm-message{margin:0 0 18px;white-space:pre-line;line-height:1.5}
.confirm-buttons{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap}
.confirm-buttons button{min-width:110px}
.confirm-buttons .danger{color:#ffe6df;background:linear-gradient(180deg,#ffffff1a,#0000 50%),linear-gradient(180deg,#8e2a2f,#561519);border-color:#c0574f}
.confirm-buttons .danger:hover,.confirm-buttons .danger:focus-visible{background:linear-gradient(180deg,#ffffff26,#0000 50%),linear-gradient(180deg,#a3343a,#66191e)}
</style>
