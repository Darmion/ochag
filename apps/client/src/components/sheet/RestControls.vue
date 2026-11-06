<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { hitDiceSummary, type HitDiceView } from '../../rules/hitDice';
import GameIcon from '../game/GameIcon.vue';

export type { HitDiceView } from '../../rules/hitDice';

const props = defineProps<{
  campaignId: string;
  characterId: string;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
  hitDice: HitDiceView | null;
  disabled?: boolean;
}>();

const emit = defineEmits<{ rested: [summary: string] }>();

const count = ref(1);
const working = ref(false);
const error = ref('');
const left = computed(() => props.hitDice?.left ?? 0);
watch(left, value => { count.value = Math.min(Math.max(count.value, value ? 1 : 0), value); }, { immediate: true });

async function rest(body: Record<string, unknown>) {
  working.value = true;
  error.value = '';
  try {
    const { summary } = await props.request(`/campaigns/${props.campaignId}/characters/${props.characterId}/rest`, 'POST', body);
    emit('rested', summary);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Отдохнуть не вышло.';
  } finally {
    working.value = false;
  }
}
</script>

<template>
  <div class="rest-controls" @input.stop @change.stop>
    <p v-if="hitDice" class="hit-dice" :title="hitDice.pools && hitDice.pools.length > 1 ? 'Тратятся сначала крупные кости, долгий отдых возвращает тоже крупные' : undefined">
      Кости хитов: <strong>{{ hitDiceSummary(hitDice) }}</strong>
    </p>
    <div class="rest-row">
      <label class="rest-count" title="Сколько костей хитов потратить: каждая — бросок + модификатор Телосложения">
        Костей
        <input v-model.number="count" type="number" min="0" :max="left" :disabled="disabled || working || !left" />
      </label>
      <button type="button" :disabled="disabled || working" @click="rest({ kind: 'short', hitDice: Math.max(0, Math.min(left, count || 0)) })">
        <GameIcon class="ui-icon" name="cup" :size="20" />Короткий отдых
      </button>
      <button type="button" :disabled="disabled || working || !left" title="Тратить кости, пока хиты не полны" @click="rest({ kind: 'short', autoHitDice: true })">
        Сколько нужно
      </button>
      <button type="button" class="primary" :disabled="disabled || working" title="Все хиты, половина костей хитов, ячейки, ресурсы, истощение −1" @click="rest({ kind: 'long' })">
        <GameIcon class="ui-icon" name="moon" :size="20" />Долгий отдых
      </button>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.rest-controls{display:grid;gap:6px}
.hit-dice{margin:0}
.rest-row{display:flex;flex-wrap:wrap;gap:6px;align-items:end}
.rest-count{margin:0;font-size:12px;width:70px}
.rest-count input{min-height:32px;padding:2px 6px}
.rest-row button{display:inline-flex;align-items:center;gap:6px;min-height:32px;padding:2px 10px;font-size:13px}
</style>
