<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  label: string;
  current: number;
  max: number;
  readOnly?: boolean;
}>();

const emit = defineEmits<{ increment: []; decrement: [] }>();

const pct = computed(() => (props.max > 0 ? Math.max(0, Math.min(100, (props.current / props.max) * 100)) : 0));
const stateLabel = computed(() => {
  if (props.current <= 0) return 'Пусто';
  if (props.current >= props.max) return 'Полный запас';
  return `${Math.round(pct.value)}% осталось`;
});
</script>

<template>
  <article class="resource-bar">
    <div class="resource-bar-top">
      <span class="resource-bar-title">
        <strong class="resource-bar-label">{{ label }}</strong>
        <small>{{ stateLabel }}</small>
      </span>
      <span class="resource-bar-count"><b>{{ current }}</b><span>/ {{ max }}</span></span>
      <span v-if="$slots.corner" class="resource-bar-corner"><slot name="corner" /></span>
    </div>
    <div class="resource-bar-track">
      <div class="resource-bar-fill" :style="{ width: pct + '%' }" />
    </div>
    <div v-if="!readOnly" class="resource-bar-actions">
      <div class="resource-stepper" aria-label="Изменить значение ресурса">
        <button type="button" :aria-label="`Уменьшить ${label}`" :disabled="current <= 0" @click="emit('decrement')">−</button>
        <button type="button" :aria-label="`Увеличить ${label}`" :disabled="current >= max" @click="emit('increment')">+</button>
      </div>
      <slot name="actions" />
    </div>
  </article>
</template>

<style scoped>
.resource-bar{border:1px solid var(--brass-light);border-radius:7px;background:var(--surface-inset);padding:11px 12px;min-width:0}
.resource-bar-top{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:8px;margin-bottom:8px}
.resource-bar-title{display:flex;flex-direction:column;min-width:0}
.resource-bar-label{font-weight:700;font-size:14px;overflow-wrap:anywhere}
.resource-bar-title small{font-size:11px;color:var(--muted-ink)}
.resource-bar-count{display:flex;align-items:baseline;gap:4px;white-space:nowrap;font-variant-numeric:tabular-nums}
.resource-bar-count b{font-size:22px;line-height:1}
.resource-bar-count span{font-size:12px;color:var(--muted-ink)}
.resource-bar-track{height:6px;border-radius:3px;background:#00000026;overflow:hidden}
.resource-bar-fill{height:100%;width:0;background:linear-gradient(var(--burgundy-light),var(--burgundy));transition:width .2s ease}
.resource-bar-actions{display:flex;align-items:center;gap:8px;margin-top:9px;flex-wrap:wrap}
.resource-stepper{display:inline-grid;grid-template-columns:repeat(2,34px);gap:4px}
.resource-bar-actions button{min-height:30px;padding:2px 9px;font-size:13px}
.resource-stepper button{font-size:18px;padding:0}
</style>
