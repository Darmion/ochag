<script setup lang="ts">
import { findFormulas } from '../../rules/dice';
import type { SrdSpell } from '../../rules/srd';
import { CASTING_USE_LABELS, DAMAGE_TYPE_LABELS, SPELL_PURPOSES, castingUse } from '../../spells/spellPurpose';
import { toggleFavoriteSpell } from '../../spells/spellFavorites';
import { describeSpellMechanics } from '../../spells/spellMechanics';
import { classesRu, componentsRu, spellTextRu } from '../../spells/spellText';
import { statusOf } from '../../spellsPanel/catalog';
import { STATUS_LABEL, mechanicsOf, schoolIcon, schoolLabel, spellDesc, spellHigherLevel } from '../../spellsPanel/spellInfo';
import type { AnySpell, BrowseItem, CampaignSpell, CastOption, CharacterSpellEntry, FormulaRoll, LastCast, SpellSlot, SpellsRequest } from '../../spellsPanel/types';
import ItemArt from '../rpg/ItemArt.vue';
import SpellMechanicsEditor, { type MechanicsOverrides, type SpellFormulas } from './SpellMechanicsEditor.vue';
import VisibilityControl, { type CampaignMember, type VisibilitySetting } from '../common/VisibilityControl.vue';
import GameIcon from '../game/GameIcon.vue';

const props = defineProps<{
  selected: BrowseItem | null;
  readOnly: boolean;
  busy: boolean;
  castBusy: boolean;
  campaignId: string;
  characterId: string;
  request: SpellsRequest;
  campaignMembers: CampaignMember[];
  canReview: boolean;
  srdOverrides: Set<string>;
  castMenuFor: string;
  lastCast: LastCast | null;
  lastFormulaRoll: FormulaRoll | null;
  mechanicsFor: string;
  artOf: (spell: unknown, school: string) => string | null;
  slotFor: (level: number) => SpellSlot;
  isFavorite: (item: BrowseItem) => boolean;
  visibilityFor: (fieldKey: string) => VisibilitySetting;
  canAdd: (item: BrowseItem) => boolean;
  canEditCustom: (spell: CampaignSpell) => boolean;
  canCastNow: (entry: CharacterSpellEntry) => boolean;
  castOptions: (entry: CharacterSpellEntry) => CastOption[];
  overridesOf: (entry: CharacterSpellEntry) => MechanicsOverrides | null;
}>();

const emit = defineEmits<{
  cast: [entry: CharacterSpellEntry, event: MouseEvent];
  togglePrepared: [entry: CharacterSpellEntry];
  rollFormula: [entry: CharacterSpellEntry, formula: string];
  editMechanics: [entryId: string];
  saveMechanics: [entry: CharacterSpellEntry, overrides: MechanicsOverrides, formulas: SpellFormulas | null];
  visibilityChange: [fieldKey: string, setting: VisibilitySetting];
  add: [item: BrowseItem];
  remove: [item: BrowseItem];
  editCustom: [spell: CampaignSpell];
  copySrd: [spell: SrdSpell];
  openSrd: [index: string];
}>();

function descriptionFormulas(spell: SrdSpell | CampaignSpell) {
  return findFormulas(`${spellDesc(spell)} ${spellHigherLevel(spell) ?? ''}`).slice(0, 6);
}

function paragraphs(text: string | null | undefined): string[] {
  return (text ?? '').split(/\n+/).map(part => part.trim()).filter(Boolean);
}

function useText(spell: AnySpell): string {
  return CASTING_USE_LABELS[castingUse(spell.castingTime)];
}

function hintFor(item: BrowseItem): string[] {
  const spell = item.spell;
  if (!spell) return [];
  const hints: string[] = [];
  if (!item.entry) hints.push(props.readOnly ? 'Этого заклинания у героя нет.' : 'Этого заклинания в листе нет: «Добавить в лист» — и оно появится в «Магии» на столе.');
  else if (spell.level === 0) hints.push('Заговор: без ячеек, сколько угодно раз; с уровнем героя становится сильнее.');
  else if (item.entry.slotless) hints.push('Сотворяется без ячейки — так отмечено в листе.');
  else if (!item.entry.prepared) hints.push('Не подготовлено: отметьте «Подготовлено», чтобы сотворять.');
  else hints.push(`Тратит ячейку ${spell.level} круга или выше${spellHigherLevel(spell) ? ' — чем выше круг, тем сильнее (см. «На больших кругах»)' : ''}.`);
  if (spell.ritual) hints.push('Ритуал: можно сотворить без ячейки, на 10 минут дольше.');
  if (spell.concentration) hints.push('Концентрация: другое заклинание с концентрацией её прервёт, урон требует спасброска Телосложения.');
  if (castingUse(spell.castingTime) === 'reaction') hints.push('Реакция: сотворяется в ответ на событие, даже не в свой ход.');
  return hints;
}
</script>

<template>
  <article class="spell-pane spell-card-pane" aria-label="Карточка заклинания" aria-live="polite">
    <template v-if="selected && selected.spell">
      <header class="card-head">
        <ItemArt :src="artOf(selected.source === 'custom' ? selected.spell : null, selected.school)" :size="72" :fallback-icon="schoolIcon(selected.school)" />
        <div class="card-title">
          <h4 lang="ru">{{ selected.name }}</h4>
          <p class="card-sub">{{ selected.level === 0 ? 'Заговор' : `${selected.level} круг` }} · {{ schoolLabel(selected.school) }}<template v-if="selected.source === 'custom'"> · своё заклинание</template><template v-else-if="selected.spell && srdOverrides.has((selected.spell as SrdSpell).index)"> · правка кампании</template></p>
          <p v-if="selected.alt" class="card-alt">{{ selected.alt }}</p>
          <button
            v-if="selected.entry" type="button" class="fav-button" :aria-pressed="isFavorite(selected)"
            title="Избранные — первыми в «Магии» на столе и в быстрых ячейках панели действий"
            @click="toggleFavoriteSpell(characterId, selected.entry.id)"
          ><GameIcon class="inline-icon" :name="isFavorite(selected) ? 'starFilled' : 'star'" :size="16" /> {{ isFavorite(selected) ? 'В избранном' : 'В избранное' }}</button>
        </div>
      </header>
      <div class="card-tags">
        <span class="status" :class="statusOf(selected).tone">{{ statusOf(selected).label }}</span>
        <span v-for="purpose in selected.purposes" :key="purpose" class="tag">{{ SPELL_PURPOSES.find(entry => entry.id === purpose)?.label }}</span>
        <span v-for="type in selected.damageTypes" :key="type" class="tag element">{{ DAMAGE_TYPE_LABELS[type] }}</span>
        <span v-if="selected.spell.concentration" class="tag">концентрация</span>
        <span v-if="selected.spell.ritual" class="tag">ритуал</span>
        <span v-if="selected.entry?.slotless" class="tag">без ячейки</span>
        <span v-if="selected.source === 'custom' && (selected.spell as CampaignSpell).status !== 'approved'" class="tag">{{ STATUS_LABEL[(selected.spell as CampaignSpell).status] }}</span>
      </div>
      <dl class="card-facts">
        <div><dt><GameIcon class="inline-icon" name="clock" :size="16" /> Время накладывания</dt><dd>{{ spellTextRu(selected.spell.castingTime) }}</dd></div>
        <div><dt><GameIcon class="inline-icon" name="dash" :size="16" /> Дистанция</dt><dd>{{ spellTextRu(selected.spell.range) }}</dd></div>
        <div><dt><GameIcon class="inline-icon" name="hand" :size="16" /> Компоненты</dt><dd>{{ componentsRu(selected.spell.components) }}<small v-if="selected.spell.material" class="material">{{ selected.spell.material }}</small></dd></div>
        <div><dt><GameIcon class="inline-icon" name="hourglass" :size="16" /> Длительность</dt><dd>{{ selected.spell.concentration ? 'Концентрация, ' : '' }}{{ selected.spell.concentration ? spellTextRu(selected.spell.duration).toLowerCase() : spellTextRu(selected.spell.duration) }}</dd></div>
      </dl>
      <div class="card-desc">
        <p v-for="(part, index) in paragraphs(spellDesc(selected.spell))" :key="index">{{ part }}</p>
        <p v-if="spellHigherLevel(selected.spell)" class="higher"><b>На больших кругах.</b> {{ spellHigherLevel(selected.spell) }}</p>
      </div>
      <section class="card-box">
        <h5>Использование</h5>
        <p><b>{{ useText(selected.spell) }}</b> — {{ spellTextRu(selected.spell.castingTime) }}{{ selected.spell.ritual ? ', или ритуалом' : '' }}<template v-if="selected.level > 0 && !selected.entry?.slotless">; ячейка {{ selected.level }} круга или выше<template v-if="slotFor(selected.level).max"> (осталось {{ slotFor(selected.level).current }} из {{ slotFor(selected.level).max }})</template></template>.</p>
        <p v-if="describeSpellMechanics(mechanicsOf(selected.spell))" class="spell-mechanics" title="Механика сотворения по целям — с панели действий стола"><GameIcon class="inline-icon" name="gear" :size="16" /> {{ describeSpellMechanics(mechanicsOf(selected.spell)) }}</p>
      </section>
      <section v-if="selected.classes.length" class="card-box">
        <h5>Классы</h5>
        <p>Доступно: {{ classesRu(selected.classes) }}</p>
      </section>

      <section v-if="!readOnly" class="card-actions" aria-label="Действия">
        <template v-if="selected.entry">
          <span v-if="selected.entry.prepared || selected.level === 0" class="cast-wrap">
            <button
              type="button" class="primary" :disabled="castBusy || !canCastNow(selected.entry)" :aria-expanded="castMenuFor === selected.entry.id"
              :title="canCastNow(selected.entry) ? 'Сотворить: ячейка тратится, урон и лечение бросаются в общий журнал' : 'Нет подходящих ячеек — вернутся после отдыха'"
              @click="emit('cast', selected.entry, $event)"
            ><GameIcon class="inline-icon" name="d20" :size="16" /> Сотворить{{ castOptions(selected.entry).filter(option => !option.disabled).length > 1 ? ' ▾' : '' }}</button>
          </span>
          <label v-if="selected.level > 0" class="checkbox-label" :title="selected.entry.granted ? 'Дарованное заклинание подготовлено всегда' : ''">
            <input type="checkbox" :checked="selected.entry.prepared" :disabled="busy || selected.entry.granted" @change="emit('togglePrepared', selected.entry)" />
            подготовлено
          </label>
          <div v-if="descriptionFormulas(selected.spell).length" class="description-rolls" aria-label="Броски из описания">
            <button
              v-for="formula in descriptionFormulas(selected.spell)" :key="formula" type="button" :disabled="castBusy"
              :title="`Бросить ${formula} в общий журнал от имени персонажа`" @click="emit('rollFormula', selected.entry, formula)"
            ><GameIcon class="inline-icon" name="d20" :size="16" /> {{ formula }}</button>
          </div>
          <p v-if="lastCast && lastCast.spellNameText === selected.name" class="cast-result">
            <template v-if="lastCast.damageTotal !== null">Урон <strong>{{ lastCast.damageTotal }}</strong>. </template>
            <template v-if="lastCast.healingTotal !== null">Лечение <strong>{{ lastCast.healingTotal }}</strong>. </template>
            <template v-if="lastCast.pending">Ждём — противник может ответить «Контрзаклинанием».</template>
            <template v-else-if="lastCast.damageTotal === null && lastCast.healingTotal === null">Сотворено.</template>
            <template v-if="lastCast.slot"> Ячейка {{ lastCast.slot.level }} круга: {{ lastCast.slot.current }}/{{ lastCast.slot.max }}.</template>
          </p>
          <p v-if="lastFormulaRoll && lastFormulaRoll.spellNameText === selected.name" class="cast-result">
            {{ lastFormulaRoll.formula }}: <strong>{{ lastFormulaRoll.total }}</strong> ({{ lastFormulaRoll.detail }})
          </p>
          <div class="card-tools">
            <button v-if="mechanicsFor !== selected.entry.id" type="button" class="link-button" @click="emit('editMechanics', selected.entry.id)">Поправить механику</button>
            <VisibilityControl
              :field-key="`spell:${selected.entry.id}`" :campaign-id="campaignId" :character-id="characterId" :request="request"
              :setting="visibilityFor(`spell:${selected.entry.id}`)" :members="campaignMembers"
              @change="(setting, fieldKey) => emit('visibilityChange', fieldKey, setting)"
            />
            <button type="button" class="danger-link" :disabled="busy" @click="emit('remove', selected)">Убрать из листа</button>
          </div>
          <SpellMechanicsEditor
            v-if="mechanicsFor === selected.entry.id" :overrides="overridesOf(selected.entry)" :busy="busy" :from-text="selected.source === 'srd'"
            :formulas="selected.source === 'srd'
              ? { damageFormula: selected.spell.damageFormula ?? null, healingFormula: selected.spell.healingFormula ?? null, upcastFormula: mechanicsOf(selected.spell)?.upcastFormula ?? null }
              : { damageFormula: selected.spell.damageFormula ?? null, healingFormula: selected.spell.healingFormula ?? null, upcastFormula: (selected.spell as CampaignSpell).upcastFormula ?? null }"
            @save="(overrides, formulas) => emit('saveMechanics', selected!.entry!, overrides, formulas)"
          />
        </template>
        <template v-else>
          <button type="button" class="primary" :disabled="busy || !canAdd(selected)" @click="emit('add', selected)">＋ Добавить в лист</button>
        </template>
        <div class="card-edit">
          <button
            v-if="selected.source === 'custom' && canEditCustom(selected.spell as CampaignSpell)" type="button" class="link-button"
            title="Название, круг, школа, время, дистанция, длительность, описание, формулы — всё"
            @click="emit('editCustom', selected.spell as CampaignSpell)"
          ><GameIcon class="inline-icon" name="pencil" :size="16" /> Изменить заклинание</button>
          <button
            v-else-if="selected.source === 'srd'" type="button" class="link-button"
            title="Своё заклинание из этого: поменять можно всё — текст, круг, дистанцию, урон, механику; SRD-оригинал останется как есть"
            @click="emit('copySrd', selected.spell as SrdSpell)"
          >⧉ Своя копия — поменять всё</button>
          <button
            v-if="selected.source === 'srd' && selected.spell" type="button" class="link-button"
            :title="canReview ? 'Как заклинание работает в игре — таблицей; правка — только для этой кампании' : 'Как заклинание работает в игре — таблицей'"
            @click="emit('openSrd', (selected.spell as SrdSpell).index)"
          ><GameIcon class="inline-icon" name="grid" :size="16" /> Таблица механики</button>
        </div>
      </section>

      <aside v-if="hintFor(selected).length" class="card-hint">
        <h5><GameIcon class="inline-icon" name="bulb" :size="16" /> Подсказка</h5>
        <p v-for="hint in hintFor(selected)" :key="hint">{{ hint }}</p>
      </aside>
    </template>
    <template v-else-if="selected && selected.entry">
      <h4>(заклинание удалено)</h4>
      <p class="muted">Заклинание пропало из библиотеки кампании.</p>
      <button v-if="!readOnly" type="button" :disabled="busy" @click="emit('remove', selected)">Убрать из листа</button>
    </template>
    <p v-else class="muted empty">Выберите заклинание в списке.</p>
  </article>
</template>

<style scoped src="./spellsKit.css"></style>
<style scoped>
.cast-result{margin:0}
.spell-mechanics{font-size:12px;font-weight:600}
.description-rolls{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.description-rolls button{min-height:28px;padding:2px 8px;font-size:13px}
.cast-wrap{position:relative;display:inline-flex}
.card-head{display:flex;align-items:flex-start;gap:12px;justify-content:flex-start}
.card-head :deep(.item-art){border:1px solid var(--brass-light);border-radius:10px}
.card-title{flex:1;min-width:0}
.card-title h4{margin:0;font:700 19px var(--heading-font);line-height:1.25;overflow-wrap:normal;word-break:normal;hyphens:auto}
.card-sub{margin:4px 0 0;font-size:14px;color:var(--muted-ink)}
.card-alt{margin:2px 0 0;font-size:12px;color:var(--muted-ink);font-style:italic}
.fav-button{margin-top:8px;min-height:28px;padding:2px 10px;font-size:12px}
.fav-button[aria-pressed="true"]{border-color:var(--brass);background:var(--burgundy);color:var(--burgundy-text)}
.card-tags{display:flex;flex-wrap:wrap;gap:5px}
.tag{padding:1px 8px;border-radius:999px;font-size:11px;border:1px solid var(--brass-light);color:var(--muted-ink)}
.tag.element{border-style:dashed}
.card-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:0;padding:10px 0;border-top:1px solid var(--brass-light);border-bottom:1px solid var(--brass-light)}
.card-facts div{min-width:0}
.card-facts dt{font-size:11px;color:var(--muted-ink)}
.card-facts dd{margin:2px 0 0;font-size:14px;font-weight:600}
.card-facts .material{display:block;margin-top:2px;font-size:11px;font-weight:400;color:var(--muted-ink)}
.card-desc p{margin:0 0 8px;line-height:1.55}
.card-desc .higher{font-style:italic}
.card-box{padding:9px 12px;border:1px solid var(--brass-light);border-radius:8px}
.card-box h5,.card-hint h5{margin:0 0 4px;font:700 14px var(--heading-font)}
.card-box p{margin:0;font-size:13px}
.card-box p + p{margin-top:4px}
.card-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding-top:2px}
.card-actions .cast-result{flex-basis:100%;margin:0;font-size:13px}
.card-tools{flex-basis:100%;display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px}
.card-hint{padding:10px 12px;border:1px dashed var(--brass-light);border-radius:8px}
.card-hint p{margin:0;font-size:13px;color:var(--muted-ink)}
.card-hint p + p{margin-top:4px}
.card-edit{flex-basis:100%;display:flex;gap:12px;margin-top:4px}
</style>
