<script setup lang="ts">
import { computed } from 'vue';

import GameIcon from '../game/GameIcon.vue';
import { CLAUSE_CATALOG, describeClause, fieldShown, type Clause, type FieldSpec } from '../../../../../packages/domain/combat/condition-rules';

const props = defineProps<{ clause: Clause; index: number; count: number; editable: boolean; busy: boolean }>();
const emit = defineEmits<{ update: [clause: Clause]; remove: []; move: [step: -1 | 1] }>();

const spec = computed(() => CLAUSE_CATALOG[props.clause.kind]);
const visible = (field: FieldSpec) => fieldShown(field, props.clause.values);
const fields = computed(() => spec.value.fields.filter(visible));
const optionsOf = (field: FieldSpec) => (field.options ?? []).filter(([value]) =>
  !field.hideIf || !field.hideIf.in.includes(props.clause.values[field.hideIf.key]) || !field.hideIf.values.includes(value));

function set(key: string, value: unknown) {
  const values = { ...props.clause.values, [key]: value };
  for (const field of spec.value.fields) {
    if (field.hideIf && field.hideIf.in.includes(values[field.hideIf.key]) && field.hideIf.values.includes(String(values[field.key]))) values[field.key] = field.default;
  }
  emit('update', { kind: props.clause.kind, values });
}
</script>

<template>
  <li class="clause" :class="`clause-${clause.kind}`">
    <span class="clause-number" aria-hidden="true">{{ index + 1 }}</span>
    <div class="clause-body">
      <p class="clause-sentence">{{ describeClause(clause) || 'Пустая заметка' }}</p>
      <div v-if="editable" class="clause-fields">
        <span class="clause-kind" :title="spec.hint">{{ spec.label }}</span>
        <template v-for="field in fields" :key="field.key">
          <label v-if="field.type === 'select'" class="clause-field">
            <span>{{ field.label }}</span>
            <select :value="clause.values[field.key]" :disabled="busy" @change="set(field.key, ($event.target as HTMLSelectElement).value)">
              <option v-for="[value, label] in optionsOf(field)" :key="value" :value="value">{{ label }}</option>
            </select>
          </label>
          <label v-else-if="field.type === 'bool'" class="clause-check">
            <input type="checkbox" :checked="clause.values[field.key] === true" :disabled="busy" @change="set(field.key, ($event.target as HTMLInputElement).checked)" />
            <span>{{ field.label }}</span>
          </label>
          <label v-else class="clause-field" :class="{ wide: field.key === 'text' }">
            <span>{{ field.label }}</span>
            <input :value="String(clause.values[field.key] ?? '')" maxlength="300" :disabled="busy" :placeholder="field.placeholder" @input="set(field.key, ($event.target as HTMLInputElement).value)" />
          </label>
        </template>
      </div>
    </div>
    <div v-if="editable" class="clause-tools">
      <button type="button" class="icon-only" :disabled="busy || index === 0" aria-label="Выше" title="Поднять выше" @click="emit('move', -1)"><GameIcon name="chevron" :size="14" class="up" /></button>
      <button type="button" class="icon-only" :disabled="busy || index === count - 1" aria-label="Ниже" title="Опустить ниже" @click="emit('move', 1)"><GameIcon name="chevron" :size="14" /></button>
      <button type="button" class="icon-only danger-icon" :disabled="busy" aria-label="Убрать положение" title="Убрать это положение" @click="emit('remove')"><GameIcon name="trash" :size="14" /></button>
    </div>
  </li>
</template>

<style scoped>
.clause{position:relative;display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:12px;align-items:start;padding:12px 14px;border:1px solid var(--brass-light);border-left:4px solid var(--clause-accent,var(--brass-light));border-radius:6px;background:linear-gradient(180deg,color-mix(in srgb,var(--surface-inset) 92%,#fff 8%),var(--surface-inset));box-shadow:0 1px 0 #0000000d}
.clause-own-rolls,.clause-rolls-against,.clause-crit-against{--clause-accent:#b08d57}
.clause-cannot-attack,.clause-cannot-approach,.clause-cannot-act{--clause-accent:#a2453f}
.clause-speed{--clause-accent:#4f7f9e}
.clause-resistance,.clause-roll-bonus{--clause-accent:#5c8a52}
.clause-with-condition,.clause-lasts{--clause-accent:#4f7f9e}
.clause-repeat-save{--clause-accent:#7a4f9e}
.clause-note{--clause-accent:#8a7b66}
.clause-number{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:var(--clause-accent,#b08d57);color:#fff;font:700 14px var(--heading-font);box-shadow:inset 0 0 0 2px #ffffff40}
.clause-body{display:flex;flex-direction:column;gap:8px;min-width:0}
.clause-sentence{margin:4px 0 0;font:600 16px/1.35 var(--heading-font);color:var(--ink)}
.clause-fields{display:flex;flex-wrap:wrap;align-items:end;gap:8px 12px}
.clause-kind{align-self:center;padding:2px 9px;border-radius:10px;font-size:11px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:#fff;background:var(--clause-accent,#b08d57)}
.clause-field{display:flex;flex-direction:column;gap:3px;margin:0;font-size:12px;color:var(--muted-ink)}
.clause-field select{min-width:170px}
.clause-field.wide{flex:1 1 260px}
.clause-field.wide input{width:100%;box-sizing:border-box}
.clause-check{display:inline-flex;align-items:center;gap:6px;margin:0;font-size:13px;color:var(--ink)}
.clause-tools{display:flex;flex-direction:column;gap:4px}
.icon-only{display:grid;place-items:center;width:28px;min-width:28px;height:28px;min-height:28px;padding:0}
.icon-only .up{transform:rotate(180deg)}
.danger-icon{color:#a2453f}
@media(max-width:700px){.clause{grid-template-columns:28px minmax(0,1fr)}.clause-tools{grid-column:2;flex-direction:row}}
</style>
