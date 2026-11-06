<script setup lang="ts">
import { computed, ref } from 'vue';

import type { SheetImporterInfo } from '../../characterImport/types';
import { modText } from '../../settings/modText';

const props = defineProps<{ campaigns: Array<{ id: string; name: string }>; busy: boolean; importers: SheetImporterInfo[] }>();
const emit = defineEmits<{ file: [importerId: string, file: File] }>();
const importerId = ref('');
const importer = computed(() => props.importers.find(entry => entry.id === importerId.value) ?? props.importers[0] ?? null);
const campaignId = defineModel<string>('campaignId', { required: true });
const targetCharacterId = defineModel<string>('targetCharacterId', { required: true });

function onFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';

  if (file && importer.value) emit('file', importer.value.id, file);
}
</script>

<template>
  <section class="panel game-import">
    <h2>Загрузить персонажа</h2>

    <p class="muted">
      Сначала появится предпросмотр. Загрузка файла сама по себе
      не изменяет персонажа.
    </p>

    <label>
      Кампания
      <select v-model="campaignId" :disabled="busy">
        <option value="" disabled>Выберите кампанию</option>
        <option
          v-for="campaign in campaigns"
          :key="campaign.id"
          :value="campaign.id"
        >
          {{ campaign.name }}
        </option>
      </select>
    </label>

    <p v-if="campaigns.length === 0" class="muted">
      Нет доступных кампаний. Создайте кампанию или вступите
      по приглашению мастера (форма выше).
    </p>

    <label>
      ID существующего персонажа — необязательно
      <input
        v-model="targetCharacterId"
        placeholder="Оставьте пустым для создания нового"
        :disabled="busy"
      />
    </label>

    <label v-if="importers.length > 1">
      Откуда лист
      <select v-model="importerId" :disabled="busy">
        <option v-for="entry in importers" :key="entry.id" :value="entry.id" translate="no">{{ modText(entry, 'name', entry.name) }}</option>
      </select>
    </label>

    <label v-if="importer">
      Файл: <span translate="no">{{ modText(importer, 'description', importer.description) }}</span>
      <input
        type="file"
        :accept="importer.extensions.join(',') || '.json'"
        :disabled="busy || !campaignId"
        @change="onFile"
      />
    </label>
    <p v-else class="muted">Импорт листов добавляют моды: мастер включает его в окне «Моды».</p>
  </section>
</template>
