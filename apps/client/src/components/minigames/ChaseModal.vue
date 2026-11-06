<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { CHASE_ROUTES, CHASE_OBSTACLES, chaseDifficulty, type Chase } from '../../../../../packages/domain/minigames/chase';
import { useEscapeClose } from '../../ui/escapeStack';
import { confirmAction } from '../../ui/confirmDialog';
import GameIcon from '../game/GameIcon.vue';
const props = defineProps<{ campaignId: string; request: (path: string, method?: string, body?: unknown) => Promise<any> }>();
const emit = defineEmits<{ close: []; back: [] }>();
useEscapeClose(() => emit('close'));
const game = ref<Chase | null>(null), manager = ref(false), loaded = ref(false), busy = ref(false), error = ref('');
const active = computed(() => game.value && ['route', 'obstacle'].includes(game.value.phase));
const path = `/campaigns/${props.campaignId}/minigames/chase`;
let timer: ReturnType<typeof setTimeout> | undefined, disposed = false, generation = 0;
function apply(result: { game: Chase | null; manager: boolean }) { game.value = result.game; manager.value = result.manager; loaded.value = true; }
async function refresh() {
  const ticket = ++generation;
  try { const result = await props.request(path); if (!disposed && ticket === generation) apply(result); }
  catch (cause) { if (!disposed && ticket === generation) error.value = cause instanceof Error ? cause.message : 'Нет связи с сервером.'; }
}
async function poll() { if (!busy.value && !document.hidden) await refresh(); if (!disposed) timer = setTimeout(poll, 2000); }
async function act(action: string, extra: Record<string, unknown> = {}) {
  if (busy.value || !loaded.value) return;
  const revision = game.value?.revision ?? 0; busy.value = true;
  try {
    if (action === 'cancel' && !await confirmAction('Остановить общую погоню?', { title: 'Погоня по переулкам', confirmLabel: 'Завершить' })) return;
    error.value = ''; const ticket = ++generation;
    const result = await props.request(path, 'POST', { action, revision, ...extra });
    if (!disposed && ticket === generation) apply(result);
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось выполнить действие. Попробуйте ещё раз.'; await refresh(); }
  finally { busy.value = false; }
}
onMounted(() => void poll());
onBeforeUnmount(() => { disposed = true; generation++; clearTimeout(timer); });
</script>
<template>
  <div class="modal-overlay chase-overlay" role="dialog" aria-modal="true" aria-labelledby="chase-title"><div class="modal-card chase-card">
    <header><button type="button" aria-label="К списку мини-игр" @click="emit('back')">←</button><div><small>Улицы спящего города · весь отряд</small><h3 id="chase-title">Погоня по переулкам</h3></div><button type="button" aria-label="Закрыть мини-игру" @click="emit('close')"><GameIcon class="inline-icon" name="close" :size="16" /></button></header>
    <main>
      <p v-if="error" role="alert">{{ error }} <button type="button" :disabled="busy" @click="refresh">Обновить</button></p>
      <p v-if="!loaded" role="status">Ищу путь к убежищу…</p>
      <template v-else>
        <template v-if="game">
          <div class="city" aria-hidden="true"><span>♜</span><span>⌂</span><span>♜</span><span>⌂</span><span>♜</span></div>
          <div class="status"><strong>{{ game.phase === 'escaped' ? 'Вы оторвались!' : game.phase === 'caught' ? 'Отряд настигли' : game.phase === 'cancelled' ? 'Погоня остановлена' : 'Доберитесь до убежища' }}</strong><span>Пройдено участков: {{ game.turn }} / {{ game.limit }}</span></div>
          <div class="journey"><div class="journey-label"><span>Городские улицы</span><b>{{ Math.min(game.progress, game.goal) }} / {{ game.goal }}</b><span>Убежище</span></div><progress :value="Math.min(game.progress, game.goal)" :max="game.goal" aria-label="Путь к убежищу" /></div>
          <div class="resources"><div :class="{ danger: game.gap <= 2 }"><strong>{{ Math.max(0, game.gap) }}</strong><span>Отрыв · при 0 вас настигнут</span></div><div><strong>{{ game.stamina }} / 4</strong><span>Силы для рывка</span></div></div>
          <template v-if="game.phase === 'route'">
            <h4>Куда свернуть?</h4><p class="muted">Выберите маршрут вместе. После выбора сервер раскроет препятствие; сменить дорогу на этом участке уже нельзя.</p>
            <div class="routes"><button v-for="(route, index) in CHASE_ROUTES" :key="route.name" type="button" :disabled="busy" @click="act('route', { route: index })"><span aria-hidden="true">{{ route.glyph }}</span><strong>{{ route.name }}</strong><p>{{ route.description }}</p><small>Успех: путь +{{ route.progress }}<br />Нужно {{ route.difficulty }}–{{ route.difficulty + 1 }} на к6</small></button></div>
          </template>
          <section v-if="game.phase === 'obstacle' && game.obstacle !== null && game.route !== null" class="obstacle">
            <small>{{ CHASE_ROUTES[game.route].name }} · участок {{ game.turn + 1 }}</small><h4>{{ CHASE_OBSTACLES[game.obstacle].name }}</h4><p>{{ CHASE_OBSTACLES[game.obstacle].text }}</p>
            <div class="approaches"><button type="button" :disabled="busy || !game.stamina" @click="act('sprint')"><strong>Рывок</strong><small>к6 ≥ {{ chaseDifficulty(game, 'sprint') }} · силы −1</small><span>Успех: путь +{{ CHASE_ROUTES[game.route].progress }}, отрыв +2</span></button><button type="button" :disabled="busy" @click="act('hide')"><strong>Скрыться</strong><small>к6 ≥ {{ chaseDifficulty(game, 'hide') }} · без затрат сил</small><span>Успех: путь +{{ CHASE_ROUTES[game.route].progress }}, отрыв +1</span></button><button type="button" :disabled="busy" @click="act('detour')"><strong>Обойти и перевести дух</strong><small>Без броска · силы +1, максимум 4</small><span>Всегда: путь +1, отрыв −1</span></button></div>
            <p class="muted">Неудача рывка или укрытия: путь +1, отрыв −2. Силы за рывок расходуются при любом результате.</p>
          </section>
          <p class="event" role="status">{{ game.message }}</p>
          <details v-if="game.history.length"><summary>Хроника погони</summary><ol><li v-for="(entry, index) in game.history" :key="index">{{ entry }}</li></ol></details>
          <button v-if="manager && active" type="button" :disabled="busy" @click="act('cancel')">Остановить погоню</button>
        </template>
        <section v-if="manager && !active" class="setup"><h4>{{ game ? 'Новая погоня' : 'Поднять тревогу' }}</h4><p>Отряд начинает с отрывом 4 и запасом сил 3. Нужно пройти 10 единиц пути за 8 участков.</p><button type="button" class="primary" :disabled="busy" @click="act('create')">Начать погоню</button></section>
        <p v-else-if="!game">Мастер ещё не начал погоню. Когда он поднимет тревогу, отряд увидит общие маршруты.</p>
      </template>
      <details class="rules"><summary>Правила — шаг за шагом</summary><ol><li><b>Цель:</b> набрать 10 пути за 8 участков и сохранить положительный отрыв. Нулевой отрыв означает, что отряд настигли, даже у самого убежища.</li><li><b>Выберите маршрут.</b> Главная улица даёт +1 пути при успехе, переулки +2, крыши +3. Чем короче путь, тем труднее проверка. Выбор дороги сам по себе не расходует участок.</li><li><b>Изучите препятствие.</b> Оно случайно выбирается сервером и облегчает один из способов. Точный порог броска показан на кнопке. Вернуться к выбору дороги нельзя.</li><li><b>Рывок:</b> потратьте 1 силу и бросьте к6. Успех даёт продвижение маршрута и +2 отрыва. <b>Скрыться:</b> бросок без затрат сил, успех даёт продвижение маршрута и +1 отрыва. Неудача любого броска даёт только +1 пути и −2 отрыва.</li><li><b>Обход:</b> без броска получите +1 пути, −1 отрыва и восстановите 1 силу (до 4). Это тоже завершает участок.</li><li>После восьмого участка выходы перекрывают. Победа на восьмом участке возможна, если вы уже набрали 10 пути и отрыв выше нуля.</li></ol><p><b>Пример:</b> на крышах выпала телега. Для рывка нужно 4+ на к6. Выпало 5: путь +3, отрыв +2, силы −1. При результате 3: путь +1, отрыв −2, силы всё равно −1.</p><p>Отряд действует совместно, без очереди и таймера. Кости бросает сервер. Эти силы и путь относятся только к мини-игре: характеристики, позиции фигур и боевые действия персонажей не меняются. Проверки Атлетики, Акробатики и Скрытности персонажей пока не подключены. Последствия определяет мастер. Перезапуск сервера сбрасывает погоню.</p></details>
    </main>
  </div></div>
</template>
<style scoped>
.chase-overlay{position:fixed;inset:0;z-index:3000;display:flex;align-items:center;justify-content:center;padding:18px;background:#000a;backdrop-filter:blur(3px)}.chase-card{width:min(740px,100%);max-height:90vh;display:flex;flex-direction:column;overflow:hidden;padding:0;background:var(--parchment-background);color:var(--ink);border:1px solid var(--brass);border-radius:12px;box-shadow:var(--g-ring),var(--g-shadow)}header{display:flex;align-items:center;gap:12px;padding:18px;background:var(--surface-inset);border-bottom:3px double var(--brass-light)}header h3{margin:3px 0 0;font-size:24px}header>button:last-child{margin-left:auto}main{padding:20px;overflow:auto;min-height:0}small,.muted{font-size:12px;color:var(--muted-ink);line-height:1.6}.city{display:flex;justify-content:space-evenly;align-items:flex-end;height:80px;border-bottom:2px solid var(--brass);color:var(--brass);background:radial-gradient(ellipse at top,color-mix(in srgb,var(--brass) 20%,transparent),transparent);overflow:hidden}.city span{font:60px Georgia}.city span:nth-child(even){font-size:42px}.status{display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;margin:16px 0}.status span{font-size:12px;color:var(--muted-ink)}.journey-label{display:flex;justify-content:space-between;font-size:12px;gap:8px}.journey progress{width:100%;height:14px;accent-color:var(--brass)}.resources{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:16px 0}.resources>div{display:flex;flex-direction:column;text-align:center;padding:12px;border:1px solid var(--brass-light);border-radius:8px;background:var(--surface-inset)}.resources strong{font:28px var(--g-title-font,Georgia)}.resources span{font-size:12px;color:var(--muted-ink)}.resources .danger{border-color:var(--g-bad,var(--brass))}.danger strong{color:var(--g-bad,var(--ink))}h4{font-size:20px;margin:14px 0 8px}.routes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.routes button,.approaches button{display:flex;flex-direction:column;align-items:flex-start;gap:8px;padding:14px;background:var(--surface-inset);border:1px solid var(--brass-light);color:var(--ink);border-radius:8px;text-align:left;white-space:normal}.routes button>span{font-size:32px;color:var(--brass)}.routes p{font-size:13px;line-height:1.6;margin:0}.routes small{margin-top:auto}.obstacle{padding:16px;border:1px solid var(--brass);border-radius:8px;background:var(--surface-inset)}.obstacle p{font-size:13px;line-height:1.6}.approaches{display:grid;grid-template-columns:1fr 1fr;gap:10px}.approaches button:last-child{grid-column:1/-1}.approaches span{font-size:12px}.event{padding:12px;border-left:3px solid var(--brass);background:var(--surface-inset);line-height:1.6}.setup{padding:16px;border:1px solid var(--brass-light);margin-block:12px}.setup p{font-size:13px;line-height:1.6}.rules{border-top:1px solid var(--brass-light);margin-top:16px}li,.rules p{font-size:13px;line-height:1.65;margin:8px 0}ol{padding-left:22px}@media(max-width:520px){main{padding:12px}header{padding:12px}header h3{font-size:19px}.routes,.approaches{grid-template-columns:1fr}.approaches button:last-child{grid-column:auto}}
</style>
