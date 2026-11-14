<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { coinArt } from '../../../art/itemArt';
import { priceLabel } from '../../../inventory/icons';
import InvPopover from './InvPopover.vue';

type Wallet = Record<'cp' | 'sp' | 'ep' | 'gp' | 'pp', number>;
const props = defineProps<{
  wallet: Wallet;
  revision: number;
  campaignId: string;
  characterId: string;
  editable: boolean;
  party: Array<{ id: string; name: string }>;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();
const emit = defineEmits<{ changed: [message: string] }>();

const COINS: Array<[keyof Wallet, string]> = [['pp', 'пм'], ['gp', 'зм'], ['ep', 'эм'], ['sp', 'см'], ['cp', 'мм']];
const VALUE: Record<keyof Wallet, number> = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 };
const coins = ref<Wallet>({ ...props.wallet });
watch(() => props.wallet, value => { coins.value = { ...value }; }, { deep: true });
const total = computed(() => COINS.reduce((sum, [coin]) => sum + Math.max(0, Number(props.wallet[coin]) || 0) * VALUE[coin], 0));
const dirty = computed(() => COINS.some(([coin]) => coins.value[coin] !== props.wallet[coin]));
const giveTo = ref('');
const giveGold = ref<number | ''>('');
const working = ref(false);
const error = ref('');

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
const save = () => run(async () => {
  const clean = Object.fromEntries(COINS.map(([coin]) => [coin, Math.max(0, Math.round(Number(coins.value[coin]) || 0))]));
  await props.request(`/campaigns/${props.campaignId}/characters/${props.characterId}`, 'PATCH', { revision: props.revision, coins: clean });
  return 'Кошелёк сохранён';
});
const give = () => run(async () => {
  const amountCp = Math.round(Number(giveGold.value) * 100);
  await props.request(`/campaigns/${props.campaignId}/characters/${props.characterId}/coins/give`, 'POST', { toCharacterId: giveTo.value, amountCp });
  giveGold.value = '';
  return `Передано: ${priceLabel(amountCp)}`;
});
</script>

<template>
  <InvPopover title="Кошелёк" align="right" up>
    <template #button><img v-if="coinArt('gp')" class="coin-icon" :src="coinArt('gp')!" alt="" />Кошелёк: {{ priceLabel(total) }} ▾</template>
    <div class="wallet-coins">
      <label v-for="[coin, label] in COINS" :key="coin">
        <span><img v-if="coinArt(coin)" :src="coinArt(coin)!" alt="" />{{ label }}</span>
        <input v-if="editable" v-model.number="coins[coin]" type="number" min="0" :disabled="working" />
        <b v-else>{{ wallet[coin] }}</b>
      </label>
    </div>
    <button v-if="editable" type="button" class="primary" :disabled="working || !dirty" @click="save">Сохранить кошелёк</button>
    <div v-if="editable && party.length" class="wallet-give">
      <select v-model="giveTo" aria-label="Кому"><option value="">— передать деньги —</option><option v-for="member in party" :key="member.id" :value="member.id">{{ member.name }}</option></select>
      <input v-model.number="giveGold" type="number" min="0.01" step="0.01" placeholder="зм" aria-label="Сколько, зм" />
      <button type="button" :disabled="working || !giveTo || !giveGold" @click="give">Передать</button>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </InvPopover>
</template>

<style scoped>
.coin-icon{width:16px;height:16px;margin-right:6px;vertical-align:-3px}
.wallet-coins{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}
.wallet-coins label{display:flex;flex-direction:column;align-items:center;gap:3px;margin:0;font-size:12px}
.wallet-coins label span{display:inline-flex;align-items:center;gap:3px}
.wallet-coins img{width:14px;height:14px}
.wallet-coins input{width:100%;min-height:30px;text-align:center;padding:2px}
.wallet-give{display:grid;grid-template-columns:1fr 70px auto;gap:6px}
.wallet-give button{min-height:30px;padding:2px 10px}
</style>
