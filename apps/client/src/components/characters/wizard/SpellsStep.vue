<script setup lang="ts">
import type { HeroBuilder } from '../../../characterWizard/heroBuilder';
import SpellPicker from '../../spells/SpellPicker.vue';

defineProps<{
  wizard: HeroBuilder;
}>();
</script>

<template>
  <h3>Какой магией владеет герой?</h3>
  <p class="muted">Щёлкните по заклинанию — справа всё о нём; ✓ или «Выбрать» — взять, двойной щелчок — тоже.</p>
  <SpellPicker
    v-if="wizard.caster && wizard.cantripOptions.length" v-model="wizard.choice.cantrips" :options="wizard.cantripOptions" :limit="wizard.caster.cantrips"
    label="Заговоры — творятся сколько угодно"
  />
  <SpellPicker
    v-if="wizard.caster && wizard.spellOptions.length" v-model="wizard.choice.spells" :options="wizard.spellOptions" :limit="wizard.spellLimit"
    :label="`${wizard.caster.spells === 'spellbook' ? 'В книгу заклинаний' : wizard.caster.spells === 'prepared' ? 'Подготовленные' : 'Известные'} заклинания 1-го круга`"
  />
  <SpellPicker v-if="wizard.highElf" v-model="wizard.raceCantripList" :options="wizard.wizardCantrips" :limit="1" label="Заговор высшего эльфа (из списка волшебника)" />
</template>

<style scoped src="./wizardKit.css"></style>

