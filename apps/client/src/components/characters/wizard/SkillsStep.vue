<script setup lang="ts">
import { toggle } from '../../../characterWizard/catalog';
import type { HeroBuilder } from '../../../characterWizard/heroBuilder';
import type { HeroClass, Heroes } from '../../../characterWizard/types';
import { t } from '../../../i18n/i18n';
import GameIcon from '../../game/GameIcon.vue';

const props = defineProps<{
  wizard: HeroBuilder;
  heroes: Heroes;
  heroClass: HeroClass;
}>();

function backgroundOption(entry: Heroes['backgrounds'][number]) {
  const name = t(entry.nameRu);
  return entry.skills ? t('{name} — {skills}', { name, skills: entry.skills.map(skill => t(props.wizard.skillName(skill))).join(', ') }) : name;
}
</script>

<template>
  <h3>Чем герой жил до приключений и что умеет?</h3>
  <label class="background-pick">
    <span class="label">Предыстория</span>
    <select v-model="wizard.choice.background">
      <option v-for="entry in heroes.backgrounds" :key="entry.id" :value="entry.id">{{ backgroundOption(entry) }}</option>
    </select>
  </label>
  <div v-if="wizard.background" class="background-card">
    <ul class="traits">
      <li v-for="trait in wizard.background.traits" :key="trait[0]"><strong>{{ trait[0] }}.</strong> {{ trait[1] }}</li>
    </ul>
    <p class="muted">{{ t('Снаряжение: {gear}; {gp} зм.', { gear: wizard.background.gearNames.map(name => t(name)).join(', '), gp: wizard.background.gp }) }}</p>
  </div>
  <div class="ability-tools">
    <button type="button" @click="wizard.suggestSkills"><GameIcon class="inline-icon" name="sparkle" :size="16" /> Подобрать навыки за меня</button>
    <span v-if="wizard.granted.size" class="muted">Уже есть: {{ [...wizard.granted].map(wizard.skillName).join(', ') }}</span>
  </div>
  <div class="skill-group">
    <span class="label">Навыки класса — выбрано {{ wizard.choice.classSkills.length }} из {{ heroClass.skills.count }}</span>
    <div class="chips">
      <button
        v-for="skill in wizard.classPool" :key="skill" type="button" class="chip"
        :class="{ active: wizard.choice.classSkills.includes(skill), suggested: wizard.classInfo?.skills.includes(skill) }"
        :disabled="wizard.taken(wizard.choice.classSkills).has(skill)" :title="wizard.taken(wizard.choice.classSkills).has(skill) ? 'уже есть' : wizard.skillAbility(skill)"
        @click="toggle(wizard.choice.classSkills, skill, heroClass.skills.count)"
      >{{ wizard.skillName(skill) }}<small>{{ wizard.skillAbility(skill) }}</small></button>
    </div>
  </div>
  <div v-if="wizard.backgroundChoices" class="skill-group">
    <span class="label">Навыки предыстории — {{ wizard.choice.backgroundSkills.length }} из 2</span>
    <div class="chips">
      <button v-for="skill in wizard.allSkills" :key="skill" type="button" class="chip" :class="{ active: wizard.choice.backgroundSkills.includes(skill) }" :disabled="wizard.taken(wizard.choice.backgroundSkills).has(skill)" @click="toggle(wizard.choice.backgroundSkills, skill, 2)">{{ wizard.skillName(skill) }}</button>
    </div>
  </div>
  <div v-if="wizard.race?.skillChoices" class="skill-group">
    <span class="label">{{ wizard.race.nameRu }}: ещё {{ wizard.race.skillChoices }} навыка — {{ wizard.choice.raceSkills.length }} выбрано</span>
    <div class="chips">
      <button v-for="skill in wizard.allSkills" :key="skill" type="button" class="chip" :class="{ active: wizard.choice.raceSkills.includes(skill) }" :disabled="wizard.taken(wizard.choice.raceSkills).has(skill)" @click="toggle(wizard.choice.raceSkills, skill, wizard.race.skillChoices)">{{ wizard.skillName(skill) }}</button>
    </div>
  </div>
  <div v-if="heroClass.expertise" class="skill-group">
    <span class="label">Компетентность (бонус ×2) — {{ wizard.choice.expertise.length }} из {{ heroClass.expertise }}</span>
    <div class="chips">
      <button v-for="skill in wizard.proficient" :key="skill" type="button" class="chip" :class="{ active: wizard.choice.expertise.includes(skill) }" @click="toggle(wizard.choice.expertise, skill, heroClass.expertise)">{{ wizard.skillName(skill) }}</button>
    </div>
  </div>
</template>

<style scoped src="./wizardKit.css"></style>

<style scoped>
.skill-group{display:flex;flex-direction:column;gap:5px}
.background-pick{display:flex;flex-direction:column;gap:5px;max-width:460px}
.background-card{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border:1px solid var(--brass-light,#0003);border-radius:6px;background:var(--surface-inset,#0001)}
.background-card .muted{margin:0;font-size:12px}
</style>
