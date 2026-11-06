<script setup lang="ts">
import { ref, watch } from 'vue';

import FormulaInput from './FormulaInput.vue';
import { createRule, KEY_HINT, KNOWN_FLAGS, loadRules, updateRule, RULE_KINDS, RULE_KIND_HINTS, RULE_KIND_LABELS, type CampaignRule } from '../../campaign/campaignRules';
import { RULES_GLOSSARY } from '../../rules/rulesGlossary';
import RuleCard from './RuleCard.vue';
import { RULE_TOPICS, topicLabel } from '../../rulesTab/topics';
import { useRuleFilters } from '../../rulesTab/ruleFilters';
import { useNewRuleForm } from '../../rulesTab/newRuleForm';
import { useTutorialScene } from '../../rulesTab/tutorialScene';

const props = defineProps<{
  campaignId: string;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();

const rules = ref<CampaignRule[]>([]);
const canManage = ref(false);
const loading = ref(true);
const error = ref('');

const {
  searchQuery, ruleSort, topicFilter, topicForFlag, topicForRule, visibleFlags, visibleRules,
  clearSearch, clearFilters,
} = useRuleFilters({
  rules, knownFlagValue,
});

async function refresh() {
  loading.value = true;
  error.value = '';

  try {
    const data = await loadRules(props.request, props.campaignId);
    rules.value = data.rules;
    canManage.value = data.canManage;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось загрузить правила. Попробуйте ещё раз.';
  } finally {
    loading.value = false;
  }
}

watch(() => props.campaignId, refresh, { immediate: true });

const toggling = ref('');
function knownFlagValue(flag: typeof KNOWN_FLAGS[number]) {
  const rule = rules.value.find(entry => entry.key === flag.key && entry.kind === 'flag');
  return rule ? rule.value === true : flag.enabled;
}
async function toggleKnownFlag(flag: typeof KNOWN_FLAGS[number]) {
  if (!canManage.value || toggling.value) return;
  toggling.value = flag.key;
  error.value = '';
  try {
    const rule = rules.value.find(entry => entry.key === flag.key && entry.kind === 'flag');
    if (rule) {
      const updated = await updateRule(props.request, props.campaignId, rule.id, { label: rule.label, description: rule.description, value: !(rule.value === true), revision: rule.revision });
      Object.assign(rule, updated);
    } else {
      const created = await createRule(props.request, props.campaignId, { key: flag.key, kind: 'flag', label: flag.label, description: flag.description, value: !flag.enabled });
      rules.value = [...rules.value, created];
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось переключить правило. Попробуйте ещё раз.';
  } finally {
    toggling.value = '';
  }
}

function onDeleted(ruleId: string) {
  rules.value = rules.value.filter(rule => rule.id !== ruleId);
}

const addForm = ref<HTMLDetailsElement | null>(null);

const {
  newKey, newKind, newLabel, newDescription, newFlagValue, newNumberValue, newFormulaValue,
  newTextValue, createBusy, createError, keyValid, suggestedFlags, suggestedChoices, newChoice,
  useKnownChoice, useKnownFlag, formulaValid, canSubmit, submitNewRule,
} = useNewRuleForm({
  props, rules, refresh, addForm,
});

const { creatingTutorial, tutorialError, tutorialSceneName, createTutorialScene } = useTutorialScene({ props });
</script>

<template>
  <section class="rules-tab panel">
    <h2>Правила кампании</h2>

    <p class="muted">
      Домашние правила кампании: флаги, числа, формулы бросков и тексты. Флаги с известными
      именами включают и выключают автоматику (урон сам, экономия действий, укрытие и другие) —
      их можно добавить одной кнопкой. Остальные правила хранятся здесь и видны всем участникам.
    </p>

    <section class="rules-toolbar" aria-label="Поиск и сортировка правил">
      <label class="rules-search">
        <span>Поиск</span>
        <span class="search-control">
          <input v-model="searchQuery" type="search" placeholder="Название, описание, ключ или значение" autocomplete="off" />
          <button v-if="searchQuery" type="button" class="clear-search" aria-label="Очистить поиск" title="Очистить поиск" @click="clearSearch">×</button>
        </span>
      </label>
      <label class="rules-sort">
        <span>Сортировка правил</span>
        <select v-model="ruleSort">
          <option value="topic">По смысловым разделам</option>
          <option value="label-asc">По названию: А–Я</option>
          <option value="label-desc">По названию: Я–А</option>
          <option value="kind">По типу</option>
          <option value="key">По служебному имени</option>
          <option value="updated">Недавно изменённые</option>
        </select>
      </label>
      <label class="rules-topic">
        <span>Смысловой раздел</span>
        <select v-model="topicFilter">
          <option value="all">Все разделы</option>
          <option v-for="topic in RULE_TOPICS" :key="topic.id" :value="topic.id">{{ topic.label }}</option>
        </select>
      </label>
      <p v-if="!loading" class="search-summary" aria-live="polite">
        Автоматика: <b>{{ visibleFlags.length }}</b> из {{ KNOWN_FLAGS.length }} · Правила: <b>{{ visibleRules.length }}</b> из {{ rules.length }}
      </p>
    </section>

    <section v-if="!loading" class="auto-flags" aria-label="Автоматика">
      <h3>Автоматика</h3>
      <ul v-if="visibleFlags.length">
        <template v-for="(flag, index) in visibleFlags" :key="flag.key">
        <li v-if="ruleSort === 'topic' && (index === 0 || topicForFlag(visibleFlags[index - 1]!) !== topicForFlag(flag))" class="topic-divider">
          <span><b>{{ topicLabel(topicForFlag(flag)) }}</b><small>{{ RULE_TOPICS.find(topic => topic.id === topicForFlag(flag))?.hint }}</small></span>
        </li>
        <li>
          <span class="flag-text"><b>{{ flag.label }}</b><small>{{ flag.description }}</small></span>
          <button
            type="button" class="flag-switch" role="switch" :aria-checked="knownFlagValue(flag)"
            :disabled="!canManage || toggling === flag.key"
            :title="canManage ? (knownFlagValue(flag) ? 'Выключить' : 'Включить') : 'Переключает мастер'"
            @click="toggleKnownFlag(flag)"
          >
            <span class="switch-knob" aria-hidden="true" />
            {{ knownFlagValue(flag) ? 'Включено' : 'Выключено' }}
          </button>
        </li>
        </template>
      </ul>
      <p v-else class="rules-empty">Переключатели автоматики с выбранными условиями не найдены.</p>
    </section>

    <details class="tutorial">
      <summary>Обучение новичков</summary>

      <h3>Короткий справочник</h3>
      <dl class="glossary">
        <template v-for="entry in RULES_GLOSSARY" :key="entry.term">
          <dt>{{ entry.term }}</dt>
          <dd>{{ entry.text }}</dd>
        </template>
      </dl>

      <h3>Пробная сцена «Первый бой»</h3>
      <p class="muted">
        Маленькая комната с одним гоблином — потренироваться на ком-то, прежде чем вести настоящий бой.
      </p>
      <ol class="tutorial-steps">
        <li>Нажмите «Создать пробную сцену» ниже.</li>
        <li>Откройте вкладку «Стол» и выберите сцену «Обучение: первый бой».</li>
        <li>Откройте окно «Объекты» и поставьте героев на карту из списка «Поставить на сцену».</li>
        <li>Нажмите «Начать бой» на панели действий — игра бросит инициативу и откроет очередь хода.</li>
        <li>В свой ход нажмите «Атака» на панели действий и выберите оружие и цель. Чтобы пойти, перетащите фигуру.</li>
        <li>Бросок и его исход (попадание, урон) появляются в журнале справа.</li>
      </ol>
      <button type="button" :disabled="creatingTutorial" @click="createTutorialScene">
        {{ creatingTutorial ? 'Создаю…' : 'Создать пробную сцену' }}
      </button>
      <p v-if="tutorialSceneName" class="notice success">Готово: сцена «{{ tutorialSceneName }}» создана, гоблин на карте.</p>
      <p v-if="tutorialError" class="notice error">{{ tutorialError }}</p>
    </details>

    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <p v-else-if="loading" class="muted">Загрузка…</p>

    <details v-if="canManage" ref="addForm" class="add-rule">
      <summary>Добавить правило</summary>

      <form @submit.prevent="submitNewRule">
        <div v-if="suggestedFlags.length || suggestedChoices.length" class="known-flags">
          <span class="muted">Правила автоматики:</span>
          <button
            v-for="flag in suggestedFlags" :key="flag.key" type="button" :disabled="createBusy"
            :title="`${flag.description} Сейчас ${flag.enabled ? 'включено' : 'выключено'}.`"
            @click="useKnownFlag(flag)"
          >{{ flag.label }}</button>
          <button
            v-for="choice in suggestedChoices" :key="choice.key" type="button" :disabled="createBusy"
            :title="`${choice.description} Сейчас: ${choice.options.find(option => option.value === choice.default)?.label}.`"
            @click="useKnownChoice(choice)"
          >{{ choice.label }}</button>
        </div>
        <label>
          Служебное имя
          <input
            v-model="newKey"
            placeholder="flanking"
            spellcheck="false"
            maxlength="64"
            :disabled="createBusy"
          />
          <small :class="{ invalid: newKey && !keyValid }">{{ KEY_HINT }}</small>
        </label>

        <label>
          Тип
          <select v-model="newKind" :disabled="createBusy">
            <option v-for="kind in RULE_KINDS" :key="kind" :value="kind">{{ RULE_KIND_LABELS[kind] }}</option>
          </select>
          <small>{{ RULE_KIND_HINTS[newKind] }}</small>
        </label>

        <label>
          Название
          <input v-model="newLabel" placeholder="Фланкирование" maxlength="200" :disabled="createBusy" />
        </label>

        <label>
          Описание — необязательно
          <textarea v-model="newDescription" rows="2" maxlength="2000" :disabled="createBusy" />
        </label>

        <label v-if="newKind === 'flag'" class="checkbox-label">
          <input type="checkbox" v-model="newFlagValue" :disabled="createBusy" />
          Включено
        </label>

        <label v-else-if="newKind === 'number'">
          Значение
          <input type="number" step="any" v-model.number="newNumberValue" :disabled="createBusy" />
        </label>

        <label v-else-if="newKind === 'formula'">
          Формула
          <FormulaInput v-model="newFormulaValue" placeholder="2d6+3" :disabled="createBusy" />
          <small :class="{ invalid: newFormulaValue && !formulaValid }">{{ RULE_KIND_HINTS.formula }}</small>
        </label>

        <label v-else-if="newChoice">
          Значение
          <select v-model="newTextValue" :disabled="createBusy">
            <option v-for="option in newChoice.options" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>

        <label v-else>
          Текст
          <textarea v-model="newTextValue" rows="4" maxlength="2000" :disabled="createBusy" />
        </label>

        <p v-if="createError" class="notice error">{{ createError }}</p>

        <button class="primary" :disabled="!canSubmit">
          {{ createBusy ? 'Добавляю…' : 'Добавить правило' }}
        </button>
      </form>
    </details>

    <p v-if="!loading && !rules.length" class="rules-empty">
      {{ canManage ? 'Правил пока нет — добавьте первое выше.' : 'Правил пока нет.' }}
    </p>

    <p v-else-if="!loading && !visibleRules.length" class="rules-empty">
      Пользовательские правила с выбранными условиями не найдены.
      <button type="button" class="link-button" @click="clearFilters">Показать все</button>
    </p>

    <div v-if="visibleRules.length" class="rule-list">
      <template v-for="(rule, index) in visibleRules" :key="rule.id">
      <div v-if="ruleSort === 'topic' && (index === 0 || topicForRule(visibleRules[index - 1]!) !== topicForRule(rule))" class="rule-topic-heading">
        <span><b>{{ topicLabel(topicForRule(rule)) }}</b><small>{{ RULE_TOPICS.find(topic => topic.id === topicForRule(rule))?.hint }}</small></span>
      </div>
      <RuleCard
        :campaign-id="campaignId"
        :rule="rule"
        :can-manage="canManage"
        :request="request"
        @deleted="onDeleted(rule.id)"
      />
      </template>
    </div>
  </section>
</template>

<style scoped>
.rules-toolbar{display:grid;grid-template-columns:minmax(240px,1fr) repeat(2,minmax(180px,.45fr));gap:10px 14px;align-items:end;margin:18px 0;padding:14px;border:1px solid var(--brass-light);border-radius:6px;background:var(--surface-inset)}
.rules-toolbar label{display:grid;gap:5px;margin:0;font-size:12px;font-weight:700;color:var(--muted-ink)}
.rules-toolbar :is(input,select){width:100%;min-width:0;box-sizing:border-box}
.search-control{position:relative;display:block}
.search-control input{padding-right:38px}
.clear-search{position:absolute;top:50%;right:5px;translate:0 -50%;width:28px;min-height:28px;padding:0;border:0;background:transparent;box-shadow:none;color:var(--muted-ink);font-size:20px;line-height:1}
.clear-search:hover{color:var(--ink)}
.search-summary{grid-column:1 / -1;margin:0;font-size:12px;color:var(--muted-ink)}
.search-summary b{color:var(--ink);font-variant-numeric:tabular-nums}
.rules-empty{margin:12px 0;padding:16px;border:1px dashed var(--brass-light);border-radius:6px;background:color-mix(in srgb,var(--surface-inset) 60%,transparent);color:var(--muted-ink);text-align:center}
.rules-empty .link-button{margin-left:6px}
.tutorial{margin:16px 0 24px;border:1px solid var(--brass-light);border-radius:3px;padding:12px 16px;background:var(--surface-inset)}
.tutorial summary{font-size:17px}
.tutorial h3{margin:14px 0 6px;font-size:15px}
.glossary dt{font-weight:700;margin-top:8px}
.glossary dd{margin:2px 0 0;color:var(--muted-ink);font-size:13px;line-height:1.5}
.tutorial-steps{margin:0;padding-left:20px;font-size:13px;line-height:1.7}
.add-rule{margin:16px 0;border:1px solid var(--brass-light);border-radius:3px;padding:12px 16px;background:var(--surface-inset)}
.add-rule summary{font-size:17px}
.add-rule small{display:block;margin-top:4px}
.add-rule small.invalid{color:#8e2a2f}
.rule-list{display:flex;flex-direction:column;gap:12px;margin-top:16px}
.known-flags{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:12px}
.known-flags button{min-height:28px;padding:2px 10px;font-size:13px}
.auto-flags{margin:12px 0}
.auto-flags h3{margin:0 0 8px}
.auto-flags ul{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.auto-flags li{display:flex;align-items:center;gap:12px;padding:8px 12px;border:1px solid var(--brass-light);border-radius:3px;background:var(--surface-inset)}
.auto-flags li.topic-divider{margin-top:10px;padding:8px 2px 3px;border:0;border-bottom:1px solid var(--brass-light);border-radius:0;background:transparent}
.topic-divider > span,.rule-topic-heading > span{display:flex;flex-direction:column;gap:2px}
.topic-divider b,.rule-topic-heading b{font:700 16px var(--heading-font);color:var(--ink)}
.topic-divider small,.rule-topic-heading small{font-size:11px;color:var(--muted-ink)}
.flag-text{flex:1;display:flex;flex-direction:column;gap:2px;min-width:0}
.flag-text small{font-size:12px;opacity:.8}
.flag-switch{flex:none;display:inline-flex;align-items:center;gap:8px;min-width:132px;min-height:34px;padding:3px 12px 3px 6px}
.switch-knob{position:relative;width:34px;height:18px;border-radius:9px;background:#8a7b66;transition:background .15s}
.switch-knob::after{content:'';position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:left .15s}
.flag-switch[aria-checked="true"] .switch-knob{background:#3f8a4e}
.flag-switch[aria-checked="true"] .switch-knob::after{left:18px}
.rule-topic-heading{margin-top:8px;padding:8px 2px 4px;border-bottom:1px solid var(--brass-light)}
@media(max-width:920px){.rules-toolbar{grid-template-columns:minmax(240px,1fr) minmax(190px,.65fr)}.rules-topic{grid-column:1 / -1}}
@media(max-width:680px){.rules-toolbar{grid-template-columns:1fr}.search-summary{grid-column:auto}.auto-flags li{align-items:flex-start;flex-direction:column}.flag-switch{align-self:stretch;justify-content:center}}
</style>
