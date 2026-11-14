<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { conditionGroups, tableConditions, type ConditionGroup } from '../../rules/conditions';
import { cssZoom } from '../../settings/uiScale';
import GameIcon from './GameIcon.vue';
import { abilityIcon } from '../../rules/skillIcons';
import ConditionIcon from '../conditions/ConditionIcon.vue';

export type TokenMenuTarget = {
  characterId: string;
  objectId: string;
  name: string;
  hpText: string | null;
  conditions: string[];
  hidden: boolean;
  kind: 'character' | 'npc' | 'object';
  hp?: { current: number; max: number; temp: number } | null;
  inCombat?: boolean;
  disposition?: 'hostile' | 'neutral' | 'friendly' | null;
  merchant?: boolean;
  factions?: string[] | null;
  canFly?: boolean;
  canClimb?: boolean;
  flightHeight?: number | null;
  level?: number | null;
  experience?: number | null;
  nextExperience?: number | null;
};
export type TokenSaveRequest = { ability: string; advantage: 'none' | 'adv' | 'disadv' };
export type TokenReviveRequest = { hp: 'one' | 'half' | 'full'; clearExhaustion: boolean; clearConditions: boolean };

const props = defineProps<{
  at: { x: number; y: number };
  target: TokenMenuTarget;
  actorName: string | null;
  canAttack: boolean;
  canEdit: boolean;
  canManage: boolean;
  canDuplicate: boolean;
  busy: boolean;
  notice?: string | null;
  factionList?: Array<{ id: string; name: string; color: string }>;
}>();

const emit = defineEmits<{
  attack: [];
  spell: [];
  hp: [mode: 'damage' | 'heal' | 'temp', amount: number];
  fall: [feet: number];
  fly: [on: boolean, height?: number];
  climb: [on: boolean, height?: number];
  condition: [code: string, durationRounds: number | null];
  save: [request: TokenSaveRequest];
  combat: [join: boolean];
  disposition: [value: 'hostile' | 'neutral' | 'friendly'];
  ping: [];
  sheet: [];
  shop: [];
  examine: [];
  hide: [];
  focus: [];
  remove: [];
  rotate: [degrees: number];
  scale: [factor: number];
  duplicate: [count: number];
  factions: [ids: string[] | null];
  manageFactions: [];
  xp: [amount: number];
  revive: [request: TokenReviveRequest];
  levelUp: [];
  levelDown: [];
  close: [];
}>();

const submenu = ref<'conditions' | 'hp' | 'transform' | 'save' | 'factions' | 'xp' | 'revive' | null>(null);
const DURATIONS: Array<[number | null, string]> = [[null, 'без срока'], [1, '1 раунд'], [10, '1 минута'], [100, '10 минут']];
const duration = ref<number | null>(null);
const ABILITIES: Array<[string, string]> = [
  ['strength', 'СИЛ'], ['dexterity', 'ЛОВ'], ['constitution', 'ТЕЛ'], ['intelligence', 'ИНТ'], ['wisdom', 'МДР'], ['charisma', 'ХАР'],
];
const advantage = ref<TokenSaveRequest['advantage']>('none');
const missing = computed(() => (props.target.hp ? Math.max(0, props.target.hp.max - props.target.hp.current) : 0));
const amount = ref(5);
const FALL_HEIGHTS = [10, 20, 30, 40, 50, 60, 80, 100, 150, 200];
const FLIGHT_HEIGHTS = [0, 5, 10, 15, 20, 30, 40, 60, 80, 100, 150, 200];
const fallFeet = ref(10);
const copies = ref(1);
const root = ref<HTMLElement | null>(null);
const creature = computed(() => props.target.kind !== 'object');
const hero = computed(() => props.target.kind === 'character');
const fallen = computed(() => props.target.conditions.includes('dead') || props.target.hp?.current === 0);
const levelReady = computed(() => props.target.nextExperience != null && (props.target.experience ?? 0) >= props.target.nextExperience);
const XP_STEPS = [50, 100, 250, 500, 1000];
const xpAmount = ref(100);
function giveXp(sign: 1 | -1) {
  if (props.busy || !(xpAmount.value >= 1)) return;
  emit('xp', sign * Math.min(1_000_000, Math.round(xpAmount.value)));
}
const reviveHp = ref<TokenReviveRequest['hp']>('one');
const reviveExhaustion = ref(false);
const reviveConditions = ref(false);
function revive() {
  emit('revive', { hp: reviveHp.value, clearExhaustion: reviveExhaustion.value, clearConditions: reviveConditions.value });
}

// Screen coordinates; inside CSS zoom they are divided by it.
const zoom = cssZoom;
const position = computed(() => {
  const x = props.at.x / zoom.value;
  const y = props.at.y / zoom.value;
  const width = window.innerWidth / zoom.value;
  const height = window.innerHeight / zoom.value;
  return { left: `${Math.min(x + 8, width - 300)}px`, top: `${Math.min(y + 8, height - 420)}px`, translate: `${fit.value.x}px ${fit.value.y}px` };
});

const fit = ref({ x: 0, y: 0 });
const subLeft = ref(false);
const subShift = ref(0);
const subTop = ref(40);
async function fitInside() {
  await nextTick();
  const zoomValue = zoom.value;
  const box = root.value?.querySelector('.menu-box')?.getBoundingClientRect();
  if (box) {
    const dy = Math.min(0, window.innerHeight - 8 - box.bottom) + Math.max(0, 8 - (box.top + Math.min(0, window.innerHeight - 8 - box.bottom)));
    fit.value = { x: fit.value.x, y: fit.value.y + dy / zoomValue };
  }
  const sub = root.value?.querySelector('.sub') as HTMLElement | null;
  if (!sub) return;
  const row = root.value?.querySelector('.menu-scroll [aria-expanded="true"]') as HTMLElement | null;
  subTop.value = row ? Math.max(0, (row.getBoundingClientRect().top - root.value!.getBoundingClientRect().top) / zoomValue) : 40;
  const menuRect = root.value!.getBoundingClientRect();
  subLeft.value = menuRect.right + 300 * zoomValue > window.innerWidth;
  await nextTick();
  subShift.value = 0;
  await nextTick();
  const rect = sub.getBoundingClientRect();
  if (rect.bottom > window.innerHeight - 8) subShift.value = Math.max(8 - rect.top, window.innerHeight - 8 - rect.bottom) / zoomValue;
}
onMounted(fitInside);
watch(submenu, fitInside);
watch(() => [props.target.conditions.length, props.notice, props.target.inCombat], fitInside);

function onDocument(event: PointerEvent) {
  if (root.value && !root.value.contains(event.target as Node)) emit('close');
}
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close');
}
onMounted(() => {
  document.addEventListener('pointerdown', onDocument, true);
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocument, true);
  window.removeEventListener('keydown', onKey);
});

function act(event: 'attack' | 'spell' | 'sheet' | 'hide' | 'focus' | 'remove') {
  (emit as (name: string) => void)(event);
  emit('close');
}

function hp(mode: 'damage' | 'heal' | 'temp', value = amount.value) {
  if (!(value > 0)) return;
  emit('hp', mode, Math.round(value));
}

function condition(code: string) {
  emit('condition', code, props.target.conditions.includes(code) ? null : duration.value);
}

const conditions = computed(() => tableConditions());
const conditionKind = ref<ConditionGroup>('condition');
const kinds = computed(() => conditionGroups(conditions.value));
const shownConditions = computed(() => conditions.value.filter(entry => entry.group === conditionKind.value));
const activeConditions = computed(() => conditions.value.filter(entry => props.target.conditions.includes(entry.code)));

const memberOf = computed(() => props.target.factions ?? []);
function toggleFaction(id: string) {
  const now = memberOf.value;
  emit('factions', now.includes(id) ? now.filter(item => item !== id) : [...now, id]);
}

function rotate(degrees: number) {
  emit('rotate', degrees);
}
function scale(factor: number) {
  emit('scale', factor);
}
function duplicate() {
  if (!(copies.value >= 1)) return;
  emit('duplicate', Math.min(20, Math.round(copies.value)));
  emit('close');
}
</script>

<template>
  <div ref="root" class="token-menu" :style="position" role="menu" :aria-label="`Действия: ${target.name}`" @contextmenu.prevent>
    <div class="menu-box g-frame">
      <div class="menu-head">
        <b>{{ target.name }}</b>
        <small v-if="target.hpText">{{ target.hpText }}<template v-if="target.inCombat"> · в бою</template></small>
        <span v-if="activeConditions.length" class="head-conditions">
          <button
            v-for="entry in activeConditions" :key="entry.code" type="button" class="chip" :title="`${entry.label} — щелчок снимет`" :disabled="busy || !creature"
            @click="condition(entry.code)"
          ><ConditionIcon class="inline-icon" :name="entry.icon" :image="entry.image" :size="16" />{{ entry.label }} ×</button>
        </span>
        <small v-if="notice" class="notice-line" role="status">{{ notice }}</small>
      </div>
      <div class="menu-scroll">
      <button v-if="canAttack && creature" type="button" role="menuitem" :disabled="busy" @click="act('attack')"><GameIcon name="sword" :size="16" />Атаковать<small v-if="actorName">— {{ actorName }}</small></button>
      <button v-if="canAttack" type="button" role="menuitem" :disabled="busy" @click="act('spell')"><GameIcon name="sparkle" :size="16" />Заклинание на цель</button>
      <button v-if="canEdit && creature" type="button" role="menuitem" :aria-expanded="submenu === 'hp'" @click="submenu = submenu === 'hp' ? null : 'hp'"><GameIcon name="plus" :size="16" />Урон или лечение…</button>
      <button v-if="creature" type="button" role="menuitem" :aria-expanded="submenu === 'conditions'" @click="submenu = submenu === 'conditions' ? null : 'conditions'"><GameIcon name="hourglass" :size="16" />Состояние<span class="more">›</span></button>
      <button v-if="canEdit && creature" type="button" role="menuitem" :aria-expanded="submenu === 'save'" @click="submenu = submenu === 'save' ? null : 'save'"><GameIcon name="savingThrow" :size="16" />Спасбросок<span class="more">›</span></button>
      <button v-if="canEdit" type="button" role="menuitem" :aria-expanded="submenu === 'transform'" @click="submenu = submenu === 'transform' ? null : 'transform'"><GameIcon name="swap" :size="16" />Повернуть, размер, копии<span class="more">›</span></button>
      <span v-if="creature && (canManage || (canEdit && hero))" class="menu-sep" />
      <button v-if="canManage && creature" type="button" role="menuitem" :aria-expanded="submenu === 'xp'" @click="submenu = submenu === 'xp' ? null : 'xp'">
        <GameIcon name="xp" :size="16" />Опыт<small v-if="target.experience != null">{{ target.experience }}</small><span class="more">›</span>
      </button>
      <button v-if="canEdit && hero && levelReady" type="button" role="menuitem" @click="emit('levelUp'); emit('close')"><GameIcon name="levelUp" :size="16" />Новый уровень…</button>
      <button v-if="canEdit && hero && (target.level ?? 1) > 1" type="button" role="menuitem" title="Отменится то, что дал последний уровень; опыт не меняется" @click="emit('levelDown'); emit('close')">
        <GameIcon name="levelDown" :size="16" />Понизить уровень…<small>{{ target.level }} → {{ (target.level ?? 2) - 1 }}</small>
      </button>
      <button v-if="canManage && creature && fallen" type="button" role="menuitem" :aria-expanded="submenu === 'revive'" @click="submenu = submenu === 'revive' ? null : 'revive'"><GameIcon name="heartPlus" :size="16" />Воскресить<span class="more">›</span></button>
      <span class="menu-sep" />
      <button v-if="creature && canEdit && (target.canFly || target.conditions.includes('flying'))" type="button" role="menuitem" :disabled="busy" :title="target.conditions.includes('flying') ? 'Опуститься на землю' : 'Взлететь со своей скоростью полёта: местность и ямы не мешают; сбитый с ног — падает'" @click="emit('fly', !target.conditions.includes('flying'))">
        <GameIcon name="feather" :size="16" />{{ target.conditions.includes('flying') ? 'Приземлиться' : 'Взлететь' }}
      </button>
      <label v-if="creature && canEdit && (target.conditions.includes('flying') || target.conditions.includes('dragon_wings'))" class="height-row" title="Сбитый с ног или лишённый движения падает с этой высоты: 1к6 за 10 футов">
        <GameIcon name="feather" :size="16" />Высота
        <select :value="target.flightHeight ?? 0" :disabled="busy" aria-label="Высота полёта" @change="emit('fly', true, Number(($event.target as HTMLSelectElement).value))">
          <option v-for="feet in FLIGHT_HEIGHTS" :key="feet" :value="feet">{{ feet ? `${feet} фут.` : 'у земли' }}</option>
        </select>
      </label>
      <button v-if="creature && canEdit && target.canClimb && !target.conditions.includes('flying') && !target.conditions.includes('climbing')" type="button" role="menuitem" :disabled="busy" title="Встаньте вплотную к стене или преграде: поднимитесь на 10 футов, высоту можно сменить" @click="emit('climb', true)">
        <GameIcon name="pickaxe" :size="16" />Залезть на стену
      </button>
      <label v-if="creature && canEdit && target.conditions.includes('climbing')" class="height-row" title="Сбитый с ног или лишённый движения падает с этой высоты: 1к6 за 10 футов">
        <GameIcon name="pickaxe" :size="16" />На стене
        <select :value="target.flightHeight ?? 0" :disabled="busy" aria-label="Высота на стене" @change="emit('climb', true, Number(($event.target as HTMLSelectElement).value))">
          <option v-for="feet in FLIGHT_HEIGHTS" :key="feet" :value="feet">{{ feet ? `${feet} фут.` : 'спуститься' }}</option>
        </select>
      </label>
      <button v-if="creature && canEdit && !target.inCombat" type="button" role="menuitem" :disabled="busy" @click="emit('combat', true)"><GameIcon name="initiative" :size="16" />В бой — бросить инициативу</button>
      <button v-if="creature && canManage && target.inCombat" type="button" role="menuitem" :disabled="busy" @click="emit('combat', false)"><GameIcon name="leaveCombat" :size="16" />Убрать из боя</button>
      <button v-else-if="creature && canEdit && target.inCombat" type="button" role="menuitem" :disabled="busy" @click="emit('combat', false)"><GameIcon name="run" :size="16" />Выйти из боя</button>
      <button v-if="canManage && creature" type="button" role="menuitem" :aria-expanded="submenu === 'factions'" @click="submenu = submenu === 'factions' ? null : 'factions'">
        <GameIcon name="faction" :size="16" />Фракции<small v-if="memberOf.length">{{ memberOf.length }}</small><span class="more">›</span>
      </button>
      <div v-if="canManage && target.kind === 'npc'" class="disposition" role="group" aria-label="Отношение">
        <button
          v-for="[value, label] in ([['hostile', 'Враг'], ['neutral', 'Нейтрал'], ['friendly', 'Союзник']] as const)" :key="value" type="button"
          :aria-pressed="(target.disposition ?? 'neutral') === value" :disabled="busy" @click="emit('disposition', value)"
        >{{ label }}</button>
      </div>
      <button type="button" role="menuitem" :title="canManage ? 'Что узнает герой при осмотре — и настройка проверки' : 'Проверка навыка: что удастся узнать'" @click="emit('examine'); emit('close')"><GameIcon name="examine" :size="16" />Осмотреть</button>
      <button type="button" role="menuitem" @click="act('sheet')"><GameIcon name="sheet" :size="16" />Открыть лист</button>
      <button v-if="target.merchant" type="button" role="menuitem" @click="emit('shop'); emit('close')"><GameIcon name="bag" :size="16" />{{ canManage ? 'Лавка: товары и цены' : 'Лавка' }}</button>
      <button type="button" role="menuitem" @click="act('focus')"><GameIcon name="crosshair" :size="16" />Выбрать и показать</button>
      <button type="button" role="menuitem" :disabled="busy" title="Указка на фигуре — видят все" @click="emit('ping'); emit('close')"><GameIcon name="ping" :size="16" />Указать всем</button>
      <button v-if="canManage" type="button" role="menuitem" :disabled="busy" @click="act('hide')"><GameIcon name="eye" :size="16" />{{ target.hidden ? 'Показать игрокам' : 'Скрыть от игроков' }}</button>
      <button v-if="canEdit" type="button" role="menuitem" class="danger" :disabled="busy" @click="act('remove')"><GameIcon name="trash" :size="16" />Убрать со сцены<kbd>Del</kbd></button>
      </div>
    </div>

    <div v-if="submenu === 'hp'" class="sub g-frame" :class="{ 'sub-left': subLeft }" :style="{ translate: `0 ${subShift}px`, '--sub-top': `${subTop}px` }">
      <b>Урон или лечение<template v-if="target.hpText"> · {{ target.hpText }}</template></b>
      <div class="chips" role="group" aria-label="Сколько">
        <button v-for="value in [1, 2, 5, 10, 20]" :key="value" type="button" :aria-pressed="amount === value" @click="amount = value">{{ value }}</button>
      </div>
      <div class="hp-row">
        <input v-model.number="amount" type="number" min="1" max="999" aria-label="Сколько хитов" @keydown.enter="hp('damage')" />
        <button type="button" class="primary" :disabled="busy || !(amount > 0)" @click="hp('damage')">Урон</button>
        <button type="button" :disabled="busy || !(amount > 0)" @click="hp('heal')">Лечение</button>
      </div>
      <div class="hp-row">
        <button type="button" :disabled="busy || !(amount > 0)" title="Временные хиты — не складываются, берётся большее" @click="hp('temp')">Временные {{ amount > 0 ? amount : '' }}</button>
        <button v-if="target.hp" type="button" :disabled="busy || missing === 0" @click="hp('heal', missing)">Полностью{{ missing ? ` (+${missing})` : '' }}</button>
      </div>
      <div v-if="creature" class="hp-row" role="group" aria-label="Падение">
        <span class="row-name">Падение</span>
        <select v-model.number="fallFeet" :disabled="busy" aria-label="С какой высоты">
          <option v-for="feet in FALL_HEIGHTS" :key="feet" :value="feet">{{ feet }} фут.</option>
        </select>
        <button type="button" :disabled="busy" title="1к6 дробящего за каждые 10 футов, урон прошёл — ничком; «Медленное падение» монаха — само" @click="emit('fall', fallFeet)">Упал ({{ Math.min(20, fallFeet / 10) }}к6)</button>
      </div>
      <small>С сопротивлениями и временными хитами — как кнопка «Урон» в журнале. Окно не закрывается — можно ещё.</small>
    </div>
    <div v-else-if="submenu === 'save'" class="sub g-frame" :class="{ 'sub-left': subLeft }" :style="{ translate: `0 ${subShift}px`, '--sub-top': `${subTop}px` }">
      <b>Спасбросок — {{ target.name }}</b>
      <div class="chips" role="group" aria-label="Преимущество">
        <button v-for="[value, label] in ([['none', 'Обычно'], ['adv', 'С преимуществом'], ['disadv', 'С помехой']] as const)" :key="value" type="button" :aria-pressed="advantage === value" @click="advantage = value">{{ label }}</button>
      </div>
      <div class="save-grid">
        <button v-for="[key, label] in ABILITIES" :key="key" type="button" :disabled="busy" @click="emit('save', { ability: key, advantage })"><GameIcon v-if="abilityIcon(key)" class="inline-icon" :name="abilityIcon(key)!" :size="14" /> {{ label }}</button>
      </div>
      <small>По листу и состояниям цели (автопровал, помеха) — в журнал от её имени.</small>
    </div>
    <div v-else-if="submenu === 'transform'" class="sub g-frame" :class="{ 'sub-left': subLeft }" :style="{ translate: `0 ${subShift}px`, '--sub-top': `${subTop}px` }">
      <b>{{ target.name }}</b>
      <div class="hp-row" role="group" aria-label="Повернуть">
        <span class="row-name">Повернуть</span>
        <button type="button" :disabled="busy" title="На 45° против часовой" @click="rotate(-45)">⟲ 45°</button>
        <button type="button" :disabled="busy" title="На 45° по часовой" @click="rotate(45)">⟳ 45°</button>
        <button type="button" :disabled="busy" title="На 90°" @click="rotate(90)">90°</button>
      </div>
      <div class="hp-row" role="group" aria-label="Размер">
        <span class="row-name">Размер</span>
        <button type="button" :disabled="busy" title="Меньше" @click="scale(0.8)">−</button>
        <button type="button" :disabled="busy" title="Больше" @click="scale(1.25)">+</button>
        <button type="button" :disabled="busy" title="Вернуть исходный размер" @click="scale(0)">1:1</button>
      </div>
      <div v-if="canDuplicate" class="hp-row" role="group" aria-label="Размножить">
        <span class="row-name">Копии</span>
        <input v-model.number="copies" type="number" min="1" max="20" aria-label="Сколько копий" @keydown.enter="duplicate" />
        <button type="button" class="primary" :disabled="busy || !(copies >= 1)" @click="duplicate">Размножить</button>
      </div>
      <small>Размер — только вид фигуры; клетки, которые она занимает, задаёт размер существа в листе. Копии встают рядом.</small>
    </div>
    <div v-else-if="submenu === 'xp'" class="sub g-frame" :class="{ 'sub-left': subLeft }" :style="{ translate: `0 ${subShift}px`, '--sub-top': `${subTop}px` }">
      <b>Опыт — {{ target.name }}</b>
      <small v-if="target.experience != null">Сейчас {{ target.experience }}<template v-if="target.nextExperience != null"> · {{ (target.level ?? 1) + 1 }}-й уровень с {{ target.nextExperience }}</template></small>
      <div class="chips" role="group" aria-label="Сколько опыта">
        <button v-for="value in XP_STEPS" :key="value" type="button" :aria-pressed="xpAmount === value" @click="xpAmount = value">{{ value }}</button>
      </div>
      <div class="hp-row">
        <input v-model.number="xpAmount" type="number" min="1" max="1000000" aria-label="Сколько опыта" @keydown.enter="giveXp(1)" />
        <button type="button" class="primary" :disabled="busy || !(xpAmount >= 1)" @click="giveXp(1)">Дать</button>
        <button type="button" :disabled="busy || !(xpAmount >= 1) || target.experience === 0" @click="giveXp(-1)">Отнять</button>
      </div>
      <small>Отнять — только число опыта, не ниже нуля: уровень остаётся. Понизить уровень — отдельный пункт меню.</small>
    </div>
    <div v-else-if="submenu === 'revive'" class="sub g-frame" :class="{ 'sub-left': subLeft }" :style="{ translate: `0 ${subShift}px`, '--sub-top': `${subTop}px` }">
      <b>Воскресить — {{ target.name }}</b>
      <div class="chips" role="group" aria-label="С какими хитами">
        <button
          v-for="[value, label] in ([['one', '1 хит'], ['half', 'Половина хитов'], ['full', 'Все хиты']] as const)" :key="value" type="button"
          :aria-pressed="reviveHp === value" @click="reviveHp = value"
        >{{ label }}</button>
      </div>
      <label class="check-row"><input v-model="reviveExhaustion" type="checkbox" /> Снять истощение</label>
      <label class="check-row"><input v-model="reviveConditions" type="checkbox" /> Снять все состояния</label>
      <div class="hp-row">
        <button type="button" class="primary" :disabled="busy" @click="revive">Воскресить</button>
      </div>
      <small>Спасброски от смерти обнуляются. Окно не закрывается — видно, что стало.</small>
    </div>
    <div v-else-if="submenu === 'factions'" class="sub g-frame" :class="{ 'sub-left': subLeft }" :style="{ translate: `0 ${subShift}px`, '--sub-top': `${subTop}px` }">
      <b>Фракции — {{ target.name }}</b>
      <div class="faction-list" role="group" aria-label="Фракции">
        <button
          v-for="faction in factionList ?? []" :key="faction.id" type="button" :aria-pressed="memberOf.includes(faction.id)" :disabled="busy"
          @click="toggleFaction(faction.id)"
        ><span class="faction-dot" :style="{ background: faction.color }" />{{ faction.name }}<span v-if="memberOf.includes(faction.id)" class="more"><GameIcon name="check" :size="14" /></span></button>
      </div>
      <div class="hp-row">
        <button type="button" :disabled="busy" title="Снова по виду и отношению: персонаж и союзный НПС — «Отряд», враждебный — «Враги»" @click="emit('factions', null)">По умолчанию</button>
        <button type="button" :disabled="busy" @click="emit('manageFactions')">Настроить фракции…</button>
      </div>
      <small>Существо бывает в нескольких фракциях: общая — союзники, иначе — по отношениям фракций. Цвет фигуры, групповой ход, опыт и «не по своим» — по ним.</small>
    </div>
    <div v-else-if="submenu === 'conditions'" class="sub g-frame conditions" :class="{ 'sub-left': subLeft }" :style="{ translate: `0 ${subShift}px`, '--sub-top': `${subTop}px` }">
      <b>Состояние — {{ target.name }}</b>
      <div class="chips" role="group" aria-label="Срок">
        <button v-for="[value, label] in DURATIONS" :key="label" type="button" :aria-pressed="duration === value" @click="duration = value">{{ label }}</button>
      </div>
      <small>Щелчок по наложенному (◆) — снять; окно остаётся открытым — накладывайте сколько нужно.<template v-if="actorName && canAttack">{{ ` «Схвачен», «Испуган», «Очарован» — кем: ${actorName}. Схвативший тащит схваченного за собой (движение вдвое дороже); испуганный не подходит к нему, пока видит.` }}</template></small>
      <div v-if="kinds.length > 1" class="chips" role="group" aria-label="Вид">
        <button v-for="[kind, label] in kinds" :key="kind" type="button" :aria-pressed="conditionKind === kind" @click="conditionKind = kind">{{ label }}</button>
      </div>
      <div class="condition-grid">
        <button
          v-for="entry in shownConditions" :key="entry.code" type="button" :title="entry.rule" :disabled="busy"
          :aria-pressed="target.conditions.includes(entry.code)" @click="condition(entry.code)"
        ><ConditionIcon class="inline-icon" :name="entry.icon" :image="entry.image" :size="18" />{{ entry.label }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.token-menu{position:fixed;z-index:2600}
.menu-box{width:280px;display:flex;flex-direction:column;gap:2px;padding:6px;max-height:calc(100vh / var(--ui-zoom, 1) - 16px)}
.menu-scroll{display:flex;flex-direction:column;gap:2px;min-height:0;overflow-y:auto;scrollbar-width:thin}
.menu-head{display:flex;flex-direction:column;gap:1px;padding:6px 10px 8px;box-shadow:inset 0 -1px 0 var(--g-gold-lo)}
.menu-head b{font:600 16px var(--g-title-font);color:var(--g-gold-hi)}
.menu-head small{font-size:12px;opacity:.8}
.menu-box button{display:flex;align-items:center;gap:10px;min-height:36px;padding:4px 10px;text-align:left;justify-content:flex-start;background:transparent;box-shadow:none;font-size:14px}
.menu-box button:hover:not(:disabled),.menu-box button[aria-expanded="true"]{background:#ffffff12;box-shadow:inset 0 0 0 1px var(--g-gold-lo)}
.menu-box button small{opacity:.7;font-size:12px}
.menu-box .more{margin-left:auto}
.menu-box kbd{margin-left:auto;font:11px Consolas,monospace;opacity:.7}
.menu-box .danger{color:#ff9c8c}
.menu-sep{height:1px;margin:4px 6px;background:var(--g-gold-lo)}
.head-conditions{display:flex;flex-wrap:wrap;gap:3px;margin-top:4px}
.menu-box .head-conditions .chip{min-height:22px;padding:0 7px;font-size:11px;border-radius:11px;gap:3px;background:#0004;box-shadow:inset 0 0 0 1px var(--g-gold-lo)}
.notice-line{margin-top:4px;color:var(--g-gold-hi);opacity:1 !important}
.disposition{display:flex;gap:3px;padding:2px 6px}
.menu-box .disposition button{flex:1;justify-content:center;min-height:30px;padding:2px 4px;font-size:12px;box-shadow:inset 0 0 0 1px var(--g-gold-lo)}
.menu-box .disposition button[aria-pressed="true"]{color:var(--g-gold-hi);box-shadow:inset 0 0 0 1px var(--g-gold-hi);background:#ffffff10}
.height-row{display:flex;align-items:center;gap:10px;min-height:34px;padding:2px 10px;font-size:14px}
.height-row select{margin-left:auto;min-height:28px}
.faction-list{display:flex;flex-direction:column;gap:2px}
.faction-list button{display:flex;align-items:center;gap:8px;min-height:30px;padding:2px 8px;justify-content:flex-start;font-size:13px}
.faction-list button[aria-pressed="true"]{color:var(--g-gold-hi);box-shadow:inset 0 0 0 1px var(--g-gold-hi)}
.faction-list .more{margin-left:auto}
.faction-dot{width:10px;height:10px;border-radius:50%;flex:none}
.chips{display:flex;flex-wrap:wrap;gap:4px}
.chips button{min-height:28px;padding:2px 9px;font-size:12px}
.chips button[aria-pressed="true"]{color:var(--g-gold-hi);box-shadow:inset 0 0 0 1px var(--g-gold-hi)}
.save-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px}
.check-row{display:flex;align-items:center;gap:8px;margin:0;font-size:13px}
.save-grid button{min-height:34px;font-weight:600}
.sub{position:absolute;left:calc(100% + 8px);top:var(--sub-top,40px);width:290px;display:flex;flex-direction:column;gap:6px;padding:10px 12px}
.sub.sub-left{left:auto;right:calc(100% + 8px)}
.sub b{color:var(--g-gold);font-size:14px}
.sub small{font-size:12px;opacity:1;line-height:1.45;color:var(--g-text-dim,#ab9a7b)}
.hp-row{display:flex;gap:6px}
.hp-row input{width:70px;min-height:34px}
.row-name{flex:0 0 72px;align-self:center;font-size:12px;opacity:.85}
.hp-row button{min-height:34px;padding:2px 12px}
.condition-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:4px;max-height:300px;overflow-y:auto}
.condition-grid button{display:flex;align-items:center;gap:6px;min-height:30px;padding:2px 8px;font-size:12px;justify-content:flex-start;text-align:left}
.condition-grid button[aria-pressed="true"]{color:var(--g-gold-hi);box-shadow:inset 0 0 0 1px var(--g-gold-hi)}
</style>
