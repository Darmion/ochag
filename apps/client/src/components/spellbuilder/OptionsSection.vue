<script setup lang="ts">
import { PARAM_CHOOSERS, PARAM_KINDS, newId, type SpellTemplate } from '../../../../../packages/domain/spells/spell-template';
import { addAction, duplicate } from '../../spellBuilder/edits';
import ActionEditor from './ActionEditor.vue';
import GameIcon from '../game/GameIcon.vue';

const props = defineProps<{ template: SpellTemplate; locked: boolean }>();

function addMode() {
  props.template.options.modes.push({ id: newId('m'), name: `Режим ${props.template.options.modes.length + 1}`, actions: [] });
}
function addParam() {
  props.template.options.params.push({ id: newId('p'), key: 'стихия', label: 'Стихия', kind: 'damage-type', options: [], chooser: 'caster' });
}
</script>

<template>
  <details class="help">
    <summary>Как это устроено</summary>
    <p>Д1 Режимы — взаимоисключающие наборы действий: при сотворении выбирают один. Д2 Параметры — что выбирают при сотворении (вид урона, характеристику…) и подставляют в действия.</p>
  </details>
  <div v-for="(mode, index) in template.options.modes" :key="mode.id" class="mode">
    <header class="row">
      <input v-model="mode.name" maxlength="100" :disabled="locked" translate="no" aria-label="Название режима" />
      <button type="button" class="link-button danger-link" :disabled="locked" @click="template.options.modes.splice(index, 1)"><GameIcon class="inline-icon" name="close" :size="16" /> режим</button>
    </header>
    <ActionEditor
      v-for="(_, actionIndex) in mode.actions" :key="mode.actions[actionIndex]!.id" v-model="mode.actions[actionIndex]!" :depth="0" :disabled="locked"
      @remove="mode.actions.splice(actionIndex, 1)" @duplicate="duplicate(mode.actions, actionIndex)"
    />
    <button type="button" class="add-button" :disabled="locked" @click="addAction(mode.actions)">＋ действие режима</button>
  </div>
  <button type="button" class="add-button" :disabled="locked" @click="addMode">＋ режим</button>
  <div v-for="(param, index) in template.options.params" :key="param.id" class="grid param">
    <label>Имя {параметра}<input v-model="param.key" maxlength="40" :disabled="locked" /></label>
    <label>Подпись<input v-model="param.label" maxlength="100" :disabled="locked" translate="no" /></label>
    <label>Что выбирают
      <select v-model="param.kind" :disabled="locked"><option v-for="[value, label] in PARAM_KINDS" :key="value" :value="value">{{ label }}</option></select>
    </label>
    <label>Кто
      <select v-model="param.chooser" :disabled="locked"><option v-for="[value, label] in PARAM_CHOOSERS" :key="value" :value="value">{{ label }}</option></select>
    </label>
    <label v-if="param.kind === 'choice' || param.kind === 'damage-type'" class="wide">Варианты через запятую <small class="muted">(пусто — все)</small>
      <input :value="param.options.join(', ')" :disabled="locked" @change="param.options = ($event.target as HTMLInputElement).value.split(',').map(entry => entry.trim()).filter(Boolean)" />
    </label>
    <button type="button" class="link-button danger-link icon-button" :disabled="locked" aria-label="Убрать параметр" @click="template.options.params.splice(index, 1)"><GameIcon class="inline-icon" name="close" :size="16" /></button>
  </div>
  <button type="button" class="add-button" :disabled="locked" @click="addParam">＋ параметр</button>
</template>

<style scoped src="./builderKit.css"></style>
<style scoped>
.mode{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px dashed var(--g-line,var(--brass-light));border-radius:8px}
</style>
