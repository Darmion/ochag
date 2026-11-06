<script setup lang="ts">
import { ref } from 'vue';
import GameIcon from '../game/GameIcon.vue';

export type TableCounter = {
  id: string;
  name: string;
  kind: 'counter' | 'rounds';
  value: number;
  hidden: boolean;
  can_edit: boolean;
  author_name: string;
};

defineProps<{ counters: TableCounter[]; busy: boolean; readonly?: boolean; embedded?: boolean }>();

const emit = defineEmits<{
  change: [payload: { id: string; delta: number }];
  remove: [counter: TableCounter];
  create: [payload: { name: string; kind: 'counter' | 'rounds'; value: number; hidden: boolean }];
}>();

const formOpen = ref(false);
const name = ref('');
const kind = ref<'counter' | 'rounds'>('rounds');
const value = ref(10);
const hidden = ref(false);

function submit() {
  const amount = Math.round(Number(value.value) || 0);
  if (!name.value.trim() || (kind.value === 'rounds' && amount < 1)) return;
  emit('create', { name: name.value.trim(), kind: kind.value, value: amount, hidden: hidden.value });
  name.value = '';
  formOpen.value = false;
}

function rounds(count: number) {
  const last = count % 10, lastTwo = count % 100;
  if (last === 1 && lastTwo !== 11) return `${count} раунд`;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return `${count} раунда`;
  return `${count} раундов`;
}
</script>

<template>
  <div class="table-counters" :class="{ embedded }" aria-label="Счётчики и таймеры">
    <div
      v-for="counter in counters"
      :key="counter.id"
      class="counter-chip"
      :class="{ 'is-expired': counter.kind === 'rounds' && counter.value === 0, 'is-hidden': counter.hidden }"
      :title="`${counter.kind === 'rounds' ? 'Таймер по раундам боя' : 'Счётчик'} · завёл ${counter.author_name}${counter.hidden ? ' · виден только автору и мастеру' : ''}`"
    >
      <span class="counter-icon" aria-hidden="true"><GameIcon v-if="counter.kind === 'rounds'" class="inline-icon" name="hourglass" :size="16" /><template v-else>#</template></span>
      <span class="counter-name">{{ counter.name }}</span>
      <strong class="counter-value">
        {{ counter.kind === 'rounds' ? (counter.value === 0 ? 'время вышло' : rounds(counter.value)) : counter.value }}
      </strong>
      <template v-if="counter.can_edit && !readonly">
        <button type="button" :disabled="busy" aria-label="Уменьшить" @click="emit('change', { id: counter.id, delta: -1 })">−</button>
        <button type="button" :disabled="busy" aria-label="Увеличить" @click="emit('change', { id: counter.id, delta: 1 })">+</button>
        <button type="button" :disabled="busy" aria-label="Убрать" @click="emit('remove', counter)">×</button>
      </template>
    </div>

    <button
      v-if="!formOpen && !readonly"
      type="button"
      class="counter-add"
      :title="'Счётчик или таймер по раундам: длительность эффекта, ритуал, заряды'"
      @click="formOpen = true"
    >
      <GameIcon class="inline-icon" name="hourglass" :size="16" /> +
    </button>

    <form v-else-if="formOpen && !readonly" class="counter-form" @submit.prevent="submit">
      <input v-model="name" maxlength="60" placeholder="Ритуал, Благословение…" aria-label="Название" autofocus />
      <select v-model="kind" aria-label="Вид">
        <option value="rounds">таймер, раундов</option>
        <option value="counter">счётчик</option>
      </select>
      <input v-model.number="value" type="number" :min="kind === 'rounds' ? 1 : -9999" max="9999" aria-label="Значение" />
      <label class="checkbox-label"><input v-model="hidden" type="checkbox" /> скрыт</label>
      <button type="submit" class="primary" :disabled="busy || !name.trim()">Добавить</button>
      <button type="button" @click="formOpen = false">Отмена</button>
    </form>
  </div>
</template>

<style scoped>
.table-counters{position:absolute;left:12px;top:12px;z-index:2;display:flex;flex-wrap:wrap;gap:6px;max-width:calc(100% - 24px);pointer-events:none}
.counter-chip,.counter-add,.counter-form{pointer-events:auto}
.table-counters.embedded{position:static;max-width:none;z-index:auto}
.table-counters.embedded .counter-chip,.table-counters.embedded .counter-add{box-shadow:none;font-size:12px}
.table-counters.embedded .counter-add{min-height:24px;padding:1px 8px}
.counter-chip{display:flex;align-items:center;gap:6px;padding:3px 4px 3px 8px;background:#1a120be6;color:#f1e4c5;border:1px solid var(--brass, #a68148);border-radius:4px;font-size:13px;box-shadow:0 2px 6px #0008}
.counter-chip.is-hidden{border-style:dashed;font-style:italic}
.counter-chip.is-expired{border-color:#c4504f;background:#3a1414e6}
.counter-chip.is-expired .counter-value{color:#f09a9a}
.counter-icon{opacity:.85}
.counter-value{color:#f5c469;font-variant-numeric:tabular-nums}
.counter-chip button{min-width:24px;min-height:24px;padding:0 4px;font-size:14px;line-height:1}
.counter-add{min-height:28px;padding:2px 10px;font-size:13px;background:#1a120be6;color:#f1e4c5}
.counter-form{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 8px;background:#1a120bf0;color:#f1e4c5;border:1px solid var(--brass, #a68148);border-radius:4px}
.counter-form input[type="number"]{width:72px}
.counter-form input:not([type]){width:170px}
.counter-form .checkbox-label{margin:0;color:#f1e4c5;font-size:13px}
</style>
