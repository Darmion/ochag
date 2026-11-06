<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import ItemArt from '../rpg/ItemArt.vue';
import { itemArt } from '../../art/itemArt';

type LootItem = { id: string; name: string; contents_count: number };
type Wallet = { cp: number; sp: number; ep: number; gp: number; pp: number };

const props = defineProps<{
  campaignId: string;
  sceneId: string;
  corpse: { characterId: string; name: string };
  looter: { characterId: string; name: string };
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();

const emit = defineEmits<{ taken: [] }>();

const COINS: Array<[keyof Wallet, string]> = [['pp', 'пм'], ['gp', 'зм'], ['ep', 'эм'], ['sp', 'см'], ['cp', 'мм']];

const items = ref<LootItem[]>([]);
const coins = ref<Wallet | null>(null);
const loading = ref(false);
const working = ref(false);
const error = ref('');
const path = () => `/campaigns/${props.campaignId}/scenes/${props.sceneId}/loot/${props.corpse.characterId}`;

const SHARE_KEY = 'ttrpg.lootShare';
function readShare() {
  try {
    return localStorage.getItem(SHARE_KEY) === 'true';
  } catch {
    return false;
  }
}
const share = ref(readShare());
watch(share, value => {
  try {
    localStorage.setItem(SHARE_KEY, String(value));
  } catch {
  }
});
const sharedText = ref('');

const walletText = (wallet: Wallet) => COINS.filter(([coin]) => wallet[coin] > 0).map(([coin, label]) => `${wallet[coin]} ${label}`).join(' ');
const coinsText = computed(() => (coins.value ? walletText(coins.value) : ''));
const somethingLeft = computed(() => items.value.length > 0 || coinsText.value !== '');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const result = await props.request(`${path()}?looterId=${props.looter.characterId}`);
    items.value = result.items;
    coins.value = result.coins;
  } catch (cause) {
    items.value = [];
    coins.value = null;
    error.value = cause instanceof Error ? cause.message : 'Не удалось обыскать. Попробуйте ещё раз.';
  } finally {
    loading.value = false;
  }
}

async function take(choice?: { itemIds: string[]; coins?: boolean }) {
  working.value = true;
  error.value = '';
  sharedText.value = '';
  try {
    const withCoins = choice ? choice.coins === true : true;
    const result = await props.request(path(), 'POST', { looterId: props.looter.characterId, ...(choice ?? {}), ...(withCoins && share.value ? { share: true } : {}) });
    if (Array.isArray(result?.shares)) {
      sharedText.value = result.shares.map((entry: { name: string; coins: Wallet }) => `${entry.name} — ${walletText(entry.coins)}`).join('; ');
    }
    emit('taken');
    await load();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось взять. Попробуйте ещё раз.';
  } finally {
    working.value = false;
  }
}

onMounted(load);
watch(() => [props.corpse.characterId, props.looter.characterId], load);
</script>

<template>
  <div class="loot-panel">
    <p class="muted loot-who">{{ looter.name }} обыскивает «{{ corpse.name }}»</p>
    <p v-if="loading" class="muted">Обыскиваем…</p>
    <ul v-else-if="somethingLeft" class="loot-list">
      <li v-if="coinsText" class="loot-coins">
        <span class="item-line"><ItemArt :src="itemArt('Монеты')" :size="28" />Деньги: {{ coinsText }}</span>
        <button type="button" :disabled="working" @click="take({ itemIds: [], coins: true })">Взять</button>
      </li>
      <li v-for="item in items" :key="item.id">
        <span class="item-line"><ItemArt :name="item.name" :size="28" placeholder /><span>{{ item.name }}<small v-if="item.contents_count" class="muted"> (внутри: {{ item.contents_count }})</small></span></span>
        <button type="button" :disabled="working" @click="take({ itemIds: [item.id] })">Взять</button>
      </li>
    </ul>
    <p v-else-if="!error" class="muted">Больше ничего нет.</p>
    <label v-if="coinsText" class="checkbox-label loot-share" title="Деньги — поровну между живыми героями на сцене, союзными по фракции; каждая монета без размена, остаток — тому, кто обыскал">
      <input v-model="share" type="checkbox" :disabled="working" /> деньги поровну со своими
    </label>
    <button v-if="items.length + (coinsText ? 1 : 0) > 1" type="button" class="primary" :disabled="working" @click="take()">Забрать всё</button>
    <p v-if="sharedText" class="muted loot-shared" role="status">Поровну: {{ sharedText }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.loot-panel{display:grid;gap:6px}
.loot-who{margin:0;font-size:12px}
.loot-list{list-style:none;margin:0;padding:0;display:grid;gap:4px}
.loot-list li{display:flex;align-items:center;justify-content:space-between;gap:8px}
.loot-list button{min-height:28px;padding:2px 10px;font-size:13px}
.loot-coins span{color:var(--gold-light, #e9c46a)}
.item-line{display:flex;align-items:center;gap:6px;min-width:0}
.loot-share{font-size:13px}
.loot-shared{margin:0;font-size:12px}
</style>
