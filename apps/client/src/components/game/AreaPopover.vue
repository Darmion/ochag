<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { cssZoom } from '../../settings/uiScale';

export type AreaPopoverTemplate = {
  id: string; label: string; affected: string[];
  shape: 'circle' | 'cone' | 'square' | 'line'; sizeFeet: number; widthFeet: number | null; direction: number; color: string; customLabel: string;
};
export type AreaEditPayload = { shape?: string; sizeFeet?: number; widthFeet?: number; direction?: number; color?: string; label?: string | null };
export type AreaSavePayload = { ability: string; dc: number; damage: string; damageType: string; halfOnSave: boolean };

const props = defineProps<{ at: { x: number; y: number }; template: AreaPopoverTemplate; canManage: boolean; canRemove: boolean; busy: boolean }>();
const emit = defineEmits<{ saves: [payload: AreaSavePayload]; edit: [payload: AreaEditPayload]; move: []; remove: []; close: [] }>();

const SHAPES = [['circle', 'Круг'], ['cone', 'Конус'], ['square', 'Куб'], ['line', 'Линия']] as const;
const SIZES = [5, 10, 15, 20, 30, 40, 60, 90, 120];
const tab = ref<'saves' | 'edit'>('saves');
const labelDraft = ref('');
watch(() => props.template.id, () => { labelDraft.value = props.template.customLabel; }, { immediate: true });
function rotate(by: number) {
  emit('edit', { direction: (((props.template.direction + by) % 360) + 360) % 360 });
}
function resize(by: number) {
  const index = SIZES.indexOf(props.template.sizeFeet);
  const next = index >= 0 ? SIZES[Math.max(0, Math.min(SIZES.length - 1, index + by))]! : Math.max(5, props.template.sizeFeet + by * 5);
  if (next !== props.template.sizeFeet) emit('edit', { sizeFeet: next });
}
function saveLabel() {
  const value = labelDraft.value.trim();
  if (value !== props.template.customLabel) emit('edit', { label: value || null });
}

const ABILITIES = [
  ['dexterity', 'Ловкость'], ['constitution', 'Телосложение'], ['wisdom', 'Мудрость'],
  ['strength', 'Сила'], ['intelligence', 'Интеллект'], ['charisma', 'Харизма'],
] as const;
const DAMAGE_TYPES = [
  ['', 'без типа'], ['fire', 'огонь'], ['cold', 'холод'], ['lightning', 'молния'], ['thunder', 'звук'], ['acid', 'кислота'],
  ['poison', 'яд'], ['necrotic', 'некротическая'], ['radiant', 'излучение'], ['force', 'силовое'], ['psychic', 'психическая'],
  ['bludgeoning', 'дробящий'], ['piercing', 'колющий'], ['slashing', 'рубящий'],
] as const;

const ability = ref('dexterity');
const dc = ref(15);
const damage = ref('');
const damageType = ref('');
const halfOnSave = ref(true);
const root = ref<HTMLElement | null>(null);

const zoom = cssZoom;
const position = computed(() => ({
  left: `${Math.min(props.at.x / zoom.value + 8, window.innerWidth / zoom.value - 380)}px`,
  top: `${Math.min(props.at.y / zoom.value + 8, window.innerHeight / zoom.value - 380)}px`,
}));

function onDocument(event: PointerEvent) {
  if (root.value && !root.value.contains(event.target as Node)) emit('close');
}
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close');
}
onMounted(() => {
  document.addEventListener('pointerdown', onDocument, true);
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocument, true);
  window.removeEventListener('keydown', onKey);
});

function submit() {
  emit('saves', { ability: ability.value, dc: dc.value, damage: damage.value.trim(), damageType: damageType.value, halfOnSave: halfOnSave.value });
}
</script>

<template>
  <div ref="root" class="area-popover g-frame" :style="position" role="dialog" :aria-label="`Область: ${template.label}`" @contextmenu.prevent>
    <div class="head">
      <b>{{ template.label }}</b>
      <button type="button" class="close" aria-label="Закрыть" @click="emit('close')">×</button>
    </div>
    <div v-if="canRemove" class="tabs" role="tablist">
      <button type="button" role="tab" :aria-selected="tab === 'saves'" @click="tab = 'saves'">Спасброски</button>
      <button type="button" role="tab" :aria-selected="tab === 'edit'" @click="tab = 'edit'">Изменить</button>
    </div>
    <template v-if="tab === 'edit' && canRemove">
      <div class="row">
        <select :value="template.shape" aria-label="Форма" :disabled="busy" @change="emit('edit', { shape: ($event.target as HTMLSelectElement).value })">
          <option v-for="[key, label] in SHAPES" :key="key" :value="key">{{ label }}</option>
        </select>
        <span class="stepper" aria-label="Размер">
          <button type="button" :disabled="busy" aria-label="Меньше" @click="resize(-1)">−</button>
          <select :value="template.sizeFeet" aria-label="Размер, футов" :disabled="busy" @change="emit('edit', { sizeFeet: Number(($event.target as HTMLSelectElement).value) })">
            <option v-for="size in (SIZES.includes(template.sizeFeet) ? SIZES : [...SIZES, template.sizeFeet].sort((a, b) => a - b))" :key="size" :value="size">{{ size }} фут.</option>
          </select>
          <button type="button" :disabled="busy" aria-label="Больше" @click="resize(1)">+</button>
        </span>
      </div>
      <div v-if="template.shape !== 'circle'" class="row">
        <span class="row-label">Поворот {{ Math.round(template.direction) }}°</span>
        <button type="button" :disabled="busy" title="На 45° против часовой" @click="rotate(-45)">⟲ 45°</button>
        <button type="button" :disabled="busy" title="На 15° против часовой" @click="rotate(-15)">−15°</button>
        <button type="button" :disabled="busy" title="На 15° по часовой" @click="rotate(15)">+15°</button>
        <button type="button" :disabled="busy" title="На 45° по часовой" @click="rotate(45)">45° ⟳</button>
      </div>
      <div v-if="template.shape === 'line'" class="row">
        <span class="row-label">Ширина</span>
        <select :value="template.widthFeet ?? 5" aria-label="Ширина линии" :disabled="busy" @change="emit('edit', { widthFeet: Number(($event.target as HTMLSelectElement).value) })">
          <option v-for="width in [5, 10, 15, 20]" :key="width" :value="width">{{ width }} фут.</option>
        </select>
      </div>
      <div class="row">
        <input :value="template.color" type="color" aria-label="Цвет" :disabled="busy" @change="emit('edit', { color: ($event.target as HTMLInputElement).value })" />
        <input v-model="labelDraft" class="grow-input" type="text" maxlength="100" placeholder="Подпись (пусто — форма и размер)" @keydown.enter.prevent="saveLabel" @blur="saveLabel" />
      </div>
      <div class="buttons">
        <button type="button" :disabled="busy" title="Щёлкните по столу, куда её переставить" @click="emit('move')">Переставить…</button>
        <button type="button" :disabled="busy" @click="emit('remove')">Убрать</button>
      </div>
    </template>
    <template v-else>
    <div class="affected">
      <span v-for="name in template.affected" :key="name" class="who">{{ name }}</span>
      <small v-if="!template.affected.length">Никого не задевает.</small>
    </div>
    <template v-if="canManage && template.affected.length">
      <div class="row">
        <select v-model="ability" aria-label="Спасбросок">
          <option v-for="[key, label] in ABILITIES" :key="key" :value="key">{{ label }}</option>
        </select>
        <label>СЛ <input v-model.number="dc" type="number" min="1" max="40" /></label>
      </div>
      <div class="row">
        <label class="grow">Урон <input v-model="damage" type="text" maxlength="40" placeholder="8d6 (пусто — без урона)" /></label>
        <select v-model="damageType" aria-label="Тип урона">
          <option v-for="[key, label] in DAMAGE_TYPES" :key="key" :value="key">{{ label }}</option>
        </select>
      </div>
      <label class="checkbox-label"><input v-model="halfOnSave" type="checkbox" /> половина урона при успехе</label>
      <small class="hint">Укрытие от точки начала области: +2/+5 к спасброску Ловкости, за полным — не задет.</small>
    </template>
    <small v-else-if="!canManage" class="hint">Спасброски по области бросает мастер.</small>
    <div class="buttons">
      <button v-if="canRemove" type="button" :disabled="busy" @click="emit('remove')">Убрать</button>
      <button v-if="canManage && template.affected.length" type="button" class="primary" :disabled="busy || !(dc >= 1 && dc <= 40)" @click="submit">
        Спасброски{{ damage.trim() ? ' и урон' : '' }} ({{ template.affected.length }})
      </button>
    </div>
    </template>
  </div>
</template>

<style scoped>
.area-popover{position:fixed;z-index:2600;width:360px;display:flex;flex-direction:column;gap:8px;padding:12px 14px}
.head{display:flex;align-items:center;gap:8px}
.head b{flex:1;font:600 16px var(--g-title-font);color:var(--g-gold-hi)}
.close{width:28px;min-height:28px;height:28px;padding:0;border-radius:50%}
.affected{display:flex;flex-wrap:wrap;gap:5px}
.who{padding:2px 9px;border-radius:12px;font-size:12px;background:#0006;box-shadow:inset 0 0 0 1px var(--g-gold-lo)}
.row{display:flex;gap:8px;align-items:center}
.row label{display:flex;align-items:center;gap:6px;margin:0;font-size:13px}
.row .grow{flex:1 1 auto;min-width:0}
.row input{min-height:32px;padding:2px 6px;min-width:0}
.row input[type="number"]{width:60px;flex:none}
.row .grow input{flex:1 1 auto;width:100%}
.row select{min-height:32px;padding:2px 6px;font-size:13px;width:auto;flex:0 0 auto;max-width:150px}
.checkbox-label{margin:0;font-size:13px}
.hint{font-size:11px;opacity:.8;line-height:1.35}
.buttons{display:flex;gap:6px;justify-content:flex-end}
.buttons button{min-height:36px;padding:2px 12px}
.tabs{display:flex;gap:4px}
.tabs button{flex:1;min-height:30px;padding:2px 8px;font-size:13px}
.tabs button[aria-selected="true"]{box-shadow:inset 0 -2px 0 var(--g-gold-hi);color:var(--g-gold-hi)}
.row > button{min-height:30px;padding:2px 8px;font-size:12px}
.row-label{font-size:13px;flex:1 1 auto;white-space:nowrap}
.stepper{display:inline-flex;align-items:center;gap:3px}
.stepper button{width:30px;min-height:30px;padding:0}
.row input[type="color"]{width:42px;min-height:32px;padding:2px;flex:none}
.grow-input{flex:1 1 auto;width:100%}
</style>
