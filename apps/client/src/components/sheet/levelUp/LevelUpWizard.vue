<script setup lang="ts">
import { computed } from 'vue';
import { useEscapeClose } from '../../../ui/escapeStack';
import { useLevelUp } from '../../../levelUp/useLevelUp';
import LevelClassStep from './LevelClassStep.vue';
import LevelSubclassStep from './LevelSubclassStep.vue';
import LevelImproveStep from './LevelImproveStep.vue';
import LevelTalentsStep from './LevelTalentsStep.vue';
import LevelSpellsStep from './LevelSpellsStep.vue';
import LevelSummaryStep from './LevelSummaryStep.vue';
import LevelHeroCard from './LevelHeroCard.vue';
import GameIcon from '../../game/GameIcon.vue';

const props = defineProps<{
  campaignId: string;
  characterId: string;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();
const emit = defineEmits<{ close: []; done: [] }>();
useEscapeClose(() => emit('close'));

const level = useLevelUp(props, { onDone: () => emit('done') });
const waiting = computed(() => (level.plan && !level.milestone ? Math.max(0, level.plan.ready - level.plan.to) : 0));
</script>

<template>
  <div class="modal-overlay" role="dialog" aria-modal="true" aria-label="Новый уровень">
    <section class="modal-card wizard" :class="{ compact: level.result }">
      <header class="wizard-head">
        <h2>{{ level.result ? `Уровень ${level.result.level}!` : level.plan ? `Новый уровень: ${level.plan.from} → ${level.plan.to}` : 'Новый уровень' }}</h2>
        <span v-if="level.plan && !level.result" class="muted step-count">
          Шаг {{ level.stepIndex + 1 }} из {{ level.STEPS.length }}
          <template v-if="waiting">· потом опыта хватит ещё на {{ waiting }} ур.</template>
        </span>
        <button class="icon-only" type="button" aria-label="Закрыть" @click="emit('close')"><GameIcon class="inline-icon" name="close" :size="16" /></button>
      </header>
      <p v-if="level.error" class="error" role="alert">{{ level.error }}</p>
      <p v-if="!level.info && !level.error" class="muted">Загружаю…</p>

      <div v-if="level.result" class="level-result">
        <span class="result-sign"><GameIcon name="levelUp" :size="40" /></span>
        <p class="big">{{ level.info?.name }} — {{ level.result.level }}-й уровень. Хиты: +{{ level.result.hpGain }}<template v-if="level.result.roll !== null"> (на кости {{ level.result.roll }})</template>.</p>
        <p v-if="level.result.className" class="muted">Класс: {{ level.result.className }}</p>
        <ul v-if="level.result.features.length" class="traits"><li v-for="feature in level.result.features" :key="feature">{{ feature }}</li></ul>
        <footer class="wizard-foot">
          <button type="button" @click="emit('close')">Готово</button>
          <button v-if="level.result.next" type="button" class="primary" @click="level.nextLevel"><GameIcon class="inline-icon" name="levelUp" :size="16" /> Ещё уровень: {{ level.result.next.from }} → {{ level.result.next.to }}</button>
        </footer>
      </div>

      <template v-else-if="level.plan && level.info">
        <p v-if="level.milestone" class="notice">Уровень по вехе, без опыта — решение мастера.</p>
        <div class="wizard-grid">
          <nav class="hero-path" aria-label="Шаги нового уровня">
            <button
              v-for="(entry, index) in level.STEPS" :key="entry.id" type="button"
              :aria-current="level.current === entry.id ? 'step' : undefined"
              :data-state="level.current === entry.id ? 'current' : level.todo[entry.id].length ? 'todo' : 'done'"
              @click="level.current = entry.id"
            >
              <span class="path-dot"><template v-if="level.todo[entry.id].length || level.current === entry.id">{{ index + 1 }}</template><GameIcon v-else class="inline-icon" name="check" :size="14" /></span>
              <span class="path-text">
                <strong><GameIcon class="ui-icon" :name="entry.icon" :size="20" />{{ entry.label }}</strong>
                <small>{{ level.stepValue[entry.id] || (level.todo[entry.id].length ? 'не выбрано' : '') }}</small>
              </span>
            </button>
          </nav>

          <div class="wizard-body">
            <LevelClassStep v-if="level.current === 'class'" :level="level" />
            <LevelSubclassStep v-else-if="level.current === 'subclass'" :level="level" />
            <LevelImproveStep v-else-if="level.current === 'improve'" :level="level" />
            <LevelTalentsStep v-else-if="level.current === 'talents'" :level="level" />
            <LevelSpellsStep v-else-if="level.current === 'spells'" :level="level" />
            <LevelSummaryStep v-else :level="level" />
            <p v-if="level.current !== 'summary' && level.todo[level.current].length" class="todo">Осталось выбрать: {{ level.todo[level.current].join(', ') }}.</p>
          </div>

          <LevelHeroCard :level="level" />
        </div>

        <footer class="wizard-foot">
          <button type="button" :disabled="level.stepIndex === 0" @click="level.goStep(-1)">← Назад</button>
          <span class="foot-actions">
            <button v-if="level.info.suggestion" type="button" title="Средние хиты, главная характеристика класса, подкласс и заклинания, которые берут чаще всего. Любой шаг можно поправить." @click="level.applySuggestion">
              <GameIcon class="inline-icon" name="autoPick" :size="16" /> Подобрать за меня
            </button>
            <button v-if="level.current !== 'summary'" type="button" class="primary" @click="level.goStep(1)">Далее: {{ level.STEPS[level.stepIndex + 1]?.label }} →</button>
            <button v-else type="button" class="primary" :disabled="level.working || level.missing.length > 0" @click="level.apply">
              <GameIcon class="inline-icon" name="levelUp" :size="16" /> Повысить до {{ level.plan.to }}-го уровня
            </button>
          </span>
        </footer>
      </template>

      <p v-else-if="level.info" class="muted">Опыта на новый уровень пока не хватает.</p>
    </section>
  </div>
</template>

<style scoped src="../../characters/wizard/wizardKit.css"></style>
<style scoped src="../../characters/wizard/wizardShell.css"></style>
<style scoped src="./levelUpKit.css"></style>

<style scoped>
.modal-card.compact{width:min(640px,100%)}
.foot-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.level-result{display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center}
.level-result .traits{text-align:left;align-self:stretch}
.level-result .wizard-foot{align-self:stretch}
.result-sign{display:grid;place-items:center;width:72px;height:72px;border-radius:50%;color:#fff;background:radial-gradient(circle at 50% 35%,#3f8a4e,#1d4a28);box-shadow:0 0 18px #3f8a4e88}
.big{font-size:16px;font-weight:600}
</style>
