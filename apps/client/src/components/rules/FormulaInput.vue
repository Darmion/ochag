<script setup lang="ts">
import { ref } from 'vue';

const model = defineModel<string>({ required: true });
defineProps<{ disabled?: boolean; placeholder?: string }>();

const input = ref<HTMLInputElement | null>(null);
const listId = `formula-examples-${Math.random().toString(36).slice(2, 8)}`;

const DICE = ['1d4', '1d6', '1d8', '1d10', '1d12', '1d20', '2d6'];
const TOKENS: Array<[string, string]> = [
  ['@str', 'модификатор Силы'], ['@dex', 'модификатор Ловкости'], ['@con', 'модификатор Телосложения'],
  ['@int', 'модификатор Интеллекта'], ['@wis', 'модификатор Мудрости'], ['@cha', 'модификатор Харизмы'],
  ['@prof', 'бонус мастерства'],
];
const EXAMPLES: Array<[string, string]> = [
  ['1d20+@dex+@prof', 'атака ловким оружием'],
  ['1d20+@str+@prof', 'атака силовым оружием'],
  ['1d8+@str', 'урон длинного меча'],
  ['1d6+@dex', 'урон короткого лука'],
  ['2d6+3', 'урон с бонусом'],
  ['1d20+@wis', 'проверка Мудрости'],
];

function insert(piece: string) {
  const element = input.value;
  const text = model.value ?? '';
  const start = element?.selectionStart ?? text.length;
  const end = element?.selectionEnd ?? text.length;
  const before = text.slice(0, start);
  const glue = piece.startsWith('@') && before && !/[+\-]$/.test(before) ? '+' : '';
  const diceGlue = !piece.startsWith('@') && before && !/[+\-]$/.test(before) ? '+' : '';
  const next = `${before}${glue || diceGlue}${piece}${text.slice(end)}`;
  model.value = next;
  requestAnimationFrame(() => {
    const caret = before.length + (glue || diceGlue).length + piece.length;
    element?.focus();
    element?.setSelectionRange(caret, caret);
  });
}
</script>

<template>
  <span class="formula-input">
    <input ref="input" v-model="model" :list="listId" :placeholder="placeholder ?? '1d20+@dex+@prof'" spellcheck="false" :disabled="disabled" />
    <datalist :id="listId">
      <option v-for="[formula, label] in EXAMPLES" :key="formula" :value="formula">{{ label }}</option>
    </datalist>
    <span class="formula-chips" aria-label="Вставить в формулу">
      <button v-for="die in DICE" :key="die" type="button" :disabled="disabled" :title="`Вставить ${die}`" @click="insert(die)">{{ die }}</button>
      <button v-for="[token, label] in TOKENS" :key="token" type="button" :disabled="disabled" :title="label" @click="insert(token)">{{ token }}</button>
    </span>
  </span>
</template>

<style scoped>
.formula-input{display:grid;gap:6px}
.formula-chips{display:flex;flex-wrap:wrap;gap:4px}
.formula-chips button{min-height:24px;padding:1px 8px;font-size:12px;font-family:ui-monospace,Consolas,monospace;text-transform:none;letter-spacing:0}
</style>
