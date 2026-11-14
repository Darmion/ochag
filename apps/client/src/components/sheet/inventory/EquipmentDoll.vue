<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { EQUIP_SLOTS, SLOT_LABELS, normalizeDoll, occupiedSlots, presetDoll, type Doll, type DollPreset, type EquipSlot } from '../../../../../../packages/domain/character/inventory';
import { cropStyle, normalizeCrop } from '../../../art/imageCrop';
import { clampToFrame, fromFrame, toFrame, type Size } from '../../../inventory/dollGeometry';
import { CATEGORY_ICONS, SLOT_ICONS, srdArtIndex } from '../../../inventory/icons';
import type { InventoryEntry, InventoryView } from '../../../inventory/useInventory';
import ItemArt from '../../rpg/ItemArt.vue';
import GameIcon from '../../game/GameIcon.vue';

const props = defineProps<{
  holder: InventoryView['holder'];
  items: InventoryEntry[];
  portraitUrl: string | null;
  portraitCropped: boolean;
  editable: boolean;
  working: boolean;
  dragging: InventoryEntry | null;
}>();
const emit = defineEmits<{ equip: [itemId: string, slot: EquipSlot]; unequip: [itemId: string]; select: [itemId: string]; save: [doll: Doll] }>();

const frameEl = ref<HTMLElement | null>(null);
const frame = ref<Size>({ width: 280, height: 380 });
const natural = ref<Size | null>(null);
let observer: ResizeObserver | null = null;
onMounted(() => {
  observer = new ResizeObserver(() => {
    if (frameEl.value) frame.value = { width: frameEl.value.clientWidth, height: frameEl.value.clientHeight };
  });
  if (frameEl.value) observer.observe(frameEl.value);
});
onBeforeUnmount(() => observer?.disconnect());
watch(() => props.portraitUrl, () => { natural.value = null; });

const setup = ref(false);
const draft = ref<Doll>(normalizeDoll(props.holder.doll, props.holder.kind));
watch(() => props.holder.doll, doll => { if (!setup.value) draft.value = normalizeDoll(doll, props.holder.kind); }, { deep: true });
const doll = computed(() => (setup.value ? draft.value : normalizeDoll(props.holder.doll, props.holder.kind)));
const crop = computed(() => (props.portraitCropped ? normalizeCrop(props.holder.imageCrop) : null));
const image = computed(() => (props.portraitUrl ? natural.value : null));

const own = computed(() => props.items.filter(item => item.containerId === props.holder.id));
const taken = computed(() => occupiedSlots(own.value));
const sockets = computed(() => EQUIP_SLOTS.flatMap(slot => {
  const point = doll.value.points[slot];
  if (!point || (point.hidden && !setup.value)) return [];
  const size = Math.max(40, Math.round(44 * point.size));
  const at = clampToFrame(toFrame(point, image.value, frame.value, crop.value), frame.value, size / 2);
  const item = taken.value.get(slot) as InventoryEntry | undefined;
  const borrowed = Boolean(item && item.slot !== slot);
  return [{ slot, size, x: at.x, y: at.y, item: item ?? null, borrowed, hidden: point.hidden }];
}));
const hiddenWorn = computed(() => own.value.filter(item => item.slot && doll.value.points[item.slot]?.hidden));

const openSlot = ref<EquipSlot | null>(null);
const choices = computed(() => {
  if (!openSlot.value) return [];
  const holding = taken.value.get(openSlot.value)?.id;
  return own.value.filter(item => item.slots.includes(openSlot.value!) && item.id !== holding);
});
const menuEl = ref<HTMLElement | null>(null);
let opener: HTMLElement | null = null;

function onSocket(slot: EquipSlot, event?: Event) {
  if (setup.value) return;
  if (openSlot.value === slot) return closeMenu();
  opener = (event?.currentTarget as HTMLElement | null) ?? null;
  openSlot.value = slot;
}
function closeMenu() {
  openSlot.value = null;
  opener?.focus();
}
function onOutside(event: PointerEvent) {
  if (menuEl.value && !menuEl.value.contains(event.target as Node) && !(event.target as HTMLElement).closest?.('.socket')) openSlot.value = null;
}
watch(openSlot, async slot => {
  document.removeEventListener('pointerdown', onOutside, true);
  if (!slot) return;
  await nextTick();
  document.addEventListener('pointerdown', onOutside, true);
  (menuEl.value?.querySelector('button') as HTMLElement | null)?.focus();
});
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside, true));
function choose(item: InventoryEntry) {
  if (!openSlot.value) return;
  emit('equip', item.id, openSlot.value);
  openSlot.value = null;
}
function onDrop(event: DragEvent, slot: EquipSlot) {
  const id = event.dataTransfer?.getData('text/plain');
  if (id && props.editable) emit('equip', id, slot);
}
const fits = (slot: EquipSlot) => Boolean(props.dragging && props.dragging.slots.includes(slot));

let moving: { slot: EquipSlot; pointer: number } | null = null;
function startMove(event: PointerEvent, slot: EquipSlot) {
  if (!setup.value) return;
  moving = { slot, pointer: event.pointerId };
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}
function move(event: PointerEvent) {
  if (!moving || !frameEl.value) return;
  const rect = frameEl.value.getBoundingClientRect();
  const scale = rect.width / Math.max(1, frame.value.width);
  const at = { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale };
  const point = fromFrame(at, image.value, frame.value, crop.value);
  const current = draft.value.points[moving.slot]!;
  draft.value = { ...draft.value, points: { ...draft.value.points, [moving.slot]: { ...current, x: point.x, y: point.y } } };
}
function endMove() {
  moving = null;
}
function nudge(event: KeyboardEvent, slot: EquipSlot) {
  if (!setup.value) return;
  const step = event.shiftKey ? 0.05 : 0.01;
  const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
  if (!delta) return;
  event.preventDefault();
  const current = draft.value.points[slot]!;
  draft.value = { ...draft.value, points: { ...draft.value.points, [slot]: { ...current, x: Math.min(1, Math.max(0, current.x + delta[0]!)), y: Math.min(1, Math.max(0, current.y + delta[1]!)) } } };
}
function toggleHidden(slot: EquipSlot) {
  const current = draft.value.points[slot]!;
  draft.value = { ...draft.value, points: { ...draft.value.points, [slot]: { ...current, hidden: !current.hidden } } };
}
function usePreset(preset: DollPreset) {
  draft.value = { ...presetDoll(preset), dim: draft.value.dim };
}
function startSetup() {
  openSlot.value = null;
  draft.value = normalizeDoll(props.holder.doll, props.holder.kind);
  setup.value = true;
}
function save() {
  emit('save', draft.value);
  setup.value = false;
}
const PRESETS: Array<[DollPreset, string]> = [['humanoid', 'Гуманоид'], ['beast', 'Зверь'], ['list', 'Только список']];
const listMode = computed(() => doll.value.preset === 'list');
</script>

<template>
  <section class="doll-panel" aria-label="Надетое снаряжение">
    <div v-if="!listMode" ref="frameEl" class="doll-frame" :class="{ setup }" @pointermove="move" @pointerup="endMove" @pointercancel="endMove">
      <img
        v-if="portraitUrl" class="doll-picture" :src="portraitUrl" alt="" :style="crop ? cropStyle(holder.imageCrop) : {}"
        draggable="false" @load="natural = { width: ($event.target as HTMLImageElement).naturalWidth, height: ($event.target as HTMLImageElement).naturalHeight }"
      />
      <svg v-else class="doll-silhouette" viewBox="0 0 100 136" aria-hidden="true">
        <path d="M50 8c8 0 14 6.5 14 15s-6 15-14 15-14-6.5-14-15S42 8 50 8zM28 44c6-4 14-5 22-5s16 1 22 5c6 4 9 11 10 19l3 26c.4 3-2 5-5 5s-5-2-5.5-5L72 68v58c0 3-2.4 5-5.5 5S61 129 60.5 126L55 92h-10l-5.5 34c-.5 3-2.6 5-5.5 5S28 129 28 126V68l-2.5 21C25 92 23 94 20 94s-5.4-2-5-5l3-26c1-8 4-15 10-19z" />
      </svg>
      <div class="doll-dim" :style="{ opacity: doll.dim }" />
      <button
        v-for="socket in sockets" :key="socket.slot" type="button" class="socket"
        :class="{ filled: socket.item, borrowed: socket.borrowed, fits: fits(socket.slot), open: openSlot === socket.slot, hidden: socket.hidden, unfit: dragging && !fits(socket.slot) }"
        :style="{ left: `${socket.x}px`, top: `${socket.y}px`, width: `${socket.size}px`, height: `${socket.size}px` }"
        :title="socket.item ? `${SLOT_LABELS[socket.slot]}: ${socket.item.name}${socket.borrowed ? ' (двуручное)' : ''}` : `${SLOT_LABELS[socket.slot]} — пусто`"
        :aria-label="socket.item ? `${SLOT_LABELS[socket.slot]}: ${socket.item.name}` : `${SLOT_LABELS[socket.slot]}: пусто`"
        :disabled="!editable && !socket.item"
        @click="onSocket(socket.slot, $event)" @pointerdown="startMove($event, socket.slot)" @keydown="nudge($event, socket.slot)"
        @dragover.prevent="() => {}" @drop.prevent="onDrop($event, socket.slot)"
      >
        <ItemArt v-if="socket.item" :name="socket.item.name" :srd-index="srdArtIndex(socket.item.srd)" :size="Math.round(socket.size * 0.78)" :fallback-icon="CATEGORY_ICONS[socket.item.category]" :rarity="socket.item.magic?.rarity ?? null" />
        <GameIcon v-else :name="SLOT_ICONS[socket.slot]" :size="Math.round(socket.size * 0.45)" />
        <span v-if="fits(socket.slot)" class="socket-plus" aria-hidden="true">+</span>
      </button>
      <div v-if="openSlot && !setup" ref="menuEl" class="socket-menu g-frame" role="dialog" :aria-label="SLOT_LABELS[openSlot]" @keydown.esc.prevent.stop="closeMenu">
        <b>{{ SLOT_LABELS[openSlot] }}</b>
        <template v-if="taken.get(openSlot)">
          <button type="button" class="socket-current" @click="emit('select', (taken.get(openSlot) as InventoryEntry).id); openSlot = null">{{ (taken.get(openSlot) as InventoryEntry).name }}</button>
          <button v-if="editable" type="button" :disabled="working" @click="emit('unequip', (taken.get(openSlot) as InventoryEntry).id); openSlot = null">Снять в сумку</button>
        </template>
        <template v-if="editable">
          <button v-for="item in choices" :key="item.id" type="button" :disabled="working" @click="choose(item)">
            <ItemArt :name="item.name" :srd-index="srdArtIndex(item.srd)" :size="24" :fallback-icon="CATEGORY_ICONS[item.category]" /> {{ item.name }}<small v-if="item.quantity > 1">×{{ item.quantity }}</small>
          </button>
          <small v-if="!choices.length" class="muted">Подходящих вещей при себе нет.</small>
        </template>
        <button type="button" class="socket-close" @click="closeMenu">Закрыть</button>
      </div>
    </div>

    <ul v-else class="doll-list">
      <li v-for="slot in EQUIP_SLOTS" :key="slot" @dragover.prevent="() => {}" @drop.prevent="onDrop($event, slot)">
        <span class="list-slot"><GameIcon :name="SLOT_ICONS[slot]" :size="16" />{{ SLOT_LABELS[slot] }}</span>
        <button v-if="taken.get(slot)" type="button" class="list-item" @click="emit('select', (taken.get(slot) as InventoryEntry).id)">{{ (taken.get(slot) as InventoryEntry).name }}</button>
        <span v-else class="muted">—</span>
      </li>
    </ul>

    <p v-if="hiddenWorn.length && !setup" class="hidden-worn">Надето вне куклы: <button v-for="item in hiddenWorn" :key="item.id" type="button" class="link-button" @click="emit('select', item.id)">{{ item.name }}</button></p>

    <div v-if="editable && !setup" class="doll-actions">
      <button type="button" :disabled="working" title="Передвинуть ячейки по картинке, скрыть лишние, выбрать шаблон" @click="startSetup"><GameIcon name="pencil" :size="14" /> Настроить расположение</button>
    </div>
    <div v-if="setup" class="doll-setup">
      <label>Шаблон
        <select :value="draft.preset" @change="usePreset(($event.target as HTMLSelectElement).value as DollPreset)">
          <option v-for="[value, label] in PRESETS" :key="value" :value="value">{{ label }}</option>
        </select>
      </label>
      <label>Затемнение картинки
        <input type="range" min="0" max="0.8" step="0.05" :value="draft.dim" @input="draft = { ...draft, dim: Number(($event.target as HTMLInputElement).value) }" />
      </label>
      <details class="setup-slots">
        <summary>Ячейки</summary>
        <label v-for="slot in EQUIP_SLOTS" :key="slot" class="check-row">
          <input type="checkbox" :checked="!draft.points[slot]?.hidden" @change="toggleHidden(slot)" /> {{ SLOT_LABELS[slot] }}
        </label>
      </details>
      <small class="muted">Тяните ячейки по картинке; стрелки двигают выбранную ячейку, с Shift — быстрее. Скрытая ячейка не снимает предмет.</small>
      <div class="setup-buttons">
        <button type="button" @click="usePreset(draft.preset)">Сбросить</button>
        <button type="button" @click="setup = false">Отмена</button>
        <button type="button" class="primary" :disabled="working" @click="save">Сохранить</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.doll-panel{display:flex;flex-direction:column;gap:8px;min-width:0}
.doll-frame{position:relative;width:100%;aspect-ratio:280 / 380;border-radius:8px;overflow:hidden;background:radial-gradient(ellipse at 50% 30%,var(--g-stone-1,#2c261f),var(--g-stone-3,#110e0b));box-shadow:inset 0 0 0 1px #000,0 0 0 1px var(--g-gold-lo,#80602a)}
.doll-picture{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:top;pointer-events:none;user-select:none}
.doll-silhouette{position:absolute;inset:8% 18%;width:64%;height:84%;fill:color-mix(in srgb,var(--g-gold-lo,#80602a) 45%,transparent)}
.doll-dim{position:absolute;inset:0;background:#000;pointer-events:none}
.socket{position:absolute;translate:-50% -50%;display:grid;place-items:center;min-height:0;padding:0;border-radius:10px;color:var(--g-text-dim,#ab9a7b);background:color-mix(in srgb,var(--g-stone-3,#110e0b) 88%,transparent);box-shadow:inset 0 0 0 1px #000,0 0 0 1px var(--g-gold-lo,#80602a),0 2px 6px #000a}
.socket.filled{color:var(--g-text,#ebdfc3);box-shadow:inset 0 0 0 1px #000,0 0 0 2px var(--g-gold,#d4ae5a),0 2px 6px #000a}
.socket.borrowed{opacity:.6}
.socket.open,.socket:focus-visible{box-shadow:inset 0 0 0 2px var(--g-gold-hi,#f6e2a0),0 0 0 2px var(--g-gold,#d4ae5a),0 0 12px var(--g-glow)}
.socket.fits{box-shadow:inset 0 0 0 1px #000,0 0 0 2px var(--g-gold-hi,#f6e2a0),0 0 14px var(--g-glow)}
.socket.unfit{opacity:.35}
.socket.hidden{opacity:.4;outline:1px dashed var(--g-gold-lo,#80602a)}
.doll-frame.setup .socket{cursor:grab;touch-action:none}
.socket-plus{position:absolute;right:-6px;top:-6px;display:grid;place-items:center;width:16px;height:16px;border-radius:50%;font:700 12px/1 var(--g-body-font);color:var(--g-stone-3,#110e0b);background:var(--g-gold-hi,#f6e2a0)}
.socket-menu{position:absolute;left:8px;right:8px;bottom:8px;z-index:5;display:flex;flex-direction:column;gap:4px;max-height:60%;overflow-y:auto;overflow-x:hidden;padding:10px}
.socket-menu b{font-size:13px;color:var(--g-gold-hi,#f6e2a0)}
.socket-menu button{display:flex;align-items:center;gap:8px;justify-content:flex-start;min-width:0;min-height:32px;padding:2px 8px;font-size:13px;text-align:left;white-space:normal;overflow-wrap:anywhere}
.socket-menu .socket-close{justify-content:center}
.doll-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.doll-list li{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:32px;padding:2px 8px;border-radius:6px;background:#0003}
.list-slot{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--g-text-dim,#ab9a7b)}
.list-item{min-height:26px;padding:2px 8px;font-size:13px}
.hidden-worn{margin:0;font-size:12px;display:flex;flex-wrap:wrap;gap:4px 8px}
.doll-actions button{display:inline-flex;align-items:center;gap:6px;min-height:30px;padding:2px 10px;font-size:12px}
.doll-setup{display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:8px;background:#0003;box-shadow:inset 0 0 0 1px var(--g-line,#3b3125)}
.doll-setup label{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:600;margin:0}
.setup-slots{font-size:12px}
.setup-slots .check-row{flex-direction:row;align-items:center;gap:6px;font-weight:400}
.setup-buttons{display:flex;gap:6px;justify-content:flex-end}
.setup-buttons button{min-height:30px;padding:2px 10px;font-size:12px}
</style>
