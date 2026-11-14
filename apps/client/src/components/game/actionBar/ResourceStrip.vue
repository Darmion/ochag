<script setup lang="ts">
import GameIcon from '../GameIcon.vue';
import { pactTitle, pips, poolTitle, roman, slotTitle, type StripModel } from '../../../actionBar/resourceStrip';
// What the selected creature has left, always in view: slots by level, pact slots, class pools. A click opens the matching window.
defineProps<{ model: StripModel; size: 'compact' | 'normal' | 'large' }>();
const emit = defineEmits<{ spells: [level: number | 'pact']; feature: [id: string] }>();
const iconSize = (size: string) => (size === 'compact' ? 15 : size === 'large' ? 20 : 17);
</script>

<template>
  <div class="resource-strip" :class="`size-${size}`" role="group" aria-label="Оставшиеся ресурсы">
    <div v-if="model.slots.length || model.pact" class="strip-group" role="group" aria-label="Ячейки заклинаний">
      <button v-for="slot in model.slots" :key="slot.level" type="button" class="res" :class="{ empty: !slot.current }" :title="slotTitle(slot)" :aria-label="slotTitle(slot)" @click="emit('spells', slot.level)">
        <b class="level">{{ roman(slot.level) }}</b>
        <span v-if="pips(slot.current, slot.max)" class="pips" aria-hidden="true"><i v-for="(full, index) in pips(slot.current, slot.max)!" :key="index" :class="{ full }" /></span>
        <span v-else class="count" aria-hidden="true">{{ slot.current }}/{{ slot.max }}</span>
      </button>
      <button v-if="model.pact" type="button" class="res pact" :class="{ empty: !model.pact.current }" :title="pactTitle(model.pact)" :aria-label="pactTitle(model.pact)" @click="emit('spells', 'pact')">
        <GameIcon name="classWarlock" :size="iconSize(size)" /><span class="label">Договор</span><b class="level">{{ roman(model.pact.level) }}</b>
        <span v-if="pips(model.pact.current, model.pact.max)" class="pips" aria-hidden="true"><i v-for="(full, index) in pips(model.pact.current, model.pact.max)!" :key="index" :class="{ full }" /></span>
        <span v-else class="count" aria-hidden="true">{{ model.pact.current }}/{{ model.pact.max }}</span>
      </button>
    </div>
    <div v-if="model.pools.length" class="strip-group" role="group" aria-label="Запасы умений">
      <button v-for="pool in model.pools" :key="pool.key" type="button" class="res pool" :class="{ empty: !pool.current }" :title="poolTitle(pool)" :aria-label="poolTitle(pool)" @click="emit('feature', pool.featureId)">
        <GameIcon :name="pool.icon" :size="iconSize(size)" /><span class="label">{{ pool.name }}</span>
        <span v-if="pips(pool.current, pool.max)" class="pips" aria-hidden="true"><i v-for="(full, index) in pips(pool.current, pool.max)!" :key="index" :class="{ full }" /></span>
        <span v-else class="count" aria-hidden="true">{{ pool.current }}/{{ pool.max }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.resource-strip{--res-h:30px;--pip:9px;--res-font:13px;display:flex;align-items:center;justify-content:center;gap:10px;flex:none;width:100%;box-sizing:border-box;min-height:var(--res-h);padding:0 4px 3px;border-bottom:1px solid var(--brass-light);overflow-x:auto;scrollbar-width:thin;scrollbar-color:var(--g-gold-lo,#6b5233) transparent}
.resource-strip.size-compact{--res-h:26px;--pip:7px;--res-font:12px}
.resource-strip.size-large{--res-h:36px;--pip:11px;--res-font:14px}
.strip-group{display:flex;align-items:center;gap:2px;flex:none}
.strip-group+.strip-group{padding-left:10px;border-left:1px solid var(--brass-light)}
.res{display:inline-flex;align-items:center;gap:6px;height:var(--res-h);min-height:0;padding:0 8px;border:1px solid transparent;border-radius:6px;background:none;box-shadow:none;color:var(--ink);font-size:var(--res-font);line-height:1;white-space:nowrap}
.res:hover,.res:focus-visible{border-color:var(--brass-light);background:var(--surface-inset)}
.res .label{font-size:calc(var(--res-font) - 1px);color:var(--muted-ink)}
.res .level{font:600 calc(var(--res-font) + 1px) var(--g-title-font,Georgia);color:var(--g-gold,var(--brass));min-width:12px;text-align:center}
.res svg{color:var(--g-gold,var(--brass))}
.pips{display:inline-flex;gap:3px}
.pips i{width:var(--pip);height:var(--pip);border-radius:2px;border:1px solid var(--g-gold,var(--brass));background:transparent}
.pips i.full{background:var(--g-gold,var(--brass))}
.pact .pips i{border-radius:50%}
.count{font-variant-numeric:tabular-nums}
.res.empty{opacity:.55}
.res.empty .level,.res.empty svg{color:var(--muted-ink)}
@media (prefers-reduced-motion:no-preference){.pips i{transition:background-color .2s}}
@container strip (max-width:470px){.res .label{display:none}}
</style>
