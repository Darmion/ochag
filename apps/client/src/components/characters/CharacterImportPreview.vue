<script setup lang="ts">
import type { Draft } from '../../characterImport/types';
import { differs, display } from '../../characterImport/values';

defineProps<{
  draft: Draft;
  proposal: Record<string, any>;
  keepCurrent: Record<string, boolean>;
  busy: boolean;
}>();
const emit = defineEmits<{ editField: [key: string, event: Event]; confirm: []; cancel: [] }>();
const extrasText = defineModel<string>('extrasText', { required: true });
const keepCurrentExtras = defineModel<boolean>('keepCurrentExtras', { required: true });
</script>

<template>
  <section
    class="panel preview"
    aria-labelledby="preview-title"
  >
    <h2 id="preview-title">Предпросмотр импорта</h2>

    <p class="muted">
      Исправьте предлагаемые значения перед сохранением.
      При обновлении можно оставить отдельные текущие значения.
    </p>

    <ul class="warnings">
      <li v-for="warning in draft.warnings" :key="warning">
        {{ warning }}
      </li>
    </ul>

    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Поле</th>
            <th>Из файла</th>
            <th v-if="draft.current">Сейчас</th>
            <th>Для игры</th>
            <th v-if="draft.current">Оставить текущее</th>
          </tr>
        </thead>

        <tbody>
          <tr
            v-for="row in draft.field_mapping"
            :key="row.key"
            :class="{ changed: differs(draft, proposal, keepCurrent, row.key) }"
          >
            <td>
              <strong>{{ row.label }}</strong>
              <small>{{ row.sourcePath }}</small>
            </td>

            <td>{{ display(row.sourceValue) }}</td>

            <td v-if="draft.current">
              {{ display(draft.current[row.key]) }}
            </td>

            <td>
              <input
                :aria-label="row.label"
                :type="row.key === 'name' ? 'text' : 'number'"
                :step="row.key === 'speed_feet' ? 'any' : '1'"
                :value="proposal[row.key] ?? ''"
                :disabled="busy || keepCurrent[row.key]"
                @input="emit('editField', row.key, $event)"
              />
            </td>

            <td v-if="draft.current">
              <input
                v-model="keepCurrent[row.key]"
                type="checkbox"
                :aria-label="`Оставить текущее: ${row.label}`"
                :disabled="busy"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <details class="extras">
      <summary>
        Навыки, спасброски, оружие и дополнительные данные
      </summary>

      <p class="muted">
        На этом этапе сложные данные редактируются как JSON.
        Текстовые способности сохраняются без автоматического
        применения эффектов.
      </p>

      <label v-if="draft.current" class="checkbox-label">
        <input
          v-model="keepCurrentExtras"
          type="checkbox"
          :disabled="busy"
        />
        Сохранить текущие дополнительные данные целиком
      </label>

      <label>
        Данные для игры
        <textarea
          v-model="extrasText"
          rows="20"
          spellcheck="false"
          :disabled="busy || keepCurrentExtras"
        />
      </label>

      <details v-if="draft.current">
        <summary>Текущие дополнительные данные</summary>
        <pre>{{ JSON.stringify(draft.current.sheet_extra, null, 2) }}</pre>
      </details>
    </details>

    <footer>
      <button :disabled="busy" @click="emit('cancel')">
        Отменить
      </button>

      <button
        class="primary"
        :disabled="busy"
        @click="emit('confirm')"
      >
        {{ busy ? 'Сохранение…' : 'Подтвердить импорт' }}
      </button>
    </footer>
  </section>
</template>
