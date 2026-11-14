<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useEscapeClose } from '../../ui/escapeStack';
import { modFormBody, modFormDefaults, modFormIcon, modFormPath, modFormProblems, type ModForm } from '../../campaign/modForms';
import GameIcon from '../game/GameIcon.vue';

const props = defineProps<{
  form: ModForm;
  campaignId: string;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
  characters: Array<{ id: string; name: string; kind: string }>;
  characterId: string | null;
  characterName: string | null;
}>();
const emit = defineEmits<{ close: [] }>();
useEscapeClose(() => emit('close'));

const values = reactive(modFormDefaults(props.form));
const busy = ref(false);
const error = ref('');
const message = ref('');

const needsFigure = computed(() => props.form.scope === 'character' && !props.characterId);
const problems = computed(() => modFormProblems(props.form, values));
const choices = (who: 'any' | 'character' | 'npc') => props.characters
  .filter(entry => entry.kind !== 'object' && (who === 'any' || entry.kind === who))
  .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

async function submit() {
  if (busy.value || needsFigure.value || problems.value.length) return;
  busy.value = true;
  error.value = '';
  message.value = '';
  try {
    const result = await props.request(modFormPath(props.campaignId, props.form), 'POST', modFormBody(props.form, values, props.characterId));
    message.value = typeof result?.message === 'string' && result.message ? result.message : 'Готово.';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="mod-form-dialog" role="dialog" :aria-label="form.title">
    <form class="modal-card g-frame" @submit.prevent="submit">
      <header class="modal-header">
        <h3><GameIcon class="inline-icon" :name="modFormIcon(form)" :size="18" /> <span translate="no">{{ form.title }}</span></h3>
        <button type="button" class="modal-close icon-only" aria-label="Закрыть" @click="emit('close')"><GameIcon class="inline-icon" name="close" :size="16" /></button>
      </header>
      <p class="mod-tag">{{ `мод «${form.modName}»` }}</p>
      <p v-if="form.description" class="hint" translate="no">{{ form.description }}</p>
      <p v-if="form.scope === 'character'" class="figure" :class="{ warn: needsFigure }">
        <template v-if="characterName">Для: <strong translate="no">{{ characterName }}</strong></template>
        <template v-else>Сначала выберите фигуру на столе.</template>
      </p>

      <div class="fields">
        <template v-for="field in form.fields" :key="field.key">
          <label v-if="field.type === 'checkbox'" class="check">
            <input v-model="values[field.key]" type="checkbox" :disabled="busy" />
            <span translate="no">{{ field.label }}</span>
          </label>
          <label v-else class="field">
            <span translate="no">{{ field.label }}<b v-if="field.required" aria-hidden="true"> *</b></span>
            <input v-if="field.type === 'text'" v-model="values[field.key]" type="text" :maxlength="field.maxLength" :placeholder="field.placeholder" :required="field.required" :disabled="busy" />
            <textarea v-else-if="field.type === 'textarea'" :value="String(values[field.key] ?? '')" rows="3" @input="values[field.key] = ($event.target as HTMLTextAreaElement).value" :maxlength="field.maxLength" :placeholder="field.placeholder" :required="field.required" :disabled="busy" />
            <input v-else-if="field.type === 'number'" v-model.number="values[field.key]" type="number" :min="field.min" :max="field.max" :step="field.step" :required="field.required" :disabled="busy" />
            <select v-else-if="field.type === 'select'" v-model="values[field.key]" :disabled="busy" translate="no">
              <option v-for="option in field.options" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
            <select v-else-if="field.type === 'character'" v-model="values[field.key]" :required="field.required" :disabled="busy">
              <option :value="null">— выберите —</option>
              <option v-for="entry in choices(field.who)" :key="entry.id" :value="entry.id" translate="no">{{ entry.name }}</option>
            </select>
            <small v-if="field.hint" translate="no">{{ field.hint }}</small>
          </label>
        </template>
      </div>

      <p v-if="message" class="result" role="status" translate="no">{{ message }}</p>
      <p v-if="error" class="result error" role="alert">{{ error }}</p>
      <div class="actions">
        <button type="button" @click="emit('close')">Закрыть</button>
        <button
          type="submit" class="primary" :disabled="busy || needsFigure || problems.length > 0"
          :title="problems.length ? `Заполните: ${problems.join(', ')}` : undefined"
        ><span translate="no">{{ form.submit }}</span></button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.mod-form-dialog{position:fixed;right:112px;top:calc(var(--game-top,54px) + 14px);z-index:3000;width:min(380px,calc(100vw - 140px));max-height:calc(100vh - var(--game-top,54px) - 190px);display:flex;pointer-events:none}
.modal-card{pointer-events:auto;width:100%;max-height:100%;overflow-y:auto;padding:16px 18px;background:var(--parchment-background);color:var(--ink);border:1px solid var(--brass);border-radius:4px;box-shadow:0 12px 28px #0009}
.modal-header{display:flex;align-items:center;justify-content:space-between;gap:10px}
.modal-header h3{margin:0;display:flex;align-items:center;gap:6px}
.modal-close{min-height:32px;width:32px;padding:0}
.mod-tag{margin:2px 0 8px;font-size:12px;font-style:italic;color:var(--muted-ink)}
.hint{margin:0 0 10px;font-size:13px;color:var(--muted-ink)}
.figure{margin:0 0 10px;font-size:13px}
.figure.warn{color:var(--burgundy)}
.fields{display:flex;flex-direction:column;gap:10px}
.field{display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600}
.field small{font-weight:400;color:var(--muted-ink)}
.field b{color:var(--burgundy)}
.check{display:flex;align-items:center;gap:8px;font-size:13px}
.result{margin:12px 0 0;padding:8px 10px;border-left:3px solid var(--brass);font-size:13px}
.result.error{border-left-color:var(--burgundy);color:var(--burgundy)}
.actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
.actions button{min-height:34px;padding:4px 14px}
</style>
