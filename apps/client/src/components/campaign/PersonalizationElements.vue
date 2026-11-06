<script setup lang="ts">
import { RARITY_LABELS } from '../../personalization/catalog';
import type { ArtElements } from '../../personalization/elements';
import GameIcon from '../game/GameIcon.vue';

defineProps<{
  elements: ArtElements;
  loading: boolean;
}>();
</script>

<template>
  <aside class="pz-elements" aria-label="Элементы">
    <input
      v-model="elements.query" type="search" class="pz-search" placeholder="Найти элемент: меч, зелье, кольцо…"
      aria-label="Найти элемент" @keydown.enter.prevent="elements.selectFirst"
    />
    <div class="pz-filters" role="group" aria-label="Показать">
      <button type="button" :aria-pressed="elements.filter === 'all'" @click="elements.filter = 'all'">Все <small>{{ elements.counts.all }}</small></button>
      <button type="button" :aria-pressed="elements.filter === 'missing'" @click="elements.filter = 'missing'">Без картинки <small>{{ elements.counts.missing }}</small></button>
      <button type="button" :aria-pressed="elements.filter === 'changed'" @click="elements.filter = 'changed'">Изменённые <small>{{ elements.counts.changed }}</small></button>
    </div>

    <p v-if="loading" class="muted">Загружаю справочник…</p>
    <p v-else-if="!elements.visibleGroups.length" class="muted">Ничего не нашлось. {{ elements.query.trim() ? 'Можно добавить своё название внизу.' : '' }}</p>

    <div class="pz-groups">
      <section v-for="group in elements.visibleGroups" :key="group.id" class="pz-group">
        <button type="button" class="pz-group-head" :aria-expanded="elements.isOpen(group.id)" @click="elements.open[group.id] = !elements.isOpen(group.id)">
          <span class="caret" aria-hidden="true">{{ elements.isOpen(group.id) ? '▾' : '▸' }}</span>
          <span class="pz-group-name">{{ group.label }}</span>
          <small :title="`С картинкой ${group.withArt} из ${group.total}`">{{ group.withArt }}/{{ group.total }}</small>
        </button>
        <ul v-if="elements.isOpen(group.id)" class="pz-list">
          <li v-for="element in group.elements" :key="element.key">
            <button type="button" class="pz-element" :aria-pressed="elements.selectedKey === element.key" @click="elements.select(element)">
              <span class="pz-thumb" :class="{ empty: !elements.currentArt(element), frame: element.kind === 'rarity' }">
                <img v-if="elements.currentArt(element)" :src="elements.currentArt(element)!" alt="" />
              </span>
              <span class="pz-element-name">
                {{ element.name }}
                <small v-if="element.rarity && element.kind === 'item'" class="muted">{{ RARITY_LABELS[element.rarity.replace(' ', '_')] ?? element.rarity }}</small>
              </span>
              <small v-if="elements.statusLabel(elements.statusOf(element))" class="pz-badge" :class="elements.statusOf(element)">{{ elements.statusLabel(elements.statusOf(element)) }}</small>
            </button>
            <button
              v-if="element.custom" type="button" class="link-button pz-remove" title="Убрать своё название из списка (картинка для него сбросится)"
              @click="elements.removeName(element)"
            ><GameIcon class="inline-icon" name="close" :size="16" /></button>
          </li>
        </ul>
      </section>
    </div>

    <form class="pz-add" @submit.prevent="elements.addName">
      <label>
        Своя вещь по названию
        <input v-model="elements.customName" maxlength="100" placeholder="Например: Фамильный клинок" />
      </label>
      <button type="submit" :disabled="!elements.customName.trim()">Добавить</button>
    </form>
  </aside>
</template>

<style scoped>
.pz-elements{border:1px solid var(--brass-light);border-radius:6px;background:var(--surface-inset);padding:10px;min-width:0}
.pz-elements{display:flex;flex-direction:column;gap:8px;max-height:calc(100vh - 260px);overflow:hidden}
.pz-search{width:100%}
.pz-filters{display:flex;gap:4px;flex-wrap:wrap}
.pz-filters button{min-height:30px;padding:2px 10px;font-size:13px;display:inline-flex;align-items:center;gap:5px;flex-wrap:nowrap;white-space:nowrap}
.pz-filters small{opacity:.75;font-size:11px}
.pz-groups{overflow-y:auto;flex:1;min-height:120px;display:flex;flex-direction:column;gap:2px;padding-right:2px}
.pz-group-head{width:100%;display:flex;align-items:center;gap:8px;min-height:34px;padding:4px 8px;justify-content:flex-start;text-align:left;font-size:14px}
.pz-group-name{flex:1}
.pz-group-head small{opacity:.75;font-weight:400}
.caret{width:12px}
.pz-list{list-style:none;margin:2px 0 6px;padding:0 0 0 6px;display:flex;flex-direction:column;gap:2px}
.pz-list li{display:flex;align-items:center;gap:4px}
.pz-element{flex:1;display:flex;align-items:center;gap:8px;min-height:40px;padding:3px 8px;justify-content:flex-start;text-align:left;font:400 13px "Segoe UI",Arial,sans-serif;letter-spacing:0;min-width:0}
.pz-element-name{flex:1;min-width:0;display:flex;flex-direction:column;overflow-wrap:anywhere}
.pz-element-name small{font-size:11px}
.pz-remove{flex-shrink:0;min-height:28px;padding:0 6px}
.pz-thumb{width:32px;height:32px;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;border-radius:5px;background:radial-gradient(circle,#ffffff2e 0,#ffffff0d 55%,transparent 72%)}
.pz-thumb img{width:100%;height:100%;object-fit:contain}
.pz-thumb.empty{border:1px dashed var(--brass-light);background:none}
.pz-thumb.frame img{width:100%;height:100%}
.pz-badge{flex-shrink:0;font-size:10px;padding:1px 6px;border-radius:9px;background:#0003;white-space:nowrap}
.pz-badge.custom{background:#3d5a3a;color:#e6f2df}
.pz-badge.gm{background:#3a4a6a;color:#e3eaf7}
.pz-badge.none,.pz-badge.gmnone{background:#5a4a2a;color:#f2e8d0}
.pz-badge.missing{background:transparent;border:1px dashed currentColor;opacity:.75}
.pz-add{display:flex;align-items:flex-end;gap:6px;border-top:1px solid var(--brass-light);padding-top:8px}
.pz-add label{flex:1;display:flex;flex-direction:column;gap:2px;font-size:12px}
.pz-add button{min-height:34px;padding:3px 10px}
@media (max-width:900px){
  .pz-elements{max-height:none;position:static}
  .pz-groups{max-height:50vh}
}
</style>
