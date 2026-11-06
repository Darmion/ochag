<script setup lang="ts">
import { confirmAction } from '../../ui/confirmDialog';
import { onMounted, ref } from 'vue';

type Entry = { id: string; title: string; body: string; started_at: string | null; ended_at: string; published: boolean; revision: number };

const props = defineProps<{
  campaignId: string;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();

const entries = ref<Entry[]>([]);
const canManage = ref(false);
const sessionStartedAt = ref<string | null>(null);
const editing = ref<{ id: string; title: string; body: string; revision: number } | null>(null);
const working = ref(false);
const error = ref('');
const notice = ref('');

const base = () => `/campaigns/${props.campaignId}`;

async function load() {
  try {
    const result = await props.request(`${base()}/chronicle`);
    entries.value = result.entries;
    canManage.value = result.canManage;
    sessionStartedAt.value = result.sessionStartedAt;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}

async function run(action: () => Promise<string | void>) {
  working.value = true;
  error.value = '';
  notice.value = '';
  try {
    notice.value = (await action()) ?? '';
    await load();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    working.value = false;
  }
}

const startSession = () => run(async () => {
  const result = await props.request(`${base()}/session/start`, 'POST', {});
  return result.previous ? 'Сессия началась — у всех открылось «В прошлый раз».' : 'Сессия началась.';
});

const endSession = () => run(async () => {
  const result = await props.request(`${base()}/session/end`, 'POST', {});
  const entry = result.entry as Entry;
  editing.value = { id: entry.id, title: entry.title, body: entry.body, revision: entry.revision };
  return 'Черновик пересказа готов — поправьте и опубликуйте.';
});

const save = (publish?: boolean) => run(async () => {
  const value = editing.value;
  if (!value) return;
  await props.request(`${base()}/chronicle/${value.id}`, 'PATCH', {
    title: value.title.trim(), body: value.body, revision: value.revision, ...(publish !== undefined ? { published: publish } : {}),
  });
  editing.value = null;
  return publish ? 'Опубликовано — игроки видят в хронике.' : 'Сохранено.';
});

const togglePublished = (entry: Entry) => run(async () => {
  await props.request(`${base()}/chronicle/${entry.id}`, 'PATCH', { published: !entry.published, revision: entry.revision });
});

const show = (entry: Entry) => run(async () => {
  await props.request(`${base()}/chronicle/${entry.id}/show`, 'POST', {});
  return 'Показано всем.';
});

const remove = async (entry: Entry) => {
  if (!(await confirmAction(`Удалить запись «${entry.title}»?`, { title: 'Удалить', confirmLabel: 'Удалить', danger: true }))) return;
  void run(async () => { await props.request(`${base()}/chronicle/${entry.id}`, 'DELETE'); });
};

const time = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

onMounted(load);
</script>

<template>
  <div class="chronicle">
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="notice" class="notice-line">{{ notice }}</p>

    <div v-if="canManage" class="session">
      <template v-if="sessionStartedAt">
        <span>Сессия идёт с {{ time(sessionStartedAt) }}</span>
        <button type="button" class="primary" :disabled="working" @click="endSession">Завершить сессию</button>
      </template>
      <template v-else>
        <button type="button" class="primary" :disabled="working" @click="startSession">Начать сессию</button>
        <small class="muted">У всех откроется «В прошлый раз…» — последний опубликованный пересказ.</small>
      </template>
    </div>

    <div v-if="editing" class="editor">
      <label>Заголовок <input v-model="editing.title" maxlength="160" /></label>
      <label>Пересказ <textarea v-model="editing.body" rows="9" maxlength="20000" /></label>
      <div class="row-actions">
        <button type="button" class="primary" :disabled="working" @click="save(true)">Сохранить и опубликовать</button>
        <button type="button" :disabled="working" @click="save()">Сохранить черновик</button>
        <button type="button" :disabled="working" @click="editing = null">Отмена</button>
      </div>
    </div>

    <ul v-if="entries.length" class="entries">
      <li v-for="entry in entries" :key="entry.id">
        <header>
          <strong>{{ entry.title }}</strong>
          <small v-if="canManage" class="muted">{{ entry.published ? 'опубликовано' : 'черновик' }}</small>
        </header>
        <p class="body">{{ entry.body }}</p>
        <span v-if="canManage" class="row-actions">
          <button type="button" :disabled="working" @click="editing = { id: entry.id, title: entry.title, body: entry.body, revision: entry.revision }">Править</button>
          <button type="button" :disabled="working" @click="togglePublished(entry)">{{ entry.published ? 'Скрыть' : 'Опубликовать' }}</button>
          <button type="button" :disabled="working" @click="show(entry)">Показать всем</button>
          <button type="button" :disabled="working" @click="remove(entry)">Удалить</button>
        </span>
      </li>
    </ul>
    <p v-else class="muted">{{ canManage ? 'Пересказов пока нет — завершите сессию, и черновик соберётся сам.' : 'Мастер ещё не записал хронику.' }}</p>
  </div>
</template>

<style scoped>
.chronicle{display:flex;flex-direction:column;gap:10px;font-size:13px}
.session{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.editor{display:flex;flex-direction:column;gap:6px}
.editor label{display:flex;flex-direction:column;gap:2px;margin:0}
.entries{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.entries li{display:flex;flex-direction:column;gap:4px;padding-bottom:8px;border-bottom:1px solid var(--brass-light,#0002)}
.entries header{display:flex;gap:8px;align-items:baseline}
.body{margin:0;white-space:pre-line;line-height:1.45}
.row-actions{display:flex;gap:6px;flex-wrap:wrap}
.row-actions button,.session button{min-height:28px;padding:2px 10px;font-size:12px}
.notice-line{margin:0;color:var(--g-gold,#8a6a35)}
.error{color:#c0392b;margin:0}
</style>
