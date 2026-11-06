<script setup lang="ts">
import { ref } from 'vue';
import GameIcon from '../game/GameIcon.vue';

type Option = { name: string; cost: number; text: string };
type Phase = { atPercent: number; title: string; text: string; public: boolean; done: boolean };
type Boss = { legendaryActions: number; legendaryResistances?: number; options: Option[]; phases: Phase[]; template?: Omit<Boss, 'template'> };

const props = defineProps<{
  campaignId: string;
  characterId: string;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();

const loaded = ref(false);
const busy = ref(false);
const error = ref('');
const saved = ref('');
const legendaryActions = ref(0);
const legendaryResistances = ref(0);
const options = ref<Option[]>([]);
const phases = ref<Phase[]>([]);
let template: Omit<Boss, 'template'> | null = null;

const path = () => `/campaigns/${props.campaignId}/characters/${props.characterId}/boss`;

function apply(boss: Boss) {
  legendaryActions.value = boss.legendaryActions;
  legendaryResistances.value = boss.legendaryResistances ?? 0;
  options.value = boss.options.map(option => ({ ...option, text: option.text ?? '' }));
  phases.value = boss.phases.map(phase => ({ ...phase, text: phase.text ?? '' }));
  if (boss.template) template = boss.template;
}

async function load() {
  if (loaded.value || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    apply(await props.request(path()));
    loaded.value = true;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось прочитать. Попробуйте ещё раз.';
  } finally {
    busy.value = false;
  }
}

function useTemplate() {
  if (!template) return;
  apply({ ...template, options: template.options.map(option => ({ ...option })), phases: template.phases.map(phase => ({ ...phase })) });
}

function addOption() {
  options.value.push({ name: '', cost: 1, text: '' });
  if (!legendaryActions.value) legendaryActions.value = 3;
}

function addPhase() {
  const used = new Set(phases.value.map(phase => phase.atPercent));
  const atPercent = [50, 25, 75, 10, 90].find(value => !used.has(value)) ?? 30;
  phases.value.push({ atPercent, title: '', text: '', public: true, done: false });
}

async function save() {
  busy.value = true;
  error.value = '';
  saved.value = '';
  try {
    apply(await props.request(path(), 'PUT', {
      legendaryActions: legendaryActions.value,
      legendaryResistances: legendaryResistances.value,
      options: options.value.map(option => ({ name: option.name, cost: option.cost, text: option.text })),
      phases: phases.value.map(phase => ({ atPercent: phase.atPercent, title: phase.title, text: phase.text, public: phase.public, done: phase.done })),
    }));
    saved.value = 'Сохранено.';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось сохранить. Попробуйте ещё раз.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <details class="boss-editor" @toggle="($event.target as HTMLDetailsElement).open && load()">
    <summary><GameIcon class="inline-icon" name="crown" :size="16" /> Босс: легендарные действия и фазы</summary>
    <p v-if="!loaded && busy" class="muted">Загрузка…</p>
    <template v-if="loaded">
      <p class="muted">
        Легендарные действия тратятся в конце хода других существ и возвращаются в начале хода босса —
        после каждого хода мастер увидит подсказку. Фазы видит только мастер, пока они не начнутся.
      </p>
      <div class="boss-row">
        <label>
          Легендарных действий за раунд
          <input v-model.number="legendaryActions" type="number" min="0" max="5" :disabled="busy" />
        </label>
        <label title="Провалил спасбросок, что бросает сервер, — успех вместо провала; тратится раз из стольких в день, возвращается долгим отдыхом. Ресурс — в листе.">
          Легендарное сопротивление (в день)
          <select v-model.number="legendaryResistances" :disabled="busy">
            <option :value="0">нет</option>
            <option v-for="count in 5" :key="count" :value="count">{{ count }}</option>
          </select>
        </label>
        <button v-if="template && !options.length && !phases.length" type="button" :disabled="busy" @click="useTemplate">Заготовка босса</button>
      </div>

      <h5>Легендарные действия</h5>
      <div v-for="(option, index) in options" :key="`o${index}`" class="boss-item">
        <input v-model="option.name" maxlength="80" placeholder="Название (Удар хвостом)" :disabled="busy" aria-label="Название" />
        <label class="cost">
          стоит
          <select v-model.number="option.cost" :disabled="busy">
            <option :value="1">1</option><option :value="2">2</option><option :value="3">3</option>
          </select>
        </label>
        <button type="button" class="link-button" :disabled="busy" title="Убрать" @click="options.splice(index, 1)"><GameIcon class="inline-icon" name="close" :size="16" /></button>
        <input v-model="option.text" class="wide" maxlength="500" placeholder="Что делает (появится в журнале)" :disabled="busy" aria-label="Описание" />
      </div>
      <button type="button" class="link-button" :disabled="busy || options.length >= 10" @click="addOption">+ легендарное действие</button>

      <h5>Фазы</h5>
      <div v-for="(phase, index) in phases" :key="`p${index}`" class="boss-item">
        <label class="cost">
          на
          <input v-model.number="phase.atPercent" type="number" min="1" max="99" :disabled="busy" aria-label="Порог, % хитов" />
          % хитов
        </label>
        <input v-model="phase.title" maxlength="80" placeholder="Название (Ярость раненого)" :disabled="busy" aria-label="Название фазы" />
        <button type="button" class="link-button" :disabled="busy" title="Убрать" @click="phases.splice(index, 1)"><GameIcon class="inline-icon" name="close" :size="16" /></button>
        <input v-model="phase.text" class="wide" maxlength="500" placeholder="Что происходит" :disabled="busy" aria-label="Текст фазы" />
        <label class="checkbox-label"><input v-model="phase.public" type="checkbox" :disabled="busy" /> объявить всем</label>
        <label class="checkbox-label" title="Уже была — снимите, чтобы сработала снова"><input v-model="phase.done" type="checkbox" :disabled="busy" /> уже была</label>
      </div>
      <button type="button" class="link-button" :disabled="busy || phases.length >= 5" @click="addPhase">+ фаза</button>

      <div class="boss-row">
        <button type="button" class="primary" :disabled="busy" @click="save">Сохранить</button>
        <span v-if="saved" class="muted">{{ saved }}</span>
      </div>
    </template>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
  </details>
</template>

<style scoped>
.boss-editor{margin:8px 0;padding:6px 10px;border:1px solid var(--border,#5a4a35);border-radius:6px}
.boss-editor summary{cursor:pointer;font-weight:600}
.boss-editor h5{margin:10px 0 4px;font-size:14px}
.boss-row{display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px;margin:6px 0}
.boss-row input{width:70px}
.boss-item{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0 0 8px;padding-bottom:6px;border-bottom:1px dashed var(--border,#5a4a35)}
.boss-item > input:not(.wide){flex:1 1 160px;min-width:0}
.boss-item .wide{flex:1 1 100%;min-width:0}
.boss-item .cost{display:inline-flex;align-items:center;gap:4px;margin:0;white-space:nowrap}
.boss-item .cost input{width:56px}
.boss-item .checkbox-label{margin:0;font-size:13px}
</style>
