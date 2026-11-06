<script setup lang="ts">
import { ABILITIES, ABILITY_LABELS, DAMAGE_LABELS, RACE_INFO, bonusText, toggle } from '../../../characterWizard/catalog';
import type { HeroBuilder } from '../../../characterWizard/heroBuilder';
import type { Ability, Heroes } from '../../../characterWizard/types';
import { SIZE_LABELS, type CreatureSize } from '../../../campaign/objects';
import GameIcon from '../../game/GameIcon.vue';

defineProps<{
  wizard: HeroBuilder;
  heroes: Heroes;
}>();
</script>

<template>
  <h3>Кто ваш герой по происхождению?</h3>
  <div class="pick-layout">
    <div class="pick-list" role="listbox" aria-label="Раса">
      <button
        v-for="entry in heroes.races" :key="entry.id" type="button" role="option"
        :aria-selected="wizard.choice.race === entry.id" :class="{ active: wizard.choice.race === entry.id }" @click="wizard.choice.race = entry.id"
      >
        <span class="pick-icon"><GameIcon :name="RACE_INFO[entry.id]?.icon ?? 'raceCustom'" :size="22" /></span>
        <span><strong>{{ entry.nameRu }}</strong><small>{{ entry.custom ? '+2 и +1 на выбор' : bonusText(entry.bonuses) }}{{ entry.flexibleBonuses ? ', +1 к двум' : '' }}</small></span>
      </button>
    </div>
    <div v-if="wizard.race" class="pick-detail">
      <h4><GameIcon class="inline-icon" :name="RACE_INFO[wizard.race.id]?.icon ?? 'raceCustom'" :size="22" /> {{ wizard.race.nameRu }}</h4>
      <p class="tagline">{{ RACE_INFO[wizard.race.id]?.tagline }}</p>
      <div class="facts">
        <span>{{ SIZE_LABELS[wizard.race.size as CreatureSize] }}</span>
        <span>скорость {{ wizard.race.speed }} фт.</span>
        <span v-if="wizard.race.darkvision">тёмное зрение {{ wizard.race.darkvision }} фт.</span>
        <span v-if="wizard.race.custom">{{ wizard.choice.flexible[0] && wizard.choice.flexible[1] ? `${ABILITY_LABELS[wizard.choice.flexible[0]]} +2, ${ABILITY_LABELS[wizard.choice.flexible[1]]} +1` : '+2 и +1 — выберите ниже' }}</span>
        <span v-else>{{ bonusText(wizard.race.bonuses) }}{{ wizard.race.flexibleBonuses ? ', ещё +1 к двум' : '' }}</span>
      </div>
      <div v-if="wizard.race.subraces.length" class="sub-choice">
        <span class="label">Подраса</span>
        <div class="segmented">
          <button v-for="entry in wizard.race.subraces" :key="entry.id" type="button" :class="{ active: wizard.choice.subrace === entry.id }" @click="wizard.choice.subrace = entry.id">
            {{ entry.nameRu }} <small>{{ bonusText(entry.bonuses) }}</small>
          </button>
        </div>
      </div>
      <label v-if="wizard.race.ancestry" class="field">Дракон-предок — его стихия в дыхании и сопротивлении
        <select v-model="wizard.choice.ancestry">
          <option value="">— выберите —</option>
          <option v-for="entry in heroes.ancestries" :key="entry.id" :value="entry.id">{{ entry.nameRu }} — {{ DAMAGE_LABELS[entry.damage] ?? entry.damage }}, {{ entry.breath }}</option>
        </select>
      </label>
      <div v-if="wizard.race.custom" class="sub-choice custom-race">
        <label class="field">Название расы
          <input v-model="wizard.choice.raceName" maxlength="40" placeholder="Например: Табакси, Генаси, Аасимар" />
        </label>
        <label class="field">+2 к характеристике
          <select :value="wizard.choice.flexible[0] ?? ''" @change="wizard.setCustomBonus(0, ($event.target as HTMLSelectElement).value as Ability | '')">
            <option value="">— выберите —</option>
            <option v-for="ability in ABILITIES" :key="ability" :value="ability">{{ ABILITY_LABELS[ability] }}{{ wizard.primary.has(ability) ? ' — важна для класса' : '' }}</option>
          </select>
        </label>
        <label class="field">+1 к другой
          <select :value="wizard.choice.flexible[1] ?? ''" @change="wizard.setCustomBonus(1, ($event.target as HTMLSelectElement).value as Ability | '')">
            <option value="">— выберите —</option>
            <option v-for="ability in ABILITIES.filter(a => a !== wizard.choice.flexible[0])" :key="ability" :value="ability">{{ ABILITY_LABELS[ability] }}{{ wizard.primary.has(ability) ? ' — важна для класса' : '' }}</option>
          </select>
        </label>
      </div>
      <div v-if="wizard.race.flexibleBonuses" class="sub-choice">
        <span class="label">+1 к двум характеристикам (кроме Харизмы) — {{ wizard.choice.flexible.length }} из 2</span>
        <div class="chips">
          <button v-for="ability in ABILITIES.filter(a => a !== 'charisma')" :key="ability" type="button" class="chip" :class="{ active: wizard.choice.flexible.includes(ability), primary: wizard.primary.has(ability) }" @click="toggle(wizard.choice.flexible, ability, 2)">
            {{ ABILITY_LABELS[ability] }}
          </button>
        </div>
      </div>
      <ul class="traits">
        <li v-for="trait in [...wizard.race.traits, ...(wizard.subrace?.traits ?? [])]" :key="trait[0]"><strong>{{ trait[0] }}.</strong> {{ trait[1] }}</li>
        <li><strong>Языки.</strong> {{ wizard.race.languages }}</li>
      </ul>
    </div>
  </div>
</template>

<style scoped src="./wizardKit.css"></style>

