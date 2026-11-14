<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useMinigameSync } from '../../minigames/minigameSync';
import type { MapFragmentsView } from '../../../../../packages/domain/minigames/map-fragments';
import { useEscapeClose } from '../../ui/escapeStack';
import { confirmAction } from '../../ui/confirmDialog';
import GameIcon from '../game/GameIcon.vue';
import { linkGroups, type LinkChoice } from '../../minigames/linkChoices';
import CheckSetup from './CheckSetup.vue';
import HeroCheck from './HeroCheck.vue';
import { CHECK_SKILLS, type CheckActor } from '../../../../../packages/domain/minigames/skill-checks';
const props = defineProps<{ campaignId: string; request: (path: string, method?: string, body?: unknown) => Promise<any> }>();
const emit = defineEmits<{ close: []; back: [] }>();
useEscapeClose(() => emit('close'));
const game = ref<MapFragmentsView | null>(null), manager = ref(false), loaded = ref(false), busy = ref(false), error = ref('');
const active = computed(() => game.value?.phase === 'active');
const story = ref(0), note = ref('');
// A secret on a scene (a hidden door, a cache) that the found route reveals to everyone.
const secrets = ref<LinkChoice[]>([]), targetId = ref('');
const secretGroups = computed(() => linkGroups(secrets.value));
// A hero who knows the region (History, Survival, Investigation) opens the GM's hint.
const checkSkill = ref(''), checkDc = ref(13), actors = ref<CheckActor[]>([]);
const checkBody = () => (checkSkill.value ? { checkSkill: checkSkill.value, checkDc: checkDc.value } : {});
const stories = ref<{ id: number; title: string; description: string }[]>([]);
const repeated = computed(() => game.value?.history.some(entry => entry.route.length === game.value!.route.length && entry.route.every((place, i) => place === game.value!.route[i])));
const path = `/campaigns/${props.campaignId}/minigames/map-fragments`;
let disposed = false, generation = 0;
function apply(result: { game: MapFragmentsView | null; manager: boolean; stories: { id: number; title: string; description: string }[]; secrets?: LinkChoice[]; actors?: CheckActor[] }) {
  stories.value = result.stories; game.value = result.game; manager.value = result.manager; loaded.value = true;
  if (result.secrets) secrets.value = result.secrets;
  if (result.actors) actors.value = result.actors;
}
async function refresh() {
  const ticket = ++generation;
  try { const result = await props.request(path); if (!disposed && ticket === generation) apply(result); }
  catch (cause) { if (!disposed && ticket === generation) error.value = cause instanceof Error ? cause.message : 'Нет связи с сервером.'; }
}
useMinigameSync('map-fragments', refresh, busy);
async function act(action: string, extra: Record<string, unknown> = {}) {
  if (busy.value || !loaded.value) return;
  const revision = game.value?.revision ?? 0; busy.value = true;
  try {
    if (['cancel', 'solve'].includes(action) && !await confirmAction(action === 'solve' ? 'Показать верный путь и завершить поиск?' : 'Завершить общий поиск маршрута?', { title: 'Карта по обрывкам', confirmLabel: action === 'solve' ? 'Показать путь' : 'Завершить' })) return;
    error.value = ''; const ticket = ++generation;
    const result = await props.request(path, 'POST', { action, revision, ...extra });
    if (!disposed && ticket === generation) { apply(result); if (action === 'note') note.value = ''; }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось выполнить действие. Попробуйте ещё раз.'; await refresh(); }
  finally { busy.value = false; }
}
onBeforeUnmount(() => { disposed = true; generation++; });
</script>
<template>
  <div class="modal-overlay map-overlay" role="dialog" aria-modal="true" aria-labelledby="fragments-title"><div class="modal-card map-card">
    <header><button class="icon-only" type="button" aria-label="К списку мини-игр" @click="emit('back')"><GameIcon name="arrowLeft" :size="16" /></button><div><small>Картографический стол · весь отряд</small><h3 id="fragments-title">Карта по обрывкам</h3></div><button class="icon-only" type="button" aria-label="Закрыть мини-игру" @click="emit('close')"><GameIcon class="inline-icon" name="close" :size="16" /></button></header>
    <main>
      <p v-if="error" role="alert">{{ error }} <button type="button" :disabled="busy" @click="refresh">Обновить</button></p>
      <p v-if="!loaded" role="status">Раскладываю обрывки…</p>
      <template v-else>
        <template v-if="game && game.phase !== 'cancelled'">
          <div class="status"><div><h4>{{ game.title }}</h4><p>{{ game.description }}</p></div><b>Проверки: {{ game.attempts }} / {{ game.limit }}</b></div>
          <div class="scraps"><article v-for="(scrap, index) in game.scraps" :key="index" :class="{ doubtful: game.doubtful.includes(index) }"><small>Обрывок {{ index + 1 }}</small><h5>{{ scrap.source }}</h5><p>{{ scrap.text }}</p><button type="button" :disabled="busy || !active" :aria-pressed="game.doubtful.includes(index)" @click="act('mark', { scrap: index })">{{ game.doubtful.includes(index) ? 'Под сомнением · снять отметку' : 'Пометить как сомнительный' }}</button></article></div>
          <p v-if="game.hintShown && game.hint" class="event"><b>Подсказка мастера:</b> {{ game.hint }}</p>
          <HeroCheck v-if="game.check && active && !game.hintShown" :check="game.check" :actors="actors" :busy="busy"
            purpose="Удачная проверка открывает подсказку мастера всему отряду. Каждый герой пробует один раз." @roll="heroId => act('skill', { heroId })" />
          <section class="map-board" aria-label="Собираемый маршрут"><div class="map-heading"><span aria-hidden="true">✥</span><h4>{{ game.phase === 'solved' ? 'Восстановленный путь' : 'Ваш маршрут' }}</h4><small>Четыре места · слева направо</small></div><ol class="route"><li v-for="slot in 4" :key="slot"><small>{{ slot === 1 ? 'Начало' : slot === 4 ? 'Конец' : `Шаг ${slot}` }}</small><strong>{{ game.route[slot - 1] !== undefined ? game.places[game.route[slot - 1]] : 'Не выбрано' }}</strong><button v-if="game.route[slot - 1] !== undefined && active" type="button" :disabled="busy" :aria-label="`Убрать остановку ${slot}`" @click="act('remove', { slot: slot - 1 })">Убрать</button></li></ol><div v-if="active" class="places"><button v-for="(place, index) in game.places" :key="place" type="button" :disabled="busy || game.route.includes(index) || game.route.length === 4" @click="act('append', { place: index })">+ {{ place }}</button></div><button v-if="active" type="button" class="primary" :disabled="busy || game.route.length !== 4 || repeated" @click="act('check')">Проверить маршрут</button><p v-if="repeated && active" class="muted">Этот маршрут уже проверяли. Измените порядок или состав.</p></section>
          <p class="event" role="status">{{ game.message }}</p>
          <p v-if="game.effect" class="event effect">{{ game.effect }}</p>
          <details v-if="game.history.length"><summary>Проверенные маршруты</summary><ol><li v-for="(entry, index) in game.history" :key="index">{{ entry.route.map(place => game!.places[place]).join(' → ') }}. <b>Верных позиций: {{ entry.matches }} / 4.</b></li></ol></details>
          <details class="notes" open><summary>Заметки отряда · {{ game.notes.length }} / 20</summary><ul v-if="game.notes.length"><li v-for="(entry, index) in game.notes" :key="index"><b>{{ entry.author }}:</b> {{ entry.text }}</li></ul><p v-else class="muted">Запишите, как вы сопоставили даты или нашли противоречие.</p><form v-if="active" @submit.prevent="act('note', { text: note })"><label for="fragment-note">Новая заметка</label><textarea id="fragment-note" v-model="note" maxlength="240" rows="2" :disabled="busy || game.notes.length >= 20" /><button type="submit" :disabled="busy || !note.trim() || game.notes.length >= 20">Добавить для всех</button></form></details>
          <details v-if="manager" class="master"><summary>Панель мастера · решение</summary><p>{{ game.solution?.map(place => game!.places[place]).join(' → ') }}</p><p>{{ game.hint }}</p><p v-if="game.target">Откроет на карте: <b translate="no">«{{ game.target.name }}»</b></p><div v-if="['active', 'lost'].includes(game.phase)" class="actions"><button type="button" :disabled="busy || game.hintShown" @click="act('hint')">Открыть подсказку</button><button type="button" :disabled="busy" @click="act('solve')">Указать верный путь</button><button type="button" :disabled="busy" @click="act('cancel')">Завершить поиск</button></div></details>
        </template>
        <form v-if="manager && !active" class="setup" @submit.prevent="act('create', { story, ...(targetId ? { targetId } : {}), ...checkBody() })"><h4>Новая загадка</h4><label>История<select v-model.number="story" :disabled="busy"><option v-for="entry in stories" :key="entry.id" :value="entry.id">{{ entry.title }}</option></select></label><p>{{ stories.find(entry => entry.id === story)?.description }}</p><label>Откроет на карте<select v-model="targetId" :disabled="busy"><option value="">Ничего</option><optgroup v-for="group in secretGroups" :key="group.scene" :label="group.scene" translate="no"><option v-for="item in group.items" :key="item.id" :value="item.id">{{ item.name }}</option></optgroup></select><small>Верный маршрут покажет всем тайный предмет сцены. В списке — предметы с заданной СЛ обнаружения.</small></label><CheckSetup v-model:skill="checkSkill" v-model:dc="checkDc" :skills="CHECK_SKILLS['map-fragments']" :disabled="busy" purpose="Каждый герой отряда может один раз бросить этот навык: успех открывает подсказку." /><button type="submit" class="primary" :disabled="busy || !stories.length">Разложить обрывки</button></form>
        <p v-else-if="!game || game.phase === 'cancelled'">Мастер ещё не разложил карту. Когда он выберет историю, обрывки появятся у всего отряда.</p>
      </template>
      <details class="rules"><summary>Правила — шаг за шагом</summary><ol><li><b>Цель:</b> собрать маршрут из четырёх разных мест в правильном порядке. Всего мест пять — одно лишнее.</li><li>Прочитайте все обрывки. Обращайте внимание на дату и события: старый источник может описывать дорогу, которой уже нельзя пользоваться.</li><li>Нажимайте названия мест в порядке движения. «Убрать» удаляет выбранную остановку и сдвигает последующие; добавление всегда идёт в конец. Изменения маршрута бесплатны.</li><li>Можно отметить сомнительный обрывок и добавить заметку. Их видит весь отряд. Отметка — только ваше предположение: она не меняет правильный ответ.</li><li>«Проверить маршрут» расходует одну из четырёх общих проверок. Ответ показывает число верных позиций, но не указывает какие. Повторять уже проверенный маршрут нельзя, попытка за это не тратится.</li><li>Четыре совпадения означают успех, в том числе на последней проверке. После четырёх ошибок правки блокируются: мастер может дать подсказку, показать путь по результату сцены или начать новую загадку.</li></ol><p><b>Пример:</b> записка «после башни сразу мост» означает, что эти места идут подряд. Если другой обрывок написан до разрушения дороги, его указания могут быть устаревшими.</p><p>Таймера и автоматических бросков нет. Состояние общее для кампании; договоритесь, кто меняет маршрут. Если мастер назначил проверку навыка (История, Выживание или Расследование), каждый герой может один раз бросить её: успех открывает подсказку. Если мастер связал карту с тайным предметом сцены, верный маршрут откроет его на карте всем. Фигуры и награды мини-игра не меняет. Поиск хранится в кампании: его не сбрасывают ни закрытие окна, ни перезапуск программы.</p></details>
    </main>
  </div></div>
</template>
<style scoped>
.map-overlay{position:fixed;inset:0;z-index:3000;display:flex;align-items:center;justify-content:center;padding:18px;background:#000a;backdrop-filter:blur(3px)}.map-card{width:min(820px,100%);max-height:90vh;display:flex;flex-direction:column;overflow:hidden;padding:0;background:var(--parchment-background);color:var(--ink);border:1px solid var(--brass);border-radius:12px;box-shadow:var(--g-ring),var(--g-shadow)}header{display:flex;align-items:center;gap:12px;padding:18px;background:var(--surface-inset);border-bottom:3px double var(--brass-light)}header h3{margin:3px 0 0;font-size:24px}header>button:last-child{margin-left:auto}main{padding:20px;overflow:auto;min-height:0}small,.muted{font-size:12px;color:var(--muted-ink);line-height:1.6}.status{display:flex;justify-content:space-between;gap:12px;margin-bottom:16px}.status b{white-space:nowrap;font-size:12px}.status h4{margin:0;font-size:20px}.status p{font-size:13px;line-height:1.6;margin:8px 0}.scraps{display:grid;grid-template-columns:1fr 1fr;gap:14px}.scraps article{display:flex;flex-direction:column;padding:18px;background:linear-gradient(135deg,color-mix(in srgb,var(--brass) 12%,transparent),transparent),var(--surface-inset);border:1px solid var(--brass-light);border-radius:3px 18px 3px 12px;box-shadow:2px 4px 8px #0002}.scraps h5{font-size:15px;line-height:1.5;margin:6px 0}.scraps p{font-size:14px;line-height:1.7}.scraps button{margin-top:auto;font-size:12px;white-space:normal}.scraps .doubtful{border:1px dashed var(--brass)}.scraps .doubtful h5{text-decoration:underline dotted}.map-board{margin-top:20px;padding:18px;border:2px double var(--brass);border-radius:8px;background:radial-gradient(ellipse,color-mix(in srgb,var(--brass) 12%,transparent),transparent),var(--surface-inset)}.map-heading{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.map-heading>span{font-size:35px;color:var(--brass)}.map-heading h4{margin:0}.route{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;list-style:none;padding:0}.route li{display:flex;flex-direction:column;align-items:center;justify-content:space-between;gap:8px;text-align:center;border:1px dashed var(--brass-light);padding:12px 8px;border-radius:6px;min-height:110px}.route strong{font-size:14px;overflow-wrap:anywhere}.route button{font-size:11px;padding:4px 8px}.places,.actions{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.places button{font-size:12px;white-space:normal}.event{padding:12px;border-left:3px solid var(--brass);background:var(--surface-inset);line-height:1.6}.effect{border-left-color:var(--g-good,var(--brass))}.notes form{display:grid;gap:8px}.notes textarea{width:100%;resize:vertical}.notes li{white-space:pre-wrap;overflow-wrap:anywhere}.setup{display:grid;gap:12px;padding:16px;border:1px solid var(--brass-light);margin:12px 0}.setup h4{margin:0}.setup label{display:grid;gap:6px}.setup p{font-size:13px}.rules,.master{border-top:1px solid var(--brass-light);margin-top:16px}li,.rules p,.master p{font-size:13px;line-height:1.65;margin:8px 0}ol,ul{padding-left:22px}@media(max-width:560px){main{padding:12px}header{padding:12px}header h3{font-size:20px}.scraps{grid-template-columns:1fr}.route{grid-template-columns:1fr 1fr}.status{flex-direction:column}}
</style>
