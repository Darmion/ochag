<script setup lang="ts">
import ItemArt from '../rpg/ItemArt.vue';
import { schoolArt } from '../../art/itemArt';
import { DAMAGE_TYPES, DAMAGE_TYPE_LABELS, SPELL_PURPOSES } from '../../spells/spellPurpose';
import { SCHOOLS, SCHOOL_LABELS, SPELL_CLASSES } from '../../spells/spellText';
import type { SpellBrowser } from '../../spellsPanel/browser';
import GameIcon from '../game/GameIcon.vue';

defineProps<{ browser: SpellBrowser; readOnly: boolean }>();
</script>

<template>
  <aside class="spell-pane spell-filters" aria-label="Фильтры заклинаний">
    <div class="pane-head">
      <h4>Фильтры</h4>
      <button type="button" class="link-button" :disabled="!browser.filtersActive" @click="browser.resetFilters"><GameIcon class="inline-icon" name="undo" :size="16" /> Сбросить</button>
    </div>
    <div class="filter-search">
      <input v-model="browser.filters.text" type="search" placeholder="Поиск заклинания…" aria-label="Поиск заклинания по названию" />
      <button v-if="browser.filters.text" type="button" class="clear" aria-label="Очистить поиск" @click="browser.filters.text = ''"><GameIcon class="inline-icon" name="close" :size="16" /></button>
    </div>
    <div class="filter-block">
      <span class="filter-label">Уровень заклинания</span>
      <div class="level-grid" role="group" aria-label="Круг заклинания">
        <button type="button" class="all" :aria-pressed="!browser.filters.levels.length" @click="browser.filters.levels = []">Все</button>
        <button v-for="level in 10" :key="level" type="button" :aria-pressed="browser.filters.levels.includes(level - 1)" :title="level === 1 ? 'Заговоры' : `${level - 1} круг`" @click="browser.toggleLevel(level - 1)">{{ level - 1 }}</button>
      </div>
    </div>
    <label class="filter-block">
      <span class="filter-label">Школа магии</span>
      <select v-model="browser.filters.school">
        <option value="">Все школы</option>
        <option v-for="school in SCHOOLS" :key="school" :value="school">{{ SCHOOL_LABELS[school] }}</option>
      </select>
    </label>
    <label class="filter-block">
      <span class="filter-label">Стихия / тип урона</span>
      <select v-model="browser.filters.element">
        <option value="">Все стихии</option>
        <option v-for="type in DAMAGE_TYPES" :key="type" :value="type">{{ DAMAGE_TYPE_LABELS[type] }}</option>
      </select>
    </label>
    <label v-if="!readOnly" class="filter-block">
      <span class="filter-label">Список класса</span>
      <select v-model="browser.filters.spellList" title="Чьи заклинания показывать среди неизвестных">
        <option value="mine">{{ browser.ownListsLabel ? `Классы героя: ${browser.ownListsLabel}` : 'Классы героя (все списки)' }}</option>
        <option value="">Все классы</option>
        <option v-for="option in SPELL_CLASSES" :key="option.id" :value="option.id">{{ option.label }}</option>
      </select>
    </label>
    <fieldset class="filter-block">
      <legend class="filter-label">Доступность</legend>
      <label class="checkbox-label"><input v-model="browser.filters.showKnown" type="checkbox" /> Известные</label>
      <label v-if="!readOnly" class="checkbox-label" title="Заклинания библиотеки, которых в листе нет: выбрать и «Добавить в лист»"><input v-model="browser.filters.showUnknown" type="checkbox" /> Неизвестные</label>
      <label class="checkbox-label"><input v-model="browser.filters.onlyPrepared" type="checkbox" /> Только подготовленные</label>
    </fieldset>
    <div class="filter-block">
      <span class="filter-label">Быстрые фильтры</span>
      <div class="purpose-chips" role="group" aria-label="Назначение">
        <button v-for="purpose in SPELL_PURPOSES" :key="purpose.id" type="button" :aria-pressed="browser.filters.purposes.includes(purpose.id)" :title="purpose.hint" @click="browser.togglePurpose(purpose.id)">{{ purpose.label }}</button>
        <button type="button" :aria-pressed="browser.filters.onlyFavorites" title="Избранные — первыми в «Магии» на столе и в быстрых ячейках" @click="browser.filters.onlyFavorites = !browser.filters.onlyFavorites"><GameIcon class="inline-icon" name="starFilled" :size="16" /> Избранные</button>
      </div>
    </div>
    <div class="known-summary">
      <ItemArt :src="schoolArt('Enchantment')" :size="40" fallback-icon="sparkle" />
      <span>
        <b>Известно: {{ browser.knownSummary.total }}</b>
        <small>заговоров {{ browser.knownSummary.cantrips }} · подготовлено {{ browser.knownSummary.prepared }}</small>
      </span>
    </div>
  </aside>
</template>

<style scoped src="./spellsKit.css"></style>
<style scoped>
.spell-filters fieldset.filter-block{gap:7px}
.filter-search{position:relative;display:flex}
.filter-search input{flex:1;min-width:0;min-height:36px;padding-right:30px}
.filter-search .clear{position:absolute;right:4px;top:50%;transform:translateY(-50%);min-height:24px;width:24px;padding:0;border-radius:50%;font-size:11px}
.filter-block{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;border:0;min-width:0}
.filter-block select{min-height:34px}
.filter-label{font-size:12px;font-weight:700;color:var(--muted-ink);text-transform:uppercase;letter-spacing:.06em;padding:0}
.level-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:5px}
.level-grid button{min-height:30px;padding:0;font-size:13px;font-variant-numeric:tabular-nums}
.level-grid .all{grid-column:span 2}
.level-grid button[aria-pressed="true"],.purpose-chips button[aria-pressed="true"]{background:var(--burgundy);color:var(--burgundy-text);border-color:var(--brass)}
.purpose-chips{display:flex;flex-wrap:wrap;gap:5px}
.purpose-chips button{min-height:28px;padding:2px 10px;font-size:12px;border-radius:999px}
.known-summary{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--brass-light);border-radius:8px}
.known-summary span{display:flex;flex-direction:column;gap:1px}
.known-summary small{margin:0;color:var(--muted-ink);font-size:12px}

@container (max-width: 980px){
  .spell-filters .pane-head,.spell-filters .filter-search{grid-column:1 / -1}
}
</style>
