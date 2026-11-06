<script setup lang="ts">
defineProps<{ notes: Array<{ id: string; title: string }>; busy: boolean }>();
const noteId = defineModel<string>('noteId', { required: true });
const emit = defineEmits<{ submit: []; cancel: [] }>();
</script>

<template>
  <form class="text-entry" @submit.prevent="emit('submit')">
    <label>
      Какую заметку приколоть
      <select v-model="noteId">
        <option v-for="note in notes" :key="note.id" :value="note.id">{{ note.title }}</option>
      </select>
    </label>
    <button type="submit" class="primary" :disabled="busy || !noteId">Приколоть</button>
    <button type="button" @click="emit('cancel')">Отмена</button>
    <small v-if="!notes.length" class="muted">Сначала создайте заметку в панели «Заметки мастера».</small>
  </form>
</template>

<style scoped src="./boardForm.css"></style>
