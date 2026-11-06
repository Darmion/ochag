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
        <button type="button" aria-label="Закрыть" @click="emit('close')"><GameIcon class="inline-icon" name="close" :size="16" /></button>
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

<style scoped>
.modal-overlay{position:fixed;inset:0;z-index:3500;display:flex;align-items:center;justify-content:center;padding:18px;background:#0b0704cc}
.modal-card{width:min(1200px,100%);max-height:94vh;overflow-y:auto;padding:16px 20px;background:var(--parchment-background);color:var(--ink);border:1px solid var(--brass);border-radius:6px;box-shadow:0 16px 40px #000a;display:flex;flex-direction:column;gap:10px}
.wizard-head{display:flex;align-items:center;gap:12px}
.wizard-head h2{margin:0;font:700 24px var(--heading-font)}
.step-count{margin-right:auto}
.wizard-head button{min-height:30px;width:30px;padding:0}
.wizard-grid{display:grid;grid-template-columns:210px minmax(0,1fr) 250px;gap:14px;align-items:start}
.hero-path{display:flex;flex-direction:column;gap:4px;position:sticky;top:0}
.hero-path button{display:flex;align-items:center;gap:8px;text-align:left;padding:6px 8px;min-height:48px;justify-content:flex-start}
.hero-path button[data-state="current"]{border-color:var(--burgundy,#7a2e2e);box-shadow:inset 3px 0 0 var(--burgundy,#7a2e2e);background:#7a2e2e1f}
.path-dot{display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;width:24px;height:24px;border-radius:50%;border:1px solid var(--brass-light,#0003);font-weight:700;font-size:13px}
.hero-path button[data-state="done"] .path-dot{background:#3f8a4e;border-color:#3f8a4e;color:#fff}
.hero-path button[data-state="current"] .path-dot{background:var(--burgundy,#7a2e2e);color:#fff}
.path-text{display:flex;flex-direction:column;min-width:0}
.path-text strong{display:flex;align-items:center;gap:5px;font-size:13px}
.path-text small{font-size:11px;font-weight:400;opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wizard-body{display:flex;flex-direction:column;gap:10px;min-height:360px;font-size:13px}
.todo{margin:6px 0 0;padding:6px 10px;border-left:3px solid #a8742c;background:#a8742c14}
.wizard-foot{display:flex;justify-content:space-between;gap:8px}
.error{color:#c0392b;margin:0}
.muted{margin:0}
@media (max-width:980px){
  .wizard-grid{grid-template-columns:minmax(0,1fr)}
  .hero-path{position:static;flex-direction:row;overflow-x:auto}
  .hero-path button{flex:0 0 auto}
}
</style>
