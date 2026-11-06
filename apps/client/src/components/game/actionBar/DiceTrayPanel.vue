<script setup lang="ts">
import { computed } from 'vue';
import { QUICK_DICE, singleD20, trayFormula, type TrayAdvantage } from '../../../actionBar/diceFormula';

const modifier = defineModel<number>('modifier', { required: true });
const advantage = defineModel<TrayAdvantage>('advantage', { required: true });
const hidden = defineModel<boolean>('hidden', { required: true });
const props = defineProps<{ counts: Record<number, number>; recent: string[]; canHide: boolean; busy: boolean }>();
const emit = defineEmits<{ add: [sides: number, delta: number]; clear: []; roll: [formula: string] }>();

const d20Single = computed(() => singleD20(props.counts));
const formula = computed(() => trayFormula(props.counts, modifier.value, advantage.value));
</script>

<template>
  <h4>Кубики</h4>
  <small class="muted">Щелчок — добавить кость, правый щелчок — убрать.</small>
  <div class="tray-dice">
    <button
      v-for="sides in QUICK_DICE" :key="sides" type="button" class="tray-die" :class="{ picked: counts[sides] }"
      :aria-label="`d${sides}: ${counts[sides] ?? 0}`" @click="emit('add', sides, 1)" @contextmenu.prevent="emit('add', sides, -1)"
    >d{{ sides }}<span v-if="counts[sides]" class="tray-count">{{ counts[sides] }}</span></button>
  </div>
  <div class="tray-row">
    <span class="muted">Модификатор</span>
    <button type="button" class="tray-step" aria-label="Меньше" @click="modifier = Math.max(-99, modifier - 1)">−</button>
    <b class="tray-mod">{{ modifier > 0 ? `+${modifier}` : modifier }}</b>
    <button type="button" class="tray-step" aria-label="Больше" @click="modifier = Math.min(99, modifier + 1)">+</button>
    <select v-model="advantage" :disabled="!d20Single" :title="d20Single ? 'Для одной d20' : 'Преимущество — когда выбрана одна d20'" aria-label="Преимущество">
      <option value="none">обычно</option>
      <option value="adv">преимущество</option>
      <option value="disadv">помеха</option>
    </select>
  </div>
  <div class="tray-row">
    <label v-if="canHide" class="checkbox-label"><input v-model="hidden" type="checkbox" /> тайно</label>
    <button type="button" class="link-button" @click="emit('clear')">Сбросить</button>
  </div>
  <div v-if="recent.length" class="tray-row tray-recent">
    <span class="muted">Недавние:</span>
    <button v-for="item in recent" :key="item" type="button" class="tray-chip" @click="emit('roll', item)">{{ item }}</button>
  </div>
  <button type="button" class="primary tray-roll" :disabled="!formula || busy" @click="emit('roll', formula)">{{ formula ? `Бросить ${formula}` : 'Выберите кости' }}</button>
</template>

<style scoped src="./actionPopover.css"></style>
<style scoped>
.tray-dice{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}
.tray-die{position:relative;justify-content:center !important;min-height:44px !important;font:600 14px var(--g-title-font) !important}
.tray-die.picked{color:var(--g-gold-hi);box-shadow:inset 0 0 0 1px var(--g-gold-hi)}
.tray-count{position:absolute;top:-7px;right:-7px;min-width:18px;height:18px;border-radius:9px;font-size:11px;line-height:18px;text-align:center;color:#fff2cf;background:var(--g-accent,#7b2d6b);box-shadow:0 0 0 1px var(--g-gold-lo)}
.tray-row{display:flex;align-items:center;flex-wrap:wrap;gap:6px}
.tray-row select{min-height:30px;padding:2px 6px;font-size:13px;margin-left:auto;width:auto;flex:0 0 auto}
.tray-step{width:32px;justify-content:center !important;padding:0 !important}
.tray-mod{min-width:34px;text-align:center}
.tray-chip{min-height:28px !important;padding:2px 10px !important;border-radius:14px}
.tray-roll{justify-content:center !important;min-height:42px !important;font:600 15px var(--g-title-font) !important}
</style>
