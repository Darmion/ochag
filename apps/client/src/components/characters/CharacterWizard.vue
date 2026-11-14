<script setup lang="ts">
import { useEscapeClose } from '../../ui/escapeStack';
import { useHeroBuilder } from '../../characterWizard/heroBuilder';
import RaceStep from './wizard/RaceStep.vue';
import ClassStep from './wizard/ClassStep.vue';
import AbilitiesStep from './wizard/AbilitiesStep.vue';
import SkillsStep from './wizard/SkillsStep.vue';
import KitStep from './wizard/KitStep.vue';
import SpellsStep from './wizard/SpellsStep.vue';
import SummaryStep from './wizard/SummaryStep.vue';
import HeroCard from './wizard/HeroCard.vue';
import GameIcon from '../game/GameIcon.vue';

const props = defineProps<{
  campaignId: string;
  request: (path: string, method?: string, body?: unknown, file?: File) => Promise<any>;
}>();
const emit = defineEmits<{ close: []; created: [character: { id: string; name: string }] }>();
useEscapeClose(() => emit('close'));

const wizard = useHeroBuilder(props, { onCreated: character => emit('created', character) });
</script>

<template>
  <div class="modal-overlay" role="dialog" aria-modal="true" aria-label="Создание героя">
    <section class="modal-card wizard">
      <header class="wizard-head">
        <h2>Новый герой</h2>
        <span class="muted step-count">Шаг {{ wizard.stepIndex + 1 }} из {{ wizard.STEPS.length }}</span>
        <button class="icon-only" type="button" aria-label="Закрыть" @click="emit('close')"><GameIcon class="inline-icon" name="close" :size="16" /></button>
      </header>
      <p v-if="wizard.error" class="error" role="alert">{{ wizard.error }}</p>
      <p v-if="!wizard.heroes && !wizard.error" class="muted">Загружаю справочник…</p>

      <div v-if="wizard.heroes" class="wizard-grid">
        <nav class="hero-path" aria-label="Шаги создания">
          <button
            v-for="(entry, index) in wizard.STEPS" :key="entry.id" type="button"
            :aria-current="wizard.current === entry.id ? 'step' : undefined"
            :data-state="wizard.current === entry.id ? 'current' : wizard.todo[entry.id].length ? 'todo' : 'done'"
            @click="wizard.current = entry.id"
          >
            <span class="path-dot"><template v-if="wizard.todo[entry.id].length || wizard.current === entry.id">{{ index + 1 }}</template><GameIcon v-else class="inline-icon" name="check" :size="14" /></span>
            <span class="path-text">
              <strong><GameIcon class="ui-icon" :name="entry.icon" :size="20" />{{ entry.label }}</strong>
              <small>{{ wizard.stepValue[entry.id] || (wizard.todo[entry.id].length ? 'не выбрано' : '') }}</small>
            </span>
          </button>
        </nav>

        <div class="wizard-body">
          <RaceStep v-if="wizard.current === 'race'" :wizard="wizard" :heroes="wizard.heroes" />

          <ClassStep v-else-if="wizard.current === 'class'" :wizard="wizard" :heroes="wizard.heroes" />

          <AbilitiesStep v-else-if="wizard.current === 'abilities'" :wizard="wizard" />

          <SkillsStep v-else-if="wizard.current === 'skills' && wizard.heroClass" :wizard="wizard" :heroes="wizard.heroes" :hero-class="wizard.heroClass" />

          <KitStep v-else-if="wizard.current === 'kit' && wizard.heroClass" :wizard="wizard" :heroes="wizard.heroes" :hero-class="wizard.heroClass" />

          <SpellsStep v-else-if="wizard.current === 'spells'" :wizard="wizard" />

          <SummaryStep v-else-if="wizard.current === 'summary'" :wizard="wizard" />

          <p v-if="wizard.current !== 'summary' && wizard.todo[wizard.current].length" class="todo">Осталось выбрать: {{ wizard.todo[wizard.current].join(', ') }}.</p>
        </div>

        <HeroCard :wizard="wizard" />
      </div>

      <footer class="wizard-foot">
        <button type="button" :disabled="wizard.stepIndex === 0" @click="wizard.goStep(-1)">← Назад</button>
        <button v-if="wizard.current !== 'summary'" type="button" class="primary" @click="wizard.goStep(1)">Далее: {{ wizard.STEPS[wizard.stepIndex + 1]?.label }} →</button>
        <button v-else type="button" class="primary" :disabled="wizard.working || Boolean(wizard.preview?.problems.length) || !wizard.choice.name.trim()" @click="wizard.create"><GameIcon class="inline-icon" name="swords" :size="16" /> Создать героя</button>
      </footer>
    </section>
  </div>
</template>

<style scoped src="./wizard/wizardKit.css"></style>

<style scoped src="./wizard/wizardShell.css"></style>
