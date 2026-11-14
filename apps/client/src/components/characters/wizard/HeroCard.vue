<script setup lang="ts">
import { ABILITIES, ABILITY_LABELS, ABILITY_SHORT, mod, signed } from '../../../characterWizard/catalog';
import type { HeroBuilder } from '../../../characterWizard/heroBuilder';
import { libraryUrl } from '../../../art/portraitArt';
import { raceIcon } from '../../../characterWizard/catalog';
import ArtPickerDialog from '../../common/ArtPickerDialog.vue';
import GameIcon from '../../game/GameIcon.vue';

defineProps<{
  wizard: HeroBuilder;
}>();
</script>

<template>
  <aside class="hero-card" aria-label="Ваш герой">
    <button type="button" class="hero-portrait" :class="{ chosen: wizard.portrait }" :title="wizard.portrait ? 'Другой портрет' : 'Выбрать портрет'" @click="wizard.portraitPicker = true">
      <img v-if="wizard.portrait" :src="libraryUrl(wizard.portrait)" alt="Портрет героя" />
      <GameIcon v-else-if="!wizard.choice.name.trim()" :name="raceIcon(wizard.race)" :size="40" />
      <template v-else>{{ wizard.monogram }}</template>
      <span class="portrait-hint">{{ wizard.portrait ? 'сменить' : 'портрет' }}</span>
    </button>
    <ArtPickerDialog
      v-if="wizard.portraitPicker"
      title="Портрет героя"
      :sections="['Портреты']"
      :suggested="wizard.portraitSuggested"
      @pick="wizard.pickPortrait"
      @close="wizard.portraitPicker = false"
    />
    <button v-if="wizard.portrait" type="button" class="portrait-clear" @click="wizard.portrait = null">без портрета</button>
    <input v-model="wizard.choice.name" class="hero-name" maxlength="200" placeholder="Имя героя" aria-label="Имя героя" />
    <p class="hero-line">{{ wizard.heroLine }} · 1-й уровень</p>
    <div class="hero-vitals">
      <span title="Хиты"><b>{{ wizard.preview?.summary?.hpMax ?? '—' }}</b><small>хиты</small></span>
      <span title="Класс доспеха"><b>{{ wizard.preview?.summary?.armorClass ?? '—' }}</b><small>КД</small></span>
      <span title="Скорость"><b>{{ wizard.preview?.summary?.speed ?? wizard.race?.speed ?? '—' }}</b><small>фт.</small></span>
    </div>
    <div class="hero-abilities">
      <span v-for="ability in ABILITIES" :key="ability" :class="{ primary: wizard.primary.has(ability) }" :title="ABILITY_LABELS[ability]">
        <small>{{ ABILITY_SHORT[ability] }}</small><b>{{ wizard.finalScores[ability] }}</b><em>{{ signed(mod(wizard.finalScores[ability])) }}</em>
      </span>
    </div>
    <p v-if="wizard.proficient.length" class="hero-skills"><strong>Навыки:</strong> {{ wizard.proficient.map(wizard.skillName).join(', ') }}</p>
    <p v-if="wizard.preview?.problems.length" class="hero-problems" :title="wizard.preview.problems.join('\n')"><GameIcon class="inline-icon" name="alert" :size="16" /> {{ wizard.preview.problems.length }} — см. «Имя и итог»</p>
  </aside>
</template>

<style scoped src="./heroCard.css"></style>
