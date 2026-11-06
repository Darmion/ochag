<script setup lang="ts">
defineProps<{ roster: Array<{ userId: string; displayName: string }>; open: boolean }>();
const target = defineModel<string>('target', { required: true });
const emit = defineEmits<{ submit: []; close: []; cancel: [] }>();
</script>

<template>
  <form class="text-entry" @submit.prevent="emit('submit')">
    <label>
      Чьими глазами показать карту
      <select v-model="target">
        <option v-for="member in roster" :key="member.userId" :value="member.userId">{{ member.displayName }}</option>
      </select>
    </label>
    <button type="submit" class="primary" :disabled="!target">{{ open ? 'Показать' : 'Открыть окно' }}</button>
    <button v-if="open" type="button" @click="emit('close')">Закрыть окно</button>
    <button type="button" @click="emit('cancel')">Отмена</button>
    <small class="muted">
      Окно откроется на втором мониторе (проекторе) во весь экран, если он подключён.
      Туман, скрытые объекты и хиты — как у выбранного игрока. Сцена меняется вместе с вашей.
    </small>
  </form>
</template>

<style scoped src="./boardForm.css"></style>
