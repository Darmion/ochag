<script setup lang="ts">
import { PREFER, PURPOSES, type SpellTemplate } from '../../../../../packages/domain/spells/spell-template';

defineProps<{ template: SpellTemplate; locked: boolean }>();
</script>

<template>
  <div class="grid">
    <label>К1 Назначение<select v-model="template.hints.purpose" data-path="hints.purpose" :disabled="locked"><option v-for="[value, label] in PURPOSES" :key="value" :value="value">{{ label }}</option></select></label>
    <label>К2 Кого предпочитать<select v-model="template.hints.prefer" :disabled="locked"><option v-for="[value, label] in PREFER" :key="value" :value="value">{{ label }}</option></select></label>
    <label class="checkbox-label"><input v-model="template.hints.avoidAllies" data-path="hints.avoidAllies" type="checkbox" :disabled="locked" /> К3 не задевать своих</label>
    <label class="wide">К4 Фраза для журнала<input v-model="template.hints.logPhrase" maxlength="300" :disabled="locked" translate="no" placeholder="{заклинатель} касается {цель} — …" /></label>
  </div>
</template>

<style scoped src="./builderKit.css"></style>
