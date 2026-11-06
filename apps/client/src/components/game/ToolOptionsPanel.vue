<script setup lang="ts">
import GameIcon from './GameIcon.vue';
import type { GameIconName } from '../../ui/gameIcons';
import { WALL_STYLES } from './WallPopover.vue';
import type { TableTool, WallStyle } from '../../tabletop/scene';
import type { AreaShape } from '../../tabletop/areas';
import type { WallTool } from '../../tabletop/view/types';

defineProps<{
  meta: { label: string; icon: GameIconName; detail: string };
  busy: boolean;
  builderMode: boolean;
  terrainMode: boolean;
  drawingTool: boolean;
  wallsCount: number;
  wallTextureId: string | null;
  canManage: boolean;
  difficultCells: number;
  colors: string[];
}>();

const emit = defineEmits<{
  wallPicture: [event: Event];
  restyleAll: [];
  removeAllWalls: [];
  clearTerrain: [];
  openTriggers: [];
  erase: [scope: 'mine' | 'all'];
}>();

const tool = defineModel<TableTool>('tool', { required: true });
const shareRuler = defineModel<boolean>('shareRuler', { required: true });
const openingKind = defineModel<'door' | 'window' | 'wall'>('openingKind', { required: true });
const wallTool = defineModel<WallTool | null>('wallTool', { required: true });
const wallStyle = defineModel<WallStyle>('wallStyle', { required: true });
const templateShape = defineModel<AreaShape>('templateShape', { required: true });
const templateSizeFeet = defineModel<number>('templateSizeFeet', { required: true });
const templateAsTrigger = defineModel<boolean>('templateAsTrigger', { required: true });
const drawColor = defineModel<string>('drawColor', { required: true });
const drawLayer = defineModel<'all' | 'gm'>('drawLayer', { required: true });

const OPENINGS = [
  ['door', 'Дверь', 'Открывается щелчком (игроку — когда его существо рядом)'],
  ['window', 'Окно', 'Видно насквозь, не пройти'],
  ['wall', 'Стена', 'Вернуть участку сплошную стену'],
] as const;
const WALL_MODES = [
  ['chain', 'Цепочка', 'Щелчок за щелчком — стена продолжается от прошлой точки'],
  ['room', 'Комната', 'Два угла — четыре стены'],
  ['pick', 'Правка', 'Щелчок по стене — вид, картинка, удалить'],
] as const;
</script>

<template>
  <div class="game-tool-options g-frame" role="group" aria-label="Настройки инструмента">
    <span class="tool-options-heading">
      <span class="tool-options-icon"><GameIcon :name="meta.icon" :size="18" /></span>
      <span><small>АКТИВНЫЙ ИНСТРУМЕНТ</small><b>{{ meta.label }}</b><em>{{ meta.detail }}</em></span>
    </span>
    <span class="tool-options-divider" aria-hidden="true" />
    <label v-if="tool === 'measure'" class="checkbox-label" title="Показывать мою линейку остальным участникам сцены">
      <input v-model="shareRuler" type="checkbox" /> Линейку видят все
    </label>
    <template v-if="builderMode && wallTool === 'opening'">
      <span class="draw-modes" role="radiogroup" aria-label="Что поставить в стену">
        <button
          v-for="entry in OPENINGS"
          :key="entry[0]" type="button" role="radio" :aria-checked="openingKind === entry[0]" :disabled="busy" :title="entry[2]"
          @click="openingKind = entry[0]"
        >{{ entry[1] }}</button>
      </span>
      <span class="muted">{{ wallsCount ? 'Щёлкните по участку стены — одна клетка.' : 'Сначала нарисуйте стены — инструмент «Стены».' }}</span>
    </template>
    <template v-if="builderMode && wallTool && wallTool !== 'opening'">
      <span class="draw-modes" role="radiogroup" aria-label="Как рисовать стены">
        <button
          v-for="entry in WALL_MODES"
          :key="entry[0]" type="button" role="radio" :aria-checked="wallTool === entry[0]" :disabled="busy" :title="entry[2]"
          @click="wallTool = entry[0]"
        >{{ entry[1] }}</button>
      </span>
      <select v-model="wallStyle" :disabled="busy" aria-label="Вид новых стен">
        <option v-for="entry in WALL_STYLES" :key="entry.id" :value="entry.id">{{ entry.label }}</option>
        <option v-if="wallTextureId" value="image">Своя картинка</option>
      </select>
      <label class="tool-file" title="PNG, JPEG или WebP: плитка повторяется по длине стены, одна плитка — клетка">
        Картинка…
        <input type="file" accept="image/png,image/jpeg,image/webp" :disabled="busy" @change="emit('wallPicture', $event)" />
      </label>
      <span class="muted">{{ wallsCount ? `Стен: ${wallsCount}` : 'Стен пока нет' }}</span>
      <button v-if="wallsCount > 1" type="button" :disabled="busy" title="Вид из списка — всем стенам сцены" @click="emit('restyleAll')">Всем этот вид</button>
      <button v-if="wallsCount" type="button" :disabled="busy" @click="emit('removeAllWalls')">Убрать все</button>
    </template>
    <template v-if="builderMode && terrainMode">
      <span class="muted">Зажмите и протяните прямоугольник клеток; начали с отмеченной клетки — снимает.</span>
      <span v-if="difficultCells" class="muted">Клеток: {{ difficultCells }}</span>
      <button v-if="difficultCells" type="button" :disabled="busy" @click="emit('clearTerrain')">Снять всю</button>
    </template>
    <template v-if="tool === 'template'">
      <select v-model="templateShape" aria-label="Форма области">
        <option value="circle">Круг (сфера)</option>
        <option value="cone">Конус</option>
        <option value="square">Куб</option>
        <option value="line">Линия (5 фут.)</option>
      </select>
      <label class="inline-number">
        <input v-model.number="templateSizeFeet" type="number" min="5" max="1000" step="5" aria-label="Размер области, фут." /> фут.
      </label>
      <label v-if="canManage" class="checkbox-label" title="Область-ловушка: видит только мастер, срабатывает при входе">
        <input v-model="templateAsTrigger" type="checkbox" /> как ловушку
      </label>
      <button v-if="builderMode && templateAsTrigger" type="button" title="Все ловушки сцены, их действие и сброс (7)" @click="emit('openTriggers')">Ловушки сцены…</button>
    </template>
    <template v-if="drawingTool">
      <span class="draw-modes" role="radiogroup" aria-label="Чем рисовать">
        <button type="button" role="radio" :aria-checked="tool === 'draw'" title="Кисть (B)" @click="tool = 'draw'"><GameIcon name="quill" :size="16" />Кисть</button>
        <button type="button" role="radio" :aria-checked="tool === 'text'" title="Подпись на карте (L)" @click="tool = 'text'"><GameIcon name="letter" :size="16" />Подпись</button>
        <button type="button" role="radio" :aria-checked="tool === 'erase'" title="Ластик (E)" @click="tool = 'erase'"><GameIcon name="eraser" :size="16" />Ластик</button>
      </span>
      <span class="color-swatches" role="radiogroup" aria-label="Цвет">
        <button
          v-for="color in colors"
          :key="color"
          type="button"
          class="swatch"
          role="radio"
          :aria-checked="drawColor === color"
          :aria-label="`Цвет ${color}`"
          :style="{ background: color }"
          @click="drawColor = color"
        />
      </span>
      <select v-if="canManage" v-model="drawLayer" title="Кто видит новый рисунок">
        <option value="all">Видят все</option>
        <option value="gm">Только мастер</option>
      </select>
      <button type="button" :disabled="busy" @click="emit('erase', 'mine')">Стереть мои</button>
      <button v-if="canManage" type="button" :disabled="busy" @click="emit('erase', 'all')">Стереть все</button>
    </template>
  </div>
</template>

<style scoped>
p{line-height:1.5}
.muted{font-size:13px}
.color-swatches{display:inline-flex;gap:3px;align-items:center}
.tool-file{position:relative;display:inline-flex;align-items:center;margin:0;min-height:30px;padding:2px 10px;border:1px solid var(--g-line,#6b5233);border-radius:4px;cursor:pointer}
.tool-file input{position:absolute;inset:0;opacity:0;cursor:pointer}
.draw-modes{display:flex;gap:4px}
.draw-modes button{display:flex;align-items:center;gap:4px;min-height:30px;padding:2px 10px}
.draw-modes button[aria-checked="true"]{box-shadow:inset 0 0 0 2px var(--g-gold-hi,#f0c96a)}
.game-tool-options{position:fixed;left:calc(var(--rail-space,78px) + 8px);top:calc(var(--game-top,54px) + 24px + var(--plate-height,48px));z-index:2105;display:flex;flex-wrap:wrap;align-items:center;gap:8px;max-width:min(680px,calc(100vw - var(--rail-space,78px) - 130px));padding:10px 13px;background:linear-gradient(110deg,#24170ff5,#100a07f2)}
.tool-options-heading{display:flex;align-items:center;gap:9px;min-width:164px}
.tool-options-heading>span:last-child{display:flex;flex-direction:column;gap:1px}
.tool-options-heading small{font:600 11px var(--g-body-font);letter-spacing:.13em;color:var(--g-gold-lo)}
.tool-options-heading b{font:600 14px var(--g-title-font);color:var(--g-gold-hi)}
.tool-options-heading em{font:11px var(--g-body-font);font-style:normal;color:var(--g-text-dim)}
.tool-options-icon{display:grid;place-items:center;width:34px;height:34px;flex:none;border-radius:50%;color:var(--g-gold-hi);background:radial-gradient(circle,var(--g-accent-hi),var(--g-accent));box-shadow:inset 0 0 0 1px #000,0 0 0 1px var(--g-gold-lo)}
.tool-options-divider{align-self:stretch;width:1px;min-height:38px;margin:0 3px;background:linear-gradient(transparent,var(--g-gold-lo),transparent)}
.game-tool-options select{width:auto;min-height:34px;padding:2px 8px}
.game-tool-options label{margin:0;display:inline-flex;align-items:center;gap:6px;font-size:13px}
.game-tool-options .inline-number input{width:76px;min-height:34px;padding:2px 6px}
.game-tool-options button:not(.swatch){min-height:32px;padding:2px 10px;font-size:13px}
.game-tool-options .swatch{min-width:22px;width:22px;min-height:22px;height:22px;padding:0;border-radius:50%;border:2px solid #000;box-shadow:0 0 0 1px var(--g-gold-lo)}
.game-tool-options .swatch[aria-checked="true"]{box-shadow:0 0 0 3px var(--g-gold-hi)}
</style>
