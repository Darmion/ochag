<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import ItemArt from '../rpg/ItemArt.vue';
import { schoolArt } from '../../art/itemArt';
import type { SrdSpell } from '../../rules/srd';
import { SCHOOLS, SCHOOL_LABELS, classesRu, componentsRu, spellTextRu } from '../../spells/spellText';
import { DAMAGE_TYPE_LABELS, SPELL_PURPOSES, spellDamageTypes, spellPurposes, type SpellPurpose } from '../../spells/spellPurpose';
import { describeSpellMechanics } from '../../spells/spellMechanics';
import { schoolIcon } from '../../spellsPanel/spellInfo';
import GameIcon from '../game/GameIcon.vue';

const props = defineProps<{
  options: SrdSpell[];
  modelValue: string[];
  limit: number;
  label: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>();

const nameOf = (spell: SrdSpell) => spell.nameRu || spell.name;

const text = ref('');
const levels = ref<number[]>([]);
const school = ref('');
const purposes = ref<SpellPurpose[]>([]);
const onlyChosen = ref(false);

const traits = computed(() => new Map(props.options.map(spell => {
  const source = { name: spell.name, desc: spell.desc, descRu: spell.descRu, damageFormula: spell.damageFormula, healingFormula: spell.healingFormula, mechanics: spell.mechanics };
  return [spell.index, { purposes: spellPurposes(source), damageTypes: spellDamageTypes(source) }];
})));
const levelsPresent = computed(() => [...new Set(props.options.map(spell => spell.level))].sort((a, b) => a - b));

const chosen = computed(() => new Set(props.modelValue));
const filtered = computed(() => {
  const query = text.value.trim().toLowerCase();
  return props.options.filter(spell => {
    if (onlyChosen.value && !chosen.value.has(spell.index)) return false;
    if (levels.value.length && !levels.value.includes(spell.level)) return false;
    if (school.value && spell.school !== school.value) return false;
    if (purposes.value.length && !purposes.value.some(purpose => traits.value.get(spell.index)?.purposes.includes(purpose))) return false;
    if (query && !nameOf(spell).toLowerCase().includes(query) && !spell.name.toLowerCase().includes(query)) return false;
    return true;
  });
});
const groups = computed(() => {
  const byLevel = new Map<number, SrdSpell[]>();
  for (const spell of filtered.value) {
    if (!byLevel.has(spell.level)) byLevel.set(spell.level, []);
    byLevel.get(spell.level)!.push(spell);
  }
  return [...byLevel.entries()].sort(([a], [b]) => a - b)
    .map(([level, spells]) => ({ level, spells: spells.sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'ru')) }));
});

const focusIndex = ref('');
const focused = computed(() => filtered.value.find(spell => spell.index === focusIndex.value) ?? groups.value[0]?.spells[0] ?? null);
watch(() => props.options, () => { if (!props.options.some(spell => spell.index === focusIndex.value)) focusIndex.value = ''; });

const full = computed(() => props.modelValue.length >= props.limit);
function toggle(spell: SrdSpell) {
  if (chosen.value.has(spell.index)) emit('update:modelValue', props.modelValue.filter(index => index !== spell.index));
  else if (props.limit === 1) emit('update:modelValue', [spell.index]);
  else if (!full.value) emit('update:modelValue', [...props.modelValue, spell.index]);
}
const chosenSpells = computed(() => props.modelValue.map(index => props.options.find(spell => spell.index === index)).filter((spell): spell is SrdSpell => Boolean(spell)));

function toggleLevel(level: number) {
  levels.value = levels.value.includes(level) ? levels.value.filter(value => value !== level) : [...levels.value, level];
}
function togglePurpose(purpose: SpellPurpose) {
  purposes.value = purposes.value.includes(purpose) ? purposes.value.filter(value => value !== purpose) : [...purposes.value, purpose];
}

const listEl = ref<HTMLElement | null>(null);
function onKey(event: KeyboardEvent) {
  const flat = groups.value.flatMap(group => group.spells);
  if (!flat.length) return;
  if (event.key === 'Enter' || event.key === ' ') {
    if (focused.value) toggle(focused.value);
    event.preventDefault();
    return;
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const at = flat.findIndex(spell => spell.index === focused.value?.index);
  const next = flat[Math.max(0, Math.min(flat.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))]!;
  focusIndex.value = next.index;
  void nextTick(() => listEl.value?.querySelector(`[data-index="${CSS.escape(next.index)}"]`)?.scrollIntoView({ block: 'nearest' }));
}

const paragraphs = (value: string | null | undefined) => (value ?? '').split(/\n+/).map(part => part.trim()).filter(Boolean);

const AREA = /\b(sphere|cube|cone|cylinder|line|radius)\b|сфер|куб|конус|цилиндр|радиус/i;
function targetText(spell: SrdSpell) {
  const range = spell.range.trim();
  if (/^self\b/i.test(range)) return /\(/.test(range) ? `Область от вас: ${spellTextRu(range).replace(/^на себя\s*/i, '').replace(/^\(|\)$/g, '')}` : 'На себя';
  if (/^touch/i.test(range)) return 'Касанием — тот, кого коснулись';
  if (AREA.test(spell.desc)) return 'Существа в области';
  return 'Цель на дистанции — см. описание';
}
function rowText(spell: SrdSpell) {
  const types = (traits.value.get(spell.index)?.damageTypes ?? []).map(type => DAMAGE_TYPE_LABELS[type]).filter(Boolean);
  return [SCHOOL_LABELS[spell.school] ?? spell.school, ...types, spellTextRu(spell.castingTime)].join(' · ');
}
</script>

<template>
  <div class="spell-picker">
    <div class="picker-head">
      <b>{{ label }}</b>
      <span class="picker-count" :class="{ done: modelValue.length === limit }">выбрано {{ modelValue.length }} из {{ limit }}</span>
      <span v-for="spell in chosenSpells" :key="spell.index" class="chosen-chip">
        {{ nameOf(spell) }}
        <button type="button" :aria-label="`Убрать «${nameOf(spell)}»`" @click="toggle(spell)"><GameIcon class="inline-icon" name="close" :size="16" /></button>
      </span>
    </div>
    <div class="picker-body">
      <div class="picker-list">
        <div class="picker-filters">
          <input v-model="text" type="search" placeholder="Поиск заклинания…" :aria-label="`${label}: поиск`" />
          <select v-model="school" :aria-label="`${label}: школа`">
            <option value="">Все школы</option>
            <option v-for="entry in SCHOOLS" :key="entry" :value="entry">{{ SCHOOL_LABELS[entry] }}</option>
          </select>
          <div v-if="levelsPresent.length > 1" class="chips" role="group" aria-label="Круг">
            <button v-for="level in levelsPresent" :key="level" type="button" :aria-pressed="levels.includes(level)" @click="toggleLevel(level)">{{ level === 0 ? 'заговоры' : `${level} круг` }}</button>
          </div>
          <div class="chips" role="group" aria-label="Назначение">
            <button v-for="purpose in SPELL_PURPOSES" :key="purpose.id" type="button" :aria-pressed="purposes.includes(purpose.id)" :title="purpose.hint" @click="togglePurpose(purpose.id)">{{ purpose.label }}</button>
            <button type="button" :aria-pressed="onlyChosen" :disabled="!modelValue.length" @click="onlyChosen = !onlyChosen"><GameIcon class="inline-icon" name="check" :size="16" /> выбранные</button>
          </div>
        </div>
        <div ref="listEl" class="picker-scroll" tabindex="0" :aria-label="`${label}: стрелки — по списку, пробел — выбрать`" @keydown="onKey">
          <p v-if="!filtered.length" class="muted">Ничего не подходит.</p>
          <section v-for="group in groups" :key="group.level">
            <p class="group-title">{{ group.level === 0 ? 'Заговоры' : `${group.level} круг` }} <small>{{ group.spells.length }}</small></p>
            <button
              v-for="spell in group.spells" :key="spell.index" type="button" class="picker-row" :data-index="spell.index"
              :class="{ focused: focused?.index === spell.index, picked: chosen.has(spell.index) }"
              @click="focusIndex = spell.index" @dblclick="toggle(spell)"
            >
              <ItemArt :src="schoolArt(spell.school)" :size="30" :fallback-icon="schoolIcon(spell.school)" />
              <span class="row-text"><b>{{ nameOf(spell) }}</b><small>{{ rowText(spell) }}</small></span>
              <span
                class="pick-mark" :title="chosen.has(spell.index) ? 'Убрать из выбора' : 'Выбрать'" :aria-label="chosen.has(spell.index) ? 'выбрано' : undefined"
                @click.stop="focusIndex = spell.index; toggle(spell)"
              ><GameIcon v-if="chosen.has(spell.index)" name="check" :size="14" /></span>
            </button>
          </section>
        </div>
      </div>
      <article class="picker-card" aria-live="polite">
        <template v-if="focused">
          <header class="card-head">
            <ItemArt :src="schoolArt(focused.school)" :size="56" :fallback-icon="schoolIcon(focused.school)" />
            <div>
              <h4>{{ nameOf(focused) }}</h4>
              <p class="muted">{{ focused.level === 0 ? 'Заговор' : `${focused.level} круг` }} · {{ SCHOOL_LABELS[focused.school] ?? focused.school }}<template v-if="focused.nameRu"> · {{ focused.name }}</template></p>
            </div>
          </header>
          <div class="tags">
            <span v-for="purpose in traits.get(focused.index)?.purposes ?? []" :key="purpose" class="tag">{{ SPELL_PURPOSES.find(entry => entry.id === purpose)?.label }}</span>
            <span v-for="type in traits.get(focused.index)?.damageTypes ?? []" :key="type" class="tag">{{ DAMAGE_TYPE_LABELS[type] }}</span>
            <span v-if="focused.concentration" class="tag">концентрация</span>
            <span v-if="focused.ritual" class="tag">ритуал</span>
          </div>
          <dl class="facts">
            <div class="wide"><dt>На кого</dt><dd>{{ targetText(focused) }}</dd></div>
            <div v-if="describeSpellMechanics(focused.mechanics)" class="wide"><dt>Что делает</dt><dd>{{ describeSpellMechanics(focused.mechanics) }}</dd></div>
            <div><dt>Время</dt><dd>{{ spellTextRu(focused.castingTime) }}</dd></div>
            <div><dt>Дистанция</dt><dd>{{ spellTextRu(focused.range) }}</dd></div>
            <div><dt>Компоненты</dt><dd>{{ componentsRu(focused.components) }}</dd></div>
            <div><dt>Длительность</dt><dd>{{ focused.concentration ? 'Концентрация, ' : '' }}{{ spellTextRu(focused.duration) }}</dd></div>
          </dl>
          <div class="desc">
            <p v-for="(part, index) in paragraphs(focused.descRu ?? focused.desc)" :key="index">{{ part }}</p>
            <p v-if="focused.higherLevelRu ?? focused.higherLevel" class="higher"><b>На больших кругах.</b> {{ focused.higherLevelRu ?? focused.higherLevel }}</p>
          </div>
          <p v-if="focused.classes?.length" class="muted classes">Классы: {{ classesRu(focused.classes) }}</p>
          <button
            type="button" :class="chosen.has(focused.index) ? '' : 'primary'" :disabled="!chosen.has(focused.index) && full && limit > 1"
            @click="toggle(focused)"
          >{{ chosen.has(focused.index) ? 'Убрать из выбора' : limit === 1 && full ? 'Выбрать вместо прежнего' : 'Выбрать' }}</button>
          <p v-if="!chosen.has(focused.index) && full && limit > 1" class="muted">Уже выбрано {{ limit }} — уберите одно, чтобы взять это.</p>
        </template>
        <p v-else class="muted">Выберите заклинание в списке.</p>
      </article>
    </div>
  </div>
</template>

<style scoped>
.spell-picker{display:flex;flex-direction:column;gap:8px;container-type:inline-size}
.picker-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;font-size:13px}
.picker-count{padding:1px 9px;border-radius:999px;border:1px solid var(--brass-light);color:var(--muted-ink)}
.picker-count.done{color:color-mix(in srgb,#2f9e5e 62%,var(--ink));border-color:color-mix(in srgb,#2f9e5e 55%,transparent)}
.chosen-chip{display:inline-flex;align-items:center;gap:4px;padding:1px 4px 1px 10px;border-radius:999px;background:color-mix(in srgb,var(--brass) 18%,transparent);border:1px solid var(--brass)}
.chosen-chip button{min-height:20px;width:20px;padding:0;border-radius:50%;font-size:10px}
.picker-body{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);gap:10px;align-items:start}
.picker-list,.picker-card{display:flex;flex-direction:column;gap:8px;min-width:0;padding:10px;border:1px solid var(--brass-light);border-radius:8px;background:var(--surface-inset)}
.picker-filters{display:flex;flex-direction:column;gap:6px}
.picker-filters input,.picker-filters select{min-height:32px}
.chips{display:flex;flex-wrap:wrap;gap:4px}
.chips button{min-height:26px;padding:1px 9px;font-size:12px;border-radius:999px}
.chips button[aria-pressed="true"]{background:var(--burgundy);color:var(--burgundy-text);border-color:var(--brass)}
.picker-scroll{max-height:300px;overflow-y:auto;display:flex;flex-direction:column;gap:2px;outline:none}
.picker-scroll:focus-visible{box-shadow:0 0 0 2px var(--focus-ring)}
.group-title{margin:6px 2px 2px;font-size:12px;font-weight:700;color:var(--muted-ink);text-transform:uppercase;letter-spacing:.05em}
.group-title small{display:inline;margin:0;font-weight:400}
.picker-row{display:flex;align-items:center;gap:8px;width:100%;min-height:40px;padding:4px 8px;text-align:left;background:none;box-shadow:none;border:1px solid transparent;border-radius:6px;color:var(--ink);font-weight:400}
.picker-row:hover{border-color:var(--brass-light)}
.picker-row.focused{border-color:var(--brass);background:color-mix(in srgb,var(--brass) 14%,transparent)}
.picker-row.picked .row-text b{color:color-mix(in srgb,#2f9e5e 62%,var(--ink))}
.row-text{display:flex;flex-direction:column;min-width:0;flex:1}
.row-text b{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row-text small{margin:0;font-size:11px;color:var(--muted-ink)}
.pick-mark{flex:none;width:20px;height:20px;border-radius:5px;border:1px solid var(--brass-light);display:inline-flex;align-items:center;justify-content:center;font-size:13px;color:color-mix(in srgb,#2f9e5e 70%,var(--ink))}
.picker-row.picked .pick-mark{border-color:color-mix(in srgb,#2f9e5e 60%,transparent);background:color-mix(in srgb,#2f9e5e 14%,transparent)}
.picker-card{position:sticky;top:0;max-height:440px;overflow-y:auto}
.card-head{display:flex;gap:10px;align-items:flex-start;justify-content:flex-start}
.card-head > div{flex:1;min-width:0}
.card-head h4{margin:0;font:700 17px var(--heading-font)}
.card-head p{margin:2px 0 0;font-size:12px}
.tags{display:flex;flex-wrap:wrap;gap:4px}
.tag{padding:0 8px;border-radius:999px;font-size:11px;border:1px solid var(--brass-light);color:var(--muted-ink)}
.facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin:0;padding:6px 0;border-top:1px solid var(--brass-light);border-bottom:1px solid var(--brass-light)}
.facts dt{font-size:11px;color:var(--muted-ink)}
.facts .wide{grid-column:1 / -1}
.facts dd{margin:1px 0 0;font-size:13px;font-weight:600}
.desc p{margin:0 0 6px;font-size:13px;line-height:1.5}
.desc .higher{font-style:italic}
.classes{font-size:12px;margin:0}
.picker-card > button{align-self:flex-start}
@container (max-width: 560px){
  .picker-body{grid-template-columns:minmax(0,1fr)}
  .picker-card{position:static;max-height:none}
}
</style>
