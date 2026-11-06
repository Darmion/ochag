<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import HandoutsPanel from './HandoutsPanel.vue';
import DialoguesPanel from './DialoguesPanel.vue';
import ChroniclePanel from './ChroniclePanel.vue';
import GameIcon from '../game/GameIcon.vue';

type Objective = { id: string; text: string; done: boolean };
type Quest = {
  id: string;
  title: string;
  description: string;
  status: 'active' | 'completed' | 'failed';
  xp_reward: number;
  hidden: boolean;
  rewarded_at: string | null;
  objectives: Objective[];
};

const props = defineProps<{
  campaignId: string;
  sceneId: string;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
  revision: number;
  currentUserId?: string;
}>();

const tab = ref<'quests' | 'handouts' | 'dialogues' | 'chronicle'>('quests');

const quests = ref<Quest[]>([]);
const canManage = ref(false);
const working = ref(false);
const error = ref('');
const newTitle = ref('');
const newDescription = ref('');
const newReward = ref(0);
const newObjectives = ref('');
const newHidden = ref(false);
const objectiveDrafts = ref<Record<string, string>>({});

const base = () => `/campaigns/${props.campaignId}/quests`;
const groups = computed(() => [
  { id: 'active', label: 'Активные', entries: quests.value.filter(quest => quest.status === 'active') },
  { id: 'completed', label: 'Выполненные', entries: quests.value.filter(quest => quest.status === 'completed') },
  { id: 'failed', label: 'Проваленные', entries: quests.value.filter(quest => quest.status === 'failed') },
]);

async function load() {
  try {
    const result = await props.request(base());
    quests.value = result.quests;
    canManage.value = result.canManage;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Журнал не загрузился.';
  }
}

async function act(action: () => Promise<unknown>) {
  working.value = true;
  error.value = '';
  try {
    await action();
    await load();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не получилось.';
  } finally {
    working.value = false;
  }
}

function create() {
  return act(async () => {
    await props.request(base(), 'POST', {
      title: newTitle.value.trim(),
      description: newDescription.value,
      xpReward: Math.max(0, Math.round(newReward.value || 0)),
      hidden: newHidden.value,
      objectives: newObjectives.value.split('\n').map(line => line.trim()).filter(Boolean).slice(0, 30),
    });
    newTitle.value = '';
    newDescription.value = '';
    newReward.value = 0;
    newObjectives.value = '';
    newHidden.value = false;
  });
}

const update = (quest: Quest, body: Record<string, unknown>) => act(() => props.request(`${base()}/${quest.id}`, 'PATCH', body));
const complete = (quest: Quest) => update(quest, { status: 'completed', ...(props.sceneId ? { sceneId: props.sceneId } : {}) });
const toggleObjective = (quest: Quest, objective: Objective) =>
  act(() => props.request(`${base()}/${quest.id}/objectives/${objective.id}`, 'PATCH', { done: !objective.done }));
const removeObjective = (quest: Quest, objective: Objective) =>
  act(() => props.request(`${base()}/${quest.id}/objectives/${objective.id}`, 'DELETE'));
const remove = (quest: Quest) => act(() => props.request(`${base()}/${quest.id}`, 'DELETE'));

function addObjective(quest: Quest) {
  const text = objectiveDrafts.value[quest.id]?.trim();
  if (!text) return;
  return act(async () => {
    await props.request(`${base()}/${quest.id}/objectives`, 'POST', { text });
    objectiveDrafts.value[quest.id] = '';
  });
}

onMounted(load);
watch(() => [props.revision, props.campaignId], load);
</script>

<template>
  <nav class="journal-tabs" aria-label="Журнал">
    <button type="button" :aria-pressed="tab === 'quests'" @click="tab = 'quests'">Задания</button>
    <button type="button" :aria-pressed="tab === 'handouts'" @click="tab = 'handouts'">Материалы</button>
    <button type="button" :aria-pressed="tab === 'chronicle'" @click="tab = 'chronicle'">Хроника</button>
    <button v-if="canManage" type="button" :aria-pressed="tab === 'dialogues'" @click="tab = 'dialogues'">Разговоры</button>
  </nav>
  <ChroniclePanel v-if="tab === 'chronicle'" :campaign-id="campaignId" :request="request" />
  <HandoutsPanel v-if="tab === 'handouts'" :campaign-id="campaignId" :current-user-id="currentUserId ?? ''" :request="request" />
  <DialoguesPanel v-if="tab === 'dialogues'" :campaign-id="campaignId" :request="request" />
  <div v-show="tab === 'quests'" class="quest-log">
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <template v-for="group in groups" :key="group.id">
      <details v-if="group.entries.length" :open="group.id === 'active'" class="quest-group">
        <summary>{{ group.label }} ({{ group.entries.length }})</summary>
        <article v-for="quest in group.entries" :key="quest.id" class="quest" :class="[`status-${quest.status}`, { secret: quest.hidden }]">
          <header>
            <h4 translate="no">{{ quest.title }}</h4>
            <small v-if="quest.hidden" class="muted">скрыто от отряда</small>
          </header>
          <p v-if="quest.description" class="quest-description" translate="no">{{ quest.description }}</p>
          <ul v-if="quest.objectives.length" class="objectives">
            <li v-for="objective in quest.objectives" :key="objective.id" :class="{ done: objective.done }">
              <label v-if="canManage" class="checkbox-label">
                <input type="checkbox" :checked="objective.done" :disabled="working" @change="toggleObjective(quest, objective)" />
                {{ objective.text }}
              </label>
              <span v-else><GameIcon class="inline-icon" :name="objective.done ? 'boxChecked' : 'box'" :size="15" /> {{ objective.text }}</span>
              <button v-if="canManage" type="button" class="link-button" :disabled="working" title="Убрать цель" @click="removeObjective(quest, objective)">×</button>
            </li>
          </ul>
          <p v-if="quest.xp_reward" class="reward"><GameIcon class="inline-icon" name="starFilled" :size="16" /> Награда: {{ quest.xp_reward }} опыта каждому{{ quest.rewarded_at ? ' — выдана' : '' }}</p>
          <div v-if="canManage" class="quest-actions">
            <template v-if="quest.status === 'active'">
              <button type="button" class="primary" :disabled="working" title="Опыт — персонажам игроков на этой сцене (без сцены — всем)" @click="complete(quest)">Выполнено</button>
              <button type="button" :disabled="working" @click="update(quest, { status: 'failed' })">Провалено</button>
            </template>
            <button v-else type="button" :disabled="working" @click="update(quest, { status: 'active' })">Вернуть в активные</button>
            <button type="button" :disabled="working" @click="update(quest, { hidden: !quest.hidden })">{{ quest.hidden ? 'Показать отряду' : 'Скрыть' }}</button>
            <button type="button" :disabled="working" @click="remove(quest)">Удалить</button>
          </div>
          <div v-if="canManage && quest.status === 'active'" class="add-objective">
            <input v-model="objectiveDrafts[quest.id]" maxlength="300" placeholder="Новая цель" :disabled="working" @keydown.enter.prevent="addObjective(quest)" />
            <button type="button" :disabled="working || !objectiveDrafts[quest.id]?.trim()" @click="addObjective(quest)">Добавить</button>
          </div>
        </article>
      </details>
    </template>
    <p v-if="!quests.length" class="muted">Заданий пока нет.</p>

    <details v-if="canManage" class="quest-new">
      <summary>Новое задание</summary>
      <label>Название <input v-model="newTitle" maxlength="200" :disabled="working" /></label>
      <label>Описание <textarea v-model="newDescription" maxlength="5000" rows="3" :disabled="working" /></label>
      <label>Цели — по одной в строке <textarea v-model="newObjectives" rows="3" :disabled="working" /></label>
      <label>Опыт каждому <input v-model.number="newReward" type="number" min="0" max="1000000" :disabled="working" /></label>
      <label class="checkbox-label"><input v-model="newHidden" type="checkbox" :disabled="working" /> Пока скрыть от отряда</label>
      <button type="button" class="primary" :disabled="working || !newTitle.trim()" @click="create">Создать</button>
    </details>
  </div>
</template>

<style scoped>
.journal-tabs{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}
.journal-tabs button{min-height:30px;padding:3px 12px;font-size:13px}
.journal-tabs button[aria-pressed="true"]{background:var(--burgundy);color:var(--burgundy-text,#fff)}
.quest-log{display:grid;gap:8px}
.quest-group summary{cursor:pointer;font-weight:700}
.quest{margin:8px 0;padding:8px 10px;border:1px solid var(--brass-light,#8a6a3566);border-radius:4px}
.quest header{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.quest h4{margin:0}
.quest.secret{border-style:dashed}
.quest.status-completed h4{text-decoration:line-through;opacity:.8}
.quest.status-failed h4{color:#a3474b}
.quest-description{margin:4px 0;white-space:pre-wrap}
.objectives{list-style:none;margin:4px 0;padding:0;display:grid;gap:2px}
.objectives li{display:flex;align-items:center;justify-content:space-between;gap:6px}
.objectives li.done{opacity:.7;text-decoration:line-through}
.objectives label{margin:0}
.reward{margin:4px 0;font-weight:600;color:#b8862e}
.quest-actions,.add-objective{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.quest-actions button,.add-objective button{min-height:28px;padding:2px 10px;font-size:13px}
.add-objective input{flex:1;min-height:28px}
.quest-new{display:grid;gap:6px}
.quest-new label{margin:4px 0}
</style>
