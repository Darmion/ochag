<script setup lang="ts">
import type { SpellTemplate } from '../../../../../packages/domain/spells/spell-template';
import { addAction, duplicate } from '../../spellBuilder/edits';
import ActionEditor from './ActionEditor.vue';

defineProps<{ template: SpellTemplate; locked: boolean }>();
</script>

<template>
  <div class="flags">
    <label class="checkbox-label"><input v-model="template.ending.casterDown" type="checkbox" :disabled="locked" /> И3 хиты заклинателя упали до 0</label>
    <label class="checkbox-label"><input v-model="template.ending.targetActs" type="checkbox" :disabled="locked" /> И5 цель атаковала или колдовала</label>
    <label class="checkbox-label"><input v-model="template.ending.targetDamaged" type="checkbox" :disabled="locked" /> И6 цель получила урон</label>
    <label class="checkbox-label"><input v-model="template.ending.targetSaves" type="checkbox" :disabled="locked" /> И7 цель спаслась</label>
    <label class="checkbox-label"><input v-model="template.ending.recast" type="checkbox" :disabled="locked" /> И9 сотворено ещё раз</label>
    <label class="checkbox-label"><input v-model="template.ending.dispellable" type="checkbox" :disabled="locked" /> И11 рассеивается</label>
  </div>
  <div class="grid">
    <label>И4 Цель дальше, фт.<input v-model.number="template.ending.distanceFeet" type="number" min="0" :disabled="locked" placeholder="0 — нет" /></label>
    <label>И10 Сработало раз<input v-model.number="template.ending.afterUses" type="number" min="0" :disabled="locked" placeholder="0 — нет" /></label>
  </div>
  <p class="muted hint">И12 При окончании — действия:</p>
  <ActionEditor
    v-for="(_, index) in template.ending.onEnd" :key="template.ending.onEnd[index]!.id" v-model="template.ending.onEnd[index]!" :depth="0" :disabled="locked"
    @remove="template.ending.onEnd.splice(index, 1)" @duplicate="duplicate(template.ending.onEnd, index)"
  />
  <button type="button" class="add-button" :disabled="locked" @click="addAction(template.ending.onEnd)">＋ при окончании</button>
</template>

<style scoped src="./builderKit.css"></style>
