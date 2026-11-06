<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { ABILITY_OPTIONS, conditionInfo, CONDITIONS } from '../../rules/conditions';
import GameIcon from '../game/GameIcon.vue';

type Effect = { id: string; effect_code: string; parameters: Record<string, any> | null; active: boolean };

const props = defineProps<{
  campaignId: string;
  characterId: string;
  name: string;
  conditions: string[];
  hpCurrent: number | null;
  canEdit: boolean;
  isManager: boolean;
  sources: Array<{ id: string; name: string }>;
  revision: number;
  busy: boolean;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();

const emit = defineEmits<{ result: [message: string] }>();

const effects = ref<Effect[]>([]);
const deathSaves = ref<{ successes: number; failures: number } | null>(null);
const working = ref(false);
const error = ref('');

const code = ref('prone');
const level = ref(1);
const withSave = ref(false);
const saveAbility = ref('constitution');
const saveDc = ref(13);
const duration = ref<number | null>(null);
const repeat = ref<'' | 'end' | 'start'>('');
const sourceId = ref('');

const canApply = computed(() => props.isManager || props.sources.length > 0);
const dying = computed(() => props.hpCurrent === 0 && props.conditions.includes('unconscious') && !props.conditions.includes('dead'));
const stable = computed(() => props.conditions.includes('stable'));

async function load() {
  error.value = '';
  if (!props.canEdit) {
    effects.value = [];
    deathSaves.value = null;
    return;
  }
  try {
    const sheet = await props.request(`/campaigns/${props.campaignId}/characters/${props.characterId}`);
    effects.value = (sheet.effects ?? []).filter((effect: Effect) => effect.active);
    deathSaves.value = { successes: sheet.death_successes ?? 0, failures: sheet.death_failures ?? 0 };
  } catch {
    effects.value = [];
  }
}

watch(() => [props.characterId, props.revision, props.conditions.join(',')], load, { immediate: true });
watch(() => props.sources, list => {
  if (!props.isManager && !list.some(source => source.id === sourceId.value)) sourceId.value = list[0]?.id ?? '';
}, { immediate: true });

const chips = computed(() => props.conditions.map(conditionCode => {
  const info = conditionInfo(conditionCode);
  const effect = effects.value.find(entry => entry.effect_code === conditionCode);
  const parameters = effect?.parameters ?? {};
  const details = [
    typeof parameters.remainingRounds === 'number' ? `ещё ${parameters.remainingRounds} ход.` : '',
    parameters.save && parameters.repeatSave ? `спасбросок ${abilityShort(parameters.save.ability)} СЛ ${parameters.save.dc} в ${parameters.repeatSave === 'end' ? 'конце' : 'начале'} хода` : '',
    parameters.sourceName ? `источник: ${parameters.sourceName}` : '',
    parameters.spellName ? `заклинание: ${parameters.spellName}` : '',
  ].filter(Boolean).join(' · ');
  return { code: conditionCode, info, effectId: effect?.id ?? null, details };
}));

function abilityShort(ability: string) {
  return ({ strength: 'СИЛ', dexterity: 'ЛОВ', constitution: 'ТЕЛ', intelligence: 'ИНТ', wisdom: 'МДР', charisma: 'ХАР' } as Record<string, string>)[ability] ?? ability;
}

async function act(action: () => Promise<string | void>) {
  if (working.value) return;
  working.value = true;
  error.value = '';
  try {
    const message = await action();
    if (message) emit('result', message);
    await load();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не получилось.';
  } finally {
    working.value = false;
  }
}

function remove(effectId: string, label: string) {
  return act(async () => {
    await props.request(`/campaigns/${props.campaignId}/characters/${props.characterId}/effects/${effectId}`, 'DELETE');
    return `${props.name}: «${label}» снято.`;
  });
}

function apply() {
  return act(async () => {
    const body: Record<string, unknown> = { targetIds: [props.characterId], code: code.value };
    if (code.value === 'exhaustion') body.level = level.value;
    if (withSave.value) body.save = { ability: saveAbility.value, dc: Math.round(saveDc.value) };
    if (duration.value) body.durationRounds = Math.round(duration.value);
    if (withSave.value && repeat.value) body.repeatSave = repeat.value;
    if (sourceId.value) body.sourceCharacterId = sourceId.value;
    const { results } = await props.request(`/campaigns/${props.campaignId}/conditions/apply`, 'POST', body);
    const entry = results[0];
    const label = code.value === 'exhaustion' ? `истощение ${level.value}` : conditionInfo(code.value).label.toLowerCase();
    return entry.applied
      ? `${props.name}: «${label}» наложено${entry.total !== null ? ` (спасбросок ${entry.total}${entry.autoFail ? ', автопровал' : ''})` : ''}.`
      : `${props.name} устоял: спасбросок ${entry.total}.`;
  });
}

function deathSave() {
  return act(async () => {
    const { result } = await props.request(`/campaigns/${props.campaignId}/characters/${props.characterId}/death-save`, 'POST');
    return `${props.name}: спасбросок от смерти — ${({ success: 'успех', failure: 'провал', stable: 'стабилен', dead: 'смерть', revived: 'приходит в себя' } as Record<string, string>)[result] ?? result}.`;
  });
}

function stand() {
  return act(async () => {
    const { spentMovement } = await props.request(`/campaigns/${props.campaignId}/characters/${props.characterId}/stand`, 'POST');
    return `${props.name} встаёт${spentMovement ? ' — ушла половина скорости' : ''}.`;
  });
}
</script>

<template>
  <section class="conditions-panel">
    <h4>Состояния</h4>
    <ul v-if="chips.length" class="condition-chips">
      <li v-for="chip in chips" :key="chip.code" :title="chip.info.rule" :class="`code-${chip.code}`">
        <span class="chip-icon" aria-hidden="true"><GameIcon class="inline-icon" :name="chip.info.icon" :size="20" /></span>
        <span>{{ chip.info.label }}</span>
        <small v-if="chip.details" class="muted">{{ chip.details }}</small>
        <button
          v-if="canEdit && chip.effectId"
          type="button"
          class="chip-remove"
          :disabled="working || busy"
          :aria-label="`Снять «${chip.info.label}»`"
          @click="remove(chip.effectId, chip.info.label.toLowerCase())"
        ><GameIcon class="inline-icon" name="close" :size="16" /></button>
      </li>
    </ul>
    <p v-else class="muted">Состояний нет.</p>

    <div v-if="canEdit && (dying || conditions.includes('prone'))" class="condition-actions">
      <template v-if="dying">
        <span class="death-track" :title="'Три успеха — стабилен, три провала — смерть'">
          <GameIcon class="inline-icon" name="heartPlus" :size="14" /> {{ deathSaves?.successes ?? 0 }}/3 · <GameIcon class="inline-icon" name="skull" :size="14" /> {{ deathSaves?.failures ?? 0 }}/3
        </span>
        <button v-if="!stable" type="button" class="primary" :disabled="working || busy" @click="deathSave">Спасбросок от смерти</button>
      </template>
      <button v-if="conditions.includes('prone') && !dying" type="button" :disabled="working || busy" title="Встать: в бою — половина скорости" @click="stand">Встать</button>
    </div>

    <details v-if="canApply" class="apply-condition">
      <summary>Наложить состояние</summary>
      <label>
        Состояние
        <select v-model="code" :disabled="working">
          <option v-for="entry in CONDITIONS" :key="entry.code" :value="entry.code">{{ entry.label }}</option>
          <option value="exhaustion">⧗ Истощение</option>
        </select>
      </label>
      <label v-if="code === 'exhaustion'">
        Уровень истощения
        <input v-model.number="level" type="number" min="1" max="6" :disabled="working" />
      </label>
      <p class="muted rule">{{ code === 'exhaustion' ? conditionInfo(`exhaustion_${level}`).rule : conditionInfo(code).rule }}</p>
      <label class="checkbox-label">
        <input v-model="withSave" type="checkbox" :disabled="working" /> Цель делает спасбросок
      </label>
      <div v-if="withSave" class="save-row">
        <label>
          Характеристика
          <select v-model="saveAbility" :disabled="working">
            <option v-for="[value, label] in ABILITY_OPTIONS" :key="value" :value="value">{{ label }}</option>
          </select>
        </label>
        <label>
          СЛ
          <input v-model.number="saveDc" type="number" min="1" max="40" :disabled="working" />
        </label>
        <label>
          Повторять
          <select v-model="repeat" :disabled="working">
            <option value="">не повторять</option>
            <option value="end">в конце её хода</option>
            <option value="start">в начале её хода</option>
          </select>
        </label>
      </div>
      <label>
        Длительность, ходов (пусто — пока не снимут; 1 минута = 10)
        <input v-model.number="duration" type="number" min="1" max="1000" :disabled="working" placeholder="без срока" />
      </label>
      <label>
        Источник
        <select v-model="sourceId" :disabled="working">
          <option v-if="isManager" value="">— без источника —</option>
          <option v-for="source in sources" :key="source.id" :value="source.id">{{ source.name }}</option>
        </select>
      </label>
      <button type="button" class="primary" :disabled="working || busy" @click="apply">Наложить</button>
    </details>

    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.conditions-panel{margin-top:14px}
.conditions-panel h4{margin:0 0 6px}
.condition-chips{list-style:none;margin:0 0 8px;padding:0;display:flex;flex-direction:column;gap:6px}
.condition-chips li{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:4px 8px;border-radius:4px;background:#0003;border:1px solid var(--brass-light)}
.chip-icon{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#0006;color:var(--gold-light);font-weight:700}
.condition-chips small{flex-basis:100%;margin:0;font-size:11px}
.chip-remove{margin-left:auto;min-height:24px;width:24px;padding:0;font-size:12px}
.code-dead,.code-unconscious{border-color:#a8261c}
.condition-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:8px 0}
.death-track{font-weight:700;letter-spacing:.04em}
.apply-condition summary{font-size:15px}
.save-row{display:grid;grid-template-columns:1fr 70px 1fr;gap:8px}
.save-row label{margin:6px 0}
.rule{font-size:12px;margin:2px 0 8px}
</style>
