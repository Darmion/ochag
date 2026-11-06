<script setup lang="ts">
import { ref } from 'vue';
import { useEscapeClose } from '../../ui/escapeStack';
import DragonDiceModal from './DragonDiceModal.vue';
import SealRitualModal from './SealRitualModal.vue';
import AlchemyModal from './AlchemyModal.vue';
import ChaseModal from './ChaseModal.vue';
import DuelModal from './DuelModal.vue';
import MapFragmentsModal from './MapFragmentsModal.vue';
import RuneLockModal from './RuneLockModal.vue';
import GameIcon from '../game/GameIcon.vue';
const props = defineProps<{ campaignId: string; request: (path: string, method?: string, body?: unknown, file?: File) => Promise<any> }>();
const emit = defineEmits<{ close: [] }>();
const selected = ref<'dice' | 'runes' | 'ritual' | 'alchemy' | 'chase' | 'duel' | 'fragments' | null>(null);
useEscapeClose(() => emit('close'));
</script>
<template>
  <DragonDiceModal v-if="selected === 'dice'" v-bind="props" @back="selected = null" @close="emit('close')" />
  <RuneLockModal v-else-if="selected === 'runes'" v-bind="props" @back="selected = null" @close="emit('close')" />
  <SealRitualModal v-else-if="selected === 'ritual'" v-bind="props" @back="selected = null" @close="emit('close')" />
  <AlchemyModal v-else-if="selected === 'alchemy'" v-bind="props" @back="selected = null" @close="emit('close')" />
  <ChaseModal v-else-if="selected === 'chase'" v-bind="props" @back="selected = null" @close="emit('close')" />
  <DuelModal v-else-if="selected === 'duel'" v-bind="props" @back="selected = null" @close="emit('close')" />
  <MapFragmentsModal v-else-if="selected === 'fragments'" v-bind="props" @back="selected = null" @close="emit('close')" />
  <div v-else class="modal-overlay games-overlay" role="dialog" aria-modal="true" aria-labelledby="games-title">
    <div class="modal-card games-card">
      <header><div><small>Приключения между сражениями</small><h3 id="games-title">Мини-игры</h3></div><button type="button" aria-label="Закрыть мини-игры" @click="emit('close')"><GameIcon class="inline-icon" name="close" :size="16" /></button></header>
      <p>Выберите занятие для отряда. Открытая партия общая для участников кампании.</p>
      <div class="choices">
        <button type="button" @click="selected = 'dice'"><span aria-hidden="true"><GameIcon class="inline-icon" name="dice" :size="26" /></span><strong>Кости дракона</strong><small>Таверна · 1–8 игроков</small><p>Собирайте сокровища и вовремя останавливайтесь: второй дракон сжигает добычу хода.</p><b>К игральному столу →</b></button>
        <button type="button" @click="selected = 'runes'"><span aria-hidden="true"><GameIcon class="inline-icon" name="summon" :size="26" /></span><strong>Рунный замок</strong><small>Головоломка · весь отряд</small><p>Прочитайте подсказку и совместите три руны. Мастер готовит загадку, отряд ищет решение.</p><b>К древней печати →</b></button>
        <button type="button" @click="selected = 'ritual'"><span aria-hidden="true"><GameIcon class="inline-icon" name="sparkle" :size="26" /></span><strong>Четыре печати</strong><small>Ритуал · весь отряд</small><p>Переносите энергию между стихиями. Найдите равновесие, пока круг не погас.</p><b>Пробудить стихии →</b></button>
        <button type="button" @click="selected = 'alchemy'"><span aria-hidden="true"><GameIcon class="inline-icon" name="flask" :size="26" /></span><strong>Алхимический котёл</strong><small>Лаборатория · весь отряд</small><p>Смешивайте ингредиенты, управляйте жаром и разливайте зелье вовремя.</p><b>К алхимическому столу →</b></button>
        <button type="button" @click="selected = 'chase'"><span aria-hidden="true"><GameIcon class="inline-icon" name="run" :size="26" /></span><strong>Погоня по переулкам</strong><small>Приключение · весь отряд</small><p>Выбирайте дороги, берегите силы и оторвитесь от преследователя до того, как перекроют выходы.</p><b>На улицы города →</b></button>
        <button type="button" @click="selected = 'duel'"><span aria-hidden="true"><GameIcon class="inline-icon" name="swords" :size="26" /></span><strong>Дуэль намерений</strong><small>Арена · два участника</small><p>Выбирайте приёмы тайно, угадывайте намерения соперника и берегите выносливость.</p><b>Бросить вызов →</b></button>
        <button type="button" @click="selected = 'fragments'"><span aria-hidden="true"><GameIcon class="inline-icon" name="map" :size="26" /></span><strong>Карта по обрывкам</strong><small>Расследование · весь отряд</small><p>Сравните старые записи, найдите противоречия и восстановите путь к цели.</p><b>Разложить карту →</b></button>
      </div>
      <p class="footnote">Правила доступны внутри каждой игры. Закрытие окна сохраняет текущую партию до перезапуска сервера.</p>
    </div>
  </div>
</template>
<style scoped>
.games-overlay{position:fixed;inset:0;z-index:3000;display:flex;align-items:center;justify-content:center;padding:18px;background:#000a;backdrop-filter:blur(3px)}.games-card{width:min(680px,100%);max-height:90vh;overflow:auto;background:var(--parchment-background);color:var(--ink);border:1px solid var(--brass);box-shadow:var(--g-ring),var(--g-shadow);padding:24px;border-radius:12px}header{display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:3px double var(--brass-light);padding-bottom:16px}h3{margin:4px 0 0;font-size:27px}small,.footnote{color:var(--muted-ink)}.choices{display:grid;grid-template-columns:1fr 1fr;gap:14px}.choices button{display:flex;flex-direction:column;align-items:flex-start;white-space:normal;text-align:left;padding:20px;border:1px solid var(--brass);border-radius:8px;background:radial-gradient(ellipse at top,color-mix(in srgb,var(--brass) 20%,transparent),transparent),var(--surface-inset);color:var(--ink)}.choices button>span{font:42px Georgia;color:var(--g-gold,var(--brass));margin-bottom:12px}.choices strong{font:20px var(--g-title-font,Georgia)}.choices small{font-size:12px;margin-top:6px}.choices p{font:14px/1.6 var(--g-body-font,Georgia)}.choices b{margin-top:auto;font-size:13px;color:var(--g-gold,var(--brass))}.footnote{font-size:12px;line-height:1.6;margin-bottom:0}@media(max-width:520px){.choices{grid-template-columns:1fr}.games-card{padding:16px}}
</style>
