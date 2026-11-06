<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { findFormulas } from '../../rules/dice';
import GameIcon from '../game/GameIcon.vue';

type NoteSummary = {
  id: string;
  title: string;
  created_by: string;
  revision: number;
  grantedUsers?: Array<{ userId: string; displayName: string }>;
};

type NoteFull = NoteSummary & { body: string };

const props = defineProps<{
  notes: NoteSummary[];
  canManage: boolean;
  busy: boolean;
  loadNote: (noteId: string) => Promise<NoteFull>;
  createNote: (payload: { title: string; body: string }) => Promise<void>;
  saveNote: (payload: { noteId: string; body: string; revision: number }) => Promise<void>;
  removeNote: (noteId: string) => Promise<void>;
  grantAccess: (payload: { noteId: string; username: string }) => Promise<void>;
  revokeAccess: (payload: { noteId: string; userId: string }) => Promise<void>;
  openRequest?: { noteId: string; nonce: number } | null;
}>();

const emit = defineEmits<{ roll: [payload: { formula: string; label: string }] }>();

const selectedId = ref('');
const selected = ref<NoteFull | null>(null);
const editBody = ref('');
const grantUsername = ref('');

const noteFormulas = computed(() => (selected.value ? findFormulas(props.canManage ? editBody.value : selected.value.body) : []));

const newTitle = ref('');
const newBody = ref('');

async function selectNote(noteId: string) {
  selectedId.value = noteId;
  selected.value = null;

  if (!noteId) return;

  const full = await props.loadNote(noteId);
  const summary = props.notes.find(n => n.id === noteId);
  selected.value = { ...full, grantedUsers: summary?.grantedUsers };
  editBody.value = selected.value.body;
}

watch(
  () => props.notes,
  () => {
    if (selectedId.value && !props.notes.some(n => n.id === selectedId.value)) {
      selectedId.value = '';
      selected.value = null;
    }
  },
);

watch(
  () => props.openRequest?.nonce,
  () => {
    if (props.openRequest) void selectNote(props.openRequest.noteId);
  },
  { immediate: true },
);

async function submitCreate() {
  if (!newTitle.value.trim()) return;
  await props.createNote({ title: newTitle.value.trim(), body: newBody.value });
  newTitle.value = '';
  newBody.value = '';
}

async function submitSave() {
  if (!selected.value) return;
  await props.saveNote({ noteId: selected.value.id, body: editBody.value, revision: selected.value.revision });
  await selectNote(selected.value.id);
}

async function submitRemove() {
  if (!selected.value) return;
  await props.removeNote(selected.value.id);
}

async function submitGrant() {
  if (!selected.value || !grantUsername.value.trim()) return;
  const noteId = selected.value.id;
  await props.grantAccess({ noteId, username: grantUsername.value.trim() });
  grantUsername.value = '';
  await selectNote(noteId);
}

async function submitRevoke(userId: string) {
  if (!selected.value) return;
  const noteId = selected.value.id;
  await props.revokeAccess({ noteId, userId });
  await selectNote(noteId);
}
</script>

<template>
  <div class="notes-panel">
    <details v-if="canManage">
      <summary>Новая заметка</summary>

      <label>
        Заголовок
        <input v-model="newTitle" maxlength="200" :disabled="busy" />
      </label>

      <label>
        Текст
        <textarea v-model="newBody" rows="4" :disabled="busy" />
      </label>

      <button type="button" :disabled="busy || !newTitle.trim()" @click="submitCreate">
        Создать
      </button>
    </details>

    <label>
      Заметка
      <select :value="selectedId" :disabled="busy" @change="selectNote(($event.target as HTMLSelectElement).value)">
        <option value="">— не выбрана —</option>
        <option v-for="note in notes" :key="note.id" :value="note.id">
          {{ note.title }}
        </option>
      </select>
    </label>

    <p v-if="!notes.length" class="muted">Заметок пока нет.</p>

    <template v-if="selected">
      <h3>{{ selected.title }}</h3>

      <template v-if="canManage">
        <label>
          Текст
          <textarea v-model="editBody" rows="8" :disabled="busy" />
        </label>

        <button type="button" :disabled="busy" @click="submitSave">Сохранить</button>
        <button type="button" :disabled="busy" @click="submitRemove">Удалить</button>

        <details>
          <summary>Доступ</summary>

          <ul v-if="selected.grantedUsers?.length" class="grant-list">
            <li v-for="grant in selected.grantedUsers" :key="grant.userId">
              {{ grant.displayName }}
              <button type="button" :disabled="busy" @click="submitRevoke(grant.userId)">
                Отозвать
              </button>
            </li>
          </ul>
          <p v-else class="muted">Доступ никому не выдан — заметка видна только мастеру.</p>

          <label>
            Выдать доступ по логину игрока
            <input v-model="grantUsername" placeholder="Логин" autocomplete="off" :disabled="busy" />
          </label>
          <button type="button" :disabled="busy || !grantUsername.trim()" @click="submitGrant">
            Выдать доступ
          </button>
        </details>
      </template>

      <template v-else>
        <p class="note-body" translate="no">{{ selected.body }}</p>
        <p class="muted">Эта заметка доступна вам только для чтения.</p>
      </template>

      <div v-if="noteFormulas.length" class="note-rolls" aria-label="Броски из заметки">
        <span class="muted">Бросить:</span>
        <button
          v-for="formula in noteFormulas"
          :key="formula"
          type="button"
          :disabled="busy"
          @click="emit('roll', { formula, label: selected.title })"
        >
          <GameIcon class="inline-icon" name="d20" :size="16" /> {{ formula }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.note-rolls{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:8px 0}
.note-rolls button{min-height:30px;padding:2px 8px;font:600 13px Georgia,"Times New Roman",serif}
.notes-panel details{margin-bottom:14px}
.notes-panel textarea{width:100%;font-family:inherit}
.note-body{white-space:pre-wrap;line-height:1.5;padding:10px;border:1px solid var(--brass-light);background:var(--surface-inset);border-radius:3px}
.grant-list{list-style:none;padding:0;margin:0 0 12px}
.grant-list li{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--brass-light)}
.muted{font-size:13px}
</style>
