<script setup lang="ts">
import { computed } from 'vue';
import type { LevelUp } from '../../../levelUp/useLevelUp';
import type { StepId } from '../../../levelUp/types';
import GameIcon from '../../game/GameIcon.vue';

const props = defineProps<{ level: LevelUp }>();

const CHOICE_STEPS: Record<string, StepId> = {
  'Улучшение характеристик': 'improve', 'Боевой стиль': 'talents', 'Компетентность': 'talents', 'Чемпион: дополнительный боевой стиль': 'talents',
  'Коллегия знаний: дополнительные магические секреты': 'spells', 'Тайные магические секреты': 'spells',
};
const AUTOMATION = { auto: 'игра применяет сама', partial: 'игра применяет частично', manual: 'учитывайте сами' } as const;
const cards = computed(() => (props.level.plan?.features ?? []).map(title => {
  const card = props.level.info?.featureTexts?.[title];
  const step = CHOICE_STEPS[title];
  return {
    title,
    text: card?.text ?? null,
    automation: card?.automation ?? null,
    step: step && props.level.STEPS.some(entry => entry.id === step) ? step : null,
  };
}));
</script>

<template>
  <template v-if="level.plan">
    <h3>Какой класс повышать</h3>
    <label class="field">
      <select :value="level.chosenClass || level.plan.classId || ''" :disabled="level.working" aria-label="Класс" @change="level.chooseClass(($event.target as HTMLSelectElement).value)">
        <option v-if="!level.ownClasses.length" value="">— класс не указан —</option>
        <option v-for="option in level.ownClasses" :key="option.id" :value="option.id">{{ option.label }} {{ option.level }} → {{ option.level + 1 }}</option>
        <optgroup v-if="level.canMulticlass" label="Новый класс (мультикласс)">
          <option v-for="option in level.otherClasses" :key="option.id" :value="option.id">{{ option.label }} 1</option>
        </optgroup>
      </select>
    </label>
    <p v-if="level.plan.classProblem" class="notice">Взять второй класс нельзя, пока запись класса в листе не поправлена: {{ level.plan.classProblem }}.</p>
    <p v-if="level.plan.multiclass && level.plan.classText" class="muted">Класс станет: {{ level.plan.classText }}</p>
    <p v-if="level.plan.prerequisites.length" class="notice warn" role="note">
      Требования мультикласса не выполнены: {{ level.plan.prerequisites.join('; ') }}. Повысить можно — решает мастер.
    </p>

    <h3 v-if="level.plan.className">Что даёт {{ level.plan.classLevel }}-й уровень класса «{{ level.plan.className }}»</h3>
    <h3 v-else>Что даёт {{ level.plan.to }}-й уровень</h3>
    <div v-if="cards.length" class="feature-cards">
      <article v-for="card in cards" :key="card.title" class="feature-card">
        <strong>{{ card.title }}</strong>
        <p v-if="card.text">{{ card.text }}</p>
        <small v-if="card.automation" class="auto" :data-auto="card.automation">{{ AUTOMATION[card.automation] }}</small>
        <button v-if="card.step" type="button" class="step-link" @click="level.current = card.step">Выбрать →</button>
      </article>
    </div>
    <p v-else-if="level.plan.cantrips || level.plan.spells" class="muted">Новых умений на этом уровне нет: растут хиты и магия.</p>
    <p v-else class="muted">Новых умений на этом уровне нет: растут хиты.</p>
    <p class="muted"><GameIcon class="inline-icon" name="heart" :size="14" /> Хиты: +{{ level.plan.averageHp }} в среднем или бросок к{{ level.plan.hitDie }} — выбор на шаге «Итог».</p>

    <template v-if="level.plan.multiclassGain">
      <h3>Владения нового класса</h3>
      <p>{{ level.plan.multiclassGain.text }}.</p>
      <p class="muted">При мультиклассе — только эти, без спасбросков; оружием из листа, которое теперь по силам, отметится владение.</p>
      <div v-if="level.gainSkillCount" class="sub-choice">
        <span class="label">Навык — {{ level.form.skills.length }} из {{ level.gainSkillCount }}</span>
        <div class="chips">
          <button
            v-for="skill in level.gainSkillOptions" :key="skill" type="button" class="chip" :class="{ active: level.form.skills.includes(skill) }"
            :aria-pressed="level.form.skills.includes(skill)" @click="level.toggle(level.form.skills, skill, level.gainSkillCount)"
          >{{ level.skillName(skill) }}</button>
        </div>
      </div>
    </template>
  </template>
</template>

<style scoped src="../../characters/wizard/wizardKit.css"></style>
<style scoped src="./levelUpKit.css"></style>
