<script setup lang="ts">
import ItemArt from '../rpg/ItemArt.vue';
import { statusOf } from '../../spellsPanel/catalog';
import { schoolIcon, schoolLabel } from '../../spellsPanel/spellInfo';
import type { SpellBrowser } from '../../spellsPanel/browser';
import type { SpellSlot } from '../../spellsPanel/types';
import GameIcon from '../game/GameIcon.vue';

defineProps<{
  browser: SpellBrowser;
  readOnly: boolean;
  busy: boolean;
  knownCount: number;
  slotFor: (level: number) => SpellSlot;
  artOf: (spell: unknown, school: string) => string | null;
}>();
</script>

<template>
  <section class="spell-pane spell-list-pane" aria-label="Список заклинаний">
    <div class="pane-head">
      <h4>Заклинания <small class="muted">{{ browser.filtered.length }}</small></h4>
      <div class="view-toggle" role="group" aria-label="Вид списка">
        <button type="button" :aria-pressed="browser.viewMode === 'grid'" title="Плиткой" @click="browser.viewMode = 'grid'"><GameIcon class="inline-icon" name="grid" :size="16" /></button>
        <button type="button" :aria-pressed="browser.viewMode === 'list'" title="Строками" @click="browser.viewMode = 'list'"><GameIcon class="inline-icon" name="list" :size="16" /></button>
      </div>
    </div>
    <div class="spell-scroll" tabindex="0" aria-label="Заклинания по кругам — стрелки вверх и вниз выбирают" @keydown="browser.onListKey">
      <p v-if="busy && !knownCount" class="muted empty">Загрузка…</p>
      <p v-else-if="!browser.filtered.length" class="muted empty">
        <template v-if="!knownCount && !browser.filters.showUnknown">Пока нет ни одного заклинания.<template v-if="!readOnly"> Отметьте «Неизвестные» — и выберите из библиотеки, или создайте «Своё заклинание».</template></template>
        <template v-else>Ничего не подходит под фильтры.</template>
      </p>
      <section v-for="group in browser.groups" :key="group.level" class="spell-group">
        <button type="button" class="group-head" :aria-expanded="!browser.collapsed.includes(group.level)" @click="browser.toggleGroup(group.level)">
          <span class="chevron" aria-hidden="true">▸</span>
          <b>{{ group.level === 0 ? 'Заговоры' : `${group.level} круг` }}</b>
          <span v-if="group.level > 0 && slotFor(group.level).max" class="slot-pips group-pips" :title="`Ячейки ${group.level} круга: ${slotFor(group.level).current} из ${slotFor(group.level).max}`">
            <i v-for="index in Math.min(slotFor(group.level).max, 6)" :key="index" :class="{ spent: index > slotFor(group.level).current }" />
          </span>
          <span class="group-count" :title="`известно ${group.known} из ${group.items.length} в списке`">{{ group.known }} / {{ group.items.length }}</span>
        </button>
        <ul v-if="!browser.collapsed.includes(group.level)" :class="browser.viewMode === 'grid' ? 'spell-tiles' : 'spell-rows'">
          <li v-for="item in group.items" :key="item.key">
            <button
              type="button" class="spell-row" :class="[statusOf(item).tone, { selected: browser.selected?.key === item.key }]" :data-key="item.key"
              :aria-current="browser.selected?.key === item.key ? 'true' : undefined" :title="browser.viewMode === 'grid' ? `${item.name} — ${schoolLabel(item.school)}, ${statusOf(item).label.toLowerCase()}` : undefined"
              @click="browser.select(item)"
            >
              <ItemArt :src="artOf(item.source === 'custom' ? item.spell : null, item.school)" :size="browser.viewMode === 'grid' ? 46 : 34" :fallback-icon="schoolIcon(item.school)" />
              <span class="row-text">
                <b>{{ item.name }}</b>
                <small v-if="browser.viewMode === 'list'">{{ schoolLabel(item.school) }}{{ item.source === 'custom' ? ' · своё' : '' }}</small>
              </span>
              <span v-if="browser.isFavorite(item)" class="fav-mark" aria-label="в избранном"><GameIcon name="starFilled" :size="13" /></span>
              <span v-if="browser.viewMode === 'list'" class="status" :class="statusOf(item).tone">{{ statusOf(item).label }}</span>
              <span v-else class="status-dot" :class="statusOf(item).tone" aria-hidden="true" />
            </button>
          </li>
        </ul>
      </section>
    </div>
  </section>
</template>

<style scoped src="./spellsKit.css"></style>
<style scoped>
.spell-group{margin-bottom:6px}
.view-toggle button[aria-pressed="true"]{background:var(--burgundy);color:var(--burgundy-text);border-color:var(--brass)}
.view-toggle{display:inline-flex;gap:3px}
.view-toggle button{min-height:28px;width:32px;padding:0;font-size:15px}
.spell-scroll{max-height:min(68vh,760px);overflow-y:auto;display:flex;flex-direction:column;gap:6px;padding-right:2px;outline:none}
.spell-scroll:focus-visible{box-shadow:0 0 0 2px var(--focus-ring)}
.spell-group{display:flex;flex-direction:column;gap:4px}
.group-head{display:flex;align-items:center;gap:8px;width:100%;min-height:34px;padding:4px 10px;text-align:left;font-size:14px;border-radius:6px}
.group-head .chevron{display:inline-block;transition:transform .15s;font-size:11px}
.group-head[aria-expanded="true"] .chevron{transform:rotate(90deg)}
.group-pips{margin-left:4px}
.group-count{margin-left:auto;font-size:12px;color:var(--muted-ink);font-variant-numeric:tabular-nums}
.spell-rows,.spell-tiles{list-style:none;margin:0;padding:0}
.spell-rows{display:flex;flex-direction:column;gap:3px}
.spell-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:6px}
.spell-row{display:flex;align-items:center;gap:10px;width:100%;min-height:46px;padding:5px 9px;text-align:left;background:none;box-shadow:none;border:1px solid transparent;border-radius:7px;color:var(--ink);font-weight:400}
.spell-row:hover{border-color:var(--brass-light);background:color-mix(in srgb,var(--brass) 8%,transparent)}
.spell-row.selected{border-color:var(--brass);background:color-mix(in srgb,var(--brass) 18%,transparent);box-shadow:inset 3px 0 0 var(--brass)}
.spell-row.unknown .row-text,.spell-row.unknown :deep(.item-art){opacity:.62}
.row-text{display:flex;flex-direction:column;min-width:0;flex:1}
.row-text b{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row-text small{margin:0;font-size:12px;color:var(--muted-ink)}
.spell-tiles .spell-row{flex-direction:column;justify-content:flex-start;gap:4px;min-height:98px;padding:8px 4px;text-align:center;position:relative}
.spell-tiles .row-text b{white-space:normal;font-size:12px;line-height:1.2;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.spell-tiles .fav-mark{position:absolute;top:4px;left:6px}
.spell-tiles .status-dot{position:absolute;top:6px;right:6px}
.fav-mark{color:var(--brass);font-size:13px}
.status-dot{width:9px;height:9px;border-radius:50%;background:color-mix(in srgb,var(--muted-ink) 45%,transparent)}
.status-dot.known{background:#2f9e5e}
.status-dot.unprepared{background:#c7892b}
.status-dot.granted{background:#8b6fd6}

@container (max-width: 640px){
  .spell-scroll{max-height:52vh}
}
</style>
