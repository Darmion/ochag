<script setup lang="ts">
import { DISMISS, DURATION_KINDS, type SpellTemplate } from '../../../../../packages/domain/spells/spell-template';

defineProps<{ template: SpellTemplate; locked: boolean }>();
</script>

<template>
  <div class="grid">
    <label>В1 Длительность
      <select v-model="template.duration.kind" data-path="duration.kind" :disabled="locked"><option v-for="[value, label] in DURATION_KINDS" :key="value" :value="value">{{ label }}</option></select>
    </label>
    <label v-if="['rounds', 'minutes', 'hours', 'days'].includes(template.duration.kind)">Сколько<input v-model.number="template.duration.value" data-path="duration.value" type="number" min="1" :disabled="locked" /></label>
    <label v-if="template.duration.kind === 'special'" class="wide">Какая<input v-model="template.duration.text" maxlength="200" :disabled="locked" translate="no" /></label>
    <label>В3 Закончить досрочно
      <select v-model="template.duration.dismiss" :disabled="locked"><option v-for="[value, label] in DISMISS" :key="value" :value="value">{{ label }}</option></select>
    </label>
  </div>
  <div class="flags">
    <label class="checkbox-label"><input v-model="template.duration.concentration" data-path="duration.concentration" type="checkbox" :disabled="locked" /> В2 Концентрация</label>
    <label class="checkbox-label" title="По правилам эффекты одного заклинания не складываются"><input v-model="template.duration.stacks" type="checkbox" :disabled="locked" /> В4 Складывается само с собой</label>
  </div>
</template>

<style scoped src="./builderKit.css"></style>
