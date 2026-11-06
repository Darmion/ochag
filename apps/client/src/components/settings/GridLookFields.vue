<script setup lang="ts">
import { computed } from 'vue';

import { GRID_STYLES, GRID_WIDTHS, type GridLook } from '../../settings/gridSettings';
import { t } from '../../i18n/i18n';

const props = defineProps<{ modelValue: GridLook; disabled?: boolean; themeColor: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: GridLook] }>();

function set(patch: Partial<GridLook>) {
  emit('update:modelValue', { ...props.modelValue, ...patch });
}

const colorMode = computed(() => (props.modelValue.color ? 'custom' : 'theme'));
function setColorMode(mode: string) {
  set({ color: mode === 'custom' ? props.modelValue.color ?? props.themeColor : null });
}
</script>

<template>
  <div class="grid-fields">
    <label class="checkbox-label wide">
      <input type="checkbox" :checked="modelValue.visible" :disabled="disabled" @change="set({ visible: ($event.target as HTMLInputElement).checked })" />
      {{ t('Показывать сетку') }}
    </label>
    <label>
      {{ t('Вид') }}
      <select :value="modelValue.style" :disabled="disabled || !modelValue.visible" @change="set({ style: ($event.target as HTMLSelectElement).value as GridLook['style'] })">
        <option v-for="entry in GRID_STYLES" :key="entry.id" :value="entry.id">{{ t(entry.label) }}</option>
      </select>
    </label>
    <label>
      {{ t('Толщина') }}
      <select :value="modelValue.width" :disabled="disabled || !modelValue.visible" @change="set({ width: Number(($event.target as HTMLSelectElement).value) })">
        <option v-for="width in GRID_WIDTHS" :key="width" :value="width">{{ width === 1 ? t('{width} px — по умолчанию', { width }) : `${width} px` }}</option>
      </select>
    </label>
    <label>
      {{ t('Цвет') }}
      <span class="color-row">
        <select :value="colorMode" :disabled="disabled || !modelValue.visible" @change="setColorMode(($event.target as HTMLSelectElement).value)">
          <option value="theme">{{ t('по оформлению') }}</option>
          <option value="custom">{{ t('свой') }}</option>
        </select>
        <input
          v-if="modelValue.color" type="color" :value="modelValue.color" :disabled="disabled || !modelValue.visible" :aria-label="t('Цвет сетки')"
          @input="set({ color: ($event.target as HTMLInputElement).value })"
        />
        <span v-else class="swatch" :style="{ background: themeColor }" aria-hidden="true" />
      </span>
    </label>
    <label>
      {{ t('Прозрачность: {value} %', { value: Math.round((1 - modelValue.opacity) * 100) }) }}
      <input
        type="range" min="0" max="95" step="5" :value="Math.round((1 - modelValue.opacity) * 100)" :disabled="disabled || !modelValue.visible"
        @input="set({ opacity: 1 - Number(($event.target as HTMLInputElement).value) / 100 })"
      />
    </label>
  </div>
</template>

<style scoped>
.grid-fields{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px}
.grid-fields label{display:flex;flex-direction:column;gap:4px;margin:0;font-size:13px;font-weight:600}
.grid-fields .wide{grid-column:1 / -1;flex-direction:row;align-items:center}
.grid-fields select,.grid-fields input[type="range"]{width:100%}
.color-row{display:flex;align-items:center;gap:8px}
.color-row select{flex:1}
.color-row input[type="color"]{width:42px;min-height:32px;padding:2px;cursor:pointer}
.swatch{width:42px;height:28px;border:1px solid var(--brass-light);border-radius:3px}
@media(max-width:480px){.grid-fields{grid-template-columns:1fr}}
</style>
