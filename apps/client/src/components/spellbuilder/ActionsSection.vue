<script setup lang="ts">
import type { SpellTemplate } from '../../../../../packages/domain/spells/spell-template';
import { addAction, duplicate } from '../../spellBuilder/edits';
import ActionEditor from './ActionEditor.vue';

defineProps<{ template: SpellTemplate; locked: boolean }>();
</script>

<template>
  <details class="help">
    <summary>Как это устроено</summary>
    <p>Заклинание — список действий: когда срабатывает, кого касается, какая проверка и что следует при каждом исходе. ✓ игра считает сама, ◐ частично, ✗ — мастер получит окно «примените вручную».</p>
  </details>
  <ActionEditor
    v-for="(_, index) in template.actions" :key="template.actions[index]!.id" v-model="template.actions[index]!" :depth="0" :disabled="locked"
    @remove="template.actions.splice(index, 1)" @duplicate="duplicate(template.actions, index)"
  />
  <button type="button" class="add-button" :disabled="locked" @click="addAction(template.actions)">＋ действие</button>
</template>

<style scoped src="./builderKit.css"></style>
