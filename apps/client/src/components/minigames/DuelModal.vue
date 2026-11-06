<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { DUEL_MOVES, DUEL_DAMAGE, type DuelView } from '../../../../../packages/domain/minigames/duel';
import { useEscapeClose } from '../../ui/escapeStack';
import { confirmAction } from '../../ui/confirmDialog';
import GameIcon from '../game/GameIcon.vue';
const props = defineProps<{ campaignId: string; request: (path: string, method?: string, body?: unknown) => Promise<any> }>();
const emit = defineEmits<{ close: []; back: [] }>();
useEscapeClose(() => emit('close'));
const game = ref<DuelView | null>(null), manager = ref(false), loaded = ref(false), busy = ref(false), error = ref('');
const userId = ref('');
const me = computed(() => game.value?.players.find(p => p.id === userId.value));
const host = computed(() => game.value?.hostId === userId.value);
const active = computed(() => game.value && ['lobby', 'playing'].includes(game.value.phase));
function moveName(id: string) { return DUEL_MOVES.find(m => m.id === id)?.name ?? id; }
const path = `/campaigns/${props.campaignId}/minigames/duel`;
let timer: ReturnType<typeof setTimeout> | undefined, disposed = false, generation = 0;
function apply(result: { game: DuelView | null; manager: boolean; userId: string }) { userId.value = result.userId; game.value = result.game; manager.value = result.manager; loaded.value = true; }
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
    if (['cancel', 'surrender'].includes(action) && !await confirmAction(action === 'surrender' ? 'Уступить победу сопернику?' : 'Завершить дуэль без победителя?', { title: 'Дуэль намерений', confirmLabel: action === 'surrender' ? 'Сдаться' : 'Завершить' })) return;
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
  <div class="modal-overlay duel-overlay" role="dialog" aria-modal="true" aria-labelledby="duel-title"><div class="modal-card duel-card">
    <header><button type="button" aria-label="К списку мини-игр" @click="emit('back')">←</button><div><small>Арена · два соперника</small><h3 id="duel-title">Дуэль намерений</h3></div><button type="button" aria-label="Закрыть мини-игру" @click="emit('close')"><GameIcon class="inline-icon" name="close" :size="16" /></button></header>
    <main>
      <p v-if="error" role="alert">{{ error }} <button type="button" :disabled="busy" @click="refresh">Обновить</button></p>
      <p v-if="!loaded" role="status">Готовлю арену…</p>
      <template v-else>
        <template v-if="game">
          <div class="status"><strong>{{ game.phase === 'lobby' ? 'Сбор дуэлянтов' : game.phase === 'playing' ? `Раунд ${game.round} из ${game.limit}` : game.phase === 'cancelled' ? 'Дуэль отменена' : game.winnerId ? 'Победитель определён' : 'Ничья' }}</strong><small>Без случайных бросков · тайный выбор</small></div>
          <div class="arena"><section v-for="player in game.players" :key="player.id" :class="{ mine: player.id === userId, winner: game.phase === 'finished' && game.winnerId === player.id }"><span class="crest" aria-hidden="true">{{ game.winnerId === player.id ? '♛' : '⚔' }}</span><h4>{{ player.name }} <small v-if="player.id === userId">вы</small></h4><label>Стойкость {{ player.health }} / 6<progress :value="player.health" max="6" /></label><label>Выносливость {{ player.stamina }} / 3<progress :value="player.stamina" max="3" /></label><p v-if="game.phase === 'playing'">{{ game.ready.includes(player.id) ? 'Приём выбран' : 'Обдумывает приём' }}</p></section><section v-if="game.players.length === 1" class="empty"><span class="crest" aria-hidden="true">◇</span><h4>Место соперника</h4><p>Другой участник кампании может принять вызов.</p></section></div>
          <template v-if="game.phase === 'lobby'"><button v-if="!me && game.players.length < 2" type="button" class="primary" :disabled="busy" @click="act('join')">Принять вызов</button><button v-if="host" type="button" class="primary" :disabled="busy || game.players.length !== 2" @click="act('start')">Начать дуэль</button><button v-if="me && !host" type="button" :disabled="busy" @click="act('leave')">Покинуть сбор</button></template>
          <template v-if="game.phase === 'playing'">
            <p v-if="!me" class="muted">Вы наблюдаете. Приёмы раскроются, когда оба соперника сделают выбор.</p>
            <p v-else-if="game.ownMove" class="commit" role="status">Ваш приём: <b>{{ moveName(game.ownMove) }}</b><br />Соперник его не видит. Изменить выбор нельзя — ждём раскрытия.</p>
            <p v-else class="muted">Выберите приём. Он сразу фиксируется; соперник увидит его только после своего выбора.</p>
            <div v-if="me" class="moves"><button v-for="move in DUEL_MOVES" :key="move.id" type="button" :disabled="busy || !!game.ownMove || me.stamina < move.cost" @click="act('choose', { move: move.id })"><span aria-hidden="true">{{ move.glyph }}</span><strong>{{ move.name }}</strong><small>{{ move.cost ? `Цена: ${move.cost} выносливости` : `Восстановление: +${move.recovery}, максимум 3` }}</small><p>{{ move.description }}</p></button></div>
          </template>
          <p class="event" role="status">{{ game.message }}</p>
          <details v-if="game.history.length" open><summary>Раскрытые раунды</summary><ol><li v-for="entry in game.history" :key="entry.round"><b>Раунд {{ entry.round }}:</b> {{ game.players[0].name }} — {{ moveName(entry.moves[0]) }}; {{ game.players[1].name }} — {{ moveName(entry.moves[1]) }}.<br />Нанесено урона: {{ entry.damage[0] }} / {{ entry.damage[1] }} соответственно.</li></ol></details>
          <div class="actions"><button v-if="game.phase === 'playing' && me" type="button" :disabled="busy" @click="act('surrender')">Сдаться</button><button v-if="active && (host || manager)" type="button" :disabled="busy" @click="act('cancel')">Завершить без победителя</button></div>
        </template>
        <section v-if="!active" class="setup"><h4>{{ game ? 'Новый вызов' : 'Испытайте намерения соперника' }}</h4><p>Два участника кампании, по 6 стойкости и 3 выносливости. Остальные могут наблюдать.</p><button type="button" class="primary" :disabled="busy" @click="act('create')">Бросить вызов</button></section>
      </template>
      <details class="rules"><summary>Правила и таблица приёмов</summary><ol><li>Создатель бросает вызов, второй участник принимает его. Создатель начинает дуэль. Для игры нужны два разных участника кампании.</li><li>Каждый тайно выбирает один доступный приём. Выбор нельзя поменять. Даже наблюдающий мастер не видит приём до раскрытия. Стойкость и выносливость обновляются только после обоих решений.</li><li>Урон наносится одновременно. В таблице — урон, который приём из строки наносит приёму из столбца. Урон уменьшает стойкость соперника.</li></ol><div class="table-scroll"><table><caption>Наносимый урон</caption><thead><tr><th scope="col">Ваш приём ↓ / соперник →</th><th v-for="move in DUEL_MOVES" :key="move.id" scope="col">{{ move.name }}</th></tr></thead><tbody><tr v-for="(move, row) in DUEL_MOVES" :key="move.id"><th scope="row">{{ move.name }}</th><td v-for="(damage, col) in DUEL_DAMAGE[row]" :key="col">{{ damage }}</td></tr></tbody></table></div><p><b>Пример:</b> натиск против защиты наносит 0, а защита отвечает на натиск 1 уроном. Натиск теряет 1 выносливость, защита восстанавливает 1. Финт против защиты наносит 2 урона без ответного урона.</p><p>Натиск стоит 1 выносливость, финт — 2. Защита восстанавливает 1, выжидание — 2, максимум 3. Цена оплачивается при любом результате. На нулевой выносливости доступны защита и выжидание.</p><p>Дуэль заканчивается при нулевой стойкости или после 8 раундов. Побеждает тот, у кого больше стойкости; при равенстве — ничья, включая одновременное падение. Можно сдаться и отдать победу сопернику.</p><p>Таймера нет. Закрытие окна сохраняет выбор и не означает сдачу. Если соперник отключился, создатель или мастер может отменить дуэль. Перезапуск сервера сбрасывает игру. Стойкость и выносливость мини-игры не меняют хиты, ресурсы или предметы персонажей.</p></details>
    </main>
  </div></div>
</template>
<style scoped>
.duel-overlay{position:fixed;inset:0;z-index:3000;display:flex;align-items:center;justify-content:center;padding:18px;background:#000a;backdrop-filter:blur(3px)}.duel-card{width:min(760px,100%);max-height:90vh;display:flex;flex-direction:column;overflow:hidden;padding:0;background:var(--parchment-background);color:var(--ink);border:1px solid var(--brass);border-radius:12px;box-shadow:var(--g-ring),var(--g-shadow)}header{display:flex;align-items:center;gap:12px;padding:18px;background:var(--surface-inset);border-bottom:3px double var(--brass-light)}header h3{margin:3px 0 0;font-size:24px}header>button:last-child{margin-left:auto}main{padding:20px;overflow:auto;min-height:0}small,.muted{font-size:12px;color:var(--muted-ink);line-height:1.6}.status{display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px}.arena{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:18px 0}.arena section{padding:18px;border:2px double var(--brass-light);border-radius:40px 40px 8px 8px;text-align:center;background:radial-gradient(ellipse at top,color-mix(in srgb,var(--brass) 15%,transparent),transparent),var(--surface-inset);min-width:0}.arena .mine{border-color:var(--brass)}.arena .winner{border-color:var(--g-good,var(--brass))}.crest{font:38px Georgia;color:var(--brass)}h4{font-size:18px;margin:10px 0;overflow-wrap:anywhere}.arena label{display:block;text-align:left;font-size:12px;margin:10px 0}.arena progress{display:block;width:100%;height:12px;accent-color:var(--brass)}.arena p{font-size:12px;line-height:1.5}.empty{display:flex;flex-direction:column;justify-content:center}.moves{display:grid;grid-template-columns:1fr 1fr;gap:10px}.moves button{display:flex;flex-direction:column;align-items:flex-start;gap:8px;padding:16px;text-align:left;white-space:normal;background:var(--surface-inset);border:1px solid var(--brass-light);border-radius:8px;color:var(--ink)}.moves button>span{font-size:30px;color:var(--brass)}.moves p{margin:0;font-size:13px;line-height:1.6}.commit,.event{padding:12px;border-left:3px solid var(--brass);background:var(--surface-inset);line-height:1.6}.actions{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.setup{padding:16px;border:1px solid var(--brass-light);margin:12px 0}.setup p{font-size:13px;line-height:1.6}.rules{border-top:1px solid var(--brass-light);margin-top:16px}li,.rules p{font-size:13px;line-height:1.65;margin:8px 0}ol{padding-left:22px}.table-scroll{overflow:auto}table{width:100%;border-collapse:collapse;font-size:12px}td,th{padding:8px;border:1px solid var(--brass-light);text-align:center}caption{text-align:left;margin:10px 0;color:var(--muted-ink)}@media(max-width:480px){main{padding:12px}header{padding:12px}header h3{font-size:20px}.arena{gap:8px}.arena section{padding:10px}.moves{grid-template-columns:1fr}}
</style>
