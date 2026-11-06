<script setup lang="ts">
import { CASTING_TIMES, RANGE_KINDS, REACTION_TRIGGERS, type SpellTemplate } from '../../../../../packages/domain/spells/spell-template';

defineProps<{ template: SpellTemplate; locked: boolean }>();
</script>

<template>
  <div class="grid">
    <label>Б1 Время
      <select v-model="template.casting.time" data-path="casting.time" :disabled="locked"><option v-for="[value, label] in CASTING_TIMES" :key="value" :value="value">{{ label }}</option></select>
    </label>
    <label v-if="template.casting.time === 'custom'">Минут<input v-model.number="template.casting.minutes" type="number" min="1" :disabled="locked" /></label>
    <label v-if="template.casting.time === 'reaction'">Б2 На что реакция
      <select v-model="template.casting.trigger" :disabled="locked"><option v-for="[value, label] in REACTION_TRIGGERS" :key="value" :value="value">{{ label }}</option></select>
    </label>
    <label v-if="template.casting.time === 'reaction' && template.casting.trigger === 'custom'" class="wide">Своё<input v-model="template.casting.triggerText" maxlength="300" :disabled="locked" translate="no" /></label>
    <label>Б6 Дистанция
      <select v-model="template.casting.range" data-path="casting.range" :disabled="locked"><option v-for="[value, label] in RANGE_KINDS" :key="value" :value="value">{{ label }}</option></select>
    </label>
    <label v-if="template.casting.range === 'feet' || template.casting.range === 'miles'">{{ template.casting.range === 'feet' ? 'Футов' : 'Миль' }}<input v-model.number="template.casting.rangeValue" data-path="casting.rangeValue" type="number" min="0" :disabled="locked" /></label>
    <label v-if="template.casting.range === 'special'" class="wide">Какая<input v-model="template.casting.rangeText" maxlength="200" :disabled="locked" translate="no" /></label>
  </div>
  <div class="flags">
    <label class="checkbox-label"><input v-model="template.casting.verbal" data-path="casting.verbal" type="checkbox" :disabled="locked" /> В</label>
    <label class="checkbox-label"><input v-model="template.casting.somatic" data-path="casting.somatic" type="checkbox" :disabled="locked" /> С</label>
    <label class="checkbox-label"><input v-model="template.casting.material" data-path="casting.material" type="checkbox" :disabled="locked" /> М</label>
    <label class="checkbox-label"><input v-model="template.casting.ritual" data-path="casting.ritual" type="checkbox" :disabled="locked" /> Б3 Ритуал</label>
    <label class="checkbox-label"><input v-model="template.casting.needsSight" type="checkbox" :disabled="locked" /> Б7 Цель нужно видеть</label>
  </div>
  <div v-if="template.casting.material" class="grid">
    <label class="wide">Б5 Материал<input v-model="template.casting.materialText" data-path="casting.materialText" maxlength="500" :disabled="locked" translate="no" /></label>
    <label>Цена, зм<input v-model.number="template.casting.materialCost" data-path="casting.materialCost" type="number" min="0" :disabled="locked" /></label>
    <label class="checkbox-label"><input v-model="template.casting.materialConsumed" data-path="casting.materialConsumed" type="checkbox" :disabled="locked" /> расходуется</label>
  </div>
</template>

<style scoped src="./builderKit.css"></style>
