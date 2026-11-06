<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { LIGHT_PRESETS, lightText, presetFor } from '../../tabletop/lightPresets';
import GameIcon from '../game/GameIcon.vue';

const props = defineProps<{
  campaignId: string;
  characterId: string;
  name: string;
  light: { bright: number; dim: number; lit: boolean; openFlame?: boolean; cone?: boolean } | null;
  canEdit: boolean;
  busy?: boolean;
  compact?: boolean;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();

const emit = defineEmits<{ changed: [message: string] }>();

const working = ref(false);
const error = ref('');
const custom = ref(false);
const bright = ref<number | ''>(props.light?.bright ?? 20);
const dim = ref<number | ''>(props.light?.dim ?? 20);
const flame = ref(props.light?.openFlame ?? true);
const selected = computed(() => (custom.value ? 'custom' : props.light ? presetFor(props.light)?.id ?? 'custom' : ''));

watch(() => props.light, light => {
  bright.value = light?.bright ?? 20;
  dim.value = light?.dim ?? 20;
  flame.value = light?.openFlame ?? true;
});

const path = () => `/campaigns/${props.campaignId}/characters/${props.characterId}`;
const feet = (value: number | '') => (value === '' ? 0 : Math.max(0, Math.min(1000, Math.round(Number(value)))));

async function run(action: () => Promise<string>) {
  working.value = true;
  error.value = '';
  try {
    emit('changed', await action());
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    working.value = false;
  }
}

function setLight(brightFeet: number, dimFeet: number, openFlame = false, cone = false) {
  return run(async () => {
    await props.request(`${path()}/state`, 'PUT', {
      lightBrightFeet: brightFeet || null, lightDimFeet: dimFeet || null, lit: true, lightOpenFlame: openFlame, lightCone: cone,
    });
    return brightFeet + dimFeet > 0 ? `«${props.name}» светит.` : `«${props.name}» больше не светит.`;
  });
}

function onPreset(event: Event) {
  const id = (event.target as HTMLSelectElement).value;
  custom.value = id === 'custom';
  if (id === 'custom') return;
  if (!id) {
    void setLight(0, 0);
    return;
  }
  const preset = LIGHT_PRESETS.find(entry => entry.id === id);
  if (preset) void setLight(preset.bright, preset.dim, preset.openFlame, preset.cone === true);
}

function applyCustom() {
  custom.value = false;
  void setLight(feet(bright.value), feet(dim.value), flame.value);
}

function toggle() {
  const action = props.light?.lit ? 'douse' : 'light';
  return run(async () => {
    const result = await props.request(`${path()}/interact`, 'POST', { action });
    return result.message ?? '';
  });
}
</script>

<template>
  <div class="light-control" :class="{ compact }">
    <span class="light-line">
      <span aria-hidden="true"><GameIcon v-if="light?.lit" name="flame" :size="14" /><template v-else>·</template></span>
      <span v-if="!compact">Свет: </span><strong>{{ lightText(light) }}</strong>
    </span>
    <div v-if="canEdit" class="light-actions">
      <select :value="selected" :disabled="busy || working" aria-label="Источник света" @change="onPreset">
        <option value="">Нет света</option>
        <option v-for="preset in LIGHT_PRESETS" :key="preset.id" :value="preset.id">
          {{ preset.label }} ({{ preset.bright ? `${preset.bright} + ` : '' }}{{ preset.dim }} фут.)
        </option>
        <option value="custom">Свой радиус…</option>
      </select>
      <button v-if="light" type="button" :disabled="busy || working" @click="toggle">{{ light.lit ? 'Погасить' : 'Зажечь' }}</button>
    </div>
    <div v-if="canEdit && custom" class="light-custom">
      <label>Ярко, фут. <input v-model.number="bright" type="number" min="0" max="1000" step="5" /></label>
      <label>Тускло ещё, фут. <input v-model.number="dim" type="number" min="0" max="1000" step="5" /></label>
      <label class="flame"><input v-model="flame" type="checkbox" /> открытый огонь (гаснет под ливнем)</label>
      <button type="button" :disabled="busy || working" @click="applyCustom">Применить</button>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.light-control{display:flex;flex-direction:column;gap:6px;font-size:13px}
.light-line{display:flex;gap:6px;align-items:baseline}
.light-actions{display:flex;gap:6px;flex-wrap:wrap}
.light-actions select{flex:1 1 150px;min-width:0}
.light-actions button,.light-custom button{min-height:30px;padding:2px 10px;font-size:12px}
.light-custom{display:flex;gap:6px;flex-wrap:wrap;align-items:flex-end}
.light-custom label{display:flex;flex-direction:column;gap:2px;margin:0;font-size:12px}
.light-custom input{width:90px}
.light-custom .flame{flex-direction:row;align-items:center;gap:4px}
.light-custom .flame input{width:auto}
.compact .light-line{font-size:12px}
.error{color:#c0392b;margin:0;font-size:12px}
</style>
