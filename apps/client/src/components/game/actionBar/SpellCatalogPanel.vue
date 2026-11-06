<script setup lang="ts">
import GameIcon from '../GameIcon.vue';
import { describeSpellMechanics } from '../../../spells/spellMechanics';
import { isOwnSpellArt, spellArtUrl } from '../../../art/spellArt';
import { spellName } from '../../../actionBar/spellCatalog';
import type { ActionBarProps, PactSlots, SpellEntry, SpellSlot } from '../../../actionBar/types';

const query = defineModel<string>('query', { required: true });
const circle = defineModel<number | null>('circle', { required: true });
defineProps<{
  spells: SpellEntry[];
  known: number;
  circles: number[];
  slots: SpellSlot[];
  pact: PactSlots | null;
  working: boolean;
  campaignId: string;
  request: ActionBarProps['request'];
  favorite: (entry: SpellEntry) => boolean;
}>();
const emit = defineEmits<{ choose: [entry: SpellEntry] }>();
</script>

<template>
  <label class="spell-search"><GameIcon name="search" :size="16" /><input v-model="query" type="search" placeholder="Найти заклинание…" aria-label="Поиск заклинания" /></label>
  <div class="spell-circles" role="group" aria-label="Круг заклинаний">
    <button type="button" :aria-pressed="circle === null" @click="circle = null">Все</button>
    <button v-for="level in circles" :key="level" type="button" :aria-pressed="circle === level" @click="circle = level">{{ level === 0 ? 'Заговоры' : level + ' круг' }}</button>
  </div>
  <div v-if="slots.length || pact" class="spell-reserves" aria-label="Оставшиеся ячейки">
    <span v-for="slot in slots" :key="slot.level" :class="{ spent: !slot.current }">{{ slot.level }} круг <b>{{ slot.current }}/{{ slot.max }}</b></span>
    <span v-if="pact">Договор · {{ pact.slotLevel }} <b>{{ pact.current }}/{{ pact.max }}</b></span>
  </div>
  <button v-for="entry in spells" :key="entry.id" class="spell-command" type="button" :disabled="working" :title="describeSpellMechanics(entry.spell?.mechanics)" @click="emit('choose', entry)">
    <span v-if="spellArtUrl(entry.spell?.art, campaignId, request)" class="spell-art" :class="{ library: !isOwnSpellArt(entry.spell?.art) }" :title="entry.spell!.level ? entry.spell!.level + ' круг' : 'Заговор'">
      <img :src="spellArtUrl(entry.spell?.art, campaignId, request)!" alt="" /><b><template v-if="entry.spell!.level">{{ entry.spell!.level }}</template><GameIcon v-else name="sparkle" :size="14" /></b>
    </span>
    <span v-else class="spell-level" :title="entry.spell!.level ? entry.spell!.level + ' круг' : 'Заговор'"><template v-if="entry.spell!.level">{{ entry.spell!.level }}</template><GameIcon v-else name="sparkle" :size="14" /></span>
    <span class="spell-copy"><strong><span v-if="favorite(entry)" class="spell-favorite" aria-label="Избранное"><GameIcon class="inline-icon" name="starFilled" :size="13" /> </span>{{ spellName(entry) }}</strong>
    <small v-if="describeSpellMechanics(entry.spell?.mechanics)">{{ describeSpellMechanics(entry.spell?.mechanics) }}</small>
    <small v-if="!entry.prepared && entry.spell!.level > 0" class="unprepared">Не подготовлено</small></span><span class="command-arrow" aria-hidden="true">›</span>
  </button>
  <p v-if="!known" class="command-empty">Заклинаний в листе нет.</p><p v-else-if="!spells.length" class="command-empty">Ничего не найдено. Измените поиск или круг.</p>
</template>

<style scoped src="./actionPopover.css"></style>
<style scoped>
.spell-level{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;background:#0008;color:var(--g-gold);font-size:11px;box-shadow:0 0 0 1px var(--g-gold-lo)}
.spell-art{position:relative;flex:none;width:28px;height:28px;border-radius:6px;overflow:hidden;box-shadow:0 0 0 1px var(--g-gold-lo)}
.spell-art img{width:100%;height:100%;object-fit:cover;display:block}
.spell-art b{position:absolute;right:0;bottom:0;min-width:12px;padding:0 2px;background:#000b;color:var(--g-gold);font-size:9px;line-height:12px;text-align:center;border-top-left-radius:4px}
.action-popover .command-body .spell-search{display:flex;align-items:center;gap:8px;padding:0 10px;background:var(--input-bg);border:1px solid var(--brass-light);border-radius:5px;color:var(--ink)}
.action-popover .command-body .spell-search input{width:100%;border:0;background:none;box-shadow:none;min-height:36px;padding-inline:0}
.spell-circles{display:flex;flex-wrap:wrap;gap:5px}.action-popover .spell-circles button{min-height:26px;padding:4px 8px;border:1px solid var(--brass-light);border-radius:3px;background:var(--surface-inset);box-shadow:none;color:var(--muted-ink);font:12px/1.3 var(--g-body-font,Georgia)}
.action-popover .spell-circles button[aria-pressed=true]{border-color:var(--brass);color:var(--ink);box-shadow:inset 0 -2px var(--brass)}
.spell-reserves{display:flex;flex-wrap:wrap;gap:6px}.spell-reserves span{padding:4px 7px;background:var(--surface-inset);color:var(--muted-ink);font:11px/1.4 var(--g-body-font,Georgia)}.spell-reserves b{margin-left:6px;color:var(--ink)}.spell-reserves .spent{opacity:.6}
.action-popover .command-body .spell-command{display:flex;flex-wrap:nowrap;gap:12px;min-height:64px;padding:10px 12px;border-left:3px solid var(--brass)}
.action-popover .spell-level{width:36px;height:40px;flex:none;border-radius:18px 18px 4px 4px;border:1px solid var(--brass);color:var(--g-gold,var(--ink));background:var(--surface-inset);box-shadow:none;font:18px Georgia,serif}
.action-popover .spell-art{width:36px;height:40px;border-radius:18px 18px 4px 4px;border:1px solid var(--brass);box-shadow:none;background:var(--surface-inset)}
.action-popover .spell-art.library img{object-fit:contain;padding:3px;box-sizing:border-box}
.action-popover .spell-art b{min-width:16px;padding:0 3px;font:700 12px/16px Georgia,serif;background:var(--g-well,#000c);border-top:1px solid var(--g-gold-lo);border-left:1px solid var(--g-gold-lo)}
.spell-copy{flex:1;min-width:0}.spell-copy strong{font:15px/1.4 var(--g-title-font,Georgia);display:block}.spell-copy small{display:block;margin-top:4px!important}.spell-favorite{color:var(--g-gold,var(--brass))}.command-arrow{color:var(--brass);font:24px Georgia,serif;flex:none}
.action-popover .command-empty{padding:20px 12px;text-align:center;border:1px dashed var(--brass-light);color:var(--muted-ink);font:13px/1.6 var(--g-body-font,Georgia)}
</style>
