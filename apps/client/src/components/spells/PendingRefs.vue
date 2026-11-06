<script setup lang="ts">
import { LIST_LABELS, refTitle } from '../../spellsPanel/refMatch';
import type { RefMapping } from '../../spellsPanel/refMapping';
import type { PendingRef } from '../../spellsPanel/types';

defineProps<{ mapping: RefMapping; pending: PendingRef[]; busy: boolean }>();
</script>

<template>
  <details class="pending-refs" open>
    <summary>Не распознано при импорте листа: {{ pending.length }}</summary>
    <p class="muted">В импортированном листе у заклинаний только номера — названий нет. Выберите, что это за заклинание: оно встанет всем персонажам кампании с тем же номером и будущим импортам.</p>
    <ul>
      <li v-for="ref in pending" :key="ref.ref">
        <div class="ref-head">
          <b>{{ refTitle(ref) }}</b>
          <span v-for="list in ref.lists" :key="list" class="ref-tag">{{ LIST_LABELS[list] ?? list }}</span>
          <span v-if="ref.level !== null" class="ref-tag">{{ ref.level === 0 ? 'заговор' : `${ref.level} ур.` }}</span>
          <small v-if="ref.characters.length > 1" class="muted">у {{ ref.characters.join(', ') }}</small>
        </div>
        <div class="ref-pick">
          <input
            :value="mapping.refQuery[ref.ref] ?? ref.label ?? ''" placeholder="Поиск: название по-русски или по-английски" :disabled="busy"
            @input="mapping.refQuery[ref.ref] = ($event.target as HTMLInputElement).value; mapping.refChoice[ref.ref] = ''"
          />
          <select :value="mapping.refChoice[ref.ref] || ''" :disabled="busy || !mapping.refMatches(ref).length" aria-label="Заклинание" @change="mapping.refChoice[ref.ref] = ($event.target as HTMLSelectElement).value">
            <option value="">{{ mapping.refMatches(ref).length ? `— выберите (${mapping.refMatches(ref).length}) —` : 'ничего не нашлось' }}</option>
            <option v-for="item in mapping.refMatches(ref)" :key="item.key" :value="item.key">{{ item.level === 0 ? 'заговор' : `${item.level} ур.` }} · {{ item.name }}{{ item.own ? '' : ' (другой класс)' }}</option>
          </select>
          <button type="button" class="primary" :disabled="busy || !mapping.refChoice[ref.ref]" @click="mapping.mapRef(ref)">Сопоставить</button>
          <button type="button" :disabled="busy" title="Не заклинание или не нужно — больше не спрашивать" @click="mapping.mapRef(ref, true)">Не нужно</button>
        </div>
      </li>
    </ul>
  </details>
</template>

<style scoped>
.pending-refs{padding:8px 12px;border:1px dashed var(--brass,#c9a227);border-radius:4px}
.pending-refs summary{font-weight:700;cursor:pointer}
.pending-refs ul{list-style:none;margin:6px 0 0;padding:0;display:flex;flex-direction:column;gap:8px}
.ref-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.ref-tag{padding:1px 8px;border-radius:10px;font-size:12px;background:var(--surface-inset,#0001);box-shadow:inset 0 0 0 1px var(--brass-light)}
.ref-pick{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
.ref-pick input{flex:1 1 200px;min-width:0;min-height:32px}
.ref-pick select{flex:1 1 220px;min-width:0;min-height:32px;width:auto}
.ref-pick button{min-height:32px;padding:2px 12px}
</style>
