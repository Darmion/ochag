<script setup lang="ts">
import { useEscapeClose } from '../../ui/escapeStack';
import { confirmAction } from '../../ui/confirmDialog';
import { computed, onMounted, ref, watch } from 'vue';

import ItemArt from '../rpg/ItemArt.vue';
import GameIcon from '../game/GameIcon.vue';

type Good = { id: string; name: string; price_cp: number | null; default_price?: boolean; weight_lb: number | null; rarity?: string | null };
type Offer = { id: string; name: string; priceCp: number | null; incomeCp: number | null; rarity: string | null };
type Gear = { index: string; nameRu: string; category: string; priceCp: number; weightLb: number | null };
type MagicPreset = { index: string; nameRu: string; rarity: string };

const props = defineProps<{
  campaignId: string;
  merchantId: string;
  merchantName: string;
  buyers: Array<{ id: string; name: string }>;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();

const emit = defineEmits<{ close: []; done: [message: string] }>();
useEscapeClose(() => emit('close'));

const RARITY_LABELS: Record<string, string> = {
  common: 'обычный', uncommon: 'необычный', rare: 'редкий', very_rare: 'очень редкий', legendary: 'легендарный', artifact: 'артефакт',
};
const GEAR_GROUPS: Record<string, string> = {
  gear: 'Снаряжение', armor: 'Доспехи и щиты', ammo: 'Боеприпасы', tools: 'Инструменты', consumable: 'Расходники', focus: 'Фокусировки', clothes: 'Одежда',
};

const goods = ref<Good[]>([]);
const offers = ref<Offer[]>([]);
const wallet = ref(0);
const canManage = ref(false);
const buyerId = ref(props.buyers[0]?.id ?? '');
const working = ref(false);
const error = ref('');

const base = computed(() => `/campaigns/${props.campaignId}/characters`);

function priceText(cp: number | null) {
  if (cp === null) return '—';
  const gold = Math.floor(cp / 100), silver = Math.floor((cp % 100) / 10), copper = cp % 10;
  return [gold && `${gold} зм`, silver && `${silver} см`, copper && `${copper} мм`].filter(Boolean).join(' ') || '0 мм';
}

async function load() {
  error.value = '';
  try {
    const shop = await props.request(`${base.value}/${props.merchantId}/shop`);
    goods.value = (shop.goods as Good[]).map(good => ({ ...good, price_cp: good.price_cp === null ? null : Number(good.price_cp) }));
    canManage.value = shop.canManage === true;
    if (buyerId.value) {
      const sheet = await props.request(`${base.value}/${buyerId.value}`);
      wallet.value = (sheet.cp ?? 0) + (sheet.sp ?? 0) * 10 + (sheet.ep ?? 0) * 50 + (sheet.gp ?? 0) * 100 + (sheet.pp ?? 0) * 1000;
      offers.value = (await props.request(`${base.value}/${props.merchantId}/offers/${buyerId.value}`)).offers;
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}

async function run(action: () => Promise<unknown>) {
  working.value = true;
  error.value = '';
  try {
    await action();
    await load();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    working.value = false;
  }
}

function trade(kind: 'buy' | 'sell', itemId: string) {
  return run(async () => {
    const result = await props.request(`${base.value}/${props.merchantId}/${kind}`, 'POST', kind === 'buy' ? { itemId, buyerId: buyerId.value } : { itemId, sellerId: buyerId.value });
    emit('done', kind === 'buy' ? `Куплено: ${result.bought} за ${priceText(result.priceCp)}.` : `Продано: ${result.sold} за ${priceText(result.incomeCp)}.`);
  });
}

function setPrice(good: Good, goldText: string) {
  const gold = Number(goldText.replace(',', '.'));
  if (!Number.isFinite(gold) || gold < 0) return;
  const priceCp = Math.round(gold * 100);
  if (priceCp === good.price_cp && !good.default_price) return;
  return run(() => props.request(`${base.value}/${props.merchantId}/goods/${good.id}`, 'PUT', { priceCp }));
}

async function removeGood(good: Good) {
  if (!(await confirmAction(`Убрать «${good.name}» с прилавка? Вещь удалится из кампании.`, { title: 'Убрать товар', confirmLabel: 'Убрать', danger: true }))) return;
  return run(() => props.request(`${base.value}/${good.id}`, 'DELETE'));
}

const addKind = ref<'gear' | 'magic' | 'own'>('gear');
const gearList = ref<Gear[]>([]);
const magicList = ref<MagicPreset[]>([]);
const gearPick = ref('');
const magicPick = ref('');
const ownName = ref('');
const ownGold = ref<number | ''>('');
const ownWeight = ref<number | ''>('');
const ownText = ref('');

const gearGroups = computed(() => Object.entries(GEAR_GROUPS)
  .map(([id, label]) => ({ label, items: gearList.value.filter(item => item.category === id) }))
  .filter(group => group.items.length));
const magicSorted = computed(() => [...magicList.value].sort((a, b) => a.nameRu.localeCompare(b.nameRu, 'ru')));

async function loadCatalogs() {
  if (gearList.value.length && magicList.value.length) return;
  try {
    const [gear, magic] = await Promise.all([props.request('/srd/gear'), props.request('/srd/magic-items')]);
    gearList.value = gear.gear;
    magicList.value = magic.items;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}

const canAdd = computed(() => (addKind.value === 'gear' ? Boolean(gearPick.value)
  : addKind.value === 'magic' ? Boolean(magicPick.value)
    : Boolean(ownName.value.trim()) && ownGold.value !== '' && Number(ownGold.value) >= 0));

function addGood() {
  return run(async () => {
    if (addKind.value === 'gear') {
      await props.request(`${base.value}/${props.merchantId}/gear`, 'POST', { srdIndex: gearPick.value });
      gearPick.value = '';
    } else if (addKind.value === 'magic') {
      await props.request(`${base.value}/${props.merchantId}/items`, 'POST', { srdIndex: magicPick.value });
      magicPick.value = '';
    } else {
      await props.request(`${base.value}/${props.merchantId}/goods`, 'POST', {
        name: ownName.value.trim(),
        priceCp: Math.round(Number(ownGold.value) * 100),
        ...(ownWeight.value !== '' ? { weightLb: Number(ownWeight.value) } : {}),
        ...(ownText.value.trim() ? { text: ownText.value.trim() } : {}),
      });
      ownName.value = '';
      ownGold.value = '';
      ownWeight.value = '';
      ownText.value = '';
    }
  });
}

watch(buyerId, () => void load());
onMounted(load);
</script>

<template>
  <div class="modal-overlay" role="dialog" aria-modal="true" :aria-label="`Лавка: ${merchantName}`" @click.self="emit('close')">
    <section class="modal-card shop">
      <header>
        <h2>Лавка: {{ merchantName }}</h2>
        <button type="button" aria-label="Закрыть" @click="emit('close')"><GameIcon class="inline-icon" name="close" :size="16" /></button>
      </header>
      <label v-if="buyers.length" class="buyer">Кто торгует
        <select v-model="buyerId" :disabled="working">
          <option v-for="buyer in buyers" :key="buyer.id" :value="buyer.id">{{ buyer.name }}</option>
        </select>
        <span class="muted">в кошельке {{ priceText(wallet) }}</span>
      </label>
      <p v-else-if="!canManage" class="muted">Торговать может ваш персонаж на этой сцене.</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <div class="columns">
        <div>
          <h3>Товары</h3>
          <ul v-if="goods.length">
            <li v-for="good in goods" :key="good.id">
              <ItemArt :name="good.name" :rarity="good.rarity" :size="34" placeholder />
              <span class="good-name">
                {{ good.name }}
                <small v-if="good.rarity" class="muted">{{ RARITY_LABELS[good.rarity] ?? good.rarity }}{{ canManage && good.default_price ? ' · цена по редкости' : '' }}</small>
              </span>
              <span v-if="canManage" class="price-edit" title="Цена в золотых — Enter или уход из поля сохраняет">
                <input
                  type="number" min="0" step="0.01" :value="good.price_cp === null ? '' : good.price_cp / 100" placeholder="цена" :disabled="working"
                  :aria-label="`Цена «${good.name}», зм`"
                  @change="setPrice(good, ($event.target as HTMLInputElement).value)"
                /> зм
                <button type="button" class="link-button" :disabled="working" title="Убрать с прилавка" @click="removeGood(good)"><GameIcon class="inline-icon" name="close" :size="16" /></button>
              </span>
              <button
                v-if="buyers.length && good.price_cp !== null" type="button" :disabled="working || !buyerId || good.price_cp > wallet"
                @click="trade('buy', good.id)"
              >Купить · {{ priceText(good.price_cp) }}</button>
            </li>
          </ul>
          <p v-else class="muted">Прилавок пуст.</p>
        </div>
        <div v-if="buyers.length">
          <h3>Продать</h3>
          <ul v-if="offers.length">
            <li v-for="item in offers" :key="item.id">
              <ItemArt :name="item.name" :rarity="item.rarity" :size="34" placeholder />
              <span class="good-name">
                {{ item.name }}
                <small v-if="item.rarity" class="muted">{{ RARITY_LABELS[item.rarity] ?? item.rarity }}</small>
              </span>
              <button v-if="item.incomeCp !== null" type="button" :disabled="working" @click="trade('sell', item.id)">Продать · {{ priceText(item.incomeCp) }}</button>
              <small v-else class="muted">без цены</small>
            </li>
          </ul>
          <p v-else class="muted">Продавать нечего.</p>
        </div>
      </div>

      <details v-if="canManage" class="stock" @toggle="($event.target as HTMLDetailsElement).open && loadCatalogs()">
        <summary>Добавить на прилавок</summary>
        <label>Что
          <select v-model="addKind" :disabled="working">
            <option value="gear">Снаряжение из справочника SRD</option>
            <option value="magic">Магический предмет SRD (цена по редкости)</option>
            <option value="own">Свой предмет</option>
          </select>
        </label>
        <label v-if="addKind === 'gear'">Снаряжение
          <select v-model="gearPick" :disabled="working">
            <option value="">— выберите —</option>
            <optgroup v-for="group in gearGroups" :key="group.label" :label="group.label">
              <option v-for="item in group.items" :key="item.index" :value="item.index">{{ item.nameRu }} — {{ priceText(item.priceCp) }}</option>
            </optgroup>
          </select>
        </label>
        <label v-else-if="addKind === 'magic'">Предмет
          <select v-model="magicPick" :disabled="working">
            <option value="">— выберите —</option>
            <option v-for="item in magicSorted" :key="item.index" :value="item.index">{{ item.nameRu }} — {{ RARITY_LABELS[item.rarity] ?? item.rarity }}</option>
          </select>
        </label>
        <template v-else>
          <label>Название <input v-model="ownName" maxlength="100" placeholder="Карта сокровищ" :disabled="working" /></label>
          <div class="own-row">
            <label>Цена, зм <input v-model.number="ownGold" type="number" min="0" step="0.01" placeholder="25" :disabled="working" /></label>
            <label>Вес, фнт <input v-model.number="ownWeight" type="number" min="0" step="0.1" placeholder="—" :disabled="working" /></label>
          </div>
          <label>Описание <textarea v-model="ownText" rows="2" maxlength="2000" placeholder="Что это и что делает (видно в листе предмета)" :disabled="working" /></label>
        </template>
        <small class="muted">Цену любого товара можно поменять прямо в списке. Магические свойства своего предмета — в его листе («Магия»).</small>
        <button type="button" class="primary" :disabled="working || !canAdd" @click="addGood">Поставить на прилавок</button>
      </details>
    </section>
  </div>
</template>

<style scoped>
.modal-overlay{position:fixed;inset:0;z-index:3500;display:flex;align-items:center;justify-content:center;padding:24px;background:#0b0704cc}
.modal-card{width:min(820px,100%);max-height:88vh;overflow-y:auto;padding:20px 22px;background:var(--parchment-background);color:var(--ink);border:1px solid var(--brass);border-radius:6px;box-shadow:0 16px 40px #000a}
.shop header{display:flex;justify-content:space-between;align-items:center;gap:12px}
.shop h2{margin:0;font:700 24px var(--heading-font)}
.shop header button{min-height:30px;width:30px;padding:0}
.buyer{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0}
.columns{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
.columns h3{margin:6px 0;font-size:16px}
.columns ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.columns li{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:3px 0;border-bottom:1px solid var(--brass-light,#0002)}
.columns button{min-height:28px;padding:2px 10px;font-size:12px;white-space:nowrap}
.good-name{display:flex;flex-direction:column;min-width:0;flex:1}
.good-name small{display:block;margin:0;font-size:11px}
.price-edit{display:flex;align-items:center;gap:4px;white-space:nowrap}
.price-edit input{width:84px;min-height:28px;padding:2px 6px}
.stock{margin-top:14px;padding-top:10px;border-top:1px solid var(--brass-light,#0002)}
.stock summary{cursor:pointer;font-weight:700}
.stock label{display:flex;flex-direction:column;gap:3px;margin:8px 0;font-weight:600}
.stock .own-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.stock .primary{margin-top:8px}
.error{color:#c0392b;margin:0}
</style>
