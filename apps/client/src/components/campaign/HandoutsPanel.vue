<script setup lang="ts">
import { confirmAction } from '../../ui/confirmDialog';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { emitCampaignEvent, onCampaignEvent } from '../../campaign/campaignEvents';
import type { Handout } from './HandoutViewer.vue';
import GameIcon from '../game/GameIcon.vue';

type Row = { id: string; title: string; body: string | null; asset_id: string | null; created_at: string; shown_at?: string; recipients?: Array<{ userId: string }> };
type Member = { userId: string; displayName: string };

const props = defineProps<{
  campaignId: string;
  currentUserId: string;
  request: (path: string, method?: string, body?: unknown, file?: File) => Promise<any>;
}>();

const handouts = ref<Row[]>([]);
const canManage = ref(false);
const members = ref<Member[]>([]);
const working = ref(false);
const error = ref('');
const title = ref('');
const body = ref('');
const imageFile = ref<File | null>(null);
const audience = ref<'all' | 'some'>('all');
const chosen = ref<string[]>([]);

const base = () => `/campaigns/${props.campaignId}/handouts`;

async function load() {
  try {
    const result = await props.request(base());
    handouts.value = result.handouts;
    canManage.value = result.canManage;
    if (canManage.value && !members.value.length) {
      const roster = await props.request(`/campaigns/${props.campaignId}/members/roster`);
      members.value = (roster.members as Member[]).filter(member => member.userId !== props.currentUserId);
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}

function open(row: Row) {
  const handout: Handout = { id: row.id, title: row.title, body: row.body, assetId: row.asset_id };
  emitCampaignEvent('handout', handout);
}

async function run(action: () => Promise<void>) {
  working.value = true;
  error.value = '';
  try {
    await action();
    await load();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    working.value = false;
  }
}

const recipients = () => (audience.value === 'some' ? { userIds: chosen.value } : {});

function showNew() {
  return run(async () => {
    let assetId: string | null = null;
    if (imageFile.value) assetId = (await props.request(`/campaigns/${props.campaignId}/assets?kind=object_image`, 'POST', undefined, imageFile.value)).id;
    await props.request(base(), 'POST', { title: title.value.trim(), body: body.value.trim() || null, assetId, ...recipients() });
    title.value = '';
    body.value = '';
    imageFile.value = null;
  });
}

const showAgain = (row: Row) => run(async () => { await props.request(`${base()}/${row.id}/show`, 'POST', recipients()); });
const remove = async (row: Row) => {
  if (!(await confirmAction(`Удалить материал «${row.title}» из всех журналов?`, { title: 'Удалить', confirmLabel: 'Удалить', danger: true }))) return;
  void run(async () => { await props.request(`${base()}/${row.id}`, 'DELETE'); });
};

const nameOf = (userId: string) => members.value.find(member => member.userId === userId)?.displayName ?? 'участник';

let stop: (() => void) | null = null;
onMounted(() => {
  void load();
  stop = onCampaignEvent('handout', () => void load());
});
onBeforeUnmount(() => stop?.());
</script>

<template>
  <div class="handouts">
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <details v-if="canManage" class="handout-form" open>
      <summary>Показать материал</summary>
      <label>Заголовок <input v-model="title" maxlength="120" placeholder="Письмо барона" /></label>
      <label>Текст <textarea v-model="body" rows="4" maxlength="20000" placeholder="Что написано (можно без текста — только картинка)" /></label>
      <label>Картинка — PNG, JPEG или WebP <input type="file" accept="image/png,image/jpeg,image/webp" @change="imageFile = ($event.target as HTMLInputElement).files?.[0] ?? null" /></label>
      <label>Кому
        <select v-model="audience">
          <option value="all">всем за столом</option>
          <option value="some">выбранным</option>
        </select>
      </label>
      <div v-if="audience === 'some'" class="members">
        <label v-for="member in members" :key="member.userId" class="checkbox-label">
          <input v-model="chosen" type="checkbox" :value="member.userId" /> {{ member.displayName }}
        </label>
      </div>
      <button type="button" class="primary" :disabled="working || !title.trim() || (!body.trim() && !imageFile) || (audience === 'some' && !chosen.length)" @click="showNew">Показать</button>
    </details>

    <ul v-if="handouts.length" class="handout-list">
      <li v-for="row in handouts" :key="row.id">
        <button type="button" class="handout-open" @click="open(row)">
          <GameIcon class="inline-icon" :name="row.asset_id ? 'image' : 'mail'" :size="16" /> {{ row.title }}
        </button>
        <small v-if="canManage" class="muted">
          {{ row.recipients?.length ? `Показано: ${row.recipients.map(entry => nameOf(entry.userId)).join(', ')}` : 'Ещё никому не показан' }}
        </small>
        <span v-if="canManage" class="row-actions">
          <button type="button" :disabled="working" @click="showAgain(row)">Показать ещё раз</button>
          <button type="button" :disabled="working" @click="remove(row)">Удалить</button>
        </span>
      </li>
    </ul>
    <p v-else class="muted">{{ canManage ? 'Материалов пока нет.' : 'Мастер ещё ничего не показывал.' }}</p>
  </div>
</template>

<style scoped>
.handouts{display:flex;flex-direction:column;gap:10px;font-size:13px}
.handout-form{display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid var(--brass-light,#0003);border-radius:4px}
.handout-form summary{cursor:pointer;font-weight:700}
.handout-form label{display:flex;flex-direction:column;gap:2px;margin:4px 0}
.members{display:flex;flex-direction:column;gap:2px}
.members label{flex-direction:row;align-items:center;gap:6px;margin:0}
.handout-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.handout-list li{display:flex;flex-direction:column;gap:3px;padding-bottom:6px;border-bottom:1px solid var(--brass-light,#0002)}
.handout-open{text-align:left;min-height:32px;padding:4px 10px}
.row-actions{display:flex;gap:6px;flex-wrap:wrap}
.row-actions button{min-height:26px;padding:2px 8px;font-size:12px}
.error{color:#c0392b;margin:0}
</style>
