<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useEscapeClose } from '../../ui/escapeStack';
import { confirmAction } from '../../ui/confirmDialog';
import { dragonWinners, type DragonAction, type DragonGame } from '../../../../../packages/domain/minigames/dragon-dice';
import GameIcon from '../game/GameIcon.vue';
const props = defineProps<{ campaignId: string; request: (path: string, method?: string, body?: unknown) => Promise<any> }>();
const emit = defineEmits<{ close: []; back: [] }>();
useEscapeClose(() => emit('close'));
const game = ref<DragonGame | null>(null);
const userId = ref('');
const manager = ref(false);
const busy = ref(false);
const loaded = ref(false);
const error = ref('');
const current = computed(() => game.value?.players[game.value.turn]);
const myTurn = computed(() => game.value?.phase === 'playing' && current.value?.id === userId.value);
const joined = computed(() => game.value?.players.some(p => p.id === userId.value));
const host = computed(() => game.value?.hostId === userId.value);
const winners = computed(() => game.value ? dragonWinners(game.value) : []);
const path = `/campaigns/${props.campaignId}/minigames/dragon-dice`;
let timer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
let generation = 0;
function apply(result: { game: DragonGame | null; userId: string; manager: boolean }) {
  game.value = result.game; userId.value = result.userId; manager.value = result.manager; loaded.value = true;
}
async function refresh() {
  const ticket = ++generation;
  try {
    const result = await props.request(path);
    if (!disposed && ticket === generation) apply(result);
  } catch (cause) {
    if (!disposed && ticket === generation) error.value = cause instanceof Error ? cause.message : 'Нет связи с сервером.';
  }
}
async function poll() {
  if (!busy.value && !document.hidden) await refresh();
  if (!disposed) timer = setTimeout(poll, 2000);
}
async function act(action: DragonAction | 'create') {
  if (busy.value || !loaded.value) return;
  const revision = game.value?.revision ?? 0;
  busy.value = true;
  try {
    if (action === 'cancel' && !await confirmAction('Завершить общую партию без победителя?', { title: 'Завершить партию', confirmLabel: 'Завершить' })) return;
    error.value = '';
    const ticket = ++generation;
    const result = await props.request(path, 'POST', { action, revision });
    if (!disposed && ticket === generation) apply(result);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось выполнить действие. Попробуйте ещё раз.';
    await refresh();
  } finally { busy.value = false; }
}
onMounted(() => void poll());
onBeforeUnmount(() => { disposed = true; generation += 1; clearTimeout(timer); });
</script>

<template>
  <div class="modal-overlay dragon-overlay" role="dialog" aria-modal="true" aria-labelledby="dragon-title">
    <div class="modal-card dragon-card">
      <header class="dragon-header">
        <button type="button" aria-label="К списку мини-игр" @click="emit('back')">←</button>
        <span class="crest" aria-hidden="true"><GameIcon name="dice" :size="30" /></span>
        <div><small>Мини-игры · таверна</small><h3 id="dragon-title">Кости дракона</h3></div>
        <button type="button" aria-label="Закрыть мини-игру" @click="emit('close')"><GameIcon class="inline-icon" name="close" :size="16" /></button>
      </header>
      <div class="dragon-body">
        <p v-if="error" class="notice error" role="alert">{{ error }} <button type="button" :disabled="busy" @click="refresh">Обновить</button></p>
        <p v-if="!loaded" role="status">Собираю игральный стол…</p>
        <template v-else>
          <div class="game-status"><span>{{ !game || game.phase === 'cancelled' ? 'Стол свободен' : game.phase === 'lobby' ? 'Сбор участников' : game.phase === 'finished' ? 'Партия окончена' : `Круг ${game.round} из ${game.rounds}` }}</span><span>1–8 игроков · на очки</span></div>
          <section class="dice-table" aria-label="Игральный стол">
            <template v-if="game?.phase === 'playing'">
              <p class="turn-name">{{ myTurn ? 'Ваш ход' : `Ходит ${current?.name}` }}</p>
              <div class="die" :key="game.revision" :class="{ dragon: game.lastDie === 1 }" :aria-label="game.lastDie === 1 ? 'Дракон' : game.lastDie === 6 ? 'Самоцвет' : `Кость: ${game.lastDie ?? 'ещё не брошена'}`">
                <GameIcon v-if="game.lastDie === 1" name="flame" :size="42" /><GameIcon v-else-if="game.lastDie === 6" name="sparkle" :size="42" /><span v-else>{{ game.lastDie ?? '✧' }}</span>
              </div>
              <div class="treasure"><strong>{{ game.pot }}</strong><span>очков на кону</span><span class="danger-meter">Драконы: {{ game.dragons }} / 2</span></div>
              <div class="play-actions">
                <button type="button" class="primary" :disabled="busy || !myTurn" @click="act('roll')"><GameIcon name="dice" :size="20" /> {{ busy ? 'Подождите…' : game.rolls ? 'Рискнуть ещё' : 'Бросить кость' }}</button>
                <button type="button" :disabled="busy || !myTurn || !game.rolls" @click="act('bank')">Сохранить {{ game.pot }} очков</button>
              </div>
            </template>
            <template v-else-if="game?.phase === 'finished'">
              <GameIcon name="crown" :size="48" /><h4>{{ winners.length > 1 ? 'Общая победа' : 'Победитель' }}</h4><p class="winner">{{ winners.map(p => p.name).join(', ') }}</p><p>{{ winners[0]?.score ?? 0 }} очков</p>
            </template>
            <template v-else>
              <GameIcon name="dice" :size="56" /><h4>Сокровище или пламя?</h4><p>Заберите добычу вовремя. Второй дракон сжигает очки хода.</p>
              <button v-if="!game || game.phase === 'cancelled'" type="button" class="primary" :disabled="busy" @click="act('create')">Собрать стол</button>
              <button v-else-if="!joined" type="button" class="primary" :disabled="busy || game.players.length >= 8" @click="act('join')">Присоединиться</button>
              <button v-else-if="host" type="button" class="primary" :disabled="busy" @click="act('start')">{{ game.players.length === 1 ? 'Начать тренировку в одиночку' : 'Начать партию' }}</button>
              <p v-else class="muted">Вы за столом. Создатель начнёт партию, когда все соберутся.</p>
            </template>
          </section>
          <p v-if="game" class="last-event" role="status">{{ game.message }}</p>
          <ol v-if="game" class="players" aria-label="Участники и счёт">
            <li v-for="(player, index) in game.players" :key="player.id" :class="{ active: game.phase === 'playing' && index === game.turn }"><span>{{ player.name }} <small v-if="player.id === userId">вы</small></span><strong>{{ player.score }}</strong></li>
          </ol>
          <div class="table-actions">
            <button v-if="game?.phase === 'finished'" type="button" :disabled="busy" @click="act('create')">Новая партия</button>
            <button v-if="game?.phase === 'lobby' && joined && !host" type="button" :disabled="busy" @click="act('leave')">Покинуть стол</button>
            <button v-if="game && ['lobby', 'playing'].includes(game.phase) && (host || manager)" type="button" :disabled="busy" @click="act('cancel')">Завершить партию</button>
          </div>
        </template>
        <details class="rules"><summary>Как играть — по шагам</summary>
          <p><b>Цель:</b> набрать больше сохранённых очков за три круга. При равном счёте победа общая. В одиночку вы тренируетесь и стараетесь побить свой результат.</p>
          <ol><li><b>Соберите участников.</b> Нажмите «Собрать стол». Остальные открывают эту игру и нажимают «Присоединиться». Создатель начинает партию, когда все готовы. После начала присоединиться нельзя.</li>
          <li><b>Дождитесь своего хода и бросьте кость.</b> 1 — дракон, без очков; 2, 3, 4 или 5 — столько же очков; 6 — самоцвет, сразу 10 очков. Очки складываются в сумму «на кону».</li>
          <li><b>Выберите: сохранить или рискнуть.</b> «Сохранить» прибавляет всю сумму на кону к вашему счёту и передаёт ход. «Рискнуть ещё» бросает кость снова в том же ходу.</li>
          <li><b>Следите за драконами.</b> Первый дракон не отнимает добычу, но остаётся до конца хода. Второй дракон за тот же ход, даже не подряд, сжигает всю сумму на кону и немедленно передаёт ход. Ранее сохранённые очки не теряются.</li>
          <li><b>Пройдите три круга.</b> Круг заканчивается, когда сходили все. Каждый получает ровно три хода. В новом ходу сумма на кону и число драконов снова равны нулю.</li></ol>
          <p><b>Пример:</b> выпали 4, затем 6 — на кону 14. Выпала 1 — первый дракон, всё ещё 14. Можно сохранить 14. Если рискнуть и получить ещё 1, эти 14 сгорят; ваш прежний счёт останется.</p>
          <p>В одном ходу можно бросать несколько раз. Сохранить можно только после первого броска, даже если он дал 0 очков. Счёт рядом с именем — уже сохранённые очки.</p>
          <p>Закрытие окна не выводит из партии и не пропускает ход. При отключении игрока создатель или мастер может завершить партию без победителя. Перезапуск сервера сбрасывает игру. Золото и характеристики персонажей не меняются.</p>
        </details>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dragon-overlay{position:fixed;inset:0;z-index:3000;display:flex;align-items:center;justify-content:center;padding:18px;background:#000a;backdrop-filter:blur(3px)}
.dragon-card{width:min(620px,100%);max-height:90vh;overflow:hidden;display:flex;flex-direction:column;padding:0;background:var(--parchment-background);color:var(--ink);border:1px solid var(--brass);border-radius:10px;box-shadow:var(--g-ring),var(--g-shadow)}
.dragon-header{flex:none;display:flex;gap:14px;align-items:center;padding:20px;border-bottom:3px double var(--brass-light);background:var(--surface-inset)}
.dragon-header h3{margin:3px 0 0;font-size:25px}.dragon-header small{margin:0;color:var(--muted-ink)}.dragon-header>button:last-child{margin-left:auto;width:32px;min-height:32px;padding:0}.crest{color:var(--g-gold,var(--brass))}
.dragon-body{padding:18px 20px;overflow:auto;min-height:0}.game-status{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;color:var(--muted-ink);font-size:12px;margin-bottom:12px}
.dice-table{display:flex;flex-direction:column;align-items:center;gap:12px;padding:22px 16px;border:1px solid var(--brass);border-radius:60px 60px 12px 12px;background:radial-gradient(ellipse at center,color-mix(in srgb,var(--g-accent,var(--brass)) 25%,transparent),transparent 80%),var(--surface-inset);text-align:center;box-shadow:inset 0 0 0 5px color-mix(in srgb,var(--brass) 10%,transparent)}
.dice-table h4,.dice-table p{margin:0}.dice-table>svg{color:var(--g-gold,var(--brass))}.turn-name,.winner{font:18px var(--g-title-font,Georgia)}.die{display:grid;place-items:center;width:72px;height:72px;border:2px solid var(--brass);border-radius:12px;background:var(--input-bg);box-shadow:0 5px 12px #0006,inset 0 0 0 4px var(--brass-light);font:34px Georgia;color:var(--g-gold,var(--ink));animation:land .25s ease-out}.die.dragon{color:var(--g-bad)}
.treasure{display:flex;flex-direction:column;gap:2px}.treasure strong{font:30px var(--g-title-font,Georgia)}.treasure>span{font-size:12px;color:var(--muted-ink)}.treasure .danger-meter{color:var(--g-warn);margin-top:5px}
.play-actions,.table-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}.play-actions button{display:flex;align-items:center;gap:8px;font-size:13px}.last-event{padding:10px;border-left:2px solid var(--brass);background:var(--surface-inset);font-size:13px;line-height:1.5}
.players{list-style:none;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:7px}.players li{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 12px;border:1px solid var(--brass-light);border-radius:5px;min-width:0}.players li>span{overflow-wrap:anywhere;min-width:0}.players small{display:inline;margin-left:5px}.players .active{border-color:var(--brass);background:color-mix(in srgb,var(--brass) 15%,transparent)}.table-actions button{font-size:12px;min-height:32px;padding:6px 12px}.rules{border-top:1px solid var(--brass-light);margin-top:16px}.rules summary{font-size:15px}.rules ol{padding-left:22px}.rules li{margin:8px 0;font-size:13px;line-height:1.65}.rules p{font-size:13px;color:var(--muted-ink);line-height:1.6}.notice{margin-top:0}.notice button{font-size:12px;padding:4px 8px;min-height:28px}
@keyframes land{from{transform:translateY(-6px) rotate(-10deg);opacity:.5}to{transform:none;opacity:1}}@media(prefers-reduced-motion:reduce){.die{animation:none}}@media(max-width:460px){.dragon-header{padding:14px}.dragon-body{padding:14px}.players{grid-template-columns:1fr}.play-actions{flex-direction:column;width:100%}.play-actions button{justify-content:center}}
</style>
