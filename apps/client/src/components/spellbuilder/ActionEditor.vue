<script setup lang="ts">
import { computed, reactive } from 'vue';
import ActionSummary from './ActionSummary.vue';
import GameIcon from '../game/GameIcon.vue';
import {
  ABILITIES, CHECK_KINDS, EFFECT_CATALOG, EFFECT_KINDS, OUTCOME_LABELS, SKILLS, TIMES, WHEN, WHO,
  emptyAction, emptyEffect, outcomesFor, parseTemplateFormula, shown,
  type Action, type Effect, type EffectKind, type FieldSpec, type Outcome,
} from '../../../../../packages/domain/spells/spell-template';

const props = defineProps<{ depth: number; zone?: boolean; disabled?: boolean }>();
const action = defineModel<Action>({ required: true });
const emit = defineEmits<{ remove: []; duplicate: [] }>();

const ZONE_WHEN = new Set(['zone-enter-or-start', 'zone-enter', 'zone-start', 'zone-end']);
const whenOptions = computed(() => WHEN.filter(([value]) => props.zone ? true : !ZONE_WHEN.has(value)));
const outcomes = computed(() => outcomesFor(action.value.check.kind));
const SUPPORT_MARK: Record<string, string> = { yes: '✓', partial: '◐', no: '✗' };
const SUPPORT_TITLE: Record<string, string> = {
  yes: 'Игра считает сама', partial: 'Игра считает часть, остальное — мастер вручную', no: 'Пока вручную: мастер получит окно «примените вручную»',
};
const effectOptions = EFFECT_KINDS.filter(kind => kind !== 'zone' || props.depth < 2);
const EFFECT_GROUPS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['Урон и хиты', ['damage', 'heal', 'temp-hp', 'max-hp', 'pool']],
  ['Состояния и защита', ['condition', 'ac', 'defense', 'invisible', 'senses', 'remove']],
  ['Броски', ['attack-rolls', 'checks', 'extra-damage']],
  ['Движение и действия', ['speed', 'move', 'restrict', 'extra-action']],
  ['На карте и в мире', ['zone', 'wall', 'summon', 'shape', 'weapon']],
  ['Прочее', ['preset', 'message', 'special']],
];
const effectGroups = computed(() => {
  const groups = EFFECT_GROUPS.map(([label, kinds]) => ({ label, kinds: effectOptions.filter(kind => kinds.includes(kind)) }));
  const listed = new Set(EFFECT_GROUPS.flatMap(([, kinds]) => kinds));
  const rest = effectOptions.filter(kind => !listed.has(kind));
  if (rest.length) groups[groups.length - 1]!.kinds.push(...rest);
  return groups.filter(group => group.kinds.length);
});


function setCheck(kind: Action['check']['kind']) {
  const before = outcomesFor(action.value.check.kind);
  const after = outcomesFor(kind);
  const moved: Partial<Record<Outcome, Effect[]>> = {};
  for (const [outcome, list] of Object.entries(action.value.outcomes) as Array<[Outcome, Effect[] | undefined]>) {
    if (!list?.length) continue;
    const index = before.indexOf(outcome);
    const target = after[Math.max(0, Math.min(after.length - 1, index < 0 ? 0 : index))]!;
    moved[target] = [...(moved[target] ?? []), ...list];
  }
  action.value.check.kind = kind;
  action.value.outcomes = moved;
  if (kind !== 'save' && kind !== 'ability') action.value.successHalf = false;
}

function effectsOf(outcome: Outcome): Effect[] {
  return action.value.outcomes[outcome] ?? [];
}
function addEffect(outcome: Outcome, kind: string) {
  if (!kind) return;
  action.value.outcomes = { ...action.value.outcomes, [outcome]: [...effectsOf(outcome), emptyEffect(kind as EffectKind)] };
}
function removeEffect(outcome: Outcome, id: string) {
  action.value.outcomes = { ...action.value.outcomes, [outcome]: effectsOf(outcome).filter(effect => effect.id !== id) };
}
function toggle(effect: Effect, key: string, value: string) {
  const list = Array.isArray(effect.values[key]) ? [...(effect.values[key] as string[])] : [];
  const index = list.indexOf(value);
  if (index >= 0) list.splice(index, 1);
  else list.push(value);
  effect.values[key] = list;
}
function formulaBad(value: unknown) {
  return Boolean(String(value ?? '').trim()) && !parseTemplateFormula(String(value));
}
const SECONDARY: Partial<Record<EffectKind, string[]>> = { damage: ['magical', 'split'], heal: ['notUndead'] };
const moreOpen = reactive(new Set<string>());
function fields(effect: Effect, secondary = false): FieldSpec[] {
  const extra = SECONDARY[effect.kind] ?? [];
  return EFFECT_CATALOG[effect.kind].fields.filter(field => shown(field, effect.values) && extra.includes(field.key) === secondary);
}
function moreShown(effect: Effect): boolean {
  return moreOpen.has(effect.id) || fields(effect, true).some(field => effect.values[field.key] !== field.default);
}
function addNested(effect: Effect) {
  const inner = emptyAction('В зоне');
  inner.when = 'zone-enter-or-start';
  inner.who = 'entering';
  inner.times = 'turn';
  effect.actions.push(inner);
}
function duplicateNested(effect: Effect, index: number) {
  const copy = JSON.parse(JSON.stringify(effect.actions[index])) as Action;
  copy.id = emptyAction().id;
  effect.actions.splice(index + 1, 0, copy);
}
</script>

<template>
  <div class="action-editor" :class="`depth-${depth}`">
    <header class="action-head">
      <input v-model="action.name" class="action-name" maxlength="100" :disabled="disabled" aria-label="Название действия" />
      <span class="action-tools">
        <button type="button" class="link-button icon-button" :disabled="disabled" title="Копия этого действия" aria-label="Копия этого действия" @click="emit('duplicate')">⧉</button>
        <button type="button" class="link-button danger-link icon-button" :disabled="disabled" title="Убрать действие" aria-label="Убрать действие" @click="emit('remove')"><GameIcon class="inline-icon" name="close" :size="16" /></button>
      </span>
    </header>

    <div class="action-grid">
      <label>Когда
        <select v-model="action.when" :disabled="disabled">
          <option v-for="[value, label] in whenOptions" :key="value" :value="value">{{ label }}</option>
        </select>
      </label>
      <label>Сколько раз
        <span class="pair">
          <select v-model="action.times" :disabled="disabled">
            <option v-for="[value, label] in TIMES" :key="value" :value="value">{{ label }}</option>
          </select>
          <input v-if="action.times === 'count'" v-model.number="action.timesCount" type="number" min="1" max="100" :disabled="disabled" aria-label="Сколько раз" />
        </span>
      </label>
      <label>Кого
        <span class="pair">
          <select v-model="action.who" :disabled="disabled">
            <option v-for="[value, label] in WHO" :key="value" :value="value">{{ label }}</option>
          </select>
          <input v-if="action.who === 'chosen'" v-model.number="action.whoMax" type="number" min="1" max="100" :disabled="disabled" aria-label="Сколько выбрать" />
        </span>
      </label>
    </div>

    <fieldset class="check">
      <legend>Проверка</legend>
      <div class="action-grid">
        <label>Какая проверка
          <select :value="action.check.kind" :disabled="disabled" @change="setCheck(($event.target as HTMLSelectElement).value as Action['check']['kind'])">
            <option v-for="[value, label] in CHECK_KINDS" :key="value" :value="value">{{ label }}</option>
          </select>
        </label>
        <template v-if="action.check.kind === 'attack'">
          <label>Атака
            <select v-model="action.check.attackRange" :disabled="disabled">
              <option value="ranged">дальнобойная</option>
              <option value="melee">рукопашная</option>
            </select>
          </label>
        </template>
        <label v-if="action.check.kind === 'attack' || action.check.kind === 'none'" title="Лучи, дротики, снаряды: у каждого своя цель">
          {{ action.check.kind === 'attack' ? 'Бросков атаки' : 'Снарядов (попадают сами)' }}
          <input v-model.number="action.check.attackCount" type="number" min="1" max="20" :disabled="disabled" />
        </label>
        <template v-if="action.check.kind === 'save' || action.check.kind === 'ability'">
          <label>{{ action.check.kind === 'save' ? 'Спасбросок' : 'Характеристика проверки' }}
            <select v-model="action.check.ability" :disabled="disabled">
              <option v-for="[value, label] in ABILITIES" :key="value" :value="value">{{ label }}</option>
            </select>
          </label>
          <label>СЛ
            <span class="pair">
              <select v-model="action.check.dc" :disabled="disabled">
                <option value="spell">заклинаний</option>
                <option value="fixed">число</option>
              </select>
              <input v-if="action.check.dc === 'fixed'" v-model.number="action.check.dcValue" type="number" min="1" max="40" :disabled="disabled" aria-label="СЛ" />
            </span>
          </label>
        </template>
        <template v-if="action.check.kind === 'ability'">
          <label>Навык
            <select v-model="action.check.skill" :disabled="disabled">
              <option value="none">— характеристика —</option>
              <option v-for="[value, label] in SKILLS" :key="value" :value="value">{{ label }}</option>
            </select>
          </label>
          <label>Кто проверяет
            <select v-model="action.check.roller" :disabled="disabled">
              <option value="target">цель</option>
              <option value="caster">заклинатель</option>
            </select>
          </label>
        </template>
        <template v-if="action.check.kind === 'contest'">
          <label>Навык заклинателя
            <select v-model="action.check.contestMine" :disabled="disabled">
              <option v-for="[value, label] in SKILLS" :key="value" :value="value">{{ label }}</option>
            </select>
          </label>
          <label>Навык цели
            <select v-model="action.check.contestTheirs" :disabled="disabled">
              <option v-for="[value, label] in SKILLS" :key="value" :value="value">{{ label }}</option>
            </select>
          </label>
        </template>
        <label v-if="action.check.kind === 'caster-d20'">Не меньше
          <input v-model.number="action.check.threshold" type="number" min="1" max="30" :disabled="disabled" />
        </label>
        <label v-if="action.check.kind === 'hp-threshold'">Хиты цели не больше
          <input v-model="action.check.hpFormula" :class="{ bad: formulaBad(action.check.hpFormula) }" :disabled="disabled" placeholder="5к8" />
        </label>
      </div>
    </fieldset>

    <div class="outcomes">
      <section v-for="outcome in outcomes" :key="outcome" class="outcome" :data-outcome="outcome">
        <h5>{{ outcome === 'always' ? 'Последствия' : OUTCOME_LABELS[outcome] }}</h5>
        <label v-if="outcome === 'success' && (action.check.kind === 'save' || action.check.kind === 'ability')" class="checkbox-label">
          <input v-model="action.successHalf" type="checkbox" :disabled="disabled" /> половина урона
        </label>
        <article v-for="effect in effectsOf(outcome)" :key="effect.id" class="effect">
          <header>
            <strong>{{ EFFECT_CATALOG[effect.kind].label }}</strong>
            <span class="support" :class="EFFECT_CATALOG[effect.kind].support" :title="SUPPORT_TITLE[EFFECT_CATALOG[effect.kind].support]" :aria-label="SUPPORT_TITLE[EFFECT_CATALOG[effect.kind].support]">{{ SUPPORT_MARK[EFFECT_CATALOG[effect.kind].support] }}</span>
            <button type="button" class="link-button danger-link icon-button" :disabled="disabled" aria-label="Убрать последствие" title="Убрать последствие" @click="removeEffect(outcome, effect.id)"><GameIcon class="inline-icon" name="close" :size="16" /></button>
          </header>
          <div class="effect-fields">
            <template v-for="field in [...fields(effect), ...(moreShown(effect) ? fields(effect, true) : [])]" :key="field.key">
              <label v-if="field.type === 'bool'" class="checkbox-label">
                <input v-model="effect.values[field.key]" type="checkbox" :disabled="disabled" /> {{ field.label }}
              </label>
              <label v-else-if="field.type === 'select'">{{ field.label }}
                <select v-model="effect.values[field.key]" :disabled="disabled">
                  <option v-for="[value, label] in field.options" :key="value" :value="value">{{ label }}</option>
                </select>
              </label>
              <fieldset v-else-if="field.type === 'multi'" class="multi">
                <legend>{{ field.label }}</legend>
                <label v-for="[value, label] in field.options" :key="value" class="chip" :class="{ on: (effect.values[field.key] as string[] | undefined)?.includes(value) }">
                  <input type="checkbox" :checked="(effect.values[field.key] as string[] | undefined)?.includes(value)" :disabled="disabled" @change="toggle(effect, field.key, value)" />{{ label }}
                </label>
              </fieldset>
              <label v-else-if="field.type === 'number'">{{ field.label }}
                <input v-model.number="effect.values[field.key]" type="number" :disabled="disabled" />
              </label>
              <label v-else :class="{ wide: field.type === 'text' }">{{ field.label }}
                <input
                  v-model="effect.values[field.key]" :class="{ bad: field.type === 'formula' && formulaBad(effect.values[field.key]) }"
                  :placeholder="field.type === 'formula' ? '2к6 + @mod' : ''" :disabled="disabled"
                />
              </label>
            </template>
          </div>
          <button v-if="fields(effect, true).length && !moreShown(effect)" type="button" class="link-button more" :disabled="disabled" @click="moreOpen.add(effect.id)">ещё…</button>
          <div v-if="effect.kind === 'zone'" class="nested">
            <p class="muted">Что происходит в зоне — действия с «Когда»: вошёл, начал или закончил ход в ней.</p>
            <ActionEditor
              v-for="(_, index) in effect.actions" :key="effect.actions[index]!.id" v-model="effect.actions[index]!" :depth="depth + 1" zone :disabled="disabled"
              @remove="effect.actions.splice(index, 1)" @duplicate="duplicateNested(effect, index)"
            />
            <button type="button" class="add-button" :disabled="disabled" @click="addNested(effect)">＋ действие в зоне</button>
          </div>
        </article>
        <select class="add-effect" :disabled="disabled" value="" aria-label="Добавить последствие" @change="addEffect(outcome, ($event.target as HTMLSelectElement).value); ($event.target as HTMLSelectElement).value = ''">
          <option value="">＋ последствие…</option>
          <optgroup v-for="group in effectGroups" :key="group.label" :label="group.label">
            <option v-for="kind in group.kinds" :key="kind" :value="kind">{{ SUPPORT_MARK[EFFECT_CATALOG[kind].support] }} {{ EFFECT_CATALOG[kind].label }}</option>
          </optgroup>
        </select>
      </section>
    </div>
    <p class="summary"><ActionSummary :action="action" /></p>
  </div>
</template>

<style scoped>
.action-editor{display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--g-line,var(--brass-light));border-radius:8px;background:var(--surface-inset)}
.action-editor.depth-1,.action-editor.depth-2{background:var(--surface,transparent)}
label{margin:0}
.action-head{display:flex;gap:8px;align-items:center}
.action-name{flex:1;min-width:0;font-weight:700}
.action-tools{display:flex;gap:4px}
.icon-button{display:inline-flex;align-items:center;justify-content:center;min-width:32px;min-height:32px;text-decoration:none}
.danger-link.icon-button:hover{color:var(--g-bad,#c0392b)}
.action-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr));gap:12px;row-gap:12px}
.action-grid>label,.effect-fields>label{min-width:0}
.action-grid label,.effect-fields label{display:flex;flex-direction:column;gap:4px;font-size:14px}
.pair{display:flex;gap:6px}
.pair select{flex:1 1 0;min-width:0}
.pair input{flex:0 0 70px;width:70px}
.check{margin:0;border:0;border-top:1px solid var(--g-line,var(--brass-light));border-radius:0;padding:6px 0 0}
.check legend{padding:0 6px 0 0;font-size:14px;font-weight:700}
.outcomes{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:12px;align-items:start}
.outcome{min-width:0;display:flex;flex-direction:column;gap:8px;padding:8px 0 0;border:0;border-top:2px solid var(--g-gold-lo,var(--brass-light));border-radius:0}
.outcome h5{margin:0;font-size:14px;text-transform:none;letter-spacing:0}
.outcome h5::first-letter{text-transform:uppercase}
.effect{border:1px solid var(--g-line,var(--brass-light));border-radius:6px;padding:8px 10px;background:var(--g-well,var(--surface,transparent))}
.effect header{display:flex;align-items:center;gap:6px}
.effect header strong{flex:1}
.support{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;font-size:12px;font-weight:700;border:1px solid currentColor}
.support.yes{color:var(--g-good,#6ab04c)}
.support.partial{color:var(--g-warn,#e1a33a)}
.support.no{color:var(--g-bad,#c0392b)}
.effect-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr));gap:10px;row-gap:8px;margin-top:4px}
.more{margin-top:4px;font-size:13px}
.effect-fields .wide,.effect-fields .multi{grid-column:1/-1}
.multi{display:flex;flex-wrap:wrap;gap:6px;border:none;padding:0;margin:0}
.multi legend{font-size:14px;margin-bottom:6px}
.chip{display:inline-flex!important;flex-direction:row!important;align-items:center;gap:6px;min-height:32px;padding:4px 10px;border:1px solid var(--g-line,var(--brass-light));border-radius:16px;cursor:pointer;font-size:13px}
.chip input{width:14px;height:14px;margin:0;accent-color:var(--g-gold,var(--brass))}
.chip.on{background:var(--burgundy);color:var(--burgundy-text)}
.chip:focus-within{outline:2px solid var(--g-gold-hi,var(--brass));outline-offset:2px}
.nested{display:flex;flex-direction:column;gap:10px;margin-top:10px;padding-left:12px;border-left:3px solid var(--g-gold-lo,var(--brass,#c9a227))}
.add-effect{width:100%;min-width:0}
.add-button{align-self:flex-start;min-height:36px;padding:6px 12px}
.bad{outline:2px solid var(--g-bad,#c0392b)}
.summary{margin:0;font-size:13px;line-height:1.5;color:var(--g-text-dim,inherit)}
.checkbox-label{display:flex!important;flex-direction:row!important;align-items:center;gap:6px}
:root[data-ui="game"] .action-editor{position:relative;padding:16px;gap:12px;border-color:var(--g-gold-lo);background:var(--g-stone-2);box-shadow:inset 0 0 0 3px var(--g-stone-3),0 4px 10px #0005}
:root[data-ui="game"] .action-editor::before,:root[data-ui="game"] .action-editor::after{content:"";position:absolute;width:28px;height:28px;background:var(--g-gold);opacity:.7;pointer-events:none}
:root[data-ui="game"] .action-editor::before{top:3px;left:3px;-webkit-mask:var(--g-corner-tl) center/contain no-repeat;mask:var(--g-corner-tl) center/contain no-repeat}
:root[data-ui="game"] .action-editor::after{right:3px;bottom:3px;-webkit-mask:var(--g-corner-br) center/contain no-repeat;mask:var(--g-corner-br) center/contain no-repeat}
:root[data-ui="game"] .action-head{padding-bottom:10px;border-bottom:1px solid var(--g-gold-deep)}
:root[data-ui="game"] .action-name{color:var(--g-gold-hi);font-family:var(--g-title-font)}
:root[data-ui="game"] .action-editor .icon-button{min-width:36px;min-height:36px}
:root[data-ui="game"] .action-editor.depth-1,:root[data-ui="game"] .action-editor.depth-2{background:var(--g-stone-3);box-shadow:none}
:root[data-ui="game"] .action-editor.depth-1::before,:root[data-ui="game"] .action-editor.depth-2::before,:root[data-ui="game"] .action-editor.depth-1::after,:root[data-ui="game"] .action-editor.depth-2::after{opacity:.3}
:root[data-ui="game"] .outcome{--branch:var(--g-gold);padding:10px;border:1px solid var(--g-line);border-top:3px solid var(--branch);border-radius:4px;background:var(--g-stone-3)}
:root[data-ui="game"] .outcome[data-outcome="fail"],:root[data-ui="game"] .outcome[data-outcome="unmet"]{--branch:var(--g-bad)}
:root[data-ui="game"] .outcome[data-outcome="success"],:root[data-ui="game"] .outcome[data-outcome="miss"]{--branch:#b9c5cf}
:root[data-ui="game"] .outcome[data-outcome="crit"]{--branch:var(--g-gold-hi)}
:root[data-ui="game"] .outcome h5{display:flex;align-items:center;gap:8px;color:var(--g-text)}
:root[data-ui="game"] .outcome h5::before{content:"";width:7px;height:7px;flex-shrink:0;transform:rotate(45deg);background:var(--branch)}
:root[data-ui="game"] .effect{background:var(--g-well);border-color:var(--g-line)}
:root[data-ui="game"] .summary{padding:10px 12px;border-left:2px solid var(--g-gold-lo);background:var(--g-well);color:var(--g-text);font-size:14px;line-height:1.6}
</style>
