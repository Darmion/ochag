<script setup lang="ts">
import { computed, ref } from 'vue';
import { ITEM_CATEGORIES, ITEM_CATEGORY_LABELS, SLOT_LABELS, type ItemCategory } from '../../../../../../packages/domain/character/inventory';
import { CATEGORY_ICONS, srdArtIndex } from '../../../inventory/icons';
import type { InventoryEntry } from '../../../inventory/useInventory';
import ItemArt from '../../rpg/ItemArt.vue';
import GameIcon from '../../game/GameIcon.vue';

const props = defineProps<{ items: InventoryEntry[]; holderId: string; selectedId: string; editable: boolean; loadError: string }>();
const emit = defineEmits<{ select: [itemId: string]; drag: [item: InventoryEntry | null]; reload: [] }>();

type Filter = 'all' | 'worn' | 'consumable' | 'magic';
const FILTERS: Array<[Filter, string]> = [['all', 'Все'], ['worn', 'Надето'], ['consumable', 'Расходники'], ['magic', 'Магические']];
const filter = ref<Filter>('all');
const category = ref<ItemCategory | ''>('');
const query = ref('');
const sort = ref<'name' | 'category' | 'weight' | 'price'>('name');

const where = (item: InventoryEntry) => {
  if (item.containerId === props.holderId) return null;
  return props.items.find(entry => entry.id === item.containerId)?.name ?? null;
};

const shown = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase('ru-RU');
  const list = props.items.filter(item => {
    if (category.value && item.category !== category.value) return false;
    if (filter.value === 'worn' && !item.slot) return false;
    if (filter.value === 'consumable' && !['consumable', 'ammo'].includes(item.category)) return false;
    if (filter.value === 'magic' && !item.magic) return false;
    return !needle || `${item.name} ${ITEM_CATEGORY_LABELS[item.category]}`.toLocaleLowerCase('ru-RU').includes(needle);
  });
  return list.sort((a, b) => {
    if (sort.value === 'category') return ITEM_CATEGORIES.indexOf(a.category) - ITEM_CATEGORIES.indexOf(b.category) || a.name.localeCompare(b.name, 'ru');
    if (sort.value === 'weight') return (b.weightLb ?? -1) * b.quantity - (a.weightLb ?? -1) * a.quantity;
    if (sort.value === 'price') return (b.priceCp ?? -1) * b.quantity - (a.priceCp ?? -1) * a.quantity;
    return Number(Boolean(b.slot)) - Number(Boolean(a.slot)) || a.name.localeCompare(b.name, 'ru');
  });
});
const usedCategories = computed(() => ITEM_CATEGORIES.filter(id => props.items.some(item => item.category === id)));

function onDragStart(event: DragEvent, item: InventoryEntry) {
  if (!props.editable) return;
  event.dataTransfer?.setData('text/plain', item.id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  emit('drag', item);
}
</script>

<template>
  <section class="bag" aria-label="Сумка">
    <div class="bag-tools">
      <label class="bag-search"><span class="sr-only">Поиск вещей</span><input v-model="query" type="search" placeholder="Название вещи…" /></label>
      <select v-model="category" aria-label="Категория">
        <option value="">Все категории</option>
        <option v-for="id in usedCategories" :key="id" :value="id">{{ ITEM_CATEGORY_LABELS[id] }}</option>
      </select>
      <select v-model="sort" aria-label="Сортировка">
        <option value="name">Сначала надетое</option><option value="category">По категории</option>
        <option value="weight">Тяжёлые сверху</option><option value="price">Дорогие сверху</option>
      </select>
    </div>
    <div class="bag-filters" role="group" aria-label="Показать">
      <button v-for="[id, label] in FILTERS" :key="id" type="button" :aria-pressed="filter === id" @click="filter = id">{{ label }}</button>
    </div>

    <div v-if="loadError" class="bag-empty" role="alert">
      <strong>Не удалось загрузить вещи</strong>
      <p>{{ loadError }}</p>
      <button type="button" @click="emit('reload')">Повторить</button>
    </div>
    <ul v-else-if="shown.length" class="bag-grid">
      <li v-for="item in shown" :key="item.id">
        <button
          type="button" class="tile" :class="{ selected: selectedId === item.id, worn: item.slot }" :aria-pressed="selectedId === item.id"
          :draggable="editable && item.slots.length > 0 && item.containerId === holderId" @click="emit('select', item.id)" @dragstart="onDragStart($event, item)" @dragend="emit('drag', null)"
        >
          <ItemArt :name="item.name" :srd-index="srdArtIndex(item.srd)" :size="48" :fallback-icon="CATEGORY_ICONS[item.category]" :rarity="item.magic?.rarity ?? null" />
          <span class="tile-name">{{ item.name }}</span>
          <small class="tile-sub">{{ item.slot ? SLOT_LABELS[item.slot] : where(item) ? `в «${where(item)}»` : ITEM_CATEGORY_LABELS[item.category] }}</small>
          <b v-if="item.infinite" class="tile-count" title="Бесконечный — не расходуется">∞</b>
          <b v-else-if="item.quantity > 1" class="tile-count">×{{ item.quantity }}</b>
          <span v-if="item.slot" class="tile-mark" title="Надето"><GameIcon name="check" :size="12" /></span>
          <span v-if="item.magic?.requiresAttunement" class="tile-attune" :class="{ on: item.magic.attuned }" :title="item.magic.attuned ? 'Настроен' : 'Требует настройки'"><GameIcon name="sparkle" :size="12" /></span>
        </button>
      </li>
    </ul>
    <div v-else class="bag-empty">
      <strong>{{ items.length ? 'Ничего не нашлось' : 'Сумка пуста' }}</strong>
      <p>{{ items.length ? 'Измените поиск или фильтр.' : 'Добавьте вещи кнопкой «Добавить предмет» или положите их в инвентарь на столе.' }}</p>
      <button v-if="items.length && (query || category || filter !== 'all')" type="button" @click="query = ''; category = ''; filter = 'all'">Сбросить фильтры</button>
    </div>
  </section>
</template>

<style scoped>
.bag{display:flex;flex-direction:column;gap:8px;min-width:0;min-height:0}
.bag-tools{display:grid;grid-template-columns:minmax(120px,1fr) auto auto;gap:6px;align-items:center}
.bag-search{margin:0;min-width:0}
.bag-tools input,.bag-tools select{width:100%;height:36px;min-height:36px;padding:6px 10px;box-sizing:border-box}
.bag-filters{display:flex;flex-wrap:wrap;gap:4px}
.bag-filters button{min-height:28px;padding:2px 12px;font-size:12px;border-radius:14px}
.bag-filters button[aria-pressed="true"]{color:var(--g-gold-hi,#f6e2a0);box-shadow:inset 0 0 0 1px var(--g-gold-hi,#f6e2a0)}
.bag-grid{list-style:none;margin:0;padding:2px;display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px;overflow-y:auto;max-height:440px;align-content:start}
.tile{position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;width:100%;min-height:100px;padding:8px 6px;text-align:center;border-radius:8px}
.tile.selected{box-shadow:inset 0 0 0 2px var(--g-gold-hi,#f6e2a0)}
.tile.worn{background:linear-gradient(180deg,color-mix(in srgb,var(--g-accent,#7a1b16) 30%,transparent),transparent)}
.tile-name{font:600 12px/1.25 var(--g-body-font);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.tile-sub{font-size:11px;color:var(--g-text-dim,#ab9a7b);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.tile-count{position:absolute;top:4px;right:6px;font:700 11px var(--g-body-font);color:var(--g-gold-hi,#f6e2a0)}
.tile-mark{position:absolute;top:4px;left:6px;color:var(--g-good,#5ea764)}
.tile-attune{position:absolute;top:22px;left:6px;color:var(--g-text-faint,#77694f)}
.tile-attune.on{color:var(--g-gold-hi,#f6e2a0)}
.bag-empty{display:flex;flex-direction:column;align-items:flex-start;gap:6px;padding:18px;border-radius:8px;background:#0003}
.bag-empty p{margin:0;font-size:13px;color:var(--g-text-dim,#ab9a7b)}
@media (max-width:1100px){.bag-tools{grid-template-columns:1fr 1fr}.bag-search{grid-column:1 / -1}}
</style>
