<script setup lang="ts">
import { confirmAction } from '../../ui/confirmDialog';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import DifficultyChip, { type DifficultyView } from '../rules/DifficultyChip.vue';
import RollTablesPanel from './RollTablesPanel.vue';
import type { BestiaryPlacement } from '../rules/BestiaryModal.vue';
import GameIcon from '../game/GameIcon.vue';

type Candidate = { id: string; name: string; kind: 'character' | 'npc' | 'object'; disposition: string | null };
type Encounter = {
  id: string;
  name: string;
  members: Array<{ name: string; kind: string; disposition: string | null; dx: number; dz: number }>;
};

const props = defineProps<{
  campaignId: string;
  sceneId: string;
  canManage: boolean;
  busy: boolean;
  candidates: Candidate[];
  placingId: string;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();

const emit = defineEmits<{
  deploy: [encounter: { id: string; name: string; members: Array<{ dx: number; dz: number }> }];
  'cancel-deploy': [];
  bestiary: [];
  'place-monsters': [placement: BestiaryPlacement];
}>();

const tab = ref<'encounters' | 'tables'>('encounters');

const encounters = ref<Encounter[]>([]);
const sceneDifficulty = ref<DifficultyView | null>(null);
const difficulties = ref<Record<string, DifficultyView>>({});
const error = ref('');
const saving = ref(false);
const newName = ref('');
const chosen = ref<string[]>([]);

const working = computed(() => props.busy || saving.value);

async function load() {
  if (!props.canManage) return;
  try {
    encounters.value = await props.request(`/campaigns/${props.campaignId}/encounters`);
    error.value = '';
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  }
  void loadDifficulty();
}

async function loadDifficulty() {
  if (!props.canManage) return;
  const path = `/campaigns/${props.campaignId}/difficulty`;
  const scene = props.sceneId ? { sceneId: props.sceneId } : {};
  try {
    sceneDifficulty.value = props.sceneId ? await props.request(path, 'POST', scene) : null;
    const entries = await Promise.all(encounters.value.map(async encounter =>
      [encounter.id, await props.request(path, 'POST', { ...scene, encounterId: encounter.id })] as const));
    difficulties.value = Object.fromEntries(entries);
  } catch {
  }
}

watch(() => [props.campaignId, props.canManage], load, { immediate: true });

let difficultyTimer: ReturnType<typeof setTimeout> | null = null;
watch(() => `${props.sceneId}|${props.candidates.map(candidate => `${candidate.id}:${candidate.disposition}`).join()}`, () => {
  if (difficultyTimer) clearTimeout(difficultyTimer);
  difficultyTimer = setTimeout(() => void loadDifficulty(), 400);
});
onBeforeUnmount(() => { if (difficultyTimer) clearTimeout(difficultyTimer); });

watch(() => props.candidates, list => {
  const present = new Set(list.map(candidate => candidate.id));
  chosen.value = chosen.value.filter(id => present.has(id));
});

function chooseHostile() {
  chosen.value = props.candidates.filter(candidate => candidate.disposition === 'hostile').map(candidate => candidate.id);
}

async function save() {
  if (!newName.value.trim() || !chosen.value.length) return;
  saving.value = true;
  try {
    await props.request(`/campaigns/${props.campaignId}/encounters`, 'POST', {
      name: newName.value.trim(),
      sceneId: props.sceneId,
      objectIds: chosen.value,
    });
    newName.value = '';
    chosen.value = [];
    await load();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    saving.value = false;
  }
}

async function remove(encounter: Encounter) {
  if (!(await confirmAction(`Удалить встречу «${encounter.name}»? Объекты, уже расставленные с неё, останутся.`, { title: 'Удалить', confirmLabel: 'Удалить', danger: true }))) return;
  saving.value = true;
  try {
    await props.request(`/campaigns/${props.campaignId}/encounters/${encounter.id}`, 'DELETE');
    await load();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    saving.value = false;
  }
}

function composition(encounter: Encounter) {
  const counts = new Map<string, number>();
  for (const member of encounter.members) {
    const base = member.name.replace(/\s+\d+$/, '');
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => (count > 1 ? `${name} ×${count}` : name)).join(', ');
}

defineExpose({ load });
</script>

<template>
  <div class="encounters-panel">
    <p v-if="!canManage" class="muted">Встречи собирает и расставляет мастер.</p>

    <template v-else>
      <nav class="panel-tabs" aria-label="Встречи и таблицы">
        <button type="button" :aria-pressed="tab === 'encounters'" @click="tab = 'encounters'">Встречи</button>
        <button type="button" :aria-pressed="tab === 'tables'" @click="tab = 'tables'">Таблицы случайностей</button>
      </nav>
      <RollTablesPanel v-if="tab === 'tables'" :campaign-id="campaignId" :scene-id="sceneId" :request="request" @place="placement => emit('place-monsters', placement)" />
    </template>

    <template v-if="canManage && tab === 'encounters'">
      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <button type="button" class="bestiary-button" :disabled="working" @click="emit('bestiary')"><GameIcon class="inline-icon" name="spellbook" :size="16" /> Из бестиария…</button>
      <p v-if="sceneDifficulty?.foes?.length" class="scene-difficulty">Враги на сцене: <DifficultyChip :result="sceneDifficulty" /></p>
      <p v-if="!encounters.length" class="muted">Сохранённых встреч пока нет.</p>
      <ul v-else class="encounter-list">
        <li v-for="encounter in encounters" :key="encounter.id" :class="{ placing: placingId === encounter.id }">
          <div>
            <strong>{{ encounter.name }}</strong>
            <small class="muted">{{ composition(encounter) }}</small>
            <DifficultyChip v-if="difficulties[encounter.id]" :result="difficulties[encounter.id]!" />
          </div>
          <div class="encounter-actions">
            <button
              v-if="placingId === encounter.id"
              type="button"
              @click="emit('cancel-deploy')"
            >
              Отмена
            </button>
            <button
              v-else
              type="button"
              :disabled="working || !sceneId"
              title="Затем щёлкните по клетке карты — там встанет центр встречи"
              @click="emit('deploy', { id: encounter.id, name: encounter.name, members: encounter.members })"
            >
              Расставить
            </button>
            <button type="button" :disabled="working" @click="remove(encounter)">Удалить</button>
          </div>
        </li>
      </ul>

      <details class="save-encounter">
        <summary>Сохранить встречу с этой сцены</summary>
        <p v-if="!candidates.length" class="muted">На сцене нет НПС и предметов.</p>
        <template v-else>
          <button type="button" class="link-button" :disabled="working" @click="chooseHostile">Выбрать всех врагов</button>
          <label v-for="candidate in candidates" :key="candidate.id" class="checkbox-label">
            <input v-model="chosen" type="checkbox" :value="candidate.id" :disabled="working" />
            {{ candidate.name }}
          </label>
          <label>
            Название встречи
            <input v-model="newName" maxlength="100" :disabled="working" placeholder="Засада у моста" />
          </label>
          <button type="button" :disabled="working || !newName.trim() || !chosen.length" @click="save">
            Сохранить ({{ chosen.length }})
          </button>
          <small class="muted">
            Сохраняются листы и расстановка; персонажи игроков во встречу не входят.
            Каждая расстановка создаёт новые объекты с полными хитами.
          </small>
        </template>
      </details>
    </template>
  </div>
</template>

<style scoped>
.encounters-panel{display:grid;gap:8px}
.panel-tabs{display:flex;gap:4px;flex-wrap:wrap}
.panel-tabs button{min-height:28px;padding:2px 10px;font-size:12px}
.panel-tabs button[aria-pressed="true"]{background:var(--burgundy,#7a2e2e);color:var(--ivory,#fff)}
.encounter-list{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.encounter-list li{display:flex;justify-content:space-between;gap:8px;align-items:center;padding:6px 8px;border:1px solid var(--line, #8a6a3f55);border-radius:4px}
.encounter-list li.placing{border-color:var(--brass, #c9a227);background:#c9a22722}
.encounter-list li > div:first-child{display:grid;gap:2px;min-width:0}
.encounter-list small{overflow:hidden;text-overflow:ellipsis}
.encounter-actions{display:flex;gap:4px;flex-shrink:0}
.save-encounter{display:grid;gap:6px}
.save-encounter[open]{padding-bottom:4px}
.save-encounter > summary{cursor:pointer;font-weight:600}
.link-button{justify-self:start}
</style>
