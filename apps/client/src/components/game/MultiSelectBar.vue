<script setup lang="ts">
import { ref } from 'vue';
import { pictureSets, type PictureSet } from '../../art/pictureSets';
import type { ScatterDensity, SizeSpread } from '../../../../../packages/domain/map/scatter';

import { conditionGroups, tableConditions, type ConditionGroup } from '../../rules/conditions';
import type { WallStyle } from '../../tabletop/scene';
import type { AlternateMode } from '../../../../../packages/domain/map/wall-alternate';
import { WALL_STYLES } from './WallPopover.vue';
import GameIcon from './GameIcon.vue';
import ConditionIcon from '../conditions/ConditionIcon.vue';

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
  things?: number;
}>();

const emit = defineEmits<{
  move: [dx: number, dz: number];
  rotate: [quarterTurns: number];
  spread: [options: { rotate: boolean; size: SizeSpread; pictures: string }];
  scatter: [options: { rotate: boolean; size: SizeSpread; density: ScatterDensity; pictures: string }];
  hide: [hidden: boolean];
  condition: [code: string];
  hp: [mode: 'damage' | 'heal', amount: number];
  combat: [];
  revive: [options: { hp: 'one' | 'half' | 'full'; clearExhaustion: boolean; clearConditions: boolean }];
  wallStyle: [style: WallStyle];
  wallAlternate: [styles: WallStyle[], mode: AlternateMode, length: number];
  remove: [];
  clear: [];
}>();

const open = ref<'conditions' | 'hp' | 'revive' | 'alternate' | 'spread' | null>(null);
const conditionKind = ref<ConditionGroup>('condition');
const spreadRotate = ref(true);
const spreadSize = ref<SizeSpread>(0.25);
const spreadPictures = ref('');
const scatterDensity = ref<ScatterDensity>('medium');
const sets = ref<PictureSet[]>([]);
const SIZE_OPTIONS: Array<[SizeSpread, string]> = [[0, 'не менять'], [0.1, '±10 %'], [0.25, '±25 %'], [0.4, '±40 %']];
const DENSITY_OPTIONS: Array<[ScatterDensity, string]> = [['sparse', 'редко'], ['medium', 'средне'], ['dense', 'густо']];
async function toggleSpread() {
  open.value = open.value === 'spread' ? null : 'spread';
  if (open.value === 'spread' && !sets.value.length) sets.value = await pictureSets().catch(() => []);
}
function applySpread() {
  emit('spread', { rotate: spreadRotate.value, size: spreadSize.value, pictures: spreadPictures.value });
  open.value = null;
}
function scatter() {
  emit('scatter', { rotate: spreadRotate.value, size: spreadSize.value, density: scatterDensity.value, pictures: spreadPictures.value });
  open.value = null;
}
const alternateStyles = ref<WallStyle[]>(['rock', 'stone']);
const alternateMode = ref<AlternateMode>('cycle');
const alternateLength = ref(1);
const SECTION_LENGTHS = [[1, 'по 1 клетке'], [2, 'по 2 клетки'], [3, 'по 3 клетки'], [4, 'по 4 клетки'], [6, 'по 6 клеток']] as const;
function alternate() {
  emit('wallAlternate', WALL_STYLES.map(entry => entry.id).filter(id => alternateStyles.value.includes(id)), alternateMode.value, alternateLength.value);
  open.value = null;
}
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
      <button class="icon-only" type="button" :disabled="busy" title="Влево на клетку (←)" aria-label="Влево на клетку" @click="emit('move', -1, 0)"><GameIcon name="arrowLeft" :size="15" /></button>
      <button class="icon-only" type="button" :disabled="busy" title="Вверх на клетку (↑)" aria-label="Вверх на клетку" @click="emit('move', 0, -1)"><GameIcon name="arrowUp" :size="15" /></button>
      <button class="icon-only" type="button" :disabled="busy" title="Вниз на клетку (↓)" aria-label="Вниз на клетку" @click="emit('move', 0, 1)"><GameIcon name="arrowDown" :size="15" /></button>
      <button class="icon-only" type="button" :disabled="busy" title="Вправо на клетку (→)" aria-label="Вправо на клетку" @click="emit('move', 1, 0)"><GameIcon name="arrowRight" :size="15" /></button>
    </div>
    <div v-if="objects + templates > 1" class="group rotate" role="group" aria-label="Повернуть строй">
      <button type="button" :disabled="busy" title="Повернуть строй на 90° по часовой стрелке — вокруг его середины; фигуры поворачиваются следом" @click="emit('rotate', 1)"><GameIcon class="inline-icon" name="rotate" :size="16" /> 90°</button>
      <button type="button" :disabled="busy" title="Повернуть строй на 90° против часовой стрелки" @click="emit('rotate', -1)"><GameIcon class="inline-icon" name="undo" :size="16" /> 90°</button>
      <button type="button" :disabled="busy" title="Развернуть строй на 180°" @click="emit('rotate', 2)">180°</button>
    </div>
    <span v-if="things && canManage" class="popup-wrap">
      <button type="button" :aria-expanded="open === 'spread'" :disabled="busy" title="Случайные поворот, размер и картинка — или рассыпать копии по области" @click="toggleSpread">Разброс ▾</button>
      <span v-if="open === 'spread'" class="popup g-frame spread" role="dialog" aria-label="Разброс">
        <b>Разброс — чтобы лес не стоял по линейке</b>
        <label class="spread-row">Поворот
          <select v-model="spreadRotate" aria-label="Поворот">
            <option :value="true">случайный</option>
            <option :value="false">не менять</option>
          </select>
        </label>
        <label class="spread-row">Размер
          <select v-model.number="spreadSize" aria-label="Размер">
            <option v-for="entry in SIZE_OPTIONS" :key="entry[0]" :value="entry[0]">{{ entry[1] }}</option>
          </select>
        </label>
        <label class="spread-row">Картинка
          <select v-model="spreadPictures" aria-label="Картинка из набора">
            <option value="">не менять</option>
            <option v-for="set in sets" :key="set.id" :value="set.id">{{ set.label }}</option>
          </select>
        </label>
        <small>Картинка — случайная из набора, каждому предмету своя.</small>
        <button type="button" class="primary" :disabled="busy || (!spreadRotate && !spreadSize && !spreadPictures)" @click="applySpread">Разбросать выделенное</button>
        <span class="spread-divider" aria-hidden="true" />
        <label class="spread-row">Плотность
          <select v-model="scatterDensity" aria-label="Плотность">
            <option v-for="entry in DENSITY_OPTIONS" :key="entry[0]" :value="entry[0]">{{ entry[1] }}</option>
          </select>
        </label>
        <small>Копии выделенного лягут в свободные клетки протянутого прямоугольника — с поворотом, размером и картинкой отсюда.</small>
        <button type="button" :disabled="busy" @click="scatter">Рассыпать по области…</button>
      </span>
    </span>
    <template v-if="creatures">
      <span class="popup-wrap">
        <button type="button" :aria-expanded="open === 'conditions'" :disabled="busy" @click="open = open === 'conditions' ? null : 'conditions'">Состояние ▾</button>
        <span v-if="open === 'conditions'" class="popup g-frame" role="menu">
          <span v-if="conditionGroups(tableConditions()).length > 1" class="condition-kinds" role="group" aria-label="Вид">
            <button v-for="[kind, label] in conditionGroups(tableConditions())" :key="kind" type="button" :aria-pressed="conditionKind === kind" @click="conditionKind = kind">{{ label }}</button>
          </span>
          <span class="condition-grid">
            <button v-for="entry in tableConditions().filter(item => item.group === conditionKind)" :key="entry.code" type="button" role="menuitem" :title="entry.rule" :disabled="busy" @click="emit('condition', entry.code)"><ConditionIcon class="inline-icon" :name="entry.icon" :image="entry.image" :size="18" />{{ entry.label }}</button>
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
    <span v-if="walls && canManage" class="popup-wrap">
      <button type="button" :aria-expanded="open === 'alternate'" :disabled="busy" title="Раздать участкам выделенных стен несколько видов по очереди или вперемешку" @click="open = open === 'alternate' ? null : 'alternate'">Чередовать ▾</button>
      <span v-if="open === 'alternate'" class="popup g-frame alternate" role="dialog" aria-label="Чередовать вид стен">
        <b>Чередовать вид стен</b>
        <span class="alternate-styles" role="group" aria-label="Какие виды">
          <label v-for="entry in WALL_STYLES" :key="entry.id"><input v-model="alternateStyles" type="checkbox" :value="entry.id" /> {{ entry.label }}</label>
        </span>
        <span class="alternate-mode" role="radiogroup" aria-label="Как чередовать">
          <label><input v-model="alternateMode" type="radio" name="alternate-mode" value="cycle" /> по очереди вдоль стены</label>
          <label><input v-model="alternateMode" type="radio" name="alternate-mode" value="mix" /> вперемешку</label>
        </span>
        <label class="alternate-length">Участок
          <select v-model.number="alternateLength" aria-label="Длина участка">
            <option v-for="entry in SECTION_LENGTHS" :key="entry[0]" :value="entry[0]">{{ entry[1] }}</option>
          </select>
        </label>
        <small v-if="alternateStyles.length < 2">Отметьте хотя бы два вида.</small>
        <small v-else-if="alternateMode === 'cycle'">Участки идут по очереди вдоль всей цепочки, и через углы тоже.</small>
        <small v-else>Участки получают вид случайно, соседние не совпадают.</small>
        <button type="button" class="primary" :disabled="busy || alternateStyles.length < 2" @click="alternate">Чередовать</button>
      </span>
    </span>
    <button type="button" class="danger" :disabled="busy" :title="`Убрать со сцены всё выделенное (${total()})`" @click="emit('remove')">Убрать</button>
    <button type="button" class="close icon-only" :disabled="busy" title="Снять выделение (Esc)" aria-label="Снять выделение" @click="emit('clear')"><GameIcon name="close" :size="16" /></button>
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
.multi-bar .close{display:grid;place-items:center;place-content:center;width:30px;padding:0;border-radius:50%}
.popup-wrap{position:relative}
.popup{position:absolute;top:calc(100% + 6px);left:0;z-index:5;padding:8px}
.condition-kinds{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px}
.condition-kinds button{min-height:26px;padding:0 10px;font-size:12px}
.condition-kinds button[aria-pressed="true"]{background:var(--brass-light,#b08d57);color:#fff}
.condition-grid{display:grid;grid-template-columns:repeat(2,minmax(130px,1fr));gap:4px;width:300px;max-height:320px;overflow-y:auto}
.condition-grid button{display:flex;align-items:center;gap:6px;justify-content:flex-start;text-align:left;font-size:12px;min-height:30px}
.hp{display:flex;gap:6px;width:max-content}
.hp input{width:70px;min-height:32px}
.popup.revive{display:flex;flex-direction:column;gap:6px;width:250px;padding:10px;font-size:12px;text-align:left}
.popup.revive label{display:flex;align-items:center;gap:6px;margin:0}
.revive-hp{display:flex;flex-direction:column;gap:3px}
.popup.revive small{opacity:.75}
.popup.alternate{display:flex;flex-direction:column;gap:6px;width:250px;padding:10px;font-size:12px;text-align:left}
.popup.alternate label{display:flex;align-items:center;gap:6px;margin:0}
.alternate-styles{display:grid;grid-template-columns:1fr 1fr;gap:3px 8px}
.alternate-mode{display:flex;flex-direction:column;gap:3px}
.alternate-length{display:flex;align-items:center;justify-content:space-between;gap:8px}
.alternate-length select{min-height:28px;font-size:12px}
.popup.alternate small{opacity:.75}
.popup.spread{display:flex;flex-direction:column;gap:6px;width:270px;padding:10px;font-size:12px;text-align:left}
.spread-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0}
.spread-row select{min-height:28px;max-width:170px;font-size:12px}
.popup.spread small{opacity:.75}
.spread-divider{height:1px;margin:2px 0;background:var(--g-gold-lo,#8a6d3b)}
.multi-bar.as-menu{position:static;translate:none;flex-direction:column;flex-wrap:nowrap;align-items:stretch;width:240px;max-width:none}
.as-menu .title{white-space:normal}
.as-menu .group{justify-content:space-between}
.as-menu .group button{flex:1}
.as-menu .popup{top:0;left:calc(100% + 6px)}
</style>
