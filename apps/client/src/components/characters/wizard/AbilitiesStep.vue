<script setup lang="ts">
import { ABILITIES, ABILITY_HINTS, ABILITY_LABELS, mod, signed } from '../../../characterWizard/catalog';
import type { HeroBuilder } from '../../../characterWizard/heroBuilder';
import GameIcon from '../../game/GameIcon.vue';

defineProps<{
  wizard: HeroBuilder;
}>();
</script>

<template>
  <h3>В чём ваш герой силён?</h3>
  <div class="segmented methods" role="radiogroup" aria-label="Способ">
    <button type="button" role="radio" :aria-checked="wizard.choice.method === 'free'" :class="{ active: wizard.choice.method === 'free' }" @click="wizard.choice.method = 'free'">Свободное <small>любое 1–20</small></button>
    <button type="button" role="radio" :aria-checked="wizard.choice.method === 'pointbuy'" :class="{ active: wizard.choice.method === 'pointbuy' }" @click="wizard.choice.method = 'pointbuy'">Покупка очков <small>{{ wizard.budget }} очков</small></button>
    <button type="button" role="radio" :aria-checked="wizard.choice.method === 'roll'" :class="{ active: wizard.choice.method === 'roll' }" @click="wizard.choice.method = 'roll'">Бросок кубиков <small>4к6, на удачу</small></button>
    <button type="button" role="radio" :aria-checked="wizard.choice.method === 'standard'" :class="{ active: wizard.choice.method === 'standard' }" @click="wizard.choice.method = 'standard'">Стандартный набор <small>15, 14, 13, 12, 10, 8</small></button>
  </div>
  <div class="ability-tools">
    <button v-if="wizard.choice.method !== 'roll' || wizard.rolled" type="button" @click="wizard.abilitiesTouched = false; wizard.arrangeForClass()"><GameIcon class="inline-icon" name="sparkle" :size="16" /> Расставить за меня — для класса «{{ wizard.heroClass?.nameRu }}»</button>
    <button v-if="wizard.choice.method === 'roll'" type="button" class="primary" :disabled="wizard.working" @click="wizard.rollAbilities"><GameIcon class="inline-icon" name="d20" :size="16" /> {{ wizard.rolled ? 'Бросить заново' : 'Бросить 4к6 шесть раз' }}</button>
    <span v-if="wizard.choice.method === 'pointbuy'" class="points" :class="{ over: wizard.pointsSpent > wizard.budget }">Очки: {{ wizard.budget - wizard.pointsSpent }} осталось</span>
  </div>
  <small v-if="wizard.choice.method === 'roll' && wizard.rolled" class="muted">{{ wizard.rolled.sets.map(set => `${set.dice.join('·')} → ${set.value}`).join('; ') }} — бросок виден всем в журнале.</small>
  <p v-if="wizard.choice.method === 'standard'" class="muted">Выберите значение у характеристики — занятое значение поменяется местами.</p>
  <p v-if="wizard.choice.method === 'free'" class="muted">Любые значения от 1 до 20 до расовых бонусов — например, как договорились с мастером.</p>
  <div v-if="wizard.choice.method !== 'roll' || wizard.rolled" class="ability-cards">
    <div v-for="ability in ABILITIES" :key="ability" class="ability-card" :class="{ primary: wizard.primary.has(ability) }">
      <div class="ability-top">
        <strong>{{ ABILITY_LABELS[ability] }}</strong>
        <span v-if="wizard.primary.has(ability)" class="badge">важно для класса</span>
      </div>
      <div class="ability-value">
        <b>{{ wizard.finalScores[ability] }}</b>
        <span class="mod">{{ signed(mod(wizard.finalScores[ability])) }}</span>
      </div>
      <div class="ability-edit">
        <input
          v-if="wizard.choice.method === 'free'" type="number" min="1" max="20" class="free-score" :value="wizard.choice.free[ability]" :aria-label="ABILITY_LABELS[ability]"
          @change="wizard.setFree(ability, Number(($event.target as HTMLInputElement).value))"
        />
        <template v-else-if="wizard.choice.method === 'pointbuy'">
          <button type="button" :aria-label="`${ABILITY_LABELS[ability]}: меньше`" :disabled="wizard.choice.pointBuy[ability] <= 8" @click="wizard.stepPoint(ability, -1)">−</button>
          <span>{{ wizard.choice.pointBuy[ability] }}</span>
          <button type="button" :aria-label="`${ABILITY_LABELS[ability]}: больше`" :disabled="wizard.choice.pointBuy[ability] >= 15" @click="wizard.stepPoint(ability, 1)">+</button>
        </template>
        <select v-else :value="wizard.choice.assign[ability]" :aria-label="ABILITY_LABELS[ability]" @change="wizard.assignValue(ability, Number(($event.target as HTMLSelectElement).value))">
          <option v-for="(value, index) in wizard.pool" :key="index" :value="index">{{ value }}</option>
        </select>
        <small v-if="wizard.bonusOf(ability)" class="race-bonus">+{{ wizard.bonusOf(ability) }} раса</small>
      </div>
      <small class="ability-hint">{{ ABILITY_HINTS[ability] }}</small>
    </div>
  </div>
</template>

<style scoped src="./wizardKit.css"></style>

<style scoped>
.methods button{flex:1 1 160px}
.points{font-weight:700}
.points.over{color:#c0392b}
.ability-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px}
.ability-card{border:1px solid var(--brass-light,#0003);border-radius:6px;padding:8px 10px;display:flex;flex-direction:column;gap:4px}
.ability-card.primary{border-color:#a8742c;box-shadow:inset 0 0 0 1px #a8742c55}
.ability-top{display:flex;justify-content:space-between;align-items:center;gap:6px}
.badge{font-size:10px;padding:1px 6px;border-radius:8px;background:#a8742c;color:#fff;white-space:nowrap}
.ability-value{display:flex;align-items:baseline;gap:8px}
.ability-value b{font:700 28px var(--heading-font)}
.ability-value .mod{font-weight:700;font-size:16px}
.ability-edit{display:flex;align-items:center;gap:6px}
.ability-edit button{min-height:28px;width:28px;padding:0}
.ability-edit select{width:76px;min-height:28px}
.ability-edit .free-score{width:76px;min-height:28px;text-align:center}
.race-bonus{color:#3f8a4e;font-weight:700}
.ability-hint{font-size:11px;opacity:.8;line-height:1.3}
</style>
