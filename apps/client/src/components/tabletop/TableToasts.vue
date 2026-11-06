<script setup lang="ts">
import type { TableToast } from '../../tabletop/toasts';
import GameIcon from '../game/GameIcon.vue';

defineProps<{ toasts: TableToast[] }>();

const emit = defineEmits<{
  dismiss: [id: number];
  focus: [toast: TableToast];
}>();
</script>

<template>
  <div class="table-toasts" role="status" aria-live="polite">
    <TransitionGroup name="toast">
      <article
        v-for="toast in toasts"
        :key="toast.id"
        class="table-toast"
        :class="`tone-${toast.tone}`"
      >
        <div class="toast-text">
          <p class="toast-title">
            {{ toast.title }}
            <span v-if="toast.badge" class="toast-badge">{{ toast.badge }}</span>
          </p>
          <p v-if="toast.detail" class="toast-detail">{{ toast.detail }}</p>
        </div>

        <strong v-if="toast.value" class="toast-value">{{ toast.value }}</strong>

        <button
          v-if="toast.focus"
          type="button"
          class="toast-action"
          @click="emit('focus', toast)"
        >
          Показать
        </button>

        <button
          type="button"
          class="toast-close"
          aria-label="Скрыть уведомление"
          @click="emit('dismiss', toast.id)"
        >
          <GameIcon name="close" :size="14" />
        </button>
      </article>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.table-toasts{position:absolute;left:12px;bottom:12px;z-index:2;display:flex;flex-direction:column;gap:8px;width:min(380px,calc(100% - 24px));pointer-events:none}
.table-toast{pointer-events:auto;display:flex;align-items:center;gap:10px;padding:8px 10px;background:#1a120bf0;color:#f1e4c5;border:1px solid #a68148;border-left-width:4px;border-radius:4px;box-shadow:0 6px 18px #0009}
.toast-text{flex:1;min-width:0}
.toast-title{margin:0;font:700 14px/1.3 Georgia,"Times New Roman",serif}
.toast-detail{margin:2px 0 0;font-size:12px;line-height:1.35;color:#d9c7a3;overflow-wrap:anywhere}
.toast-badge{display:inline-block;margin-left:4px;padding:0 6px;border:1px solid currentColor;border-radius:3px;font:600 11px/1.5 "Segoe UI",Arial,sans-serif;vertical-align:middle}
.toast-value{font:700 26px/1 Georgia,"Times New Roman",serif;min-width:2ch;text-align:right;color:#f5c469}
.toast-action,.toast-close{min-height:28px;padding:2px 8px;font-size:12px;flex-shrink:0}
.toast-close{width:28px;padding:0}
.tone-crit{border-color:#f5c469;background:#3a2a10f2;box-shadow:0 0 0 1px #f5c46988,0 0 22px #f5c46955,0 6px 18px #0009}
.tone-crit .toast-value,.tone-fumble .toast-value{font-size:20px;white-space:nowrap;letter-spacing:.03em;animation:natural-pop .5s ease-out}
.tone-crit .toast-value{text-shadow:0 0 12px #f5c469aa}
.tone-fumble{background:#2c1314f2;box-shadow:0 0 0 1px #b5575d88,0 0 18px #b5575d44,0 6px 18px #0009}
@keyframes natural-pop{0%{transform:scale(1.6);opacity:0}60%{transform:scale(.95);opacity:1}100%{transform:scale(1)}}
@media (prefers-reduced-motion:reduce){.tone-crit .toast-value,.tone-fumble .toast-value{animation:none}}
.tone-crit .toast-badge{color:#f5c469}
.tone-fumble{border-color:#b5575d}
.tone-fumble .toast-badge,.tone-fumble .toast-value{color:#e08a8f}
.tone-turn{border-color:#d9c7a3}
.tone-turn .toast-value,.tone-mine .toast-value{font-size:18px;color:#f1e4c5}
.tone-mine{border-color:#7fbf9f;background:#18281ff2}
.tone-mine .toast-title{color:#a9e0c3}
.tone-info{border-color:#8a7c68}
.tone-error{border-color:#c4504f;background:#2c1312f2}
.tone-error .toast-title{color:#f0a49d}
.toast-enter-active,.toast-leave-active{transition:opacity .25s ease,transform .25s ease}
.toast-enter-from,.toast-leave-to{opacity:0;transform:translateY(8px)}
</style>
