<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useEscapeClose } from '../../ui/escapeStack';
import { t } from '../../i18n/i18n';
import { libraryArt, schoolArt } from '../../art/itemArt';
import { isOwnSpellArt } from '../../art/spellArt';
import ArtPickerDialog from '../common/ArtPickerDialog.vue';
import SpellArtMenu from './SpellArtMenu.vue';
import SuggestRulesDialog from './SuggestRulesDialog.vue';
import SpellCheckStep from './SpellCheckStep.vue';
import SpellDescribeStep from './SpellDescribeStep.vue';
import PassportSection from './PassportSection.vue';
import CastingSection from './CastingSection.vue';
import DurationSection from './DurationSection.vue';
import TargetingSection from './TargetingSection.vue';
import OptionsSection from './OptionsSection.vue';
import ActionsSection from './ActionsSection.vue';
import CommandsSection from './CommandsSection.vue';
import ScalingSection from './ScalingSection.vue';
import EndingSection from './EndingSection.vue';
import HintsSection from './HintsSection.vue';
import SuggestionsPanel from './SuggestionsPanel.vue';
import { localized } from './localize';
import {
  EFFECT_CATALOG,
  STRENGTH_LABELS,
  allEffects, describeEffect,
  emptyTemplate, manualParts, normalizeTemplate, templateStrength, validateTemplate,
  type SpellTemplate,
} from '../../../../../packages/domain/spells/spell-template';
import { SCHOOL_OPTIONS, SECTIONS, STATUS_LABELS, STEPS } from '../../spellBuilder/constants';
import { checkActionBlocks, checkFacts, countSectionBadges, sectionOfIssue, summarizeSections } from '../../spellBuilder/overview';
import { useSpellArt } from '../../spellBuilder/art';
import { useSpellSaving } from '../../spellBuilder/saving';
import { useSuggestions } from '../../spellBuilder/suggestions';
import { useTemplateFile } from '../../spellBuilder/templateFile';
import type { SrdView, SuggestionState, View } from '../../spellBuilder/types';
import GameIcon from '../game/GameIcon.vue';

const props = defineProps<{
  campaignId: string;
  request: (path: string, method?: string, body?: unknown, file?: File) => Promise<any>;
  canReview: boolean;
  spellId?: string | null;
  seed?: { template?: unknown; autoSuggest?: boolean } | null;
  review?: boolean;
  srdIndex?: string | null;
}>();
const emit = defineEmits<{ close: []; saved: [spellId: string] }>();
useEscapeClose(() => {
  if (artMenu.value || strengthOpen.value || applyCampaigns.value) {
    closePopovers(true);
    return;
  }
  emit('close');
});

const grimoireFrame = { '--sb-frame': `url("${new URL(libraryArt('ui/frames/slot-gold-ornate'), document.baseURI).href}")` };
function splitTitle(title: string): [string, string] {
  const text = t(title);
  const at = text.indexOf('. ');
  return at > 0 ? [text.slice(0, at), text.slice(at + 2)] : ['', text];
}

const template = ref<SpellTemplate>(emptyTemplate());
const suggestions = ref<SuggestionState[]>([]);
const step = ref<1 | 2 | 3>(props.srdIndex ? 2 : 1);
const open = ref<Set<string>>(new Set(['passport', 'actions']));
const busy = ref(false);
const error = ref('');
const info = ref('');
const view = ref<View | null>(null);
const note = ref('');
const applyCampaigns = ref<Array<{ id: string; name: string }> | null>(null);
const applyChosen = ref<string[]>([]);
const loaded = ref<string>('');
const bodyEl = ref<HTMLElement | null>(null);
const suggestionsOpen = ref(true);
const strengthOpen = ref(false);
const artMenu = ref<'' | 'head' | 'passport'>('');
const artPicker = ref(false);
const rulesOpen = ref(false);
const infoKind = ref<'' | 'suggest'>('');
const headArtEl = ref<HTMLElement | null>(null);
const passportArtEl = ref<HTMLElement | null>(null);
const setPassportArtEl = (el: HTMLElement | null) => { passportArtEl.value = el; };
const strengthEl = ref<HTMLElement | null>(null);

function closePopovers(restoreFocus = false) {
  const opener = artMenu.value === 'head' ? headArtEl.value : artMenu.value === 'passport' ? passportArtEl.value : strengthOpen.value ? strengthEl.value : null;
  artMenu.value = '';
  strengthOpen.value = false;
  applyCampaigns.value = null;
  if (restoreFocus) opener?.focus();
}
function onCardPointer(event: PointerEvent) {
  const target = event.target as Element | null;
  if (artMenu.value && !target?.closest('.art-holder, .passport-art')) artMenu.value = '';
  if (strengthOpen.value && !target?.closest('.strength-holder')) strengthOpen.value = false;
}

const srdView = ref<SrdView | null>(null);
const srdMode = computed(() => Boolean(props.srdIndex));
const readOnly = computed(() => srdMode.value && !srdView.value?.canEdit);
const locked = computed(() => busy.value || readOnly.value);
const isNew = computed(() => !view.value && !srdMode.value);
const status = computed(() => view.value?.spell.status ?? 'new');
const issues = computed(() => validateTemplate(template.value));
const strength = computed(() => templateStrength(template.value));
const manual = computed(() => manualParts(template.value));
const partial = computed(() => allEffects(template.value).filter(({ effect }) => EFFECT_CATALOG[effect.kind].support === 'partial').map(({ effect, action }) => `«${action.name}»: ${describeEffect(effect)}`));
const reviewing = computed(() => Boolean(props.review && props.canReview && view.value && (status.value === 'pending' || view.value.proposal?.status === 'pending')));
const dirty = computed(() => JSON.stringify(template.value) !== loaded.value);

const schoolKey = computed(() => template.value.passport.school.charAt(0).toUpperCase() + template.value.passport.school.slice(1));
const schoolLabel = computed(() => SCHOOL_OPTIONS.find(([value]) => value === template.value.passport.school)?.[1] ?? template.value.passport.school);
const levelText = computed(() => (template.value.passport.level ? `${template.value.passport.level} круг` : 'заговор'));

function fromFlat(spell: View['spell']): SpellTemplate {
  const t = emptyTemplate();
  t.passport.name = spell.name;
  t.passport.level = spell.level;
  t.passport.school = String(spell.school ?? 'evocation').toLowerCase();
  t.passport.description = spell.desc ?? '';
  t.passport.higherLevel = spell.higherLevel ?? '';
  return t;
}

async function load() {
  if (props.srdIndex) {
    busy.value = true;
    try {
      const data = await props.request(`/campaigns/${props.campaignId}/srd-templates/${props.srdIndex}`);
      srdView.value = { overridden: data.overridden, canEdit: data.canEdit, templateVersion: data.templateVersion, specialNotify: data.specialNotify };
      template.value = normalizeTemplate(data.template);
      loaded.value = JSON.stringify(template.value);
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Не удалось открыть заклинание. Попробуйте ещё раз.';
    } finally {
      busy.value = false;
    }
    return;
  }
  if (!props.spellId) {
    template.value = props.seed?.template ? normalizeTemplate(props.seed.template) : emptyTemplate();
    loaded.value = JSON.stringify(template.value);
    if (props.seed?.autoSuggest && template.value.passport.description.trim()) await suggest();
    return;
  }
  busy.value = true;
  try {
    view.value = await props.request(`/campaigns/${props.campaignId}/spell-templates/${props.spellId}`);
    const spell = view.value!.spell;
    const proposal = view.value!.proposal;
    template.value = normalizeTemplate(proposal?.template ?? spell.template ?? fromFlat(spell));
    suggestions.value = spell.suggestions?.items ?? [];
    loaded.value = JSON.stringify(template.value);
    if (!spell.template && !proposal && template.value.passport.description.trim()) await suggest();
    if (reviewing.value) step.value = 3;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось открыть заклинание. Попробуйте ещё раз.';
  } finally {
    busy.value = false;
  }
}
onMounted(load);

const { artUrl, hasArt, artSuggested, uploadArt, pickLibraryArt, openLibrary, clearArt, toggleArtMenu } = useSpellArt({
  props, template, schoolKey, busy, error, artMenu, artPicker, strengthOpen,
});

const { pending, showInfo, highlighted, suggest, accept, acceptAll, insertExample } = useSuggestions({
  props, template, suggestions, step, busy, error, info, infoKind, suggestionsOpen, rulesOpen, focusField,
});

function toggleSection(id: string) {
  const next = new Set(open.value);
  if (next.has(id)) next.delete(id); else next.add(id);
  open.value = next;
}

const scrollBehavior = (): ScrollBehavior => (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
async function focusField(path: string) {
  const section = path.split(/[.[]/)[0]!;
  step.value = 2;
  open.value = new Set([...open.value, section]);
  await nextTick();
  const root = bodyEl.value;
  if (!root) return;
  const inSection = root.querySelector<HTMLElement>(`[data-section="${section}"]`);
  const target = path.endsWith('[+]')
    ? [...root.querySelectorAll<HTMLElement>(`[data-section="${section}"] ${section === 'actions' ? '.action-editor' : '.scaling'}`)].pop() ?? inSection
    : root.querySelector<HTMLElement>(`[data-path="${path}"]`) ?? inSection;
  if (!target) return;
  target.scrollIntoView({ block: path === section ? 'start' : 'center', behavior: scrollBehavior() });
  const field = target.matches('input, select, textarea') ? target : target.querySelector<HTMLElement>('input, select, textarea');
  field?.focus({ preventScroll: true });
  const lit = target.closest<HTMLElement>('label, .chips, .action-editor, .scaling') ?? target;
  lit.classList.add('flash');
  setTimeout(() => lit.classList.remove('flash'), 1400);
}

async function showSuggestions() {
  step.value = 2;
  suggestionsOpen.value = true;
  await nextTick();
  bodyEl.value?.querySelector<HTMLElement>('.suggestions')?.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
}
const blocker = computed(() => {
  if (pending.value.length) return { text: `Непринятых подсказок: ${pending.value.length}`, go: showSuggestions };
  const first = issues.value.errors[0];
  if (first) return { text: `Ошибок: ${issues.value.errors.length}`, go: () => focusField(sectionOfIssue(first.path)) };
  if (!template.value.passport.name.trim()) return { text: 'Нет названия', go: () => focusField('passport.name') };
  return null;
});

const sectionBadges = computed(() => countSectionBadges(issues.value, pending.value));

const sectionSummary = computed(() => summarizeSections(template.value, levelText.value, schoolLabel.value, localized));

const facts = computed(() => checkFacts(template.value, localized));
const actionBlocks = computed(() => checkActionBlocks(template.value));

const { save, decide, saveSrd, toggleSrdSpecial, toggleSpecial } = useSpellSaving({
  props, template, suggestions, view, srdView, loaded, note, dirty, busy, error, info, infoKind, onSaved: spellId => emit('saved', spellId),
});

const { download, openApply, applyNow } = useTemplateFile({ props, template, view, busy, error, info, applyCampaigns, applyChosen });

const strengthWidth = computed(() => `${Math.min(100, Math.round((strength.value.ratio || 0) / 2 * 100))}%`);
</script>

<template>
  <div class="modal-overlay" role="dialog" aria-modal="true" aria-label="Заклинание" @click.self="emit('close')">
    <section class="modal-card spell-builder" :style="grimoireFrame" @pointerdown="onCardPointer">
      <header class="builder-head">
        <div class="art-holder">
          <button ref="headArtEl" type="button" class="art-slot" :class="{ empty: !hasArt, library: hasArt && !isOwnSpellArt(template.passport.art) }" :disabled="locked" :aria-expanded="artMenu === 'head'" title="Картинка заклинания" @click="toggleArtMenu('head')">
            <img v-if="artUrl" :src="artUrl" alt="" />
            <span v-if="!hasArt" class="art-plus" aria-hidden="true">＋</span>
          </button>
          <SpellArtMenu v-if="artMenu === 'head'" :has-art="hasArt" :busy="busy" @upload="uploadArt" @library="openLibrary" @clear="clearArt" />
        </div>
        <div class="title-block">
          <h2 translate="no">{{ template.passport.name }}</h2>
          <h2 v-if="!template.passport.name">{{ isNew ? 'Новое заклинание' : 'Заклинание' }}</h2>
          <p class="muted meta">
            <span>{{ levelText }}</span>
            <template v-if="srdMode">
              <span>SRD</span>
              <span>{{ srdView?.overridden ? 'правка кампании' : 'как в SRD' }}</span>
              <span v-if="srdView?.overridden && srdView.templateVersion > 1">версия {{ srdView.templateVersion }}</span>
              <span v-if="readOnly">только просмотр</span>
            </template>
            <span v-else>{{ status === 'new' ? 'новое' : STATUS_LABELS[status] ?? status }}</span>
            <span v-if="view?.spell.authorName">автор: <span translate="no">{{ view.spell.authorName }}</span></span>
            <span v-if="view && view.spell.templateVersion > 1">версия {{ view.spell.templateVersion }}</span>
            <span v-if="view?.proposal">есть новая версия: {{ STATUS_LABELS[view.proposal.status] ?? view.proposal.status }}</span>
          </p>
          <span class="school-mark"><img v-if="schoolArt(schoolKey)" :src="schoolArt(schoolKey)!" alt="" aria-hidden="true" />{{ schoolLabel }}</span>
          <span v-if="template.origin.srd && !template.origin.reviewed" class="review-mark" title="Таблицу собрал конвертер по тексту SRD — мастер её ещё не просматривал">перенесено автоматически — проверьте</span>
        </div>
        <div class="strength-holder">
          <button ref="strengthEl" type="button" class="strength" :class="strength.band" :aria-expanded="strengthOpen" @click="artMenu = ''; strengthOpen = !strengthOpen">
            <small>Сила: {{ STRENGTH_LABELS[strength.band] }}</small>
            <span class="bar"><i :style="{ width: strengthWidth }" /></span>
          </button>
          <div v-if="strengthOpen" class="popover strength-pop" role="dialog" aria-label="Сила заклинания">
            <p v-if="strength.band === 'none'">Урона нет — шкалу не с чем сравнить.</p>
            <p v-else>~{{ strength.damage }} урона против обычных ~{{ strength.expected }} для круга</p>
            <p class="muted">Шкала только подсказывает: ограничений нет, решает мастер.</p>
          </div>
        </div>
        <button type="button" class="close" aria-label="Закрыть" @click="emit('close')"><GameIcon class="inline-icon" name="close" :size="16" /></button>
      </header>

      <nav class="steps" role="tablist" aria-label="Шаги">
        <button v-for="[number, title] in STEPS" :key="number" type="button" role="tab" :aria-selected="step === number" @click="step = number">
          <span class="step-seal" aria-hidden="true" translate="no">{{ splitTitle(title)[0] }}</span><span translate="no">{{ splitTitle(title)[1] }}</span>
          <span v-if="number === 2 && pending.length" class="badge pending" title="Непринятых подсказок">{{ pending.length }}</span>
          <span v-if="number === 3 && issues.errors.length" class="badge bad" title="Ошибок">{{ issues.errors.length }}</span>
        </button>
      </nav>

      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <div ref="bodyEl" class="builder-body">
        <p v-if="showInfo" class="notice">{{ info }}</p>
        <p v-if="view?.spell.reviewNote && (status === 'rework' || status === 'rejected')" class="notice">Мастер: «<span translate="no">{{ view.spell.reviewNote }}</span>»</p>
        <p v-if="view?.proposal?.note" class="notice">Мастер о новой версии: «<span translate="no">{{ view.proposal.note }}</span>»</p>

        <SpellDescribeStep
          v-if="step === 1" :passport="template.passport" :locked="locked" :busy="busy" :srd-mode="srdMode" :highlighted="highlighted" :has-pending="pending.length > 0"
          @suggest="suggest" @show-rules="rulesOpen = true" @to-table="step = 2"
        />

        <section v-else-if="step === 2" class="step-table">
          <SuggestionsPanel
            v-if="pending.length" v-model:open="suggestionsOpen" :pending="pending" :locked="locked"
            @accept="accept" @accept-all="acceptAll" @clear="entry => entry.status = 'cleared'"
          />

          <article v-for="[id, title] in SECTIONS" :key="id" class="table-section" :class="{ open: open.has(id) }" :data-section="id">
            <button type="button" class="section-toggle" :aria-expanded="open.has(id)" @click="toggleSection(id)">
              <span class="chevron" aria-hidden="true">▸</span>
              <span class="section-title" translate="no"><span class="chapter-letter">{{ splitTitle(title)[0] }}</span><span>{{ splitTitle(title)[1] }}</span></span>
              <span v-if="sectionBadges[id]?.errors" class="badge bad" title="Ошибок">{{ sectionBadges[id]!.errors }}</span>
              <span v-if="sectionBadges[id]?.pending" class="badge pending" title="Непринятых подсказок">{{ sectionBadges[id]!.pending }}</span>
              <span v-if="sectionBadges[id]?.warnings" class="badge warn" title="Стоит посмотреть">{{ sectionBadges[id]!.warnings }}</span>
              <span class="section-summary">
                <template v-for="(segment, index) in sectionSummary[id] ?? []" :key="index"><span v-if="index" class="dot"> · </span><span :translate="segment.user ? 'no' : undefined">{{ segment.text }}</span></template>
              </span>
            </button>
            <div v-if="open.has(id)" class="section-body">
              <PassportSection
                v-if="id === 'passport'" :passport="template.passport" :locked="locked" :busy="busy" :art-url="artUrl" :has-art="hasArt"
                :art-menu-open="artMenu === 'passport'" :register-art-el="setPassportArtEl"
                @toggle-art="toggleArtMenu('passport')" @upload="uploadArt" @library="openLibrary" @clear="clearArt"
              />

              <CastingSection v-else-if="id === 'casting'" :template="template" :locked="locked" />

              <DurationSection v-else-if="id === 'duration'" :template="template" :locked="locked" />

              <TargetingSection v-else-if="id === 'targeting'" :template="template" :locked="locked" />

              <OptionsSection v-else-if="id === 'options'" :template="template" :locked="locked" />

              <ActionsSection v-else-if="id === 'actions'" :template="template" :locked="locked" />

              <CommandsSection v-else-if="id === 'commands'" :template="template" :locked="locked" />

              <ScalingSection v-else-if="id === 'scaling'" :template="template" :locked="locked" />

              <EndingSection v-else-if="id === 'ending'" :template="template" :locked="locked" />

              <HintsSection v-else-if="id === 'hints'" :template="template" :locked="locked" />
            </div>
          </article>
        </section>

        <SpellCheckStep
          v-else v-model:note="note"
          :template="template" :art-url="artUrl" :level-text="levelText" :school-label="schoolLabel" :facts="facts" :action-blocks="actionBlocks"
          :issues="issues" :pending="pending" :manual="manual" :partial="partial" :reviewing="reviewing" :locked="locked" :dirty="dirty"
          @to-section="focusField" @show-suggestions="showSuggestions" @decide="decide"
        />
      </div>

      <footer v-if="srdMode" class="builder-foot">
        <div v-if="srdView?.canEdit" class="foot-main">
          <button type="button" class="primary" :disabled="locked || issues.errors.length > 0" @click="saveSrd(false)">Сохранить для кампании</button>
          <button v-if="srdView.overridden" type="button" :disabled="locked" title="Убрать правку кампании — заклинание снова как в SRD" @click="saveSrd(true)">Как в SRD</button>
        </div>
        <div class="foot-tools">
          <button type="button" class="quiet" :disabled="busy" title="Файл шаблона — чтобы предложить его мастеру другой кампании" @click="download"><GameIcon class="inline-icon" name="download" :size="16" /> Скачать шаблон</button>
          <label v-if="srdView?.canEdit && srdView.overridden" class="checkbox-label" title="Окно «примените вручную» мастеру при сотворении"><input type="checkbox" :checked="srdView.specialNotify" :disabled="locked" @change="toggleSrdSpecial" /> окно «Особое»</label>
        </div>
      </footer>
      <footer v-else class="builder-foot">
        <div v-if="!reviewing" class="foot-main">
          <button v-if="!(canReview && status === 'approved')" type="button" :disabled="locked || !template.passport.name.trim()" @click="save(false)">Сохранить черновик</button>
          <button type="button" class="primary" :disabled="locked || !template.passport.name.trim() || issues.errors.length > 0 || pending.length > 0" :aria-describedby="blocker ? 'spell-builder-blocker' : undefined" @click="save(true)">
            {{ canReview ? (status === 'approved' ? 'Сохранить — новая версия' : 'Создать') : status === 'approved' ? 'Отправить новую версию мастеру' : 'Отправить на рассмотрение' }}
          </button>
          <button v-if="blocker" id="spell-builder-blocker" type="button" class="small quiet blocker" title="Показать, что мешает" @click="blocker.go()"><GameIcon class="inline-icon" name="alert" :size="16" /> {{ blocker.text }}</button>
        </div>
        <div class="foot-tools">
          <button type="button" class="quiet" :disabled="busy" title="Файл шаблона — чтобы предложить его мастеру другой кампании" @click="download"><GameIcon class="inline-icon" name="download" :size="16" /> Скачать шаблон</button>
          <template v-if="canReview && view && status === 'approved'">
            <button type="button" class="quiet" :disabled="locked" @click="openApply">Применить в других кампаниях…</button>
            <label class="checkbox-label" title="Окно «примените вручную» мастеру при сотворении"><input type="checkbox" :checked="view.spell.specialNotify" :disabled="locked" @change="toggleSpecial" /> окно «Особое»</label>
          </template>
        </div>
      </footer>

      <div v-if="applyCampaigns" class="popover apply" aria-label="Применить в других кампаниях">
        <strong>Применить в других кампаниях</strong>
        <p v-if="!applyCampaigns.length" class="muted">Других кампаний, где вы мастер, нет. Создайте кампанию на вкладке «Кампании» — и шаблон можно будет применить в ней.</p>
        <label v-for="campaign in applyCampaigns" :key="campaign.id" class="checkbox-label"><input v-model="applyChosen" type="checkbox" :value="campaign.id" /> <span translate="no">{{ campaign.name }}</span></label>
        <div class="actions-row">
          <button type="button" class="primary" :disabled="locked || !applyChosen.length" @click="applyNow">Применить</button>
          <button type="button" @click="applyCampaigns = null">Отмена</button>
        </div>
      </div>
    </section>
    <SuggestRulesDialog v-if="rulesOpen" :busy="busy" @close="rulesOpen = false" @insert="insertExample" />
    <ArtPickerDialog
      v-if="artPicker" title="Картинка заклинания" :suggested="artSuggested" :first-sections="['Магия']" :busy="busy"
      @pick="pickLibraryArt" @close="artPicker = false"
    />
  </div>
</template>

<style scoped src="./builderKit.css"></style>
<style scoped>
/* Above the character sheet (z-index 3000): the window is teleported to body from SpellsPanel. */
.modal-overlay{position:fixed;inset:0;z-index:3600;display:flex;align-items:center;justify-content:center;padding:16px;background:#0b0704cc;overscroll-behavior:contain}
.modal-card{overflow:hidden;padding:16px 20px;background:var(--parchment-background);color:var(--ink);border:1px solid var(--brass);border-radius:6px;box-shadow:0 16px 40px #000a}
.spell-builder{position:relative;box-sizing:border-box;width:min(1100px,100%);height:calc(90dvh / var(--ui-zoom, 1));display:flex;flex-direction:column;gap:10px}
.builder-head,.steps,.builder-foot,.spell-builder>.error{flex-shrink:0}
.builder-head{display:flex;gap:14px;align-items:flex-start}
.title-block{flex:1;min-width:0}
.title-block h2{margin:0;overflow-wrap:anywhere;line-height:1.15}
.meta{display:flex;flex-wrap:wrap;gap:0 10px;margin:4px 0 0;font-size:14px}
.meta>span+span::before{content:'·';margin-right:10px;opacity:.6}
.close{flex-shrink:0}

.art-holder,.strength-holder{position:relative;flex-shrink:0}
.art-slot{width:64px;height:64px;padding:0;display:grid;place-items:center;overflow:hidden;border-radius:8px;border:1px solid var(--g-gold-lo,var(--brass));background:var(--g-well,var(--surface-inset));position:relative}
.art-slot img{width:100%;height:100%;object-fit:cover}
.art-slot.empty img{opacity:.35;filter:grayscale(.4)}
.art-plus{position:absolute;inset:0;display:grid;place-items:center;font-size:24px;color:var(--g-gold-hi,var(--brass))}
.popover{position:absolute;z-index:6;display:flex;flex-direction:column;gap:6px;padding:10px;min-width:240px;border:1px solid var(--g-gold-lo,var(--brass));border-radius:8px;background:var(--g-stone-2,var(--parchment-background));box-shadow:0 10px 28px #000b}
.art-slot.library img{object-fit:contain;padding:4px;box-sizing:border-box}

.strength{display:flex;flex-direction:column;align-items:stretch;gap:4px;min-width:180px;padding:6px 10px;background:none;box-shadow:none;border:1px solid transparent;border-radius:6px}
.strength:hover,.strength[aria-expanded="true"]{border-color:var(--g-line,var(--brass-light))}
.strength small{font-size:13px;margin:0;text-align:left}
.strength .bar{height:10px;border-radius:5px;background:var(--g-well,var(--surface-inset));overflow:hidden;box-shadow:inset 0 0 0 1px var(--g-line,var(--brass-light))}
.strength .bar i{display:block;height:100%;background:var(--g-good,#6ab04c)}
.strength.strong .bar i{background:var(--g-warn,#e1a33a)}
.strength.very-strong .bar i{background:var(--g-bad,#c0392b)}
.strength.weak .bar i{background:var(--g-mana,#7f9cc0)}
.strength-pop{top:calc(100% + 6px);right:0;max-width:320px}
.strength-pop p{margin:0;font-size:14px}

.steps{display:flex;flex-wrap:wrap;gap:6px;border-bottom:1px solid var(--g-line,var(--brass-light));padding-bottom:8px}
.steps button{display:inline-flex;align-items:center;gap:8px}
.steps button[aria-selected="true"]{background:var(--burgundy);color:var(--burgundy-text)}

.builder-body{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:2px 8px 12px 0;scroll-padding-top:52px}
.builder-body>.notice{margin:0 0 10px}
.step-table{display:flex;flex-direction:column;gap:14px}


.table-section{border:1px solid var(--g-line,var(--brass-light));border-radius:8px}
.section-toggle{width:100%;display:flex;align-items:center;gap:10px;text-align:left;font-weight:700;font-size:16px;background:var(--g-stone-2,transparent);border:none;box-shadow:none;padding:9px 12px;border-radius:8px}
.table-section.open .section-toggle{border-bottom:1px solid var(--g-line,var(--brass-light));border-radius:8px 8px 0 0}
.table-section.open>.section-toggle{position:sticky;top:0;z-index:2;background:var(--g-stone-2,var(--parchment-background))}
.section-body :deep(.action-editor){scroll-margin-top:56px}
.section-title{flex-shrink:0}
.section-summary{margin-left:auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--g-text-dim,inherit);font-size:13px;font-weight:400}
.section-body{display:flex;flex-direction:column;gap:12px;padding:12px}

.review-mark{display:inline-block;margin:6px 0 0 10px;padding:2px 10px;border-radius:10px;font-size:12px;background:color-mix(in srgb,var(--g-warn,#e1a33a) 22%,transparent);border:1px solid color-mix(in srgb,var(--g-warn,#e1a33a) 60%,transparent)}
.blocker{color:var(--g-warn,#e1a33a)}

.builder-foot{display:flex;gap:8px 16px;flex-wrap:wrap;align-items:center;justify-content:space-between;border-top:1px solid var(--g-line,var(--brass-light));padding-top:10px;margin-top:0}
.foot-main,.foot-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.apply{right:20px;bottom:72px;min-width:280px}
:root[data-ui="game"] .spell-builder{background:var(--g-stone-panel);box-shadow:var(--g-ring),var(--g-shadow);color:var(--g-text)}
:root[data-ui="game"] .spell-builder::after{content:"";position:absolute;inset:12px auto 12px 5px;width:5px;pointer-events:none;background:linear-gradient(90deg,var(--g-well),var(--g-gold-lo),var(--g-stone-3));opacity:.65}
:root[data-ui="game"] .builder-body{background:var(--g-stone-3);border-radius:4px;padding:8px 10px 12px;scroll-padding-top:64px}

:root[data-ui="game"] .builder-head{align-items:center;padding:2px 0 10px 8px;background:linear-gradient(90deg,transparent,var(--g-gold-lo),transparent) bottom/100% 1px no-repeat}
:root[data-ui="game"] .title-block h2{font-family:var(--g-title-font);font-size:clamp(26px,2.5vw,32px);color:var(--g-gold-hi);text-shadow:0 2px 2px #000}
.school-mark{display:inline-flex;align-items:center;gap:6px;margin-top:5px;font-size:13px}
.school-mark img{width:22px;height:22px;object-fit:contain}
:root[data-ui="game"] .school-mark{color:var(--g-text)}
:root[data-ui="game"] .art-slot{position:relative;padding:7px;border:0;background:var(--g-well);box-shadow:inset 0 0 12px #000}
:root[data-ui="game"] .art-slot::after{content:"";position:absolute;inset:0;z-index:0;pointer-events:none;background:var(--sb-frame) center/100% 100% no-repeat}
:root[data-ui="game"] .art-slot img{position:relative;z-index:1;border-radius:3px}
:root[data-ui="game"] .art-slot{width:84px;height:84px}
:root[data-ui="game"] .art-slot.library img{padding:1px}
:root[data-ui="game"] .art-plus{z-index:2;text-shadow:0 1px 4px #000}

.step-seal{display:inline-grid;place-items:center;flex:0 0 28px;height:28px;border-radius:50%}
:root[data-ui="game"] .steps{gap:10px;padding:2px 0 10px}
:root[data-ui="game"] .steps>button{min-height:46px;padding:6px 14px 6px 8px;border-radius:5px 5px 10px 10px;background:var(--g-plate);color:var(--g-text);box-shadow:var(--g-ring-thin)}
:root[data-ui="game"] .step-seal{border:1px solid var(--g-gold-lo);background:var(--g-well);color:var(--g-gold-hi);font-family:var(--g-title-font)}
:root[data-ui="game"] .steps>button[aria-selected="true"]{background:linear-gradient(180deg,#ffffff0c,transparent),var(--g-accent);color:var(--g-accent-text);box-shadow:var(--g-ring-thin),inset 0 -3px var(--g-gold)}
:root[data-ui="game"] .steps>button[aria-selected="true"] .step-seal{border-color:var(--g-gold);box-shadow:0 0 10px var(--g-glow)}


.chapter-letter{display:inline-grid;place-items:center;min-width:30px;height:30px;padding:0 4px;box-sizing:border-box;border-radius:3px}
.section-title{display:inline-flex;align-items:center;gap:9px}
:root[data-ui="game"] .table-section{border-color:var(--g-gold-deep);background:var(--g-stone-3)}
:root[data-ui="game"] .section-toggle{min-height:50px;background:var(--g-stone-2);color:var(--g-gold-hi)}
:root[data-ui="game"] .table-section.open>.section-toggle{background:var(--g-stone-2);box-shadow:0 3px 6px #0006}
:root[data-ui="game"] .chapter-letter{border:1px solid var(--g-gold-lo);background:var(--g-well);color:var(--g-gold-hi);font:700 20px/1 var(--g-body-font)}
:root[data-ui="game"] .section-summary{color:var(--g-text)}
:root[data-ui="game"] .section-body :deep(.action-editor){scroll-margin-top:68px}


:root[data-ui="game"] .strength{min-height:48px;background:var(--g-well);border-color:var(--g-gold-deep)}
:root[data-ui="game"] .strength small{color:var(--g-text)}
:root[data-ui="game"] .strength .bar{position:relative;height:14px;border-radius:2px;background:var(--g-stone-3);box-shadow:inset 0 0 0 1px var(--g-gold-lo)}
:root[data-ui="game"] .strength .bar i{box-shadow:inset 0 2px 0 #ffffff45,inset 0 -3px 0 #0005}
:root[data-ui="game"] .strength .bar::after{content:"";position:absolute;inset:1px;pointer-events:none;background:repeating-linear-gradient(115deg,transparent 0 17px,#ffffff20 17px 18px,#0005 18px 19px)}


:root[data-ui="game"] .builder-foot{position:relative;padding-top:12px;border-top-color:var(--g-gold-lo);background:var(--g-stone-3)}
:root[data-ui="game"] .builder-foot::before{content:"";position:absolute;top:-4px;left:calc(50% - 3px);width:6px;height:6px;transform:rotate(45deg);background:var(--g-gold);box-shadow:0 0 0 3px var(--g-stone-3);pointer-events:none}
:root[data-ui="game"] .foot-main>.primary{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:46px;padding:7px 16px;white-space:normal;background:linear-gradient(180deg,#ffffff14,transparent 55%,#0003),var(--g-accent);color:var(--g-accent-text);border-color:var(--g-gold-lo);box-shadow:var(--g-ring-thin),inset 0 1px 0 #ffffff20}
:root[data-ui="game"] .foot-main>.primary::before{content:"";width:24px;height:24px;flex:0 0 24px;border-radius:50%;border:1px solid var(--g-gold);background:radial-gradient(circle,var(--g-gold-hi) 0 2px,transparent 3px),radial-gradient(circle,transparent 44%,#0005 46% 52%,transparent 54%),var(--g-accent);box-shadow:inset 0 1px 2px #ffffff30,0 2px 3px #0008}
:root[data-ui="game"] .foot-main>.primary:disabled{opacity:1;background:var(--g-stone-2);color:var(--g-text-dim);border-color:var(--g-line);box-shadow:inset 0 0 0 1px var(--g-line)}
:root[data-ui="game"] .foot-main>.primary:disabled::before{background:var(--g-stone-3);border-color:var(--g-text-dim);box-shadow:inset 0 0 0 3px var(--g-stone-2);filter:none;opacity:.65}
@media (max-width:1100px){
  :root[data-ui="game"] .builder-foot{align-items:flex-start;gap:10px}
  :root[data-ui="game"] .foot-main,:root[data-ui="game"] .foot-tools{max-width:100%}
  :root[data-ui="game"] .foot-main,:root[data-ui="game"] .foot-tools{flex:1 1 100%;min-width:0}
  :root[data-ui="game"] .foot-tools{justify-content:flex-end}
  :root[data-ui="game"] .foot-tools>button{min-width:0;white-space:normal}
}

@media (hover:hover){
  :root[data-ui="game"] .steps>button:not(:disabled):hover{border-color:var(--g-gold-hi);color:var(--g-gold-hi)}
  :root[data-ui="game"] .art-slot:not(:disabled):hover::after{filter:brightness(1.15)}
}
@media (prefers-reduced-motion:reduce){
  .spell-builder,.spell-builder :deep(*){animation:none!important;transition:none!important;scroll-behavior:auto!important}
}
</style>
