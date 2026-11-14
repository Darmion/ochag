<script setup lang="ts">
import type { LevelUp } from '../../../levelUp/useLevelUp';

defineProps<{ level: LevelUp }>();
</script>

<template>
  <template v-if="level.plan">
    <template v-if="level.plan.fightingStyles">
      <h3>Боевой стиль</h3>
      <div class="segmented styles" role="radiogroup" aria-label="Боевой стиль">
        <button
          v-for="style in level.styleOptions" :key="style.id" type="button" role="radio"
          :aria-checked="level.form.fightingStyle === style.id" :class="{ active: level.form.fightingStyle === style.id }" @click="level.form.fightingStyle = style.id"
        >
          {{ style.nameRu }} <small>{{ style.text }}</small>
        </button>
      </div>
    </template>

    <template v-if="level.plan.expertise">
      <h3>Компетентность — {{ level.form.expertise.length }} из {{ level.plan.expertise }}</h3>
      <p class="muted">Бонус мастерства удваивается в проверках выбранных навыков.</p>
      <div class="chips">
        <button
          v-for="skill in level.expertiseOptions" :key="skill" type="button" class="chip" :class="{ active: level.form.expertise.includes(skill) }"
          :aria-pressed="level.form.expertise.includes(skill)" @click="level.toggle(level.form.expertise, skill, level.plan.expertise)"
        >{{ level.skillName(skill) }}</button>
      </div>
      <p v-if="!level.expertiseOptions.length" class="muted">Нет навыков, которыми герой владеет без компетентности: отметьте владения в листе.</p>
    </template>
  </template>
</template>

<style scoped src="../../characters/wizard/wizardKit.css"></style>

<style scoped>
.styles button{flex:1 1 220px;max-width:340px;text-align:left}
</style>
