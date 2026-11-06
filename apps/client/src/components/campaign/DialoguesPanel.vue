<script setup lang="ts">
import { confirmAction } from '../../ui/confirmDialog';
import { computed, onMounted, ref } from 'vue';
import { ensureSrdSkills, type SrdSkill } from '../../rules/srd';
import GameIcon from '../game/GameIcon.vue';

type Check = { skill: string; dc: number; success: string | null; failure: string | null };
type Option = { id: string; label: string; next: string | null; check: Check | null };
type Node = { id: string; speaker: string | null; text: string; options: Option[] };
type Dialogue = { id: string; title: string; npc_id: string | null; npc_name?: string | null; nodes: Node[]; start_node: string; revision: number };

const props = defineProps<{
  campaignId: string;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();

const dialogues = ref<Dialogue[]>([]);
const npcs = ref<Array<{ id: string; name: string }>>([]);
const skills = ref<SrdSkill[]>([]);
const working = ref(false);
const error = ref('');
const notice = ref('');
const forbidden = ref(false);

const draft = ref<{ id: string | null; title: string; npcId: string; nodes: Node[]; startNode: string; revision: number } | null>(null);

const base = () => `/campaigns/${props.campaignId}/dialogues`;
let counter = 0;
const freshId = (prefix: string, taken: string[]) => {
  let id = '';
  do id = `${prefix}${++counter}`; while (taken.includes(id));
  return id;
};

async function load() {
  try {
    dialogues.value = (await props.request(base())).dialogues;
    forbidden.value = false;
  } catch (cause: any) {
    if (cause?.status === 403) forbidden.value = true;
    else error.value = cause instanceof Error ? cause.message : String(cause);
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

function startNew() {
  draft.value = {
    id: null, title: '', npcId: npcs.value[0]?.id ?? '', startNode: 'start', revision: 0,
    nodes: [{ id: 'start', speaker: null, text: '', options: [{ id: 'o1', label: 'Прощай.', next: null, check: null }] }],
  };
}

function edit(dialogue: Dialogue) {
  draft.value = {
    id: dialogue.id, title: dialogue.title, npcId: dialogue.npc_id ?? '', startNode: dialogue.start_node, revision: dialogue.revision,
    nodes: JSON.parse(JSON.stringify(dialogue.nodes)).map((node: Node) => ({ ...node, speaker: node.speaker ?? null, options: node.options.map(option => ({ ...option, check: option.check ?? null })) })),
  };
}

const nodeIds = computed(() => draft.value?.nodes.map(node => node.id) ?? []);
const nodeLabel = (id: string) => {
  const node = draft.value?.nodes.find(entry => entry.id === id);
  return node ? `${id}: ${node.text.slice(0, 30) || '…'}` : id;
};

function addNode() {
  if (!draft.value) return;
  draft.value.nodes.push({ id: freshId('n', nodeIds.value), speaker: null, text: '', options: [] });
}

function removeNode(index: number) {
  if (!draft.value || draft.value.nodes.length <= 1) return;
  const [gone] = draft.value.nodes.splice(index, 1);
  for (const node of draft.value.nodes) {
    for (const option of node.options) {
      if (option.next === gone!.id) option.next = null;
      if (option.check?.success === gone!.id) option.check.success = null;
      if (option.check?.failure === gone!.id) option.check.failure = null;
    }
  }
  if (draft.value.startNode === gone!.id) draft.value.startNode = draft.value.nodes[0]!.id;
}

function addOption(node: Node) {
  node.options.push({ id: freshId('o', node.options.map(option => option.id)), label: '', next: null, check: null });
}

function toggleCheck(option: Option) {
  option.check = option.check ? null : { skill: 'persuasion', dc: 12, success: option.next, failure: null };
}

function save() {
  const value = draft.value;
  if (!value) return;
  return run(async () => {
    const body = {
      title: value.title.trim(), npcId: value.npcId || null, startNode: value.startNode,
      nodes: value.nodes.map(node => ({
        id: node.id, speaker: node.speaker?.trim() || null, text: node.text,
        options: node.options.map(option => ({ id: option.id, label: option.label, next: option.check ? null : option.next, check: option.check })),
      })),
    };
    if (value.id) await props.request(`${base()}/${value.id}`, 'PUT', { ...body, revision: value.revision });
    else await props.request(base(), 'POST', body);
    draft.value = null;
    return `Разговор «${body.title}» сохранён.`;
  });
}

const start = (dialogue: Dialogue) => run(async () => {
  await props.request(`${base()}/${dialogue.id}/start`, 'POST', {});
  return `Разговор «${dialogue.title}» начат — окно открылось у всех.`;
});

const remove = async (dialogue: Dialogue) => {
  if (!(await confirmAction(`Удалить разговор «${dialogue.title}»?`, { title: 'Удалить', confirmLabel: 'Удалить', danger: true }))) return;
  void run(async () => {
    await props.request(`${base()}/${dialogue.id}`, 'DELETE');
    return 'Разговор удалён.';
  });
};

onMounted(async () => {
  await load();
  try {
    const roster = await props.request(`/campaigns/${props.campaignId}/characters`);
    npcs.value = (roster.characters as Array<any>).filter(character => character.kind === 'npc').map(character => ({ id: character.id, name: character.name }));
    skills.value = await ensureSrdSkills(props.request);
  } catch {
  }
});
</script>

<template>
  <div class="dialogues">
    <p v-if="forbidden" class="muted">Разговоры готовит мастер.</p>
    <template v-else>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-if="notice" class="notice-line">{{ notice }}</p>

      <template v-if="!draft">
        <button type="button" class="primary" :disabled="working" @click="startNew">Новый разговор</button>
        <ul v-if="dialogues.length" class="dialogue-list">
          <li v-for="dialogue in dialogues" :key="dialogue.id">
            <strong>{{ dialogue.title }}</strong>
            <small class="muted">{{ dialogue.npc_name ?? 'без собеседника' }} · реплик: {{ dialogue.nodes.length }}</small>
            <span class="row-actions">
              <button type="button" class="primary" :disabled="working" @click="start(dialogue)"><GameIcon class="inline-icon" name="play" :size="16" /> Начать</button>
              <button type="button" :disabled="working" @click="edit(dialogue)">Править</button>
              <button type="button" :disabled="working" @click="remove(dialogue)">Удалить</button>
            </span>
          </li>
        </ul>
        <p v-else class="muted">Разговоров пока нет. Заготовьте реплики НПС и ответы игроков — как в компьютерных ролевых играх.</p>
      </template>

      <div v-else class="editor">
        <label>Название <input v-model="draft.title" maxlength="120" placeholder="Трактирщик о бароне" /></label>
        <label>Собеседник
          <select v-model="draft.npcId">
            <option value="">— рассказчик —</option>
            <option v-for="npc in npcs" :key="npc.id" :value="npc.id">{{ npc.name }}</option>
          </select>
        </label>
        <label>Начинается с реплики
          <select v-model="draft.startNode">
            <option v-for="id in nodeIds" :key="id" :value="id">{{ nodeLabel(id) }}</option>
          </select>
        </label>

        <article v-for="(node, nodeIndex) in draft.nodes" :key="node.id" class="node">
          <header>
            <strong>Реплика {{ node.id }}</strong>
            <button type="button" :disabled="draft.nodes.length <= 1" title="Удалить реплику" @click="removeNode(nodeIndex)"><GameIcon class="inline-icon" name="close" :size="16" /></button>
          </header>
          <label>Кто говорит (пусто — собеседник) <input v-model="node.speaker" maxlength="80" /></label>
          <label>Текст <textarea v-model="node.text" rows="3" maxlength="2000" placeholder="Что говорит НПС" /></label>
          <div v-for="(option, optionIndex) in node.options" :key="option.id" class="option">
            <input v-model="option.label" maxlength="200" placeholder="Ответ игрока" />
            <label class="checkbox-label"><input type="checkbox" :checked="Boolean(option.check)" @change="toggleCheck(option)" /> проверка</label>
            <template v-if="!option.check">
              <select v-model="option.next" aria-label="Ведёт к">
                <option :value="null">→ конец разговора</option>
                <option v-for="id in nodeIds" :key="id" :value="id">→ {{ nodeLabel(id) }}</option>
              </select>
            </template>
            <template v-else>
              <select v-model="option.check.skill" aria-label="Навык">
                <option v-for="skill in skills" :key="skill.index" :value="skill.index">{{ skill.nameRu }}</option>
              </select>
              <label class="inline">СЛ <input v-model.number="option.check.dc" type="number" min="1" max="40" /></label>
              <select v-model="option.check.success" aria-label="Успех ведёт к">
                <option :value="null">успех → конец</option>
                <option v-for="id in nodeIds" :key="id" :value="id">успех → {{ nodeLabel(id) }}</option>
              </select>
              <select v-model="option.check.failure" aria-label="Провал ведёт к">
                <option :value="null">провал → конец</option>
                <option v-for="id in nodeIds" :key="id" :value="id">провал → {{ nodeLabel(id) }}</option>
              </select>
            </template>
            <button type="button" title="Убрать ответ" @click="node.options.splice(optionIndex, 1)"><GameIcon class="inline-icon" name="close" :size="16" /></button>
          </div>
          <button type="button" :disabled="node.options.length >= 8" @click="addOption(node)">+ ответ</button>
        </article>
        <button type="button" @click="addNode">+ реплика</button>
        <div class="row-actions">
          <button type="button" class="primary" :disabled="working || !draft.title.trim()" @click="save">Сохранить</button>
          <button type="button" :disabled="working" @click="draft = null">Отмена</button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.dialogues{display:flex;flex-direction:column;gap:8px;font-size:13px}
.dialogue-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.dialogue-list li{display:flex;flex-direction:column;gap:3px;padding-bottom:6px;border-bottom:1px solid var(--brass-light,#0002)}
.row-actions{display:flex;gap:6px;flex-wrap:wrap}
.row-actions button,.option button,.node header button{min-height:26px;padding:2px 8px;font-size:12px}
.editor{display:flex;flex-direction:column;gap:8px}
.editor label{display:flex;flex-direction:column;gap:2px;margin:0}
.node{display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid var(--brass-light,#0003);border-radius:4px}
.node header{display:flex;justify-content:space-between;align-items:center}
.option{display:flex;flex-wrap:wrap;gap:4px;align-items:center;padding:4px 0;border-top:1px dashed var(--brass-light,#0002)}
.option > input{flex:1 1 160px;min-width:0}
.option select{flex:1 1 140px;min-width:0}
.option .checkbox-label{flex-direction:row;align-items:center;gap:4px}
.option .inline{flex-direction:row;align-items:center;gap:4px}
.option .inline input{width:56px}
.notice-line{margin:0;color:var(--g-gold,#8a6a35)}
.error{color:#c0392b;margin:0}
</style>
