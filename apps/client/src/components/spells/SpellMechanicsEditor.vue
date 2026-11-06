<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { ABILITY_OPTIONS, CONDITIONS } from '../../rules/conditions';
import { DAMAGE_TYPES } from '../../rules/objectRules';
import { isValidFormula } from '../../campaign/campaignRules';

export type MechanicsOverrides = {
  attackKind: string | null;
  saveAbility: string | null;
  halfOnSave: boolean | null;
  damageType: string | null;
  conditionCode: string | null;
  conditionRounds: number | null;
  conditionRepeat: string | null;
  createsZone: boolean;
};

export type SpellFormulas = { damageFormula: string | null; healingFormula: string | null; upcastFormula?: string | null };
const props = defineProps<{ overrides: MechanicsOverrides | null; busy: boolean; fromText: boolean; formulas?: SpellFormulas | null }>();
const emit = defineEmits<{ save: [overrides: MechanicsOverrides, formulas: SpellFormulas | null] }>();
const damageFormula = ref(props.formulas?.damageFormula ?? '');
const healingFormula = ref(props.formulas?.healingFormula ?? '');
const upcastFormula = ref(props.formulas?.upcastFormula ?? '');
watch(() => props.formulas, value => {
  damageFormula.value = value?.damageFormula ?? '';
  healingFormula.value = value?.healingFormula ?? '';
  upcastFormula.value = value?.upcastFormula ?? '';
});
const formulaProblem = computed(() => {
  if (damageFormula.value.trim() && !isValidFormula(damageFormula.value)) return 'Формула урона: NdM и члены через + или −, например 8d6 или 1d10+@int.';
  if (healingFormula.value.trim() && !isValidFormula(healingFormula.value)) return 'Формула лечения: NdM и члены через + или −, например 1d8+@wis.';
  if (upcastFormula.value.trim() && !/^\d*d\d+$/i.test(upcastFormula.value.trim())) return 'Повышение ячейки: только кости, без прибавок, например 1d6.';
  return '';
});

const empty = (): MechanicsOverrides => ({
  attackKind: null, saveAbility: null, halfOnSave: null, damageType: null, conditionCode: null, conditionRounds: null, conditionRepeat: null,
  createsZone: false,
});
const form = ref<MechanicsOverrides>({ ...empty(), ...(props.overrides ?? {}) });
const halfTextOf = (value: MechanicsOverrides | null) => value?.halfOnSave === null || value?.halfOnSave === undefined ? '' : String(value.halfOnSave);
const halfText = ref(halfTextOf(props.overrides));
watch(() => props.overrides, value => {
  form.value = { ...empty(), ...(value ?? {}) };
  halfText.value = halfTextOf(value);
});
watch(halfText, value => { form.value.halfOnSave = value === '' ? null : value === 'true'; });

const keep = props.fromText ? 'как в тексте' : 'нет';

function save() {
  if (formulaProblem.value) return;
  const formulas = props.formulas
    ? { damageFormula: damageFormula.value.trim() || null, healingFormula: healingFormula.value.trim() || null, upcastFormula: upcastFormula.value.trim() || null }
    : null;
  emit('save', {
    ...form.value,
    attackKind: form.value.attackKind || null,
    saveAbility: form.value.saveAbility || null,
    damageType: form.value.damageType || null,
    conditionCode: form.value.conditionCode || null,
    conditionRepeat: form.value.conditionRepeat || null,
    conditionRounds: form.value.conditionRounds ? Math.round(form.value.conditionRounds) : null,
  }, formulas);
}
</script>

<template>
  <div class="mechanics-editor">
    <template v-if="formulas">
      <label>
        Формула урона
        <input v-model="damageFormula" placeholder="например, 8d6" :disabled="busy" />
      </label>
      <label>
        Формула лечения
        <input v-model="healingFormula" placeholder="например, 1d8+@wis" :disabled="busy" />
      </label>
      <label title="Сколько костей прибавить за каждый круг ячейки выше базового">
        За круг ячейки выше
        <input v-model="upcastFormula" placeholder="например, 1d6" :disabled="busy" />
      </label>
    </template>
    <label>
      Атака
      <select v-model="form.attackKind" :disabled="busy">
        <option :value="null">{{ keep }}</option>
        <option value="none">нет</option>
        <option value="melee">рукопашная</option>
        <option value="ranged">дальнобойная</option>
      </select>
    </label>
    <label>
      Спасбросок цели
      <select v-model="form.saveAbility" :disabled="busy">
        <option :value="null">{{ keep }}</option>
        <option value="none">нет</option>
        <option v-for="[value, label] in ABILITY_OPTIONS" :key="value" :value="value">{{ label }}</option>
      </select>
    </label>
    <label>
      При успехе
      <select v-model="halfText" :disabled="busy">
        <option value="">{{ keep }}</option>
        <option value="true">половина урона</option>
        <option value="false">без урона</option>
      </select>
    </label>
    <label>
      Тип урона
      <select v-model="form.damageType" :disabled="busy">
        <option :value="null">{{ keep }}</option>
        <option v-for="type in DAMAGE_TYPES" :key="type.id" :value="type.id">{{ type.label }}</option>
      </select>
    </label>
    <label>
      Состояние при провале
      <select v-model="form.conditionCode" :disabled="busy">
        <option :value="null">{{ keep }}</option>
        <option value="none">нет</option>
        <option v-for="condition in CONDITIONS" :key="condition.code" :value="condition.code">{{ condition.label }}</option>
      </select>
    </label>
    <label>
      Ходов
      <input v-model.number="form.conditionRounds" type="number" min="1" max="1000" :placeholder="keep" :disabled="busy" />
    </label>
    <label>
      Повторный спасбросок
      <select v-model="form.conditionRepeat" :disabled="busy">
        <option :value="null">{{ keep }}</option>
        <option value="none">нет</option>
        <option value="end">в конце хода цели</option>
        <option value="start">в начале хода цели</option>
      </select>
    </label>
    <label class="checkbox-label" title="Сотворение с областью заведёт на сцене персистентный триггер той же формы — бьёт входящих и стоящих там же каждый ход, пока не кончится концентрация («Шипастый рост», «Паутина», «Стражи духа»)">
      <input v-model="form.createsZone" type="checkbox" :disabled="busy" /> Заклинание создаёт зону
    </label>
    <p v-if="formulas" class="hint">Формулы: NdM и члены через + или −; @str, @dex, @con, @int, @wis, @cha, @prof. {{ fromText ? 'Пустое поле — без изменений.' : 'Пустое поле — без формулы.' }}</p>
    <p v-if="formulaProblem" class="problem" role="alert">{{ formulaProblem }}</p>
    <button type="button" class="primary" :disabled="busy || Boolean(formulaProblem)" @click="save">Сохранить механику</button>
  </div>
</template>

<style scoped>
.mechanics-editor{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px 10px;align-items:end;margin-top:8px}
.mechanics-editor label{margin:0;font-size:12px}
.mechanics-editor select,.mechanics-editor input{min-height:32px;padding:2px 6px}
.mechanics-editor button{min-height:32px;padding:2px 10px;font-size:13px}
.mechanics-editor .hint,.mechanics-editor .problem{grid-column:1 / -1;margin:0;font-size:12px}
.mechanics-editor .hint{color:var(--muted-ink)}
.mechanics-editor .problem{color:#c0392b}
</style>
