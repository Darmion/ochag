<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import ItemArt from '../rpg/ItemArt.vue';
import { coinArt } from '../../art/itemArt';
import GameIcon from '../game/GameIcon.vue';
import type { GameIconName } from '../../ui/gameIcons';

type Wallet = { cp: number; sp: number; ep: number; gp: number; pp: number };
type Item = { id: string; name: string; kind: string; price_cp: number | null; weight_lb: number | null; contents_count: number };
type Gear = { index: string; nameRu: string; category: string; priceCp: number; weightLb: number };
type RosterCharacter = { id: string; name: string; kind: string };
type CategoryId = 'all' | 'weapon' | 'armor' | 'shield' | 'accessory' | 'consumable' | 'book' | 'other';
type SortId = 'name' | 'kind' | 'weight' | 'price';

const props = defineProps<{
  campaignId: string;
  characterId: string;
  wallet: Wallet;
  revision: number;
  readOnly: boolean;
  request: (path: string, method?: string, body?: unknown) => Promise<unknown>;
}>();

const emit = defineEmits<{ changed: [] }>();

const COINS: Array<[keyof Wallet, string]> = [['pp', 'пм'], ['gp', 'зм'], ['ep', 'эм'], ['sp', 'см'], ['cp', 'мм']];
const VALUE: Record<keyof Wallet, number> = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 };

const coins = ref<Wallet>({ ...props.wallet });
watch(() => props.wallet, wallet => { coins.value = { ...wallet }; });
const dirty = computed(() => COINS.some(([coin]) => coins.value[coin] !== props.wallet[coin]));
const total = computed(() => COINS.reduce((sum, [coin]) => sum + Math.max(0, Number(coins.value[coin]) || 0) * VALUE[coin], 0));

const items = ref<Item[]>([]);
const gear = ref<Gear[]>([]);
const gearIndex = ref('');
const party = ref<Array<{ id: string; name: string }>>([]);
const giveTo = ref('');
const giveGold = ref<number | ''>('');
const working = ref(false);
const error = ref('');
const query = ref('');
const category = ref<CategoryId>('all');
const sortBy = ref<SortId>('name');
const selectedId = ref('');

const CATEGORIES: Array<{ id: CategoryId; label: string; icon: GameIconName }> = [
  { id: 'all', label: 'Все предметы', icon: 'grid' },
  { id: 'weapon', label: 'Оружие', icon: 'sword' },
  { id: 'armor', label: 'Броня', icon: 'helm' },
  { id: 'shield', label: 'Щиты', icon: 'shield' },
  { id: 'accessory', label: 'Аксессуары', icon: 'crown' },
  { id: 'consumable', label: 'Расходники', icon: 'potion' },
  { id: 'book', label: 'Книги', icon: 'book' },
  { id: 'other', label: 'Прочее', icon: 'more' },
];

function itemCategory(item: Item): CategoryId {
  const source = `${item.kind} ${item.name}`.toLocaleLowerCase('ru-RU');
  if (/shield|щит/.test(source)) return 'shield';
  if (/weapon|оруж|меч|лук|арбалет|кинжал|копь|топор|булав|посох/.test(source)) return 'weapon';
  if (/armor|armour|досп|брон|кольчуг|латы/.test(source)) return 'armor';
  if (/accessor|ring|amulet|wondrous|кольц|амулет|ожерель|перст|фокус/.test(source)) return 'accessory';
  if (/consum|potion|scroll|ammo|зель|свит|боеприпас|стрел|расход/.test(source)) return 'consumable';
  if (/book|книг|том|дневник|гримуар/.test(source)) return 'book';
  return 'other';
}

function categoryCount(id: CategoryId) {
  return id === 'all' ? items.value.length : items.value.filter(item => itemCategory(item) === id).length;
}

const filteredItems = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase('ru-RU');
  const result = items.value.filter(item => {
    const matchesCategory = category.value === 'all' || itemCategory(item) === category.value;
    const matchesQuery = !needle || `${item.name} ${item.kind}`.toLocaleLowerCase('ru-RU').includes(needle);
    return matchesCategory && matchesQuery;
  });
  return result.sort((left, right) => {
    if (sortBy.value === 'kind') return left.kind.localeCompare(right.kind, 'ru');
    if (sortBy.value === 'weight') return (left.weight_lb ?? Number.MAX_SAFE_INTEGER) - (right.weight_lb ?? Number.MAX_SAFE_INTEGER);
    if (sortBy.value === 'price') return (left.price_cp ?? Number.MAX_SAFE_INTEGER) - (right.price_cp ?? Number.MAX_SAFE_INTEGER);
    return left.name.localeCompare(right.name, 'ru');
  });
});

const selectedItem = computed(() => items.value.find(item => item.id === selectedId.value) ?? null);
const selectedCategory = computed(() => CATEGORIES.find(entry => entry.id === (selectedItem.value ? itemCategory(selectedItem.value) : 'all'))?.label ?? 'Предмет');
const activeCategoryLabel = computed(() => CATEGORIES.find(entry => entry.id === category.value)?.label ?? 'Инвентарь');

watch(filteredItems, current => {
  if (!current.some(item => item.id === selectedId.value)) selectedId.value = current[0]?.id ?? '';
}, { immediate: true });

function priceText(cp: number | null) {
  if (cp === null) return '—';
  const gold = Math.floor(cp / 100), silver = Math.floor((cp % 100) / 10), copper = cp % 10;
  return [gold && `${gold} зм`, silver && `${silver} см`, copper && `${copper} мм`].filter(Boolean).join(' ') || '0 мм';
}

async function loadItems() {
  try {
    const response = await props.request(`/campaigns/${props.campaignId}/characters/${props.characterId}/contents`) as { contents: Item[] };
    items.value = response.contents;
  } catch {
    items.value = [];
  }
}

watch(() => props.revision, () => { void loadItems(); });

async function run(action: () => Promise<void>) {
  working.value = true;
  error.value = '';
  try {
    await action();
    emit('changed');
    await loadItems();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    working.value = false;
  }
}

const saveWallet = () => run(async () => {
  const clean = Object.fromEntries(COINS.map(([coin]) => [coin, Math.max(0, Math.round(Number(coins.value[coin]) || 0))]));
  await props.request(`/campaigns/${props.campaignId}/characters/${props.characterId}`, 'PATCH', { revision: props.revision, coins: clean });
});

const addGear = () => run(async () => {
  await props.request(`/campaigns/${props.campaignId}/characters/${props.characterId}/gear`, 'POST', { srdIndex: gearIndex.value });
  gearIndex.value = '';
});

const give = () => run(async () => {
  const amountCp = Math.round(Number(giveGold.value) * 100);
  await props.request(`/campaigns/${props.campaignId}/characters/${props.characterId}/coins/give`, 'POST', { toCharacterId: giveTo.value, amountCp });
  giveGold.value = '';
});

onMounted(async () => {
  void loadItems();
  try {
    gear.value = (await props.request('/srd/gear') as { gear: Gear[] }).gear;
    const roster = await props.request(`/campaigns/${props.campaignId}/characters`) as { characters: RosterCharacter[] };
    party.value = roster.characters
      .filter(character => character.kind !== 'object' && character.id !== props.characterId)
      .map(character => ({ id: character.id, name: character.name }));
  } catch {
  }
});
</script>

<template>
  <section class="wallet-panel">
    <div class="inventory-workspace">
      <aside class="inventory-sidebar" aria-label="Категории и кошелёк">
        <nav class="inventory-categories" aria-label="Категории предметов">
          <span class="panel-eyebrow">Категории</span>
          <button
            v-for="entry in CATEGORIES" :key="entry.id" type="button" class="category-button"
            :class="{ active: category === entry.id }" :aria-pressed="category === entry.id"
            @click="category = entry.id"
          >
            <span class="category-icon" aria-hidden="true"><GameIcon class="inline-icon" :name="entry.icon" :size="16" /></span>
            <span>{{ entry.label }}</span>
            <b>{{ categoryCount(entry.id) }}</b>
          </button>
        </nav>

        <section class="purse-card" aria-labelledby="purse-title">
          <div class="wallet-card-head">
            <span><small>Кошелёк</small><strong id="purse-title">{{ priceText(total) }}</strong></span>
            <button v-if="!readOnly && dirty" type="button" class="primary" :disabled="working" @click="saveWallet">Сохранить</button>
          </div>
          <div class="coins">
            <label v-for="[coin, label] in COINS" :key="coin" :title="`Монеты: ${label}`">
              <span class="coin-name"><img v-if="coinArt(coin)" :src="coinArt(coin)!" alt="" />{{ label }}</span>
              <input v-if="!readOnly" v-model.number="coins[coin]" type="number" min="0" :disabled="working" />
              <b v-else>{{ wallet[coin] }}</b>
            </label>
          </div>
        </section>

        <details v-if="!readOnly && (party.length || gear.length)" class="inventory-tools">
          <summary>Управление</summary>
          <div v-if="party.length" class="give">
            <select v-model="giveTo" aria-label="Кому">
              <option value="">— передать деньги —</option>
              <option v-for="member in party" :key="member.id" :value="member.id">{{ member.name }}</option>
            </select>
            <input v-model.number="giveGold" type="number" min="0.01" step="0.01" placeholder="зм" aria-label="Сколько, зм" />
            <button type="button" :disabled="working || !giveTo || !giveGold" @click="give">Передать</button>
          </div>
          <div v-if="gear.length" class="add-gear">
            <select v-model="gearIndex" aria-label="Снаряжение из справочника">
              <option value="">— снаряжение SRD —</option>
              <option v-for="entry in gear" :key="entry.index" :value="entry.index">{{ entry.nameRu }} — {{ priceText(entry.priceCp) }}, {{ entry.weightLb }} фнт.</option>
            </select>
            <button type="button" :disabled="working || !gearIndex" @click="addGear">Добавить</button>
          </div>
        </details>
      </aside>

      <section class="inventory-browser" aria-labelledby="inventory-title">
        <header class="inventory-toolbar">
          <div><span class="panel-eyebrow">Инвентарь</span><h4 id="inventory-title">{{ activeCategoryLabel }}</h4></div>
          <span class="item-count">{{ filteredItems.length }} из {{ items.length }}</span>
        </header>
        <div class="inventory-filters">
          <label class="search-field"><span class="sr-only">Поиск предметов</span><input v-model="query" type="search" placeholder="Поиск по названию или типу" /></label>
          <label class="sort-field">
            <span class="sr-only">Сортировка</span>
            <select v-model="sortBy">
              <option value="name">По названию</option><option value="kind">По типу</option>
              <option value="weight">По весу</option><option value="price">По стоимости</option>
            </select>
          </label>
        </div>

        <ul v-if="filteredItems.length" class="item-grid">
          <li v-for="item in filteredItems" :key="item.id">
            <button type="button" class="item-tile" :class="{ selected: selectedId === item.id }" :aria-pressed="selectedId === item.id" @click="selectedId = item.id">
              <ItemArt :name="item.name" :size="44" placeholder />
              <span class="tile-copy"><strong>{{ item.name }}</strong><small>{{ CATEGORIES.find(entry => entry.id === itemCategory(item))?.label }}</small></span>
              <b v-if="item.contents_count" class="quantity" :aria-label="`Внутри: ${item.contents_count}`">{{ item.contents_count }}</b>
            </button>
          </li>
        </ul>
        <div v-else class="inventory-empty">
          <span aria-hidden="true"><GameIcon class="inline-icon" name="pouch" :size="16" /></span>
          <strong>{{ items.length ? 'Предметы не найдены' : 'Инвентарь пуст' }}</strong>
          <p>{{ items.length ? 'Измените поиск или выберите другую категорию.' : 'Вещи можно положить в инвентарь на столе или добавить из справочника.' }}</p>
          <button v-if="items.length && (query || category !== 'all')" type="button" @click="query = ''; category = 'all'">Сбросить фильтры</button>
        </div>
      </section>

      <aside class="item-details" aria-label="Карточка выбранного предмета">
        <template v-if="selectedItem">
          <div class="detail-art"><ItemArt :name="selectedItem.name" :size="72" placeholder /></div>
          <span class="panel-eyebrow">{{ selectedCategory }}</span>
          <h4>{{ selectedItem.name }}</h4>
          <dl class="item-facts">
            <div><dt>Тип</dt><dd>{{ selectedItem.kind || 'Не указан' }}</dd></div>
            <div><dt>Стоимость</dt><dd>{{ priceText(selectedItem.price_cp) }}</dd></div>
            <div><dt>Вес</dt><dd>{{ selectedItem.weight_lb === null ? 'Не указан' : `${selectedItem.weight_lb} фнт.` }}</dd></div>
            <div v-if="selectedItem.contents_count"><dt>Содержимое</dt><dd>{{ selectedItem.contents_count }}</dd></div>
          </dl>
          <p class="detail-note">Показаны свойства, которые уже хранятся в инвентаре персонажа.</p>
        </template>
        <div v-else class="detail-placeholder"><span aria-hidden="true"><GameIcon class="inline-icon" name="pouch" :size="28" /></span><p>Выберите предмет, чтобы увидеть его свойства.</p></div>
      </aside>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.wallet-panel{display:grid;gap:10px;min-width:0}
.inventory-workspace{display:grid;grid-template-columns:minmax(170px,.55fr) minmax(300px,1.45fr) minmax(210px,.75fr);gap:10px;align-items:start;min-width:0}
.inventory-sidebar,.inventory-browser,.item-details{min-width:0;border:1px solid var(--brass-light);border-radius:7px;background:var(--surface-inset)}
.inventory-sidebar{display:grid;gap:12px;padding:10px}
.panel-eyebrow{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted-ink)}
.inventory-categories{display:grid;gap:3px}
.inventory-categories > .panel-eyebrow{padding:2px 7px 6px}
.category-button{display:grid;grid-template-columns:20px minmax(0,1fr) auto;align-items:center;gap:7px;width:100%;min-height:34px;padding:5px 7px;border:1px solid transparent;border-radius:5px;background:transparent;box-shadow:none;text-align:left;color:var(--ink);font-size:13px;font-weight:500}
.category-button:hover{border-color:var(--brass-light);background:color-mix(in srgb,var(--brass) 9%,transparent)}
.category-button:focus-visible{outline:2px solid var(--brass);outline-offset:1px}
.category-button.active{border-color:var(--brass);background:color-mix(in srgb,var(--brass) 15%,transparent);color:var(--brass)}
.category-button b{min-width:22px;text-align:right;font-size:11px;font-variant-numeric:tabular-nums;color:var(--muted-ink)}
.category-icon{color:var(--brass);text-align:center}
.purse-card{padding:10px;border-top:1px solid var(--brass-light)}
.wallet-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}
.wallet-card-head > span{display:flex;flex-direction:column}
.wallet-card-head small{font-size:11px;color:var(--muted-ink);text-transform:uppercase;letter-spacing:.05em}
.wallet-card-head strong{font-size:20px;font-variant-numeric:tabular-nums}
.wallet-card-head button{min-height:30px;padding:3px 10px;font-size:12px}
.coins{display:grid;grid-template-columns:repeat(2,minmax(52px,1fr));gap:6px}
.coins label{display:flex;flex-direction:column;gap:3px;margin:0;font-size:11px;font-weight:700;color:var(--muted-ink)}
.coins input{width:100%;min-width:0;box-sizing:border-box;text-align:center;font-variant-numeric:tabular-nums}
.coins b{font-size:17px;color:var(--ink);font-variant-numeric:tabular-nums}
.coin-name{display:flex;align-items:center;gap:4px}
.coin-name img{width:18px;height:18px;image-rendering:pixelated}
.give,.add-gear{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.give select,.add-gear select{flex:1 1 200px;min-width:0}
.give input{width:90px}
.give button,.add-gear button{min-height:30px;padding:2px 10px;font-size:12px}
.inventory-tools{padding:9px;border-top:1px solid var(--brass-light)}
.inventory-tools > summary{cursor:pointer;font-size:13px;color:var(--muted-ink)}
.inventory-tools[open] > summary{margin-bottom:10px}
.inventory-tools .add-gear{margin-top:8px}
.inventory-browser{display:grid;grid-template-rows:auto auto minmax(220px,auto);align-content:start;overflow:hidden}
.inventory-toolbar{display:flex;align-items:end;justify-content:space-between;gap:10px;padding:12px 14px 9px}
.inventory-toolbar h4,.item-details h4{margin:2px 0 0;font:700 18px var(--heading-font)}
.item-count{font-size:11px;color:var(--muted-ink);font-variant-numeric:tabular-nums}
.inventory-filters{display:grid;grid-template-columns:minmax(130px,1fr) auto;gap:6px;padding:0 12px 10px;border-bottom:1px solid var(--brass-light)}
.inventory-filters label{margin:0}
.inventory-filters input,.inventory-filters select{width:100%;min-width:0;box-sizing:border-box}
.item-grid{list-style:none;margin:0;padding:10px;display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:7px;max-height:440px;overflow:auto;overscroll-behavior:contain}
.item-tile{position:relative;display:grid;grid-template-rows:auto minmax(0,1fr);justify-items:start;gap:8px;width:100%;height:100%;min-height:116px;padding:10px;border:1px solid transparent;border-radius:6px;background:color-mix(in srgb,var(--surface) 55%,transparent);box-shadow:none;text-align:left;color:var(--ink);font-weight:400}
.item-tile:hover{border-color:var(--brass-light);background:color-mix(in srgb,var(--brass) 8%,var(--surface-inset))}
.item-tile:focus-visible{outline:2px solid var(--brass);outline-offset:1px}
.item-tile.selected{border-color:var(--brass);box-shadow:inset 0 -2px 0 var(--brass);background:color-mix(in srgb,var(--brass) 13%,var(--surface-inset))}
.tile-copy{display:grid;gap:2px;min-width:0;align-self:end}
.tile-copy strong{font-size:13px;line-height:1.2;overflow-wrap:anywhere}
.tile-copy small{font-size:10px;color:var(--muted-ink)}
.quantity{position:absolute;top:7px;right:7px;min-width:20px;padding:2px 5px;border-radius:999px;background:var(--brass);color:var(--surface);font-size:10px;text-align:center}
.inventory-empty{min-height:220px;display:grid;place-items:center;align-content:center;gap:7px;padding:24px;text-align:center;color:var(--muted-ink)}
.inventory-empty > span,.detail-placeholder > span{font-size:28px;color:var(--brass)}
.inventory-empty p,.detail-placeholder p{margin:0;max-width:32ch;font-size:12px}
.item-details{position:sticky;top:0;display:flex;flex-direction:column;padding:14px;min-height:260px}
.detail-art{display:grid;place-items:center;min-height:100px;margin-bottom:12px;border-radius:6px;background:radial-gradient(circle,color-mix(in srgb,var(--brass) 13%,transparent),transparent 68%)}
.item-facts{display:grid;gap:0;margin:14px 0 0}
.item-facts div{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid var(--brass-light)}
.item-facts dt{font-size:11px;color:var(--muted-ink)}
.item-facts dd{margin:0;text-align:right;font-size:12px;font-weight:600;overflow-wrap:anywhere}
.detail-note{margin:auto 0 0;padding-top:16px;font-size:11px;color:var(--muted-ink)}
.detail-placeholder{display:grid;place-items:center;align-content:center;gap:8px;min-height:230px;text-align:center;color:var(--muted-ink)}
.error{color:#c0392b;margin:0}
@media(max-width:940px){.inventory-workspace{grid-template-columns:minmax(170px,.55fr) minmax(300px,1.45fr)}.item-details{position:static;grid-column:1 / -1;display:grid;grid-template-columns:100px minmax(0,1fr);column-gap:14px;min-height:0}.detail-art{grid-row:1 / 5;margin:0}.item-facts{grid-column:2}.detail-note{grid-column:2}}
@media(max-width:680px){.inventory-workspace{grid-template-columns:1fr}.inventory-sidebar{grid-template-columns:1fr 1fr;align-items:start}.item-details{grid-column:auto}.item-grid{max-height:none}.inventory-categories{grid-column:1 / -1;grid-template-columns:repeat(2,minmax(0,1fr))}.inventory-categories > .panel-eyebrow{grid-column:1 / -1}.coins{grid-template-columns:repeat(3,minmax(48px,1fr))}}
@media(max-width:430px){.inventory-sidebar,.item-details{display:flex;flex-direction:column}.inventory-categories{grid-template-columns:1fr}.inventory-filters{grid-template-columns:1fr}.coins{grid-template-columns:repeat(3,minmax(52px,1fr))}.item-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
