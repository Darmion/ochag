<script setup lang="ts">
import { DAMAGE_TYPES, optionLabel, type SpellTemplate, type manualParts, type validateTemplate } from '../../../../../packages/domain/spells/spell-template';
import { sectionOfIssue, type checkFacts } from '../../spellBuilder/overview';
import type { Block, SuggestionState } from '../../spellBuilder/types';
import { localized } from './localize';
import GameIcon from '../game/GameIcon.vue';

defineProps<{
  template: SpellTemplate;
  artUrl: string | null;
  levelText: string;
  schoolLabel: string;
  facts: ReturnType<typeof checkFacts>;
  actionBlocks: Block[];
  issues: ReturnType<typeof validateTemplate>;
  pending: SuggestionState[];
  manual: ReturnType<typeof manualParts>;
  partial: string[];
  reviewing: boolean;
  locked: boolean;
  dirty: boolean;
}>();
const emit = defineEmits<{ toSection: [path: string]; showSuggestions: []; decide: [decision: 'approve' | 'rework' | 'reject'] }>();
const note = defineModel<string>('note', { required: true });
</script>

<template>
  <section class="step-check">
    <header class="overview-head">
      <span class="art-preview large"><img v-if="artUrl" :src="artUrl" alt="" /></span>
      <div>
        <h3 translate="no">{{ template.passport.name }}</h3>
        <h3 v-if="!template.passport.name">Без названия</h3>
        <p class="meta">
          <span>{{ levelText }}</span>
          <span>{{ schoolLabel }}</span>
          <span v-if="template.passport.element">{{ optionLabel(DAMAGE_TYPES, template.passport.element) }}</span>
        </p>
      </div>
      <button type="button" class="small quiet to-section" @click="emit('toSection', 'passport')"><GameIcon class="inline-icon" name="pencil" :size="16" /> Паспорт</button>
    </header>

    <dl class="check-facts">
      <div v-for="fact in facts" :key="fact.label" class="fact">
        <dt>{{ fact.label }}</dt>
        <dd>
          <template v-for="(item, itemIndex) in fact.items" :key="itemIndex"><span v-if="itemIndex" class="dot">; </span><template v-for="(segment, index) in item" :key="index">{{ index ? ' ' : '' }}<span :translate="segment.user ? 'no' : undefined">{{ segment.text }}</span></template></template>
        </dd>
        <button type="button" class="link-button icon-button to-section" :aria-label="`К разделу: ${fact.label}`" title="К разделу таблицы" @click="emit('toSection', fact.section)"><GameIcon class="inline-icon" name="pencil" :size="16" /></button>
      </div>
    </dl>

    <div class="check-actions">
      <article v-for="block in actionBlocks" :key="block.key" class="check-action" :class="`depth-${block.depth}`">
        <header>
          <span v-if="block.scope" class="scope" :translate="block.scopeUser ? 'no' : undefined">{{ block.scope }}</span>
          <strong translate="no">{{ block.name }}</strong>
          <span class="muted">{{ block.parts.when }}</span>
          <span v-if="block.parts.times" class="muted">{{ block.parts.times }}</span>
          <span class="muted">{{ block.parts.who }}</span>
          <button type="button" class="link-button icon-button to-section" aria-label="К разделу таблицы" title="К разделу таблицы" @click="emit('toSection', block.section)"><GameIcon class="inline-icon" name="pencil" :size="16" /></button>
        </header>
        <p v-if="block.parts.check" class="check-line">{{ block.parts.check }}</p>
        <ul v-if="block.parts.outcomes.length || block.parts.half" class="check-outcomes">
          <li v-for="outcome in block.parts.outcomes" :key="outcome.outcome">
            <b v-if="outcome.label">{{ outcome.label }}</b>{{ ' ' }}<template v-for="(effect, index) in outcome.effects" :key="index">{{ index ? ', ' : '' }}<span>{{ localized(effect) }}</span></template>
          </li>
          <li v-if="block.parts.half"><b>успех</b>{{ ' ' }}<span>половина урона</span></li>
        </ul>
        <p v-else class="muted">ничего</p>
      </article>
      <p v-if="!actionBlocks.length" class="muted">Действий нет — заклинание ничего не сделает в игре. Добавьте действие в разделе «Е. Действия».</p>
    </div>

    <div v-if="issues.errors.length" class="issues errors" role="alert">
      <strong>Ошибки — нельзя завершить:</strong>
      <ul><li v-for="issue in issues.errors" :key="issue.path + issue.message"><button type="button" class="issue-link" title="К разделу таблицы" @click="emit('toSection', sectionOfIssue(issue.path))"><span class="issue-path">{{ issue.path }}</span>: <span>{{ issue.message }}</span></button></li></ul>
    </div>
    <div v-if="pending.length" class="issues errors"><button type="button" class="issue-link" @click="emit('showSuggestions')"><strong>Непринятых подсказок: {{ pending.length }}</strong> — примите, измените или очистите их в «Таблице».</button></div>
    <div v-if="issues.warnings.length" class="issues warnings">
      <strong>Стоит посмотреть:</strong>
      <ul><li v-for="issue in issues.warnings" :key="issue.path + issue.message"><button type="button" class="issue-link" title="К разделу таблицы" @click="emit('toSection', sectionOfIssue(issue.path))"><span class="issue-path">{{ issue.path }}</span>: <span>{{ issue.message }}</span></button></li></ul>
    </div>
    <div v-if="manual.length || partial.length" class="issues manual">
      <strong>Это мастер применит вручную</strong> <small class="muted">— при сотворении ему покажется окно</small>
      <ul>
        <li v-for="line in manual" :key="line">✗ {{ localized(line) }}</li>
        <li v-for="line in partial" :key="line">◐ {{ localized(line) }}</li>
      </ul>
    </div>

    <div v-if="reviewing" class="review">
      <label>Замечание автору <small class="muted">(необязательно)</small><textarea v-model="note" rows="2" maxlength="2000" :disabled="locked" /></label>
      <div class="actions-row">
        <button type="button" class="primary" :disabled="locked || issues.errors.length > 0" @click="emit('decide', 'approve')">{{ dirty ? 'Принять с правками' : 'Принять' }}</button>
        <button type="button" :disabled="locked" @click="emit('decide', 'rework')">На доработку</button>
        <button type="button" class="danger-link" :disabled="locked" @click="emit('decide', 'reject')">Отклонить</button>
      </div>
    </div>
  </section>
</template>

<style scoped src="./builderKit.css"></style>
<style scoped>
.step-check{display:flex;flex-direction:column;gap:14px}
.meta{display:flex;flex-wrap:wrap;gap:0 10px;margin:4px 0 0;font-size:14px}
.meta>span+span::before{content:'·';margin-right:10px;opacity:.6}
.overview-head{display:flex;gap:14px;align-items:center}
.overview-head>div{flex:1;min-width:0}
.overview-head h3{margin:0;overflow-wrap:anywhere}
.check-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:10px 24px;margin:0}
.fact{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 8px;padding:8px 10px;border-left:2px solid var(--g-gold-lo,var(--brass-light));background:var(--g-well,var(--surface-inset));border-radius:0 6px 6px 0}
.fact dt{font-size:13px;color:var(--g-text-dim,inherit);grid-column:1}
.fact dd{margin:0;font-size:15px;line-height:1.45;grid-column:1}
.fact .to-section{grid-column:2;grid-row:1/span 2;align-self:center}
.check-actions{display:flex;flex-direction:column;gap:10px}
.check-action{padding:10px 12px;border:1px solid var(--g-line,var(--brass-light));border-radius:8px;max-width:100%}
.check-action.depth-1{margin-left:24px;border-style:dashed}
.check-action.depth-2{margin-left:48px;border-style:dashed}
.check-action header{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline}
.check-action header .to-section{margin-left:auto}
.check-action .scope{font-size:12px;padding:1px 8px;border-radius:10px;background:var(--g-stone-2,var(--surface-inset));border:1px solid var(--g-line,var(--brass-light))}
.check-line{margin:6px 0 0;font-size:15px}
.check-outcomes{margin:6px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:3px;font-size:15px;line-height:1.5;max-width:75ch}
.check-outcomes b{display:inline-block;margin-right:4px}
.check-outcomes b::first-letter{text-transform:uppercase}
.issues{padding:10px 12px;border-radius:6px}
.issues ul{margin:6px 0 0;padding-left:18px}
.issue-link{display:inline;padding:0;margin:0;border:0;background:none;box-shadow:none;color:inherit;font:inherit;text-align:left;cursor:pointer;min-height:0}
.issue-link:hover{text-decoration:underline}
.issue-path{font-weight:600}
.issues.errors{border:1px solid var(--g-bad,#c0392b)}
.issues.warnings{border:1px solid var(--g-warn,#e1a33a)}
.issues.manual{border:1px solid var(--g-line,var(--brass-light))}
:root[data-ui="game"] .step-check{padding:16px 18px 20px;border:1px solid var(--g-gold-deep);border-left:4px solid var(--g-gold-lo);border-radius:3px 8px 8px 3px;background:var(--g-stone-2)}
:root[data-ui="game"] .overview-head{padding-bottom:14px;border-bottom:1px solid var(--g-gold-lo)}
:root[data-ui="game"] .overview-head h3{font-family:var(--g-title-font);font-size:26px;color:var(--g-gold-hi)}
:root[data-ui="game"] .check-facts{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 22px}
:root[data-ui="game"] .fact{padding:12px;background:var(--g-well)}
:root[data-ui="game"] .fact dd{overflow-wrap:anywhere}
:root[data-ui="game"] .check-action{padding:14px;background:var(--g-well);border-color:var(--g-gold-deep)}
:root[data-ui="game"] .check-action header{padding-bottom:8px;border-bottom:1px solid var(--g-line)}
:root[data-ui="game"] .check-action header strong{color:var(--g-gold-hi);font-family:var(--g-title-font)}
:root[data-ui="game"] .check-outcomes{gap:7px}
@media (max-width:700px){:root[data-ui="game"] .check-facts{grid-template-columns:minmax(0,1fr)}}
</style>
