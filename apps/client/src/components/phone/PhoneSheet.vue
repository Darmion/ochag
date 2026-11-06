<script setup lang="ts">
import { ABILITIES, ABILITY_LABELS, abilityModifier, formatSigned } from '../../phone/sheet';
import type { PhoneSheetState } from '../../phone/phoneSheet';
import ItemArt from '../rpg/ItemArt.vue';

defineProps<{
  sheet: PhoneSheetState;
}>();
defineEmits<{
  back: [];
}>();
</script>

<template>
  <section class="card sheet">
    <button type="button" class="link" @click="$emit('back')">← Персонажи</button>
    <h2>{{ sheet.character.name }}</h2>

    <p v-if="sheet.lastRoll" class="roll-banner">{{ sheet.lastRoll }}</p>

    <nav class="tabs">
      <button type="button" :class="{ active: sheet.sheetTab === 'core' }" @click="sheet.sheetTab = 'core'">Лист</button>
      <button type="button" :class="{ active: sheet.sheetTab === 'skills' }" @click="sheet.sheetTab = 'skills'">Навыки</button>
      <button type="button" :class="{ active: sheet.sheetTab === 'gear' }" @click="sheet.sheetTab = 'gear'">Снаряжение</button>
      <button type="button" :class="{ active: sheet.sheetTab === 'spells' }" @click="sheet.sheetTab = 'spells'" v-if="sheet.spells.length || sheet.spellSlots.length">Заклинания</button>
    </nav>

    <div v-if="sheet.sheetTab === 'core'" class="tab">
      <div class="vitals">
        <div class="vital">
          <small>Хиты</small>
          <div class="stepper">
            <button type="button" @click="sheet.adjustHp(-1)">−</button>
            <b>{{ sheet.character.hp_current }}/{{ sheet.character.hp_max }}</b>
            <button type="button" @click="sheet.adjustHp(1)">+</button>
          </div>
        </div>
        <div class="vital"><small>КД</small><b>{{ sheet.character.armor_class }}</b></div>
        <div class="vital"><small>Скорость</small><b>{{ sheet.character.speed_feet }} фт.</b></div>
        <div class="vital"><small>Мастерство</small><b>{{ formatSigned(sheet.proficiencyBonus) }}</b></div>
      </div>

      <h3>Характеристики</h3>
      <div class="abilities">
        <button v-for="ability in ABILITIES" :key="ability" type="button" class="ability" @click="sheet.rollCheck('ability', ability)">
          <small>{{ ABILITY_LABELS[ability] }}</small>
          <b>{{ sheet.character[ability] }}</b>
          <span>{{ formatSigned(abilityModifier(sheet.character[ability])) }}</span>
        </button>
      </div>

      <h3>Спасброски</h3>
      <ul class="rows">
        <li v-for="save in sheet.saves" :key="save.ability">
          <span>{{ ABILITY_LABELS[save.ability] }}</span>
          <span class="total">{{ sheet.saveTotal(save) === null ? '—' : formatSigned(sheet.saveTotal(save)!) }}</span>
          <button type="button" :disabled="save.hidden" @click="sheet.rollCheck('save', save.ability)">Бросить</button>
        </li>
      </ul>

      <template v-if="sheet.resources.length">
        <h3>Ресурсы</h3>
        <ul class="rows">
          <li v-for="resource in sheet.resources" :key="resource.id">
            <span>{{ resource.name }}</span>
            <span class="total">{{ resource.current }}/{{ resource.max }}</span>
            <button type="button" @click="sheet.adjustResource(resource, -1)">−</button>
            <button type="button" @click="sheet.adjustResource(resource, 1)">+</button>
          </li>
        </ul>
      </template>

      <h3>Отдых</h3>
      <div class="rest-buttons">
        <button type="button" @click="sheet.rest('short')">Короткий отдых</button>
        <button type="button" @click="sheet.rest('long')">Длинный отдых</button>
      </div>
    </div>

    <div v-else-if="sheet.sheetTab === 'skills'" class="tab">
      <ul class="rows">
        <li v-for="skill in sheet.skills" :key="skill.index">
          <span>{{ sheet.skillLabel(skill.index) }}</span>
          <span class="total">{{ formatSigned(sheet.skillTotal(skill)) }}</span>
          <button type="button" @click="sheet.rollCheck('skill', skill.index)">Бросить</button>
        </li>
      </ul>
    </div>

    <div v-else-if="sheet.sheetTab === 'gear'" class="tab">
      <h3>Оружие</h3>
      <ul class="rows" v-if="sheet.weapons.length">
        <li v-for="weapon in sheet.weapons" :key="weapon.id">
          <span class="weapon-name"><ItemArt :name="weapon.name" :size="28" :fallback-icon="weapon.weapon_kind === 'ranged' ? 'bow' : 'swords'" /> {{ weapon.name }}</span>
          <span class="muted">{{ weapon.damage_formula }}</span>
          <button type="button" @click="sheet.rollCheck('attack', weapon.id)">Атака</button>
        </li>
      </ul>
      <p v-else class="muted">Оружия нет.</p>
    </div>

    <div v-else-if="sheet.sheetTab === 'spells'" class="tab">
      <p v-if="sheet.spellSlots.length" class="muted">
        Ячейки: <span v-for="slot in sheet.spellSlots" :key="slot.level">{{ slot.level }}-го ур. {{ slot.current }}/{{ slot.max }}; </span>
      </p>
      <ul class="rows">
        <li v-for="known in sheet.spells" :key="known.id">
          <span>{{ known.spell?.nameRu ?? known.spell?.name ?? '—' }}</span>
          <span class="muted" v-if="known.spell">{{ known.spell.level === 0 ? 'заговор' : `${known.spell.level}-й ур.` }}</span>
          <button type="button" @click="sheet.castSpell(known)">Сотворить</button>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped src="./phoneKit.css"></style>

<style scoped>
.roll-banner {
  background: #3a2c1f;
  border: 1px solid #8a6b3f;
  border-radius: 6px;
  padding: 8px 10px;
  font-weight: bold;
}
.tabs {
  display: flex;
  gap: 6px;
  margin: 10px 0;
  overflow-x: auto;
}
.tabs button.active {
  background: #5a4636;
}
.vitals {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-bottom: 10px;
}
.vital {
  background: #1a1210;
  border-radius: 6px;
  padding: 8px;
  text-align: center;
}
.vital small {
  display: block;
  color: #a8957e;
}
.stepper {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.abilities {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.ability {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rows li {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #1a1210;
  border-radius: 6px;
  padding: 6px 8px;
}
.rows li span:first-child {
  flex: 1;
}
.weapon-name {
  display: flex;
  align-items: center;
  gap: 6px;
}
.weapon-name .item-art {
  flex: 0 0 auto;
}
.total {
  font-weight: bold;
  min-width: 2.5em;
  text-align: right;
}
.rest-buttons {
  display: flex;
  gap: 8px;
}
</style>
