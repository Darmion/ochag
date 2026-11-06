<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { RUNES, type RuneView, type RuneSymbol } from '../../../../../packages/domain/minigames/rune-lock';
import { useEscapeClose } from '../../ui/escapeStack';
import RuneImage from './RuneImage.vue';
import RuneSymbolsEditor from './RuneSymbolsEditor.vue';
import { confirmAction } from '../../ui/confirmDialog';
import GameIcon from '../game/GameIcon.vue';
const props = defineProps<{ campaignId: string; request: (path: string, method?: string, body?: unknown, file?: File) => Promise<any> }>();
const emit = defineEmits<{ close: []; back: [] }>();
useEscapeClose(() => emit('close'));
const game = ref<RuneView | null>(null), manager = ref(false), loaded = ref(false), busy = ref(false), error = ref('');
const solution = ref([0, 1, 2]), hint = ref('День уступает место ночи, а за луной просыпается звезда.'), limit = ref(6);
const symbols = ref<RuneSymbol[]>(RUNES.map(r => ({ name: r.name, assetId: null })));
const uploading = ref(false);
const editingSymbols = ref(false);
function editSymbols() { symbols.value = (game.value?.symbols ?? symbols.value).map(symbol => ({ ...symbol })); editingSymbols.value = true; }
const path = `/campaigns/${props.campaignId}/minigames/rune-lock`;
const canPlay = computed(() => !busy.value && !uploading.value && game.value?.phase === 'active');
const repeated = computed(() => game.value?.history.some(entry => entry.rings.every((r, i) => r === game.value?.rings[i])));
let timer: ReturnType<typeof setTimeout> | undefined;
let disposed = false, generation = 0;
function apply(result: { game: RuneView | null; manager: boolean }) { game.value = result.game; manager.value = result.manager; loaded.value = true; }
async function refresh() {
  const ticket = ++generation;
  try { const result = await props.request(path); if (!disposed && ticket === generation) apply(result); }
  catch (cause) { if (!disposed && ticket === generation) error.value = cause instanceof Error ? cause.message : 'Нет связи с сервером.'; }
}
async function poll() { if (!busy.value && !document.hidden) await refresh(); if (!disposed) timer = setTimeout(poll, 2000); }
async function act(action: string, extra: Record<string, unknown> = {}) {
  if (busy.value || uploading.value || !loaded.value) return;
  const revision = game.value?.revision ?? 0;
  busy.value = true;
  try {
    if (['cancel', 'open'].includes(action) && !await confirmAction(action === 'open' ? 'Открыть замок по решению мастера?' : 'Завершить общую головоломку?', { title: 'Рунный замок', confirmLabel: action === 'open' ? 'Открыть' : 'Завершить' })) return;
    error.value = '';
    const ticket = ++generation;
    const result = await props.request(path, 'POST', { action, revision, ...extra });
    if (!disposed && ticket === generation) { apply(result); if (action === 'symbols') editingSymbols.value = false; }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось выполнить действие. Попробуйте ещё раз.'; await refresh(); }
  finally { busy.value = false; }
}
onMounted(() => void poll());
onBeforeUnmount(() => { disposed = true; generation++; clearTimeout(timer); });
</script>

<template>
  <div class="modal-overlay rune-overlay" role="dialog" aria-modal="true" aria-labelledby="rune-title">
    <div class="modal-card rune-card">
      <header><button type="button" aria-label="К списку мини-игр" @click="emit('back')">←</button><div><small>Мини-игры · древний механизм</small><h3 id="rune-title">Рунный замок</h3></div><button type="button" aria-label="Закрыть мини-игру" @click="emit('close')"><GameIcon class="inline-icon" name="close" :size="16" /></button></header>
      <div class="rune-body">
        <p v-if="error" role="alert" class="notice error">{{ error }} <button type="button" :disabled="busy" @click="refresh">Обновить</button></p>
        <p v-if="!loaded" role="status">Изучаем древние руны…</p>
        <template v-else>
          <template v-if="game && game.phase !== 'cancelled'">
            <div class="status"><strong>{{ game.phase === 'opened' ? 'Замок открыт' : game.phase === 'jammed' ? 'Замок заклинило' : 'Разгадайте печать' }}</strong><span>Проверки: {{ game.attempts }} / {{ game.limit }}</span></div>
            <blockquote>{{ game.hint || 'На механизме нет надписи. Попросите мастера описать подсказки в сцене.' }}</blockquote>
            <div class="mechanism" :class="{ opened: game.phase === 'opened' }">
              <div v-for="(rune, index) in game.rings" :key="index" class="ring">
                <small>Кольцо {{ index + 1 }}</small>
                <button type="button" :aria-label="`Предыдущая руна, кольцо ${index + 1}`" :disabled="!canPlay || game.revealed[index]" @click="act('rotate', { ring: index, step: -1 })">‹</button>
                <div class="sigil" :class="{ fixed: game.revealed[index] }"><RuneImage :asset-id="game.symbols[rune]?.assetId" :campaign-id="campaignId" :request="request"><span aria-hidden="true">{{ RUNES[rune]?.glyph }}</span></RuneImage><b>{{ game.symbols[rune]?.name }}</b></div>
                <button type="button" :aria-label="`Следующая руна, кольцо ${index + 1}`" :disabled="!canPlay || game.revealed[index]" @click="act('rotate', { ring: index, step: 1 })">›</button>
                <small>{{ game.revealed[index] ? 'Закреплено мастером' : 'Можно вращать' }}</small>
              </div>
            </div>
            <div class="check"><button type="button" class="primary" :disabled="!canPlay || repeated" @click="act('check')">{{ busy ? 'Подождите…' : 'Проверить комбинацию' }}</button><small>{{ repeated ? 'Эта комбинация уже есть в истории. Измените кольца.' : 'Повороты бесплатны. Проверка тратит одну попытку на весь отряд.' }}</small></div>
            <p class="event" role="status">{{ game.message }}</p>
            <ol v-if="game.history.length" class="history" aria-label="Проверенные комбинации"><li v-for="(entry, index) in game.history" :key="index"><span>{{ entry.rings.map(r => game!.symbols[r]?.name).join(' · ') }}</span><b>{{ entry.matches }} / 3</b></li></ol>
            <details v-if="manager" class="master"><summary>Панель мастера · тайная комбинация</summary><p>Решение: <b>{{ game.solution?.map(r => game!.symbols[r]?.name).join(' → ') }}</b>. Игрокам оно не передаётся.</p><p>После успешной проверки Магии или инструментов можно раскрыть кольцо. Сам бросок проведите обычным способом.</p><div class="master-actions"><button v-for="(_, index) in game.rings" :key="index" type="button" :disabled="!canPlay || game.revealed[index]" @click="act('reveal', { ring: index })">Раскрыть {{ index + 1 }}</button></div><div v-if="['active', 'jammed'].includes(game.phase)" class="master-actions"><button type="button" :disabled="busy" @click="act('open')">Открыть по решению мастера</button><button type="button" :disabled="busy" @click="act('cancel')">Завершить головоломку</button></div></details>
          </template>
          <form v-if="manager && (!game || game.phase !== 'active')" class="setup" @submit.prevent="act('create', { solution, hint, limit, symbols })">
            <h4>{{ game ? 'Новый замок' : 'Подготовить замок' }}</h4><p>Выберите решение слева направо и напишите подсказку для отряда. Символы могут повторяться.</p>
            <div class="solution"><label v-for="(_, index) in solution" :key="index">Кольцо {{ index + 1 }}<select v-model.number="solution[index]" :disabled="busy"><option v-for="(rune, n) in symbols" :key="n" :value="n">{{ rune.name }}</option></select></label></div>
            <RuneSymbolsEditor v-model="symbols" :campaign-id="campaignId" :request="request" :disabled="busy" @uploading="uploading = $event" />
            <label>Надпись-подсказка<textarea v-model="hint" maxlength="600" rows="3" :disabled="busy" /></label>
            <label>Число проверок<input v-model.number="limit" type="number" min="1" max="12" required :disabled="busy" /></label>
            <button type="submit" class="primary" :disabled="busy || uploading">Показать замок отряду</button>
          </form>
          <p v-else-if="!game || game.phase === 'cancelled'">Мастер ещё не подготовил замок. Когда он создаст головоломку, кольца появятся у всего отряда.</p>
          <div v-if="manager && game" class="appearance"><button type="button" :disabled="busy || uploading" @click="editSymbols">Изменить картинки текущего замка</button><form v-if="editingSymbols" @submit.prevent="act('symbols', { symbols })"><RuneSymbolsEditor v-model="symbols" :campaign-id="campaignId" :request="request" :disabled="busy" @uploading="uploading = $event" /><button type="submit" :disabled="busy || uploading">Сохранить символы для отряда</button><button type="button" :disabled="uploading" @click="editingSymbols = false">Отмена</button></form></div>
        </template>
        <details class="rules"><summary>Как играть — по шагам</summary><ol><li><b>Цель:</b> выставить три символа в правильном порядке слева направо. У каждого кольца шесть символов; повторы допустимы. Мастер может заменить их картинки и названия — правила останутся прежними.</li><li><b>Обсудите подсказку.</b> Замок общий для кампании: любой участник может повернуть кольцо. Договоритесь, кто выставляет комбинацию.</li><li><b>Вращайте стрелками.</b> Повороты не расходуют проверки. Закреплённое мастером кольцо уже стоит правильно и не вращается.</li><li><b>Нажмите «Проверить комбинацию».</b> Тратится одна общая проверка. Ответ «2 / 3» означает две верные позиции, но не сообщает какие. История сохраняет все проверенные варианты.</li><li><b>Три совпадения открывают замок.</b> Если последняя проверка неверна, механизм заклинит. Повторная проверка прежней комбинации запрещена и попытку не тратит.</li><li><b>При затруднении обратитесь к мастеру.</b> Он может раскрыть кольцо, открыть замок по результату обычного броска или подготовить новую загадку.</li></ol><p><b>Пример:</b> решение — Солнце → Луна → Звезда. Проверка Солнце → Лист → Звезда даст «2 / 3». Поворот среднего кольца на Луну и новая проверка откроют замок.</p><p>Таймера и автоматического урона нет. Открытие двери на карте, ловушки и награды определяет мастер. Закрытие окна не сбрасывает замок; перезапуск сервера сбрасывает.</p></details>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rune-overlay{position:fixed;inset:0;z-index:3000;display:flex;align-items:center;justify-content:center;padding:18px;background:#000a;backdrop-filter:blur(3px)}
.rune-card{width:min(700px,100%);max-height:90vh;display:flex;flex-direction:column;overflow:hidden;padding:0;background:var(--parchment-background);color:var(--ink);border:1px solid var(--brass);border-radius:12px;box-shadow:var(--g-ring),var(--g-shadow)}
header{display:flex;align-items:center;gap:12px;padding:18px;border-bottom:3px double var(--brass-light);background:var(--surface-inset)}header h3{margin:3px 0 0;font-size:24px}header>button{padding:4px 10px}header>button:last-child{margin-left:auto}small{color:var(--muted-ink);font-size:12px}.rune-body{padding:20px;overflow:auto;min-height:0}.status{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.status span{color:var(--muted-ink);font-size:13px}blockquote{margin:16px 0;padding:16px;text-align:center;border-block:1px solid var(--brass-light);font:italic 17px/1.6 var(--g-body-font,Georgia);overflow-wrap:anywhere}
.mechanism{display:flex;gap:14px;padding:22px 14px;border:1px solid var(--brass);border-radius:70px 70px 12px 12px;background:radial-gradient(ellipse,color-mix(in srgb,var(--brass) 20%,transparent),transparent 70%),var(--surface-inset)}.ring{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center}.ring>button{min-height:30px;padding:0 22px;font-size:24px;line-height:1.1}.sigil{width:100%;aspect-ratio:1;max-width:130px;border:3px double var(--brass);border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--input-bg);box-shadow:inset 0 0 20px color-mix(in srgb,var(--brass) 15%,transparent),0 4px 12px #0003}.sigil span{font:42px Georgia;color:var(--g-gold,var(--brass))}.sigil b{max-width:90%;overflow-wrap:anywhere;text-align:center;font:14px var(--g-title-font,Georgia)}.fixed,.opened .sigil{border-color:var(--g-good,var(--brass));box-shadow:0 0 16px color-mix(in srgb,var(--g-good,var(--brass)) 20%,transparent)}.check{display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;margin-top:18px}.event{padding:12px;border-left:3px solid var(--brass);background:var(--surface-inset);line-height:1.5}.history{padding-left:25px;font-size:13px}.history li{padding:6px}.history b{float:right;margin-left:10px}.master,.rules{border-top:1px solid var(--brass-light);margin-top:16px}.master p,.rules p,.rules li,.setup p{font-size:13px;line-height:1.65}.rules li{margin:8px 0}.rules ol{padding-left:22px}.master-actions{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.master-actions button{font-size:12px}.setup{padding:16px;margin-top:16px;background:var(--surface-inset);border:1px solid var(--brass-light);border-radius:8px;display:grid;gap:12px}.setup h4,.setup p{margin:0}.setup label{display:grid;gap:6px;font-size:13px}.solution{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.setup select,.setup textarea,.setup input{width:100%;min-width:0}.setup textarea{resize:vertical}.setup input{max-width:120px}@media(max-width:480px){.rune-body{padding:12px}.mechanism{gap:6px;padding:16px 8px}.sigil span{font-size:30px}.sigil b{font-size:12px}.ring small{font-size:10px}.solution{grid-template-columns:1fr}header{padding:12px}header h3{font-size:20px}}
</style>
