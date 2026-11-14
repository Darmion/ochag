<script setup lang="ts">
import { ABILITIES, ABILITY_HINTS, ABILITY_LABELS, mod, signed } from '../../../characterWizard/catalog';
import { CUSTOM_FEAT, type LevelUp } from '../../../levelUp/useLevelUp';
import GameIcon from '../../game/GameIcon.vue';
import { abilityIcon } from '../../../rules/skillIcons';

defineProps<{ level: LevelUp }>();
</script>

<template>
  <h3>Улучшение характеристик или черта</h3>
  <div class="segmented" role="radiogroup" aria-label="Что взять">
    <button type="button" role="radio" :aria-checked="level.form.asiKind === 'asi'" :class="{ active: level.form.asiKind === 'asi' }" @click="level.form.asiKind = 'asi'">
      Улучшить характеристики <small>+2 к одной или +1 к двум</small>
    </button>
    <button type="button" role="radio" :aria-checked="level.form.asiKind === 'feat'" :class="{ active: level.form.asiKind === 'feat' }" @click="level.form.asiKind = 'feat'">
      Взять черту <small>особое умение вместо улучшения</small>
    </button>
  </div>

  <template v-if="level.form.asiKind === 'asi'">
    <p class="points">Осталось очков: {{ level.pointsLeft }} из 2</p>
    <div class="ability-cards">
      <div
        v-for="ability in ABILITIES" :key="ability" class="ability-card"
        :class="{ primary: level.primary.has(ability), raised: level.form.increases[ability] > 0 }"
      >
        <div class="ability-top">
          <strong><GameIcon v-if="abilityIcon(ability)" class="inline-icon" :name="abilityIcon(ability)!" :size="16" /> {{ ABILITY_LABELS[ability] }}</strong>
          <span v-if="level.primary.has(ability)" class="badge">важно для класса</span>
        </div>
        <div class="ability-value">
          <b>{{ level.score(ability) + level.form.increases[ability] }}</b>
          <span class="mod">{{ signed(mod(level.score(ability) + level.form.increases[ability])) }}</span>
          <span v-if="level.form.increases[ability]" class="gain">было {{ level.score(ability) }}</span>
        </div>
        <div class="ability-edit">
          <button type="button" :aria-label="`${ABILITY_LABELS[ability]}: меньше`" :disabled="level.form.increases[ability] <= 0" @click="level.stepIncrease(ability, -1)">−</button>
          <button
            type="button" :aria-label="`${ABILITY_LABELS[ability]}: больше`"
            :disabled="level.pointsLeft <= 0 || level.form.increases[ability] >= 2 || level.score(ability) + level.form.increases[ability] >= 20"
            @click="level.stepIncrease(ability, 1)"
          >+</button>
          <small v-if="level.score(ability) >= 20" class="muted">уже 20</small>
        </div>
        <small class="muted">{{ ABILITY_HINTS[ability] }}</small>
      </div>
    </div>
    <p class="muted">Модификатор растёт на каждом чётном значении: 15 → 16 даёт +1 к модификатору, 16 → 17 — нет.</p>
  </template>

  <div v-else class="feat-fields">
    <label class="field">Черта
      <select v-model="level.form.featId" aria-label="Черта">
        <option value="">— выберите черту —</option>
        <optgroup label="Черты, которые считает игра">
          <option v-for="entry in level.feats.filter(feat => !feat.modName)" :key="entry.id" :value="entry.id" :disabled="entry.known">
            {{ entry.nameRu }}{{ entry.abilities ? ' · +1' : '' }}{{ entry.known ? ' — уже есть' : '' }}
          </option>
        </optgroup>
        <optgroup v-if="level.feats.some(feat => feat.modName)" label="Из модов">
          <option v-for="entry in level.feats.filter(feat => feat.modName)" :key="entry.id" :value="entry.id" :disabled="entry.known">
            {{ entry.nameRu }}{{ entry.abilities ? ' · +1' : '' }}{{ entry.known ? ' — уже есть' : '' }} — {{ entry.modName }}
          </option>
        </optgroup>
        <option :value="CUSTOM_FEAT">Другая черта — вписать название…</option>
      </select>
    </label>
    <p v-if="level.feat" class="feat-text" :translate="level.feat.modName ? 'no' : undefined">{{ level.feat.text }}</p>
    <template v-if="level.form.featId === CUSTOM_FEAT">
      <input v-model="level.form.featName" maxlength="100" placeholder="Например: Атлет" aria-label="Название черты" />
      <textarea v-model="level.form.featText" rows="2" maxlength="2000" placeholder="Что даёт (необязательно)" aria-label="Что даёт черта" />
    </template>
    <label v-if="level.featAbilities.length" class="field">+1 к характеристике
      <select v-model="level.form.featIncrease" :disabled="level.featAbilities.length === 1">
        <option v-if="level.form.featId === CUSTOM_FEAT" value="">— не нужно —</option>
        <option v-else-if="level.featAbilities.length > 1" value="">— выберите —</option>
        <option v-for="ability in level.featAbilities" :key="ability" :value="ability" :disabled="level.score(ability) >= 20">
          {{ ABILITY_LABELS[ability] }} ({{ level.score(ability) }} → {{ Math.min(20, level.score(ability) + 1) }})
        </option>
      </select>
    </label>
  </div>
</template>

<style scoped src="../../characters/wizard/wizardKit.css"></style>
<style scoped src="./levelUpKit.css"></style>
