<script setup lang="ts">
import ActionSummary from './ActionSummary.vue';
import { localized } from './localize';
import { suggestedActions } from '../../spellBuilder/overview';
import type { SuggestionState } from '../../spellBuilder/types';

defineProps<{ pending: SuggestionState[]; locked: boolean }>();
const emit = defineEmits<{ accept: [entry: SuggestionState, mode?: 'manual']; acceptAll: []; clear: [entry: SuggestionState] }>();
const suggestionsOpen = defineModel<boolean>('open', { required: true });
</script>

<template>
  <aside class="suggestions" :class="{ collapsed: !suggestionsOpen }" aria-label="Подсказки">
    <header>
      <button type="button" class="fold" :aria-expanded="suggestionsOpen" @click="suggestionsOpen = !suggestionsOpen">
        <span class="chevron" aria-hidden="true">▸</span>
        <strong>Подсказки по описанию</strong>
        <span class="badge pending">{{ pending.length }}</span>
        <small class="muted">— ещё не приняты</small>
      </button>
      <button type="button" class="primary small" :disabled="locked" @click="emit('acceptAll')">Принять все</button>
    </header>
    <ul v-if="suggestionsOpen">
      <li v-for="entry in pending" :key="entry.id">
        <div class="suggestion-text">
          <span v-if="entry.confidence === 'maybe'" class="maybe-mark" title="Возможна ошибка — проверьте">?</span>
          <b>{{ entry.label }}:</b>
          <template v-if="entry.path === 'actions[+]' && suggestedActions(entry).length">
            <span v-for="item in suggestedActions(entry)" :key="item.action.id" class="suggested-action" :class="{ nested: item.depth > 0 }"><ActionSummary :action="item.action" head /></span>
          </template>
          <span v-else>{{ localized(entry.display) }}</span>
          <details class="phrase"><summary>откуда</summary><small class="muted" translate="no">«{{ entry.phrase.slice(0, 200) }}»</small></details>
        </div>
        <span class="buttons">
          <button type="button" class="small" :disabled="locked" @click="emit('accept', entry)">Принять</button>
          <button type="button" class="small" :disabled="locked" title="Применить и перейти к полю, чтобы поправить" @click="emit('accept', entry, 'manual')">Изменить</button>
          <button type="button" class="small quiet" :disabled="locked" @click="emit('clear', entry)">Очистить поле</button>
        </span>
      </li>
    </ul>
  </aside>
</template>

<style scoped src="./builderKit.css"></style>
<style scoped>
.suggestions{border:1px solid color-mix(in srgb,var(--g-warn,#e1a33a) 70%,transparent);border-radius:8px;padding:8px 10px;background:color-mix(in srgb,var(--g-warn,#e1a33a) 7%,transparent)}
.suggestions header{display:flex;gap:10px;align-items:center}
.suggestions .fold{flex:1;display:flex;align-items:center;gap:8px;text-align:left;background:none;border:none;box-shadow:none;padding:4px 0}
.suggestions ul{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column}
.suggestions li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 16px;align-items:center;padding:8px 0;border-top:1px dashed var(--g-line,var(--brass-light))}
.suggestion-text{display:flex;flex-wrap:wrap;gap:2px 6px;align-items:baseline;min-width:0;font-size:14px}
.suggestion-text .phrase{flex-basis:100%;font-size:12px}
.phrase summary{cursor:pointer;color:var(--g-text-dim,inherit);width:max-content;padding:0;font:400 12px/1.4 var(--g-body-font,inherit)}
.maybe-mark{display:inline-grid;place-items:center;width:18px;height:18px;border-radius:50%;background:var(--g-warn,#e1a33a);color:#221;font-size:12px;font-weight:700}
.suggestions .buttons{display:flex;gap:4px;flex-wrap:wrap}
.suggested-action{display:block;flex-basis:100%;font-size:14px;line-height:1.45}
.suggested-action.nested{padding-left:16px;border-left:2px solid var(--g-gold-lo,var(--brass-light));margin-left:4px}
:root[data-ui="game"] .suggestions{padding:10px 14px;border:1px solid var(--g-gold-lo);border-left:5px solid var(--g-warn);border-radius:3px 8px 8px 3px;background:var(--g-stone-2);box-shadow:0 4px 10px #0005}
:root[data-ui="game"] .suggestions>header{padding-bottom:8px}
:root[data-ui="game"] .suggestions .fold{flex-wrap:wrap;color:var(--g-gold-hi)}
:root[data-ui="game"] .suggestions li{padding:12px 0;border-top-style:solid}
:root[data-ui="game"] .suggestion-text{line-height:1.55}
:root[data-ui="game"] .phrase[open]{margin-top:5px;padding:8px 10px;border-left:2px solid var(--g-gold-lo);background:var(--g-well)}
:root[data-ui="game"] .phrase[open] small{color:var(--g-text)}
:root[data-ui="game"] .phrase summary{display:inline-flex;align-items:center;min-height:24px;max-width:100%;font-size:13px;line-height:1.5;color:var(--g-text-dim)}
@media (max-width:1100px){
  :root[data-ui="game"] .suggestions li{grid-template-columns:minmax(0,1fr)}
  :root[data-ui="game"] .suggestions .buttons{justify-content:flex-end}
}
</style>
