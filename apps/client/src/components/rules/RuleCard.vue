<script setup lang="ts">
import { confirmAction } from '../../ui/confirmDialog';
import FormulaInput from './FormulaInput.vue';
import { computed, ref } from 'vue';

import {
  isValidFormula,
  RULE_KIND_HINTS,
  RULE_KIND_LABELS,
  updateRule,
  deleteRule,
  knownChoice,
  type CampaignRule,
} from '../../campaign/campaignRules';

const props = defineProps<{
  campaignId: string;
  rule: CampaignRule;
  canManage: boolean;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();

const emit = defineEmits<{ deleted: [] }>();

const label = ref(props.rule.label);
const description = ref(props.rule.description);
const value = ref(props.rule.value);

let baseline = { label: props.rule.label, description: props.rule.description, value: props.rule.value };

const editing = ref(false);
const busy = ref(false);
const error = ref('');
const saved = ref(false);

const formulaValid = computed(() => props.rule.kind !== 'formula' || typeof value.value !== 'string' || isValidFormula(value.value));

const dirty = computed(() =>
  label.value !== baseline.label ||
  description.value !== baseline.description ||
  value.value !== baseline.value,
);

function startEditing() {
  editing.value = true;
  saved.value = false;
}

function cancelEditing() {
  label.value = baseline.label;
  description.value = baseline.description;
  value.value = baseline.value;
  editing.value = false;
  error.value = '';
}

async function save() {
  if (props.rule.kind === 'formula' && !formulaValid.value) return;

  busy.value = true;
  error.value = '';

  try {
    const updated = await updateRule(props.request, props.campaignId, props.rule.id, {
      label: label.value,
      description: description.value,
      value: value.value,
      revision: props.rule.revision,
    });

    props.rule.revision = updated.revision;
    props.rule.label = updated.label;
    props.rule.description = updated.description;
    props.rule.value = updated.value;
    baseline = { label: updated.label, description: updated.description, value: updated.value };
    editing.value = false;
    saved.value = true;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось сохранить правило. Попробуйте ещё раз.';
  } finally {
    busy.value = false;
  }
}

async function remove() {
  if (!(await confirmAction(`Удалить правило «${props.rule.label}»? Вернуть его будет нельзя.`, { title: 'Удалить правило', confirmLabel: 'Удалить', danger: true }))) return;

  busy.value = true;
  error.value = '';

  try {
    await deleteRule(props.request, props.campaignId, props.rule.id);
    emit('deleted');
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось удалить правило. Попробуйте ещё раз.';
    busy.value = false;
  }
}

const choice = computed(() => (props.rule.kind === 'text' ? knownChoice(props.rule.key) : null));

async function toggleFlag() {
  if (props.rule.kind !== 'flag' || busy.value) return;
  value.value = !(props.rule.value === true);
  await save();
}

function displayValue(): string {
  if (props.rule.kind === 'flag') return props.rule.value ? 'включено' : 'выключено';
  const option = choice.value?.options.find(entry => entry.value === props.rule.value);
  if (choice.value) return option?.label ?? `${String(props.rule.value)} — неизвестное значение, действует: ${choice.value.options.find(entry => entry.value === choice.value!.default)?.label}`;
  return String(props.rule.value);
}
</script>

<template>
  <div class="rule-card">
    <header>
      <div class="titles">
        <strong>{{ rule.label }}</strong>
        <code class="rule-key">{{ rule.key }}</code>
        <span class="kind-badge">{{ RULE_KIND_LABELS[rule.kind] }}</span>
      </div>

      <div v-if="canManage" class="header-actions">
        <button v-if="!editing" type="button" :disabled="busy" @click="startEditing">Изменить</button>
        <button v-if="!editing" type="button" class="danger" :disabled="busy" @click="remove">Удалить</button>
      </div>
    </header>

    <p v-if="rule.description && !editing" class="muted description">{{ rule.description }}</p>

    <template v-if="!editing">
      <p class="value-display" :class="{ flag: rule.kind === 'flag' }">
        <template v-if="rule.kind === 'flag'">
          <span class="flag-dot" :data-on="rule.value === true" />
          {{ displayValue() }}
          <button v-if="canManage" type="button" class="flag-toggle" :disabled="busy" @click="toggleFlag">{{ rule.value === true ? 'Выключить' : 'Включить' }}</button>
        </template>
        <code v-else-if="rule.kind === 'formula'">{{ displayValue() }}</code>
        <template v-else>{{ displayValue() }}</template>
      </p>
    </template>

    <template v-else>
      <label>
        Название
        <input v-model="label" maxlength="200" :disabled="busy" />
      </label>

      <label>
        Описание — необязательно
        <textarea v-model="description" rows="2" maxlength="2000" :disabled="busy" />
      </label>

      <label class="checkbox-label" v-if="rule.kind === 'flag'">
        <input type="checkbox" v-model="value as any" :disabled="busy" />
        Включено
      </label>

      <label v-else-if="rule.kind === 'number'">
        Значение
        <input type="number" step="any" v-model.number="value as any" :disabled="busy" />
      </label>

      <label v-else-if="rule.kind === 'formula'">
        Формула
        <FormulaInput v-model="(value as any)" placeholder="2d6+3" :disabled="busy" />
        <small :class="{ invalid: !formulaValid }">{{ RULE_KIND_HINTS.formula }}</small>
      </label>

      <label v-else-if="choice">
        Значение
        <select v-model="value" :disabled="busy">
          <option v-for="option in choice.options" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </label>

      <label v-else>
        Текст
        <textarea v-model="value as any" rows="4" maxlength="2000" :disabled="busy" />
      </label>

      <div class="edit-actions">
        <button type="button" class="primary" :disabled="busy || !dirty || !formulaValid" @click="save">
          {{ busy ? 'Сохраняю…' : 'Сохранить' }}
        </button>
        <button type="button" :disabled="busy" @click="cancelEditing">Отменить</button>
      </div>
    </template>

    <p v-if="error" class="notice error">{{ error }}</p>
    <p v-if="saved && !editing" class="saved-note">✔ Сохранено</p>

    <small class="muted updated-note">
      Обновил {{ rule.updated_by_name }}, {{ new Date(rule.updated_at).toLocaleString('ru-RU') }}
    </small>
  </div>
</template>

<style scoped>
.rule-card{padding:14px 16px;border:1px solid var(--brass-light);border-radius:3px;background:var(--surface-inset);display:flex;flex-direction:column;gap:8px}
.rule-card header{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap}
.titles{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.rule-key{font-family:Consolas,monospace;font-size:12px;color:var(--muted-ink)}
.kind-badge{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:2px 8px;border-radius:10px;border:1px solid var(--brass-light)}
.header-actions{display:flex;gap:8px;flex-shrink:0}
.header-actions button{min-height:32px;padding:4px 12px;font-size:13px}
.header-actions .danger{color:#8e2a2f;border-color:#8e2a2f}
.description{margin:0}
.value-display{margin:0;font-size:16px;font-weight:600}
.value-display code{font-family:Consolas,monospace;font-size:15px}
.flag-dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:#8a7b66;margin-right:6px}
.flag-dot[data-on="true"]{background:#3f8a4e}
.flag-toggle{margin-left:12px;min-height:30px;padding:2px 12px;font-size:13px;font-weight:600}
.rule-card label{margin:6px 0}
.rule-card small.invalid{color:#8e2a2f}
.edit-actions{display:flex;gap:10px}
.saved-note{color:#2f6b3a;font-weight:600;font-size:13px;margin:0}
.updated-note{margin-top:2px}
</style>
