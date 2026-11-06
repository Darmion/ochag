<script setup lang="ts">
defineProps<{ editing: boolean; colors: string[]; busy: boolean }>();
const text = defineModel<string>('text', { required: true });
const labelColor = defineModel<string>('color', { required: true });
const emit = defineEmits<{ submit: []; move: []; delete: []; cancel: [] }>();
</script>

<template>
  <form class="text-entry" @submit.prevent="emit('submit')">
    <label>
      {{ editing ? 'Изменить подпись' : 'Текст подписи' }}
      <input v-model="text" maxlength="200" autofocus placeholder="Например: Вход в пещеру" />
    </label>
    <span v-if="editing" class="color-swatches" role="radiogroup" aria-label="Цвет подписи">
      <button
        v-for="color in colors" :key="color" type="button" class="swatch" role="radio"
        :aria-checked="labelColor === color" :aria-label="`Цвет ${color}`" :style="{ background: color }"
        @click="labelColor = color"
      />
    </span>
    <button type="submit" class="primary" :disabled="busy || !text.trim()">{{ editing ? 'Сохранить' : 'Поставить' }}</button>
    <template v-if="editing">
      <button type="button" :disabled="busy" title="Следующий щелчок по карте — новое место" @click="emit('move')">Переставить</button>
      <button type="button" :disabled="busy" @click="emit('delete')">Удалить</button>
    </template>
    <button type="button" @click="emit('cancel')">Отмена</button>
  </form>
</template>

<style scoped src="./boardForm.css"></style>
<style scoped>
.color-swatches{display:inline-flex;gap:3px;align-items:center}
</style>
