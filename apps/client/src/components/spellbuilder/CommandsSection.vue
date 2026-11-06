<script setup lang="ts">
import { computed } from 'vue';
import { COMMAND_COSTS, COMMAND_DOES, COMMAND_LIMITS, COMMAND_WHEN, allActions, newId, type SpellTemplate } from '../../../../../packages/domain/spells/spell-template';
import GameIcon from '../game/GameIcon.vue';

const props = defineProps<{ template: SpellTemplate; locked: boolean }>();
const actionRefs = computed(() => allActions(props.template).map(({ action }) => action));
function addCommand() {
  props.template.commands.push({ id: newId('c'), name: 'Команда', cost: 'bonus', when: 'after-cast', does: 'run-action', feet: 20, actionId: actionRefs.value[0]?.id ?? '', limit: 'turn', limitCount: 1 });
}
</script>

<template>
  <p class="muted hint">Кнопки на панели действий, пока заклинание действует: сдвинуть зону, ударить ещё раз.</p>
  <div v-for="(command, index) in template.commands" :key="command.id" class="grid command">
    <label>Ж1 Кнопка<input v-model="command.name" maxlength="100" :disabled="locked" translate="no" /></label>
    <label>Ж2 Цена<select v-model="command.cost" :disabled="locked"><option v-for="[value, label] in COMMAND_COSTS" :key="value" :value="value">{{ label }}</option></select></label>
    <label>Ж3 Когда<select v-model="command.when" :disabled="locked"><option v-for="[value, label] in COMMAND_WHEN" :key="value" :value="value">{{ label }}</option></select></label>
    <label>Ж4 Что делает<select v-model="command.does" :disabled="locked"><option v-for="[value, label] in COMMAND_DOES" :key="value" :value="value">{{ label }}</option></select></label>
    <label v-if="command.does.startsWith('move')">Футов<input v-model.number="command.feet" type="number" min="0" :disabled="locked" /></label>
    <label v-if="command.does === 'run-action'">Действие<select v-model="command.actionId" :disabled="locked"><option v-for="action in actionRefs" :key="action.id" :value="action.id">{{ action.name }}</option></select></label>
    <label>Ж5 Ограничение<select v-model="command.limit" :disabled="locked"><option v-for="[value, label] in COMMAND_LIMITS" :key="value" :value="value">{{ label }}</option></select></label>
    <button type="button" class="link-button danger-link icon-button" :disabled="locked" aria-label="Убрать команду" @click="template.commands.splice(index, 1)"><GameIcon class="inline-icon" name="close" :size="16" /></button>
  </div>
  <button type="button" class="add-button" :disabled="locked" @click="addCommand">＋ команда</button>
</template>

<style scoped src="./builderKit.css"></style>
