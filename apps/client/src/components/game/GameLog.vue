<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { normalizeFormula } from '../../rules/dice';
import { parseChatInput } from '../../campaign/chat';
import { chatHeight, resetChatHeight, setChatHeight } from '../../tabletop/layout/chatHeight';
import { DAMAGE_TYPES } from '../../rules/objectRules';
import { cssZoom } from '../../settings/uiScale';
import GameIcon from './GameIcon.vue';
import type { GameLogEvents, GameLogProps } from '../../gameLog/types';
import { useLogLines } from '../../gameLog/lines';
import { useApplyRoll } from '../../gameLog/applyRoll';

const props = defineProps<GameLogProps>();

const emit = defineEmits<GameLogEvents>();

const inCharacter = ref(false);
const whisperTo = ref('');

const DETAILS_KEY = 'ttrpg.log.details';
const details = ref((() => { try { return localStorage.getItem(DETAILS_KEY) === '1'; } catch { return false; } })());
watch(details, value => { try { localStorage.setItem(DETAILS_KEY, value ? '1' : '0'); } catch {  } });
const expanded = ref(new Set<string>());
function toggleLine(id: string) {
  const next = new Set(expanded.value);
  if (!next.delete(id)) next.add(id);
  expanded.value = next;
}
const open = (id: string) => details.value || expanded.value.has(id);
const modesOpen = ref(false);
const modesRoot = ref<HTMLElement | null>(null);
const modesButton = ref<HTMLButtonElement | null>(null);
function closeModes() {
  if (!modesOpen.value) return;
  modesOpen.value = false;
  modesButton.value?.focus();
}
function onModesOutside(event: PointerEvent) {
  if (modesOpen.value && modesRoot.value && !modesRoot.value.contains(event.target as Node)) modesOpen.value = false;
}
onMounted(() => document.addEventListener('pointerdown', onModesOutside, true));
onBeforeUnmount(() => document.removeEventListener('pointerdown', onModesOutside, true));
const activeModes = computed(() => Number(inCharacter.value && Boolean(props.speaker)) + Number(Boolean(whisperTo.value)) + Number(hidden.value && props.canHide));
const whisperName = computed(() => (props.members ?? []).find(member => member.userId === whisperTo.value)?.displayName ?? '');
watch(() => props.members, members => { if (whisperTo.value && !(members ?? []).some(member => member.userId === whisperTo.value)) whisperTo.value = ''; });

const formula = ref('');
const hidden = ref(false);
const list = ref<HTMLElement | null>(null);

const root = ref<HTMLElement | null>(null);
const slotHeight = ref(0);
let slotObserver: ResizeObserver | null = null;
onMounted(() => {
  const parent = root.value?.parentElement;
  if (!parent || typeof ResizeObserver === 'undefined') return;
  slotObserver = new ResizeObserver(() => { slotHeight.value = parent.clientHeight; });
  slotObserver.observe(parent);
  slotHeight.value = parent.clientHeight;
});
onBeforeUnmount(() => slotObserver?.disconnect());
const raised = computed(() => props.resizable === true && chatHeight.value > slotHeight.value + 4);

const { rollLines, lines } = useLogLines({ props });
const {
  applyFor, applyTarget, applyType, applyCritical, applyRollLine, openApply, alreadyApplied, apply,
} = useApplyRoll({
  props, emit, rollLines,
});

watch(() => lines.value.at(-1)?.id, async () => {
  const box = list.value;
  const atBottom = !box || box.scrollTop + box.clientHeight >= box.scrollHeight - 24;
  await nextTick();
  if (atBottom && list.value) list.value.scrollTop = list.value.scrollHeight;
}, { immediate: true });

function submit() {
  const parsed = parseChatInput(formula.value);
  if (!parsed) return;
  if (parsed.kind === 'roll') {
    const text = normalizeFormula(parsed.formula);
    if (!text) return;
    emit('roll', { formula: text, label: '', hidden: hidden.value });
  } else {
    emit('say', {
      body: parsed.body,
      inCharacter: inCharacter.value && Boolean(props.speaker),
      ...(inCharacter.value && props.speaker ? { characterId: props.speaker.characterId } : {}),
      ...(whisperTo.value ? { toUserId: whisperTo.value } : {}),
    });
  }
  formula.value = '';
}

// clientY is in screen pixels after CSS zoom, so the delta is divided by the scale.
function startResize(event: PointerEvent) {
  if (event.button !== 0) return;
  event.preventDefault();
  const startY = event.clientY;
  const startHeight = chatHeight.value;
  const move = (moveEvent: PointerEvent) => {
    const delta = (startY - moveEvent.clientY) / cssZoom.value;
    setChatHeight(startHeight + delta);
  };
  const up = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
}
</script>

<template>
  <section ref="root" class="game-log" :class="{ resizable, fits: !raised }" aria-label="Журнал бросков">
    <button
      v-if="raised" type="button" class="log-collapse" title="Вернуть журнал в нижнюю панель" aria-label="Свернуть журнал"
      @click="resetChatHeight"
    >▾</button>
    <div
      v-if="resizable"
      class="resize-handle"
      title="Потянуть — высота журнала; двойной щелчок — сбросить"
      @pointerdown="startResize"
      @dblclick="resetChatHeight"
    />
    <ol ref="list" class="game-log-lines" aria-live="polite">
      <li v-if="!lines.length" class="empty">Журнал пуст. Бросьте кубик — результат увидят все за столом.</li>
      <template v-for="line in lines" :key="line.id">
        <li
          v-if="line.kind === 'roll'" class="roll" :class="[line.natural, { mine: line.mine, secret: line.hidden, open: open(line.id) }]"
          :title="details ? '' : open(line.id) ? 'Щелчок — свернуть' : 'Щелчок — подробности: формула, кости, кто бросал, время'"
          @click="toggleLine(line.id)"
        >
          <time v-if="open(line.id)">{{ line.time }}</time>
          <strong class="who">{{ line.who ?? line.author }}</strong>
          <span v-if="line.who && open(line.id)" class="author">({{ line.author }})</span>
          <span class="what">{{ line.label }}</span>
          <b class="total">{{ line.total }}</b>
          <small v-if="line.fullTotal !== null" class="full-total">(итог {{ line.fullTotal }})</small>
          <span v-if="line.result" class="result" :class="line.good ? 'good' : 'bad'">{{ line.result }}</span>
          <span v-if="line.hidden" class="tag-secret">тайно</span>
          <button
            v-if="applyTargets?.length" type="button" class="apply-open" :aria-expanded="applyFor === line.id"
            :title="`Урон или лечение по броску ${line.total}`" aria-label="Урон или лечение по этому броску" @click.stop="openApply(line.id)"
          ><GameIcon class="inline-icon" name="swords" :size="14" /></button>
          <button
            v-if="!details" type="button" class="line-more" :aria-expanded="open(line.id)"
            :aria-label="open(line.id) ? 'Свернуть подробности' : 'Подробности броска'" @click.stop="toggleLine(line.id)"
          >{{ open(line.id) ? '▾' : '▸' }}</button>
          <span v-if="open(line.id)" class="detail">[{{ line.formula }}: {{ line.detail }}]</span>
          <span v-if="line.reasons && open(line.id)" class="reasons">{{ line.reasons }}</span>
        </li>
        <li v-else class="chat" :class="{ mine: line.mine, whisper: Boolean(line.whisper), 'in-character': line.inCharacter }">
          <time v-if="details">{{ line.time }}</time>
          <strong class="who" translate="no">{{ line.who }}</strong>
          <span v-if="line.author" class="author" translate="no">({{ line.author }})</span>
          <span v-if="line.whisper" class="tag-whisper">{{ line.whisper }}</span>:
          <span class="said" translate="no">{{ line.inCharacter ? `«${line.body}»` : line.body }}</span>
        </li>
      </template>
    </ol>
    <div v-if="applyRollLine && applyTargets?.length" class="apply-popover g-frame" role="dialog" aria-label="Урон или лечение по броску" @keydown.esc.stop="applyFor = null">
      <header>
        <strong>{{ applyRollLine.label }}: {{ applyRollLine.total }}</strong>
        <button type="button" class="apply-close" aria-label="Закрыть" @click="applyFor = null"><GameIcon class="inline-icon" name="close" :size="16" /></button>
      </header>
      <label>
        Кому
        <select v-model="applyTarget" :disabled="busy">
          <option v-for="target in applyTargets" :key="target.id" :value="target.id">{{ target.name }}</option>
        </select>
      </label>
      <label>
        Тип урона
        <select v-model="applyType" :disabled="busy">
          <option value="">— не важен —</option>
          <option v-for="type in DAMAGE_TYPES" :key="type.id" :value="type.id">{{ type.label }}</option>
        </select>
      </label>
      <label class="apply-crit">
        <input v-model="applyCritical" type="checkbox" :disabled="busy" /> Крит (урон удвоит кости)
      </label>
      <p v-if="alreadyApplied" class="apply-note">Этот бросок уже применён к этой цели.</p>
      <div class="apply-actions">
        <button type="button" class="primary" :disabled="busy || !applyTarget || alreadyApplied" @click="apply('damage')">Урон</button>
        <button type="button" :disabled="busy || !applyTarget || alreadyApplied" @click="apply('heal')">Лечение</button>
      </div>
    </div>
    <form class="game-log-input" :class="{ 'many-modes': activeModes > 1 }" @submit.prevent="submit">
      <button v-if="inCharacter && speaker" type="button" class="mode-chip" :title="`В роли: от лица «${speaker.name}» — щелчок выключит`" @click="inCharacter = false"><GameIcon name="helm" :size="13" /><span class="chip-text">в роли</span></button>
      <button v-if="whisperTo && whisperName" type="button" class="mode-chip whisper" title="Шёпот одному участнику — щелчок: снова всем" @click="whisperTo = ''">→ <span class="chip-name" translate="no">{{ whisperName }}</span></button>
      <button v-if="hidden && canHide" type="button" class="mode-chip secret" title="Тайный бросок: увидите вы и мастер — щелчок выключит" @click="hidden = false"><GameIcon name="eye" :size="13" /><span class="chip-text">тайный бросок</span></button>
      <input
        v-model="formula" placeholder="Сообщение или бросок: 1d20+5, /r 2d6…"
        maxlength="1000" aria-label="Сообщение или формула броска" :disabled="busy"
      />
      <span ref="modesRoot" class="modes-wrap" @keydown.esc.stop="closeModes">
        <button
          ref="modesButton" type="button" class="modes-open" :class="{ active: inCharacter || hidden || Boolean(whisperTo) }" :aria-expanded="modesOpen"
          title="Режимы: в роли, кому, тайно, подробный журнал" aria-label="Режимы журнала" @click="modesOpen = !modesOpen"
        ><GameIcon name="gear" :size="15" /></button>
        <div v-if="modesOpen" class="modes-popover g-frame" role="dialog" aria-label="Режимы журнала">
          <label v-if="speaker" class="mode-row" :title="`Говорить от лица: ${speaker.name}`">
            <input v-model="inCharacter" type="checkbox" /> В роли — от лица <b translate="no">{{ speaker.name }}</b>
          </label>
          <label v-if="members?.length" class="mode-row mode-select">
            Кому
            <select v-model="whisperTo" aria-label="Кому">
              <option value="">всем за столом</option>
              <option v-for="member in members" :key="member.userId" :value="member.userId">шёпот: {{ member.displayName }}</option>
            </select>
          </label>
          <label v-if="canHide" class="mode-row" title="Скрытый бросок — увидят только вы и мастер">
            <input v-model="hidden" type="checkbox" /> Тайно — бросок увидите вы и мастер
          </label>
          <label class="mode-row" title="Время, кто бросал, формула и кости — у каждой записи">
            <input v-model="details" type="checkbox" /> Подробно: время, формулы и кости
          </label>
        </div>
      </span>
      <button type="submit" class="send" :disabled="busy || !formula.trim()" aria-label="Отправить" title="Отправить (Enter)"><span class="send-text">Отправить</span><span class="send-icon" aria-hidden="true"><GameIcon class="inline-icon" name="send" :size="16" /></span></button>
    </form>
  </section>
</template>

<style scoped>
.game-log{display:flex;flex-direction:column;min-width:0;min-height:0;height:100%;position:relative;container-type:inline-size;container-name:log}
.apply-open{display:inline-flex;align-items:center;justify-content:center;width:22px;height:18px;min-height:0;margin-left:5px;padding:0;font-size:11px;line-height:1;vertical-align:1px;border-radius:3px;opacity:.75}
.apply-open:hover,.apply-open[aria-expanded="true"]{opacity:1}
.apply-popover{position:absolute;left:6px;bottom:44px;z-index:6;display:flex;flex-direction:column;gap:6px;width:min(280px,calc(100% - 12px));padding:10px;color:var(--g-text);background:var(--g-panel,#1c130c);box-shadow:0 10px 24px #000c;font-size:12px}
.apply-popover header{display:flex;align-items:center;justify-content:space-between;gap:6px}
.apply-popover header strong{color:var(--g-gold-hi);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.apply-close{width:24px;min-width:24px;height:24px;min-height:24px;padding:0}
.apply-popover label{display:flex;flex-direction:column;gap:3px;margin:0}
.apply-popover .apply-crit{flex-direction:row;align-items:center;gap:6px}
.apply-note{margin:0;color:var(--g-text-faint)}
.apply-actions{display:flex;gap:6px}
.apply-actions button{flex:1}
.game-log.resizable{position:absolute;left:0;right:0;bottom:0;height:max(100%, v-bind('chatHeight + "px"'));box-sizing:border-box;border-radius:8px 8px 0 0}
.game-log.resizable:not(.fits){padding:10px 8px 0;margin:0 -8px;background:var(--g-stone-panel,#1d140e);box-shadow:inset 0 0 0 1px #000,0 0 0 1px var(--g-gold-lo,#8a6a35),0 -8px 20px #000a}
.log-collapse{position:absolute;top:-2px;right:8px;z-index:2;width:26px;height:20px;min-height:0;padding:0;font-size:12px;border-radius:0 0 6px 6px}
.resize-handle{flex:none;height:8px;margin:-8px 0 4px;border-radius:4px;cursor:ns-resize;touch-action:none}
.resize-handle:hover,.resize-handle:active{background:var(--g-gold-lo,#8a6a35)}
.resize-handle::after{content:"";display:block;width:36px;height:3px;margin:2.5px auto 0;border-radius:2px;background:var(--g-gold-lo,#8a6a35)}
.send-icon{display:none}
.game-log-lines{flex:1;min-height:0;overflow-y:auto;margin:0;padding:6px 10px;list-style:none;font-size:13px;line-height:1.45;background:linear-gradient(180deg,#000c,#0008);box-shadow:inset 0 0 0 1px #000,inset 0 4px 12px #000;border-radius:3px}
.game-log-lines{overflow-x:hidden}
.game-log-lines li{padding:1px 0;color:var(--g-text-dim);overflow-wrap:anywhere}
.game-log-lines li.empty{color:var(--g-text-faint);font-style:italic}
.game-log-lines time{color:var(--g-text-faint);font-size:11px;margin-right:6px}
.game-log-lines .who{color:var(--g-gold-hi);font-family:var(--g-title-font);font-weight:600}
.game-log-lines li.mine .who{color:#9fd8a6}
.game-log-lines .author{color:var(--g-text-faint);margin-left:3px}
.game-log-lines .what{margin:0 4px;color:var(--g-text)}
.game-log-lines .total{color:#fff2cf;font-size:14px}
.game-log-lines .detail{margin-left:6px;color:var(--g-text-dim);font-size:12px}
.game-log-lines li.crit .total{color:#7ee08a;text-shadow:0 0 6px #4dbb5c}
.game-log-lines li.fumble .total{color:#ff8a7a;text-shadow:0 0 6px #c4433a}
.game-log-lines li.crit .total,.game-log-lines li.fumble .total{padding:0 6px;border:1px solid currentColor;border-radius:3px;letter-spacing:.03em;white-space:nowrap}
.game-log-lines li.crit{background:linear-gradient(90deg,#4dbb5c22,transparent 70%)}
.game-log-lines li.fumble{background:linear-gradient(90deg,#c4433a22,transparent 70%)}
.game-log-lines .full-total{opacity:.75;font-size:.85em}
.game-log-lines li.secret{opacity:.8}
.tag-secret{margin-left:6px;font-size:11px;color:#c8b0ff}
.result{margin-left:6px;font:600 12px var(--g-body-font)}
.game-log-lines li:is(.roll,.chat):last-child{animation:log-in .3s ease-out}
@keyframes log-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.result.good{color:#8fe09a}.result.bad{color:#ff9c8c}
.reasons{display:block;margin-left:44px;font-size:11px;color:var(--g-text-faint);font-style:italic}
.game-log-input{position:relative;display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:6px;color:var(--g-gold)}
.game-log-input > input{flex:1 1 140px;min-width:0;min-height:30px !important;padding:3px 8px !important;font-size:13px}
.game-log-input{flex-wrap:nowrap}
.mode-chip{display:inline-flex;align-items:center;gap:3px;flex:0 1 auto;min-width:24px;min-height:24px !important;height:24px;padding:0 7px !important;border-radius:12px;font-size:11px !important;color:var(--g-gold-hi);background:#0008;box-shadow:inset 0 0 0 1px var(--g-gold-lo);white-space:nowrap;max-width:110px;overflow:hidden;text-overflow:ellipsis}
.mode-chip.whisper{color:#d9c8ff;box-shadow:inset 0 0 0 1px #8a72c8}
.mode-chip .chip-name,.mode-chip .chip-text{min-width:0;overflow:hidden;text-overflow:ellipsis}
.mode-chip .chip-name{max-width:72px}
.game-log-input.many-modes .mode-chip .chip-text{display:none}
.game-log-input.many-modes .mode-chip{padding:0 5px !important}
.game-log-input.many-modes .mode-chip .chip-name{max-width:44px}
.game-log-input > input{min-width:96px}
.line-more{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;min-height:0 !important;margin-left:4px;padding:0 !important;font-size:10px;line-height:1;vertical-align:1px;border-radius:3px;opacity:.6;background:transparent;box-shadow:none}
.line-more:hover,.line-more:focus-visible,.line-more[aria-expanded="true"]{opacity:1}
.game-log-lines li.roll .what::before{content:'·';margin-right:5px;color:var(--g-text-faint)}
.mode-chip.secret{color:#c8b0ff;box-shadow:inset 0 0 0 1px #7a62b8}
.modes-wrap{position:relative;flex:none;display:flex}
.modes-open{display:grid;place-items:center;width:30px;padding:0 !important}
.modes-open.active{color:var(--g-gold-hi);box-shadow:inset 0 0 0 1px var(--g-gold-hi)}
.modes-popover{position:absolute;right:-40px;bottom:calc(100% + 8px);z-index:20;display:flex;flex-direction:column;gap:6px;width:260px;padding:10px 12px;color:var(--g-text);background:var(--g-panel,#1c130c);box-shadow:0 10px 24px #000c;font-size:12px}
.mode-row{display:flex;align-items:center;gap:6px;margin:0;line-height:1.3;cursor:pointer}
.mode-row input{flex:none;width:16px;height:16px}
.mode-row b{color:var(--g-gold-hi);font-weight:600}
.mode-select{flex-direction:column;align-items:stretch;gap:3px;cursor:default}
.mode-select select{min-height:28px;padding:2px 6px;font-size:12px}
.game-log-lines li.roll{cursor:pointer;border-radius:3px}
.game-log-lines li.roll:hover{background-color:#ffffff0a}
.game-log-lines li.roll .what::after{content:':'}
.game-log-lines{min-height:calc(2 * 1.45em + 12px)}
.game-log-input button{min-height:30px;padding:2px 10px;font-size:13px}
.game-log-lines li.chat .said{color:var(--g-text)}
.game-log-lines li.chat.in-character .said{font-style:italic;color:#f3e3b8}
.game-log-lines li.chat.whisper .said{color:#d9c8ff}
.tag-whisper{margin-left:4px;font-size:11px;color:#c8b0ff}
@container log (max-width: 380px){
  .send-text{display:none}
  .send-icon{display:inline}
  .game-log-input > input{flex-basis:120px}
  .mode-chip{max-width:72px}
  .game-log-input{gap:4px;margin-top:4px}
  .game-log-input .send{padding:2px 8px}
}
</style>
