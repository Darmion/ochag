<script setup lang="ts">
import { ref } from 'vue';

import GameIcon from '../game/GameIcon.vue';
import ClauseRow from './ClauseRow.vue';
import {
  CLAUSE_CATALOG, CLAUSE_KINDS, MAX_STAGES, clause as newClause, describeClause, type Clause, type ClauseKind, type ConditionStage,
} from '../../../../../packages/domain/combat/condition-rules';

const props = defineProps<{ stages: ConditionStage[]; editable: boolean; busy: boolean; own: boolean }>();
const emit = defineEmits<{ update: [stages: ConditionStage[]] }>();

const STAGE_KINDS = CLAUSE_KINDS.filter(kind => kind !== 'lasts');
const adding = ref<Record<number, ClauseKind | ''>>({});
const stageText = (stage: ConditionStage) => stage.clauses.map(describeClause).filter(Boolean).join(' ');

const copy = () => props.stages.map(stage => ({ name: stage.name, clauses: stage.clauses.map(entry => ({ kind: entry.kind, values: { ...entry.values } })) }));
function change(index: number, edit: (stage: ConditionStage) => void) {
  const list = copy();
  edit(list[index]!);
  emit('update', list);
}
const rename = (index: number, name: string) => change(index, stage => { stage.name = name; });
const setClause = (index: number, at: number, value: Clause) => change(index, stage => { stage.clauses[at] = value; });
const dropClause = (index: number, at: number) => change(index, stage => { stage.clauses.splice(at, 1); });
function moveClause(index: number, at: number, step: -1 | 1) {
  change(index, stage => {
    const [item] = stage.clauses.splice(at, 1);
    stage.clauses.splice(at + step, 0, item!);
  });
}
function addClause(index: number) {
  const kind = adding.value[index];
  if (!kind) return;
  change(index, stage => { stage.clauses.push(newClause(kind)); });
  adding.value = { ...adding.value, [index]: '' };
}
function addStage() {
  emit('update', [...copy(), { name: `Стадия ${props.stages.length + 1}`, clauses: [] }]);
}
function dropStage(index: number) {
  emit('update', copy().filter((_, at) => at !== index));
}
function moveStage(index: number, step: -1 | 1) {
  const list = copy();
  const [item] = list.splice(index, 1);
  list.splice(index + step, 0, item!);
  emit('update', list);
}
</script>

<template>
  <section class="stages">
    <h4>Стадии</h4>
    <p class="muted stages-hint">
      Болезнь или яд в несколько шагов: у каждой стадии свои положения, они добавляются к общим. Переводит между стадиями повторный спасбросок
      («провал — стадия тяжелее», «успех — стадия легче»), а мастер — в панели состояний существа.
    </p>
    <ol v-if="stages.length" class="stage-list">
      <li v-for="(stage, index) in stages" :key="index" class="stage">
        <details :open="editable && !stage.clauses.length">
          <summary>
            <span class="stage-number" aria-hidden="true">{{ index + 1 }}</span>
            <span class="stage-summary">
              <b :translate="own ? 'no' : undefined">{{ `Стадия ${index + 1} — ${stage.name}` }}</b>
              <small>{{ stageText(stage) || 'Только общие положения.' }}</small>
            </span>
          </summary>
          <div class="stage-body">
            <div v-if="editable" class="stage-head">
              <label class="stage-name">
                <span>Название стадии</span>
                <input :value="stage.name" maxlength="40" :disabled="busy" :translate="own ? 'no' : undefined" @input="rename(index, ($event.target as HTMLInputElement).value)" />
              </label>
              <span class="spacer" />
              <button type="button" class="icon-only" :disabled="busy || index === 0" aria-label="Стадию раньше" title="Сделать стадию раньше" @click="moveStage(index, -1)"><GameIcon name="chevron" :size="14" class="up" /></button>
              <button type="button" class="icon-only" :disabled="busy || index === stages.length - 1" aria-label="Стадию позже" title="Сделать стадию позже" @click="moveStage(index, 1)"><GameIcon name="chevron" :size="14" /></button>
              <button type="button" class="icon-only danger-icon" :disabled="busy" aria-label="Убрать стадию" title="Убрать эту стадию" @click="dropStage(index)"><GameIcon name="trash" :size="14" /></button>
            </div>
            <ol v-if="stage.clauses.length" class="clause-list">
              <ClauseRow
                v-for="(entry, at) in stage.clauses" :key="`${at}-${entry.kind}`"
                :clause="entry" :index="at" :count="stage.clauses.length" :editable="editable" :busy="busy"
                @update="setClause(index, at, $event)" @remove="dropClause(index, at)" @move="moveClause(index, at, $event)"
              />
            </ol>
            <p v-else class="muted">На этой стадии действуют только общие положения.</p>
            <div v-if="editable" class="add-clause">
              <select :value="adding[index] ?? ''" :disabled="busy" aria-label="Добавить положение стадии" @change="adding = { ...adding, [index]: ($event.target as HTMLSelectElement).value as ClauseKind }">
                <option value="" disabled>Добавить положение стадии…</option>
                <option v-for="kind in STAGE_KINDS" :key="kind" :value="kind" :title="CLAUSE_CATALOG[kind].hint">{{ CLAUSE_CATALOG[kind].label }}</option>
              </select>
              <button type="button" :disabled="busy || !adding[index]" @click="addClause(index)"><GameIcon name="plus" :size="14" /> Добавить</button>
            </div>
          </div>
        </details>
      </li>
    </ol>
    <p v-else class="muted empty-stages">{{ editable ? 'Стадий нет: состояние действует одинаково всё время.' : 'Стадий нет.' }}</p>
    <button v-if="editable && stages.length < MAX_STAGES" type="button" class="add-stage" :disabled="busy" @click="addStage"><GameIcon name="plus" :size="14" /> Добавить стадию</button>
  </section>
</template>

<style scoped>
.stages h4{margin:0 0 8px;font:700 13px var(--heading-font);letter-spacing:.05em;text-transform:uppercase;color:var(--muted-ink)}
.stages-hint{margin:0 0 10px;font-size:13px;line-height:1.45}
.stage-list{list-style:none;margin:0 0 10px;padding:0;display:flex;flex-direction:column;gap:8px}
.stage details{border:1px solid var(--brass-light);border-left:4px solid #7a4f9e;border-radius:6px;background:var(--surface-inset)}
.stage summary{display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;list-style:none}
.stage summary::-webkit-details-marker{display:none}
.stage-number{display:grid;place-items:center;flex:none;width:26px;height:26px;border-radius:50%;background:#7a4f9e;color:#fff;font:700 13px var(--heading-font)}
.stage-summary{display:flex;flex-direction:column;gap:3px;flex:1;min-width:0}
.stage-summary b{font-size:15px;line-height:1.3}
.stage-summary small{font-family:var(--g-body-font,inherit);font-size:13px;font-weight:400;line-height:1.4;letter-spacing:normal;text-transform:none;text-shadow:none;color:var(--muted-ink,var(--g-text))}
.stage-body{display:flex;flex-direction:column;gap:10px;padding:0 12px 12px}
.stage-head{display:flex;flex-wrap:wrap;align-items:end;gap:6px}
.stage-name{display:flex;flex-direction:column;gap:3px;margin:0;font-size:12px;color:var(--muted-ink)}
.stage-name input{min-width:220px}
.spacer{flex:1}
.clause-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.add-clause{display:flex;flex-wrap:wrap;gap:8px}
.add-clause select{flex:1 1 280px;min-width:0}
.add-clause button,.add-stage{display:inline-flex;align-items:center;gap:6px}
.empty-stages{margin:0 0 10px}
.icon-only{display:grid;place-items:center;width:28px;min-width:28px;height:28px;min-height:28px;padding:0}
.icon-only .up{transform:rotate(180deg)}
.danger-icon{color:#a2453f}
</style>
