<script setup lang="ts">
import { useEscapeClose } from '../../ui/escapeStack';
import { computed, onBeforeUnmount, ref } from 'vue';
import { altRotates, altShowsRail, cameraScheme } from '../../settings/cameraControls';
import GameIcon from '../game/GameIcon.vue';
import {
  ACTION_LABELS, hotkeyConflict, hotkeys, labelForCode, REBINDABLE_ACTIONS, reservedFor, resetHotkeys, setHotkey, type HotkeyAction,
} from '../../settings/hotkeys';

const emit = defineEmits<{ close: [] }>();
useEscapeClose(() => emit('close'));

const GAME_KEYS: Array<[string, string]> = [
  ['1', 'Окно «Карты»: сцены, размер, стены'],
  ['2', 'Окно «Объекты»: поставить, выбрать, состояние, инвентарь'],
  ['3', 'Окно «Бой»: броски, инициатива, урон'],
  ['4', 'Окно «Журнал»: заметки мастера'],
  ['5', 'Окно «Встречи»'],
  ['6', 'Окно «Музыка»'],
  ['7', 'Окно «Ловушки» (мастер)'],
  ['8', 'Окно «Свет и обзор» (мастер)'],
  ['J', 'Журнал заданий'],
  ['K', 'Справочник: бестиарий, предметы, магия, навыки, состояния'],
  ['I', 'Лист выбранного персонажа (или своего)'],
  ['H или F', 'Скрыть весь интерфейс и смотреть на карту — и обратно'],
  ['Esc', 'Закрыть открытые окна'],
];

const FIXED_KEYS = computed<Array<[string, string]>>(() => [
  ['Ctrl + щелчок', 'Указка, не меняя инструмента'],
  [cameraScheme.value === 'tts' ? 'W A S D или стрелки' : 'W A S D', 'Камера: вперёд, влево, назад, вправо (держать)'],
  ...(altShowsRail() ? [['Зажать Alt', 'Развернуть левую ленту инструментов с подписями, пока держите'] as [string, string]] : []),
  ['Ctrl + «+» / «−» / 0', 'Масштаб интерфейса: крупнее, мельче, 100 %'],
  ['Щелчок по булавке', 'Открыть заметку'],
  ['F', 'Карта на весь экран и обратно (в игровом интерфейсе — скрыть интерфейс)'],
  ['Esc', 'Выйти из инструмента, рисования стены или полноэкранной карты'],
  ['Delete', 'Убрать выбранный объект со сцены (сам объект останется в кампании)'],
  ['Shift+щелчок', 'Добавить к выделению или убрать из него фигуру, стену, область'],
  [cameraScheme.value === 'tts' ? 'Протяжка по пустому месту' : 'Shift+протяжка', 'Выделить рамкой всё, что в ней: фигуры, стены, области'],
  ['Стрелки', `Сдвинуть выделенное на клетку (Esc — снять выделение)${cameraScheme.value === 'tts' ? '; без выделения — камера' : ''}`],
  ['Ctrl+Z', 'Отменить свою последнюю правку карты: стену, расстановку, рисунок, размер сцены'],
  ['Ctrl+Y / Ctrl+Shift+Z', 'Повторить отменённую правку'],
  ['? или F1', 'Эта справка'],
]);

const DESCRIPTIONS: Record<HotkeyAction, string> = {
  select: 'Обычный режим', measure: 'Зажать ЛКМ на клетке и вести', ping: 'Щелчок по карте показывает место всем',
  draw: 'Сохраняется со сценой', text: 'Подпись на карте', erase: 'Стереть свой рисунок или подпись',
  pin: 'Приколоть заметку к месту на карте (мастер)', template: 'Нажать в точке начала и вести — направление',
  focus: '', resetCamera: 'Вписать доску в свободное от панелей место', fullscreen: '', hudToggle: '', hotkeysHelp: '',
};

const MOUSE = computed<Array<[string, string]>>(() => [
  ['Щелчок по объекту', 'Выбрать его (персонажа, НПС или предмет)'],
  ['ЛКМ по клетке', 'Переставить выбранный объект'],
  ['Зажать ЛКМ на своём объекте', 'Тащить его; над ним видно, сколько футов пройдено'],
  ...(cameraScheme.value === 'tts'
    ? [
        ['Зажать среднюю кнопку (колесо)', 'Вращать камеру'],
        ...(altRotates() ? [['Alt + зажать ЛКМ', 'Тоже вращать камеру (мышь без средней кнопки, тачпад)'] as [string, string]] : []),
        ['Зажать ЛКМ на пустом месте', 'Рамка выделения'],
      ] as Array<[string, string]>
    : [['Зажать ЛКМ на пустом месте', 'Вращать камеру'] as [string, string]]),
  ['Зажать ПКМ', 'Сдвинуть камеру'],
  ['Колесо', 'Приблизить или отдалить'],
  ['Shift + кубик на панели', 'Скрытый бросок (видите вы и мастер)'],
]);

const listeningFor = ref<HotkeyAction | null>(null);
const rebindError = ref('');

function startListening(action: HotkeyAction) {
  rebindError.value = '';
  listeningFor.value = listeningFor.value === action ? null : action;
}

function onCapture(event: KeyboardEvent) {
  const action = listeningFor.value;
  if (!action) return;
  event.preventDefault();
  event.stopPropagation();

  if (event.code === 'Escape') {
    listeningFor.value = null;
    return;
  }
  const reserved = reservedFor(event.code);
  if (reserved) {
    rebindError.value = `«${labelForCode(event.code)}» занята: ${reserved}.`;
    return;
  }
  const conflict = hotkeyConflict(event.code, action);
  if (conflict) {
    rebindError.value = `«${labelForCode(event.code)}» уже назначена действию «${ACTION_LABELS[conflict]}» — сначала переназначьте его.`;
    return;
  }
  setHotkey(action, event.code);
  listeningFor.value = null;
  rebindError.value = '';
}

document.addEventListener('keydown', onCapture, true);
onBeforeUnmount(() => document.removeEventListener('keydown', onCapture, true));

const rebindRows = computed(() => REBINDABLE_ACTIONS.map(action => ({ action, code: hotkeys.value[action] })));
</script>

<template>
  <div class="modal-overlay" role="dialog" aria-modal="true" aria-label="Горячие клавиши стола" @click.self="emit('close')">
    <div class="modal-card">
      <header class="modal-header">
        <h3>Горячие клавиши стола</h3>
        <button type="button" class="modal-close" aria-label="Закрыть" @click="emit('close')"><GameIcon class="inline-icon" name="close" :size="16" /></button>
      </header>

      <section class="modal-section">
        <h4>Клавиатура</h4>
        <p class="muted">
          Не срабатывают, пока курсор стоит в поле ввода. Проверяются по физическому положению клавиши
          (<kbd>M</kbd> — и в русской раскладке та же клавиша, что «Ь») — переназначаются так же, по нажатию,
          а не по букве. Щёлкните по клавише ниже и нажмите новую; <kbd>Esc</kbd> отменяет.
        </p>
        <p v-if="rebindError" class="rebind-error" role="alert">{{ rebindError }}</p>
        <dl class="keys rebind-keys">
          <template v-for="row in rebindRows" :key="row.action">
            <dt>
              <button
                type="button" class="rebind-key" :class="{ listening: listeningFor === row.action }"
                :aria-pressed="listeningFor === row.action"
                :title="listeningFor === row.action ? 'Нажмите новую клавишу (Esc — отмена)' : 'Переназначить'"
                @click="startListening(row.action)"
              ><kbd>{{ listeningFor === row.action ? '…' : labelForCode(row.code) }}</kbd></button>
            </dt>
            <dd>{{ ACTION_LABELS[row.action] }}<small v-if="DESCRIPTIONS[row.action]" class="muted"> — {{ DESCRIPTIONS[row.action] }}</small></dd>
          </template>
        </dl>
        <button type="button" class="link-button" @click="resetHotkeys">Вернуть клавиши по умолчанию</button>

        <dl class="keys fixed-keys">
          <template v-for="[key, action] in FIXED_KEYS" :key="key">
            <dt><kbd>{{ key }}</kbd></dt>
            <dd>{{ action }}</dd>
          </template>
        </dl>
      </section>

      <section class="modal-section">
        <h4>Игровой интерфейс</h4>
        <dl class="keys">
          <template v-for="[key, action] in GAME_KEYS" :key="key">
            <dt><kbd>{{ key }}</kbd></dt>
            <dd>{{ action }}</dd>
          </template>
        </dl>
      </section>

      <section class="modal-section">
        <h4>Мышь</h4>
        <dl class="keys">
          <template v-for="[key, action] in MOUSE" :key="key">
            <dt>{{ key }}</dt>
            <dd>{{ action }}</dd>
          </template>
        </dl>
      </section>

      <section class="modal-section">
        <h4>Как считается линейка</h4>
        <p class="muted">
          По клеткам, в футах сцены. По умолчанию — основное правило: каждая
          клетка, в том числе по диагонали, стоит одну клетку движения. Мастер
          может включить дополнительное правило «5-10-5» (каждая вторая диагональ — две
          клетки): во вкладке «Правила» создать флаг с ключом
          <code>diagonal_5_10_5</code> и отметить «Включено». Свою линейку видят все
          участники сцены, если не снять галочку «Видят все» рядом с ней.
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay{position:fixed;inset:0;z-index:3000;background:#000a;display:flex;align-items:center;justify-content:center;padding:20px}
.modal-card{width:min(560px,100%);max-height:90vh;overflow-y:auto;padding:24px;background:var(--parchment-background);color:var(--ink);border:1px solid var(--brass);border-radius:4px;box-shadow:0 16px 40px #0008}
.modal-header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:16px}
.modal-header h3{margin:0}
.modal-close{min-height:32px;width:32px;padding:0}
.modal-section{margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--brass-light)}
.modal-section:last-child{border-bottom:0;margin-bottom:0;padding-bottom:0}
.modal-section h4{margin:0 0 8px}
.modal-section .muted{font-size:13px;margin:0 0 10px;line-height:1.5}
.keys{display:grid;grid-template-columns:max-content 1fr;gap:6px 14px;margin:0;font-size:14px}
.keys dt{font-weight:600}
.keys dd{margin:0}
.fixed-keys{margin-top:14px}
.rebind-error{margin:0 0 10px;font-size:13px;color:#b43c34;font-weight:600}
.rebind-key{min-height:auto;padding:0;background:none;border:0}
.rebind-key kbd{cursor:pointer}
.rebind-key.listening kbd{border-color:var(--gold-light);box-shadow:0 0 0 2px var(--gold-light)}
kbd{display:inline-block;min-width:1.6em;padding:1px 6px;border:1px solid var(--brass);border-bottom-width:2px;border-radius:3px;background:var(--input-bg);font:600 13px/1.4 "Segoe UI",Arial,sans-serif;text-align:center}
@media(max-width:520px){.keys{grid-template-columns:1fr}.keys dd{margin-bottom:6px}}
</style>
