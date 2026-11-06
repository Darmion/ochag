<script setup lang="ts">
import { ABILITIES, ABILITY_LABELS, ABILITY_SHORT, mod, signed } from '../../../characterWizard/catalog';
import type { HeroBuilder } from '../../../characterWizard/heroBuilder';
import { libraryUrl } from '../../../art/portraitArt';
import { RACE_INFO } from '../../../characterWizard/catalog';
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
      <GameIcon v-else-if="!wizard.choice.name.trim()" :name="RACE_INFO[wizard.choice.race]?.icon ?? 'raceCustom'" :size="40" />
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

<style scoped>
.hero-card{position:sticky;top:0;border:1px solid var(--brass,#b08d57);border-radius:8px;padding:12px;display:flex;flex-direction:column;align-items:center;gap:8px;background:var(--surface-inset,#0001)}
.hero-portrait{position:relative;width:84px;height:84px;min-height:0;padding:0;border-radius:50%;border:2px solid var(--brass,#b08d57);display:flex;align-items:center;justify-content:center;font:700 38px var(--heading-font);color:inherit;background:#7a2e2e22;overflow:hidden;cursor:pointer}
.hero-portrait img{width:100%;height:100%;object-fit:cover;object-position:top;image-rendering:pixelated}
.hero-portrait img.race-sign{width:58%;height:58%;object-fit:contain;margin-bottom:10px}
.portrait-hint{position:absolute;inset:auto 0 0;padding:1px 0 3px;font-size:10px;font-weight:600;line-height:1.3;letter-spacing:.02em;text-align:center;color:#fff;background:#0009;opacity:0;transition:opacity .15s}
.hero-portrait:hover .portrait-hint,.hero-portrait:focus-visible .portrait-hint,.hero-portrait:not(.chosen) .portrait-hint{opacity:1}
.portrait-clear{min-height:24px;padding:0 8px;font-size:11px}
.hero-name{width:100%;text-align:center;font:700 18px var(--heading-font);min-height:34px}
.hero-line{margin:0;font-size:12px;text-align:center}
.hero-vitals{display:flex;gap:6px;width:100%}
.hero-vitals span{flex:1;display:flex;flex-direction:column;align-items:center;border:1px solid var(--brass-light,#0003);border-radius:6px;padding:4px 0}
.hero-vitals b{font:700 20px var(--heading-font)}
.hero-vitals small{font-size:10px}
.hero-abilities{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;width:100%}
.hero-abilities span{display:flex;flex-direction:column;align-items:center;border:1px solid var(--brass-light,#0003);border-radius:6px;padding:3px 0}
.hero-abilities span.primary{border-color:#a8742c}
.hero-abilities small{font-size:10px;font-weight:700}
.hero-abilities b{font-size:16px}
.hero-abilities em{font-style:normal;font-size:11px}
.hero-skills{margin:0;font-size:11px;line-height:1.35;width:100%}
.hero-problems{margin:0;color:#c0392b;font-size:12px}
@media (max-width:980px){
  .hero-card{position:static}
}
</style>
