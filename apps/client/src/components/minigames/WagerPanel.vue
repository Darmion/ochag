<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { COIN_VALUE, priceText, type Coin } from '../../../../../packages/domain/character/coins';
import type { Wager } from '../../../../../packages/domain/minigames/wagers';
import type { CheckActor } from '../../../../../packages/domain/minigames/skill-checks';
// A stake before the game starts (roadmap 4.6): the host names it, each player agrees with a hero whose purse pays.
const props = defineProps<{
  wager: Wager | null | undefined; players: { id: string; name: string }[]; userId: string; host: boolean; actors: CheckActor[]; busy: boolean;
}>();
const emit = defineEmits<{ stake: [cp: number]; agree: [heroId: string]; withdraw: [] }>();
const amount = ref(5), coin = ref<Coin>('gp');
const heroId = ref('');
watch(() => props.actors, list => { if (!list.some(actor => actor.id === heroId.value)) heroId.value = list[0]?.id ?? ''; }, { immediate: true });
const joined = computed(() => props.players.some(player => player.id === props.userId));
const mine = computed(() => props.wager?.seats.find(seat => seat.userId === props.userId) ?? null);
const seatOf = (userId: string) => props.wager?.seats.find(seat => seat.userId === userId) ?? null;
</script>

<template>
  <details class="wager" :open="Boolean(wager) || undefined">
    <summary>Ставка: {{ wager ? `${priceText(wager.stakeCp)} с каждого` : 'без ставки' }}</summary>
    <form v-if="host" class="stake" @submit.prevent="emit('stake', Math.round(amount * COIN_VALUE[coin]))">
      <label>Сколько<input v-model.number="amount" type="number" min="1" max="1000" required :disabled="busy" /></label>
      <label>Монеты
        <select v-model="coin" :disabled="busy">
          <option value="gp">зм</option>
          <option value="sp">см</option>
          <option value="cp">мм</option>
        </select>
      </label>
      <button type="submit" :disabled="busy">{{ wager ? 'Изменить ставку' : 'Назначить ставку' }}</button>
      <button v-if="wager" type="button" :disabled="busy" @click="emit('stake', 0)">Играть без ставки</button>
    </form>
    <template v-if="wager">
      <p class="note">Монеты спишутся из кошелька выбранного героя, когда игра начнётся. Победитель забирает банк; без победителя ставки вернутся. Новая ставка снимает прежние согласия.</p>
      <ul class="seats">
        <li v-for="player in players" :key="player.id" :class="{ agreed: seatOf(player.id) }">
          <span translate="no">{{ player.name }}</span>
          <small v-if="seatOf(player.id)">согласие дано · кошелёк <span translate="no">«{{ seatOf(player.id)!.heroName }}»</span></small>
          <small v-else>ждём согласия</small>
        </li>
      </ul>
      <p v-if="mine" class="mine">Вы ставите {{ priceText(wager.stakeCp) }} из кошелька <b translate="no">«{{ mine.heroName }}»</b>.
        <button type="button" :disabled="busy" @click="emit('withdraw')">Отказаться</button>
      </p>
      <div v-else-if="joined" class="agree">
        <label>Из кошелька
          <select v-model="heroId" :disabled="busy || !actors.length">
            <option v-for="actor in actors" :key="actor.id" :value="actor.id" translate="no">{{ actor.name }}</option>
          </select>
        </label>
        <button type="button" class="primary" :disabled="busy || !heroId" @click="emit('agree', heroId)">Поставить {{ priceText(wager.stakeCp) }}</button>
        <small v-if="!actors.length">У вас нет героя в этой кампании.</small>
      </div>
    </template>
  </details>
</template>

<style scoped>
.wager{margin:12px 0;padding:10px 14px;border:1px solid var(--brass-light);border-radius:8px;background:var(--surface-inset);text-align:left}
.wager summary{cursor:pointer;font-size:13px;font-weight:700}
.stake,.agree{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:end;margin-top:10px}
.stake label,.agree label{display:grid;gap:4px;font-size:12px}
.stake input{width:80px}
.note,.mine{font-size:12px;line-height:1.5;margin:10px 0 0}
.seats{list-style:none;padding:0;margin:8px 0 0;display:grid;gap:4px;font-size:13px}
.seats li{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 10px;padding:4px 8px;border-left:2px solid var(--brass-light)}
.seats li.agreed{border-left-color:var(--g-good,var(--brass))}
.seats small,.agree small{color:var(--muted-ink);font-size:12px}
</style>
