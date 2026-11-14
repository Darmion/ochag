<script setup lang="ts">
import { computed } from 'vue';
import type { LevelUp } from '../../../levelUp/useLevelUp';
import SpellPicker from '../../spells/SpellPicker.vue';

const props = defineProps<{ level: LevelUp }>();

const replaceTo = computed<string[]>({
  get: () => (props.level.form.replaceTo ? [props.level.form.replaceTo] : []),
  set: value => { props.level.form.replaceTo = value[0] ?? ''; },
});
const forgotten = computed(() => props.level.replaceable.find(spell => spell.index === props.level.form.replaceFrom) ?? null);
</script>

<template>
  <template v-if="level.plan">
    <template v-if="level.plan.cantrips">
      <h3>Новые заговоры</h3>
      <SpellPicker v-model="level.form.cantrips" :options="level.cantripOptions" :limit="level.plan.cantrips" label="Заговоры" />
    </template>

    <template v-if="level.plan.spells">
      <h3>Новые заклинания <small class="muted">(до {{ level.plan.maxSpellLevel }} круга{{ level.plan.anyList ? ', из списка любого класса' : ', из списка класса' }})</small></h3>
      <SpellPicker v-model="level.form.spells" :options="level.spellOptions" :limit="level.plan.spells" label="Заклинания" />
    </template>

    <template v-if="level.plan.replaceSpell && level.replaceable.length">
      <h3>Заменить заклинание <small class="muted">(по желанию)</small></h3>
      <label class="field">Какое известное заклинание забыть
        <select v-model="level.form.replaceFrom">
          <option value="">— не менять —</option>
          <option v-for="spell in level.replaceable" :key="spell.index" :value="spell.index">{{ level.spellName(spell) }} · {{ spell.level }} ур.</option>
        </select>
      </label>
      <SpellPicker v-if="forgotten" v-model="replaceTo" :options="level.replaceOptions" :limit="1" :label="`Вместо «${level.spellName(forgotten)}»`" />
    </template>
  </template>
</template>

<style scoped src="../../characters/wizard/wizardKit.css"></style>
