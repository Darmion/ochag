<script setup lang="ts">
import { useEscapeClose } from '../../ui/escapeStack';
import UiModeSettings from './UiModeSettings.vue';
import CursorSettings from './CursorSettings.vue';
import { GRID_MODES, gridPrefs } from '../../settings/gridSettings';
import GridLookFields from './GridLookFields.vue';
import { ALT_MODES, altMode, CAMERA_SCHEMES, cameraScheme } from '../../settings/cameraControls';
import { BODY_FONTS, bodyFont, TEXT_SIZES, textSize } from '../../settings/textSettings';
import { tableViewPrefs } from '../../settings/tablePrefs';
import { GAME_BOARD_COLORS, gameSkin } from '../../settings/uiMode';
import { availableLocales, baseName, coverage, loadUserLocales, locale, localeErrors, openLocalesFolder, problemText, saveTemplate, t } from '../../i18n/i18n';
import { computed, ref } from 'vue';
import GameIcon from '../game/GameIcon.vue';

const props = defineProps<{ uiScale: number; canOpenSounds?: boolean; request?: (path: string, method?: string) => Promise<any> }>();
const emit = defineEmits<{
  'update:uiScale': [number];
  sounds: [];
  close: [];
}>();
useEscapeClose(() => emit('close'));

const gridThemeColor = computed(() => GAME_BOARD_COLORS[gameSkin.value].grid);
const schemeHint = computed(() => CAMERA_SCHEMES.find(entry => entry.id === cameraScheme.value)?.hint ?? '');

const hasDesktopLocales = typeof window !== 'undefined' && Boolean(window.desktop?.locales);
const templatePath = ref('');
const localeBusy = ref(false);
async function onSaveTemplate() {
  localeBusy.value = true;
  try {
    templatePath.value = (await saveTemplate()) ?? '';
  } finally {
    localeBusy.value = false;
  }
}
async function onReloadLocales() {
  localeBusy.value = true;
  try {
    await loadUserLocales();
  } finally {
    localeBusy.value = false;
  }
}

function onScaleInput(event: Event) {
  emit('update:uiScale', Number((event.target as HTMLInputElement).value));
}
</script>

<template>
  <div class="modal-overlay" role="dialog" aria-modal="true" :aria-label="t('Настройки')" @click.self="emit('close')">
    <div class="modal-card">
      <header class="modal-header">
        <h3>{{ t('Настройки') }}</h3>
        <button type="button" class="modal-close" :aria-label="t('Закрыть')" @click="emit('close')"><GameIcon class="inline-icon" name="close" :size="16" /></button>
      </header>

      <section class="modal-section">
        <h4>{{ t('Язык') }}{{ t('Язык') === 'Language' ? '' : ' · Language' }}</h4>
        <label>
          {{ t('Язык интерфейса') }}
          <select v-model="locale">
            <option v-for="entry in availableLocales" :key="entry.code" :value="entry.code">
              {{ entry.name }}{{ entry.kind === 'source' ? '' : ` — ${Math.round(coverage(entry.code) * 100)} %` }}{{ entry.kind === 'user' ? ` (${entry.file}${baseName(entry.code) ? `, ${t('остальное — {base}', { base: baseName(entry.code)! })}` : ''})` : '' }}
            </option>
          </select>
        </label>
        <small class="muted">{{ t('Перевод идёт по частям: что ещё не переведено, остаётся по-русски. Свой язык — файл JSON в папке языков: возьмите шаблон, переведите и нажмите «Обновить список».') }}</small>
        <div v-if="hasDesktopLocales" class="locale-buttons">
          <button type="button" :disabled="localeBusy" @click="openLocalesFolder()">{{ t('Открыть папку языков') }}</button>
          <button type="button" :disabled="localeBusy" :title="t('Все строки интерфейса: ключ — русский текст, значение — английский образец')" @click="onSaveTemplate()">{{ t('Сохранить шаблон для перевода') }}</button>
          <button type="button" :disabled="localeBusy" @click="onReloadLocales()">{{ t('Обновить список') }}</button>
        </div>
        <small v-if="templatePath" class="muted">{{ t('Шаблон сохранён: {path}', { path: templatePath }) }}</small>
        <ul v-if="localeErrors.length" class="locale-errors">
          <li v-for="entry in localeErrors" :key="entry.file">{{ entry.file }}: {{ entry.error }}</li>
        </ul>
        <ul v-if="availableLocales.some(entry => entry.problems?.length)" class="locale-errors">
          <template v-for="entry in availableLocales" :key="entry.code">
            <li v-for="(problem, index) in entry.problems ?? []" :key="index">{{ entry.file }}: {{ problemText(problem) }}</li>
          </template>
        </ul>
      </section>

      <section class="modal-section">
        <label>
          {{ t('Масштаб интерфейса: {scale}%', { scale: props.uiScale }) }}
          <input type="range" min="80" max="160" step="10" :value="props.uiScale" @input="onScaleInput" />
        </label>
        <label class="checkbox-label">
          <input v-model="tableViewPrefs.showHpBars" type="checkbox" />
          {{ t('Показывать полоски хитов над объектами (видны те хиты, что открыты вам)') }}
        </label>
        <label class="checkbox-label">
          <input v-model="tableViewPrefs.followTurn" type="checkbox" />
          {{ t('Камера сама переходит к тому, чей ход (если он виден вам на карте)') }}
        </label>
        <label class="checkbox-label">
          <input v-model="tableViewPrefs.selectTurn" type="checkbox" />
          {{ t('В бою сам выбирается тот, чей ход, — если им можете действовать вы (как щелчок по фигуре)') }}
        </label>
        <label class="checkbox-label">
          <input v-model="tableViewPrefs.showGizmo" type="checkbox" />
          {{ t('Стрелки перемещения, поворота и масштаба у выбранного объекта (объект и так перетаскивается мышью)') }}
        </label>
        <label class="checkbox-label">
          <input v-model="tableViewPrefs.showMoveFilter" type="checkbox" />
          {{ t('Пока тащу существо — клетки, куда хватит скорости за ход, зелёные, остальные красные') }}
        </label>
        <label class="checkbox-label">
          <input v-model="tableViewPrefs.showWeather" type="checkbox" />
          {{ t('Погода на карте: дождь, снег, туман (правила погоды действуют и без этого)') }}
        </label>
      </section>

      <section class="modal-section">
        <h4>{{ t('Текст') }}</h4>
        <div class="text-row">
          <label>
            {{ t('Шрифт') }}
            <select v-model="bodyFont">
              <option v-for="entry in BODY_FONTS" :key="entry.id" :value="entry.id">{{ t(entry.label) }}</option>
            </select>
          </label>
          <label>
            {{ t('Размер') }}
            <select v-model.number="textSize">
              <option v-for="size in TEXT_SIZES" :key="size" :value="size">{{ size === 100 ? t('100 % (по умолчанию)') : `${size} %` }}</option>
            </select>
          </label>
        </div>
        <p class="text-sample">{{ t('Так выглядит текст: «Гоблин атакует — 14 против КД 15, промах».') }}</p>
        <small class="muted">{{ t('Меняет основной текст: листы, журнал, кнопки, окна, подписи на карте. Заголовки — своими шрифтами. Масштаб всего интерфейса — выше.') }}</small>
      </section>

      <section class="modal-section">
        <CursorSettings />
      </section>

      <section class="modal-section">
        <h4>{{ t('Камера и мышь') }}</h4>
        <label>
          {{ t('Управление камерой') }}
          <select v-model="cameraScheme">
            <option v-for="entry in CAMERA_SCHEMES" :key="entry.id" :value="entry.id">{{ t(entry.label) }}</option>
          </select>
        </label>
        <small class="muted">{{ t(schemeHint) }}. {{ t('Колесо — приблизить и отдалить.') }}</small>
        <label>
          {{ t('Зажатый Alt') }}
          <select v-model="altMode">
            <option v-for="entry in ALT_MODES" :key="entry.id" :value="entry.id">{{ t(entry.label) }}</option>
          </select>
        </label>
        <small class="muted">{{ t('Лента — левая полоса инструментов: свёрнутая до значков, пока держите Alt, она с подписями. Вращать левой — для мыши без средней кнопки и тачпада') }}{{ cameraScheme === 'classic' ? t(' (в схеме «Вращение левой кнопкой» левая и так вращает)') : '' }}.</small>
      </section>

      <section class="modal-section">
        <h4>{{ t('Сетка стола — у меня') }}</h4>
        <label>
          {{ t('Сетка на этом компьютере') }}
          <select v-model="gridPrefs.mode">
            <option v-for="entry in GRID_MODES" :key="entry.id" :value="entry.id">{{ t(entry.label) }}</option>
          </select>
        </label>
        <GridLookFields v-if="gridPrefs.mode === 'custom'" v-model="gridPrefs.custom" :theme-color="gridThemeColor" />
        <small v-else-if="gridPrefs.mode === 'hidden'" class="muted">{{ t('Сетку не видно только у вас; остальные видят, как задал мастер.') }}</small>
        <small v-else class="muted">{{ t('Только вид линий: клетки, привязка фигур и движение не меняются. Сетку сцены для всех задаёт мастер в «Конструкторе карты».') }}</small>
      </section>

      <section class="modal-section">
        <small class="muted">{{ t('Громкость — кнопка «Звук» на левой панели стола; свой звук каждого события и фон места — в окне «Звук».') }}</small>
        <button v-if="props.canOpenSounds" type="button" class="sounds-button" @click="emit('sounds')"><GameIcon class="inline-icon" name="speaker" :size="16" /> {{ t('Настроить звуки…') }}</button>
      </section>

      <section class="modal-section">
        <UiModeSettings />
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
.modal-section .muted{font-size:13px;margin:0 0 10px}
.modal-section input[type="range"]{width:100%}
.text-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.text-sample{margin:10px 0 6px;padding:8px 10px;border:1px solid var(--brass-light);border-radius:4px}
@media(max-width:520px){.text-row{grid-template-columns:1fr}}
.locale-buttons{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 4px}
.locale-buttons button{min-height:30px;padding:2px 12px;font-size:13px}
.locale-errors{margin:6px 0 0;padding-left:18px;font-size:12px;color:var(--burgundy)}
.modal-section .sounds-button{min-height:32px;padding:4px 14px}
</style>
