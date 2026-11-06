<script setup lang="ts">
import { ABILITY_LABELS, CLASS_INFO, DAMAGE_LABELS } from '../../../characterWizard/catalog';
import type { HeroBuilder } from '../../../characterWizard/heroBuilder';
import type { Heroes } from '../../../characterWizard/types';
import { t } from '../../../i18n/i18n';
import GameIcon from '../../game/GameIcon.vue';

defineProps<{
  wizard: HeroBuilder;
  heroes: Heroes;
}>();
</script>

<template>
  <h3>Чем ваш герой занимается?</h3>
  <div class="pick-layout">
    <div class="pick-list" role="listbox" aria-label="Класс">
      <button
        v-for="entry in heroes.classes" :key="entry.id" type="button" role="option"
        :aria-selected="wizard.choice.className === entry.id" :class="{ active: wizard.choice.className === entry.id }" @click="wizard.choice.className = entry.id"
      >
        <span class="pick-icon"><GameIcon :name="CLASS_INFO[entry.id]?.icon ?? 'sparkle'" :size="22" /></span>
        <span><strong>{{ entry.nameRu }}</strong><small>{{ CLASS_INFO[entry.id]?.role }}</small></span>
      </button>
    </div>
    <div v-if="wizard.heroClass" class="pick-detail">
      <h4><GameIcon class="inline-icon" :name="wizard.classInfo?.icon ?? 'sparkle'" :size="22" /> {{ wizard.heroClass.nameRu }}</h4>
      <p class="tagline">{{ wizard.classInfo?.tagline }}</p>
      <div class="facts">
        <span v-if="wizard.classInfo" :data-difficulty="wizard.classInfo.difficulty">освоить: {{ wizard.classInfo.difficulty }}</span>
        <span v-if="wizard.classInfo">{{ t('главное: {abilities}', { abilities: wizard.classInfo.order.slice(0, 2).map(a => t(ABILITY_LABELS[a])).join(t(' и ')) }) }}</span>
        <span>спасброски: {{ wizard.heroClass.saves.map(a => ABILITY_LABELS[a]).join(', ') }}</span>
        <span>{{ wizard.heroClass.caster ? `магия: ${ABILITY_LABELS[wizard.heroClass.caster.ability]}` : 'без магии на 1-м уровне' }}</span>
      </div>
      <label v-if="wizard.heroClass.fightingStyle" class="field">Боевой стиль
        <select v-model="wizard.choice.fightingStyle">
          <option value="">— выберите —</option>
          <option v-for="entry in heroes.fightingStyles" :key="entry.id" :value="entry.id">{{ entry.nameRu }} — {{ entry.text }}</option>
        </select>
      </label>
      <label v-if="wizard.heroClass.subclass?.ancestry && !wizard.race?.ancestry" class="field">Дракон-предок
        <select v-model="wizard.choice.ancestry">
          <option value="">— выберите —</option>
          <option v-for="entry in heroes.ancestries" :key="entry.id" :value="entry.id">{{ entry.nameRu }} — {{ DAMAGE_LABELS[entry.damage] ?? entry.damage }}</option>
        </select>
      </label>
      <ul class="traits">
        <li v-for="trait in [...wizard.heroClass.features, ...(wizard.heroClass.subclass?.traits ?? [])]" :key="trait[0]"><strong>{{ trait[0] }}.</strong> {{ trait[1] }}</li>
      </ul>
    </div>
  </div>
</template>

<style scoped src="./wizardKit.css"></style>

