<script setup lang="ts">
import { ref } from 'vue';

import { CONDITIONS } from '../../rules/conditions';
import type { WallStyle } from '../../tabletop/scene';
import { WALL_STYLES } from './WallPopover.vue';
import GameIcon from './GameIcon.vue';

const props = defineProps<{
  objects: number;
  creatures: number;
  walls: number;
  templates: number;
  canManage: boolean;
  allHidden: boolean;
  busy: boolean;
  downed?: number;
  menu?: boolean;
}>();

const emit = defineEmits<{
  move: [dx: number, dz: number];
  rotate: [quarterTurns: number];
  hide: [hidden: boolean];
  condition: [code: string];
  hp: [mode: 'damage' | 'heal', amount: number];
  combat: [];
  revive: [options: { hp: 'one' | 'half' | 'full'; clearExhaustion: boolean; clearConditions: boolean }];
  wallStyle: [style: WallStyle];
  remove: [];
  clear: [];
}>();

const open = ref<'conditions' | 'hp' | 'revive' | null>(null);
const amount = ref(5);
const reviveHp = ref<'one' | 'half' | 'full'>('one');
const reviveExhaustion = ref(false);
const reviveConditions = ref(false);
function revive() {
  emit('revive', { hp: reviveHp.value, clearExhaustion: reviveExhaustion.value, clearConditions: reviveConditions.value });
  open.value = null;
}
const total = () => props.objects + props.walls + props.templates;

function parts() {
  return [
    props.objects ? `${props.objects} ${plural(props.objects, 'объект', 'объекта', 'объектов')}` : '',
    props.walls ? `${props.walls} ${plural(props.walls, 'стена', 'стены', 'стен')}` : '',
    props.templates ? `${props.templates} ${plural(props.templates, 'область', 'области', 'областей')}` : '',
  ].filter(Boolean).join(', ');
}
function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
</script>

<template>
  <div class="multi-bar g-frame" :class="{ 'as-menu': menu }" role="toolbar" aria-label="Выделенное">
    <b class="title">Выделено: {{ parts() }}</b>
    <small v-if="objects + templates && !menu" class="hint">щелчок по карте — переставить</small>
    <div v-if="objects + templates" class="group" role="group" aria-label="Сдвинуть на клетку">
      <button type="button" :disabled="busy" title="Влево на клетку (←)" @click="emit('move', -1, 0)">←</button>
      <button type="button" :disabled="busy" title="Вверх на клетку (↑)" @click="emit('move', 0, -1)">↑</button>
      <button type="button" :disabled="busy" title="Вниз на клетку (↓)" @click="emit('move', 0, 1)">↓</button>
      <button type="button" :disabled="busy" title="Вправо на клетку (→)" @click="emit('move', 1, 0)">→</button>
    </div>
    <div v-if="objects + templates > 1" class="group rotate" role="group" aria-label="Повернуть строй">
      <button type="button" :disabled="busy" title="Повернуть строй на 90° по часовой стрелке — вокруг его середины; фигуры поворачиваются следом" @click="emit('rotate', 1)"><GameIcon class="inline-icon" name="rotate" :size="16" /> 90°</button>
      <button type="button" :disabled="busy" title="Повернуть строй на 90° против часовой стрелки" @click="emit('rotate', -1)"><GameIcon class="inline-icon" name="undo" :size="16" /> 90°</button>
      <button type="button" :disabled="busy" title="Развернуть строй на 180°" @click="emit('rotate', 2)">180°</button>
    </div>
    <template v-if="creatures">
      <span class="popup-wrap">
        <button type="button" :aria-expanded="open === 'conditions'" :disabled="busy" @click="open = open === 'conditions' ? null : 'conditions'">Состояние ▾</button>
        <span v-if="open === 'conditions'" class="popup g-frame" role="menu">
          <span class="condition-grid">
            <button v-for="entry in CONDITIONS" :key="entry.code" type="button" role="menuitem" :title="entry.rule" :disabled="busy" @click="emit('condition', entry.code)"><GameIcon class="inline-icon" :name="entry.icon" :size="18" />{{ entry.label }}</button>
          </span>
        </span>
      </span>
      <span class="popup-wrap">
        <button type="button" :aria-expanded="open === 'hp'" :disabled="busy" @click="open = open === 'hp' ? null : 'hp'">Урон / лечение ▾</button>
        <span v-if="open === 'hp'" class="popup g-frame hp" role="dialog" aria-label="Урон или лечение всем">
          <input v-model.number="amount" type="number" min="1" max="999" aria-label="Сколько хитов" />
          <button type="button" class="primary" :disabled="busy || !(amount > 0)" @click="emit('hp', 'damage', Math.round(amount))">Урон</button>
          <button type="button" :disabled="busy || !(amount > 0)" @click="emit('hp', 'heal', Math.round(amount))">Лечение</button>
        </span>
      </span>
      <span v-if="canManage && downed" class="popup-wrap">
        <button type="button" :aria-expanded="open === 'revive'" :disabled="busy" :title="`Поднять павших среди выделенных (${downed})`" @click="open = open === 'revive' ? null : 'revive'">Воскресить ▾</button>
        <span v-if="open === 'revive'" class="popup g-frame revive" role="dialog" aria-label="Воскресить выделенных">
          <b>Павших: {{ downed }}</b>
          <span class="revive-hp" role="radiogroup" aria-label="С чем встают">
            <label v-for="entry in ([['one', '1 хит'], ['half', 'половина хитов'], ['full', 'все хиты']] as const)" :key="entry[0]">
              <input v-model="reviveHp" type="radio" name="revive-hp" :value="entry[0]" /> {{ entry[1] }}
            </label>
          </span>
          <small>Всегда снимаются «мёртв», «без сознания» от 0 хитов, «стабилен» и спасброски от смерти.</small>
          <label><input v-model="reviveExhaustion" type="checkbox" /> снять истощение</label>
          <label><input v-model="reviveConditions" type="checkbox" /> снять остальные состояния (отравлен, ослеплён…)</label>
          <button type="button" class="primary" :disabled="busy" @click="revive">Воскресить</button>
        </span>
      </span>
      <button v-if="canManage" type="button" :disabled="busy" title="Бросить инициативу всем выделенным, кто ещё не в бою" @click="emit('combat')">В бой</button>
    </template>
    <button v-if="objects && canManage" type="button" :disabled="busy" @click="emit('hide', !allHidden)">{{ allHidden ? 'Показать игрокам' : 'Скрыть от игроков' }}</button>
    <select v-if="walls && canManage" :disabled="busy" aria-label="Вид выделенных стен" @change="emit('wallStyle', ($event.target as HTMLSelectElement).value as WallStyle); ($event.target as HTMLSelectElement).value = ''">
      <option value="">Вид стен…</option>
      <option v-for="entry in WALL_STYLES" :key="entry.id" :value="entry.id">{{ entry.label }}</option>
    </select>
    <button type="button" class="danger" :disabled="busy" :title="`Убрать со сцены всё выделенное (${total()})`" @click="emit('remove')">Убрать</button>
    <button type="button" class="close" :disabled="busy" title="Снять выделение (Esc)" aria-label="Снять выделение" @click="emit('clear')">×</button>
  </div>
</template>

<style scoped>
.multi-bar{position:fixed;left:50%;translate:-50% 0;top:calc(var(--game-top,54px) + 104px);z-index:2120;display:flex;flex-wrap:wrap;align-items:center;gap:6px;max-width:calc(100vw - 2 * var(--rail-space,78px));padding:8px 12px}
.title{font:600 14px var(--g-title-font);color:var(--g-gold-hi);margin-right:4px;white-space:nowrap}
.group{display:inline-flex;gap:2px}
.hint{font-size:12px;opacity:.75;white-space:nowrap}
.group button{width:32px;padding:0}
.group.rotate button{width:auto;padding:0 8px}
.multi-bar button,.multi-bar select{min-height:32px;padding:2px 10px;font-size:13px}
.multi-bar select{width:auto}
.multi-bar .danger{color:#ff9c8c}
.multi-bar .close{width:30px;padding:0;border-radius:50%}
.popup-wrap{position:relative}
.popup{position:absolute;top:calc(100% + 6px);left:0;z-index:5;padding:8px}
.condition-grid{display:grid;grid-template-columns:repeat(2,minmax(130px,1fr));gap:4px;width:300px;max-height:320px;overflow-y:auto}
.condition-grid button{display:flex;align-items:center;gap:6px;justify-content:flex-start;text-align:left;font-size:12px;min-height:30px}
.hp{display:flex;gap:6px;width:max-content}
.hp input{width:70px;min-height:32px}
.popup.revive{display:flex;flex-direction:column;gap:6px;width:250px;padding:10px;font-size:12px;text-align:left}
.popup.revive label{display:flex;align-items:center;gap:6px;margin:0}
.revive-hp{display:flex;flex-direction:column;gap:3px}
.popup.revive small{opacity:.75}
.multi-bar.as-menu{position:static;translate:none;flex-direction:column;flex-wrap:nowrap;align-items:stretch;width:240px;max-width:none}
.as-menu .title{white-space:normal}
.as-menu .group{justify-content:space-between}
.as-menu .group button{flex:1}
.as-menu .popup{top:0;left:calc(100% + 6px)}
</style>
