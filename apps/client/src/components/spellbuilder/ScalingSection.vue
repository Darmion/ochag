<script setup lang="ts">
import { computed } from 'vue';
import { EFFECT_CATALOG, SCALING_PER, SCALING_WHAT, allActions, allEffects, newId, type SpellTemplate } from '../../../../../packages/domain/spells/spell-template';
import GameIcon from '../game/GameIcon.vue';

const props = defineProps<{ template: SpellTemplate; locked: boolean }>();
const refOptions = computed(() => [
  ...allActions(props.template).map(({ action }) => [action.id, `действие «${action.name}»`] as const),
  ...allEffects(props.template).filter(({ effect }) => ['damage', 'heal', 'temp-hp', 'max-hp'].includes(effect.kind))
    .map(({ effect, action }) => [effect.id, `«${action.name}»: ${EFFECT_CATALOG[effect.kind].label.toLowerCase()}`] as const),
]);
function addScaling() {
  props.template.scaling.push({ id: newId('s'), what: 'damage', per: 'slot', ref: refOptions.value[0]?.[0] ?? '', amount: '1к6', steps: [] });
}
</script>

<template>
  <div v-for="(rule, index) in template.scaling" :key="rule.id" class="grid scaling">
    <label>Что растёт<select v-model="rule.what" :disabled="locked"><option v-for="[value, label] in SCALING_WHAT" :key="value" :value="value">{{ label }}</option></select></label>
    <label>Как<select v-model="rule.per" :disabled="locked"><option v-for="[value, label] in SCALING_PER" :key="value" :value="value">{{ label }}</option></select></label>
    <label>К чему<select v-model="rule.ref" :disabled="locked"><option value="">к первому подходящему</option><option v-for="[value, label] in refOptions" :key="value" :value="value">{{ label }}</option></select></label>
    <label v-if="rule.per !== 'steps'">На сколько<input v-model="rule.amount" maxlength="120" :disabled="locked" placeholder="1к6 или 1" /></label>
    <div v-else class="wide steps-editor">
      <span v-for="(stepRow, stepIndex) in rule.steps" :key="stepIndex" class="pair">
        круг <input v-model.number="stepRow[0]" type="number" min="0" max="9" :disabled="locked" /> → <input v-model="stepRow[1]" maxlength="120" :disabled="locked" />
        <button type="button" class="link-button icon-button" :disabled="locked" aria-label="Убрать ступень" @click="rule.steps.splice(stepIndex, 1)"><GameIcon class="inline-icon" name="close" :size="16" /></button>
      </span>
      <button type="button" class="add-button" :disabled="locked" @click="rule.steps.push([template.passport.level + rule.steps.length + 1, ''])">＋ ступень</button>
    </div>
    <button type="button" class="link-button danger-link icon-button" :disabled="locked" aria-label="Убрать правило" @click="template.scaling.splice(index, 1)"><GameIcon class="inline-icon" name="close" :size="16" /></button>
  </div>
  <button type="button" class="add-button" :disabled="locked" @click="addScaling">＋ правило усиления</button>
</template>

<style scoped src="./builderKit.css"></style>
