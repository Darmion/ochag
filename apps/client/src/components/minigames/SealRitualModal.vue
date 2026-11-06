<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { SEALS, type Ritual } from '../../../../../packages/domain/minigames/seal-ritual';
import { useEscapeClose } from '../../ui/escapeStack';
import { confirmAction } from '../../ui/confirmDialog';
import GameIcon from '../game/GameIcon.vue';
const props = defineProps<{ campaignId: string; request: (path: string, method?: string, body?: unknown) => Promise<any> }>();
const emit = defineEmits<{ close: []; back: [] }>();
useEscapeClose(() => emit('close'));
const game = ref<Ritual | null>(null), manager = ref(false), loaded = ref(false), busy = ref(false), error = ref('');
const limit = ref(10), selected = ref(0), amount = ref(1);
const active = computed(() => game.value?.phase === 'active' && !busy.value);
const path = `/campaigns/${props.campaignId}/minigames/seal-ritual`;
let timer: ReturnType<typeof setTimeout> | undefined, disposed = false, generation = 0;
function apply(result: { game: Ritual | null; manager: boolean }) { game.value = result.game; manager.value = result.manager; loaded.value = true; }
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
    if (action === 'cancel' && !await confirmAction('Завершить общий ритуал?', { title: 'Четыре печати', confirmLabel: 'Завершить' })) return;
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
  <div class="modal-overlay ritual-overlay" role="dialog" aria-modal="true" aria-labelledby="ritual-title"><div class="modal-card ritual-card">
    <header><button type="button" aria-label="К списку мини-игр" @click="emit('back')">←</button><div><small>Совместный ритуал · весь отряд</small><h3 id="ritual-title">Четыре печати</h3></div><button type="button" aria-label="Закрыть мини-игру" @click="emit('close')"><GameIcon class="inline-icon" name="close" :size="16" /></button></header>
    <main>
      <p v-if="error" role="alert">{{ error }} <button type="button" :disabled="busy" @click="refresh">Обновить</button></p>
      <p v-if="!loaded" role="status">Пробуждаем печати…</p>
      <template v-else>
        <template v-if="game">
          <div class="status"><strong>{{ game.phase === 'won' ? 'Равновесие достигнуто' : game.phase === 'failed' ? 'Круг погас' : game.phase === 'cancelled' ? 'Ритуал завершён мастером' : 'Уравновесьте четыре стихии' }}</strong><span>Ходы: {{ game.moves }} / {{ game.limit }} · Нестабильность: {{ game.strain }} / 3</span></div>
          <p class="intro">В каждой печати должно быть ровно <b>3 энергии</b>. Передавайте энергию соседям по кругу.</p>
          <div class="circle" aria-label="Круг печатей, порядок по часовой стрелке">
            <div class="heart" aria-hidden="true">✧<small>12 энергии</small></div>
            <button v-for="(seal, index) in SEALS" :key="seal.name" type="button" class="seal" :class="[`seal-${index}`, { selected: selected === index, balanced: game.energy[index] === 3 }]" :aria-pressed="selected === index" :disabled="!active" @click="selected = index"><span aria-hidden="true">{{ seal.glyph }}</span><b>{{ seal.name }}</b><strong>{{ game.energy[index] }} <small>/ 3</small></strong><span class="pips" aria-hidden="true"><i v-for="n in 6" :key="n" :class="{ filled: n <= game.energy[index] }" /></span></button>
          </div>
          <section v-if="game.phase === 'active'" class="controls" aria-label="Перенос энергии"><p>Источник: <b>{{ SEALS[selected]?.name }}</b> · выберите объём и соседнюю печать</p><div class="amount"><button v-for="n in [1, 2]" :key="n" type="button" :aria-pressed="amount === n" :disabled="busy" @click="amount = n">{{ n }} энергии</button></div><div class="directions"><button v-for="direction in [-1, 1]" :key="direction" type="button" :disabled="!active || game.energy[selected] < amount" @click="act('transfer', { from: selected, amount, direction })">{{ direction === -1 ? '↶' : '↷' }} В {{ SEALS[(selected + direction + 4) % 4]?.name }}<small v-if="game.energy[(selected + direction + 4) % 4] + amount > 6">Перегрузка! +1 нестабильность</small></button></div><button type="button" :disabled="!active || !game.strain" @click="act('stabilize')">Успокоить круг · −1 нестабильность, 1 ход</button></section>
          <p class="event" role="status">{{ game.message }}</p>
          <details v-if="game.history.length"><summary>Хроника ритуала</summary><ol><li v-for="(entry, i) in game.history" :key="i">{{ entry }}</li></ol></details>
          <button v-if="manager && game.phase === 'active'" type="button" :disabled="busy" @click="act('cancel')">Завершить ритуал</button>
        </template>
        <form v-if="manager && (!game || game.phase !== 'active')" class="setup" @submit.prevent="act('create', { limit })"><h4>Начать новый ритуал</h4><label>Общий запас ходов (6–20)<input v-model.number="limit" type="number" min="6" max="20" required :disabled="busy" /></label><button type="submit" class="primary" :disabled="busy">Пробудить печати</button></form>
        <p v-else-if="!game">Мастер ещё не начал ритуал. Все участники увидят один общий круг.</p>
      </template>
      <details class="rules" open><summary>Правила — шаг за шагом</summary><ol><li><b>Цель:</b> получить по 3 энергии во всех четырёх печатях до конца запаса ходов. Всего всегда 12 энергии.</li><li>Нажмите печать-источник, выберите 1 или 2 энергии и соседа слева или справа по кругу. Через центр передавать нельзя. Один перенос расходует один общий ход.</li><li>В печати может быть от 0 до 6 энергии. Если передача превысит 6, энергия останется на месте, ход потратится и нестабильность вырастет на 1. Третья перегрузка завершает ритуал неудачей.</li><li>«Успокоить круг» снижает нестабильность на 1 и тоже расходует ход. Недостаток энергии у источника — недоступное действие, ход не тратится.</li><li>Все действуют совместно, без очереди. Обсудите план перед нажатием: ходов на весь отряд один запас. Победа возможна и последним ходом.</li></ol><p><b>Пример:</b> у Пламени 5, у Прилива 1. Перенос 2 энергии из Пламени в Прилив даст обеим печатям по 3 и потратит один ход.</p><p>Это отдельный игровой круг: позиции фигур, боевые действия, урон и награды автоматически не меняются. Мастер применяет последствия сцены сам. Закрытие окна сохраняет ритуал до перезапуска сервера.</p></details>
    </main>
  </div></div>
</template>
<style scoped>
.ritual-overlay{position:fixed;inset:0;z-index:3000;display:flex;align-items:center;justify-content:center;padding:18px;background:#000a;backdrop-filter:blur(3px)}.ritual-card{width:min(680px,100%);max-height:90vh;display:flex;flex-direction:column;overflow:hidden;padding:0;border:1px solid var(--brass);border-radius:12px;background:var(--parchment-background);color:var(--ink);box-shadow:var(--g-ring),var(--g-shadow)}header{display:flex;align-items:center;gap:12px;padding:18px;background:var(--surface-inset);border-bottom:3px double var(--brass-light)}header h3{margin:3px 0 0;font-size:24px}header>button:last-child{margin-left:auto}main{padding:20px;overflow:auto;min-height:0}small{color:var(--muted-ink);font-size:12px}.status{display:flex;flex-direction:column;gap:6px}.status span,.intro{font-size:13px}.circle{display:grid;grid-template-columns:1fr 1fr 1fr;grid-template-rows:auto auto auto;gap:6px;max-width:460px;margin:18px auto;background:radial-gradient(circle,transparent 44%,var(--brass-light) 45%,transparent 46%),radial-gradient(circle,color-mix(in srgb,var(--brass) 18%,transparent),transparent 70%)}.seal{display:flex;flex-direction:column;align-items:center;gap:4px;border:2px solid var(--brass-light);border-radius:24px;background:var(--surface-inset);padding:12px 5px;color:var(--ink)}.seal-0{grid-area:1/2}.seal-1{grid-area:2/3}.seal-2{grid-area:3/2}.seal-3{grid-area:2/1}.heart{grid-area:2/2;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:48px;color:var(--brass)}.seal>span:first-child{font-size:30px}.seal strong{font-size:23px}.seal b{font-size:14px}.seal.selected{outline:2px solid var(--brass);outline-offset:3px}.seal.balanced{border-color:var(--g-good,var(--brass))}.seal:disabled{opacity:1}.pips{display:flex;gap:3px}.pips i{width:7px;height:7px;border:1px solid var(--brass);border-radius:50%}.pips .filled{background:var(--brass)}.controls{padding:14px;background:var(--surface-inset);border:1px solid var(--brass-light);text-align:center}.controls p{font-size:13px}.amount,.directions{display:flex;justify-content:center;gap:8px;margin:10px 0}.amount button[aria-pressed=true]{outline:2px solid var(--brass)}.directions button{flex:1;display:flex;flex-direction:column;align-items:center;gap:5px}.directions small{color:var(--g-warn,var(--ink))}.event{padding:12px;border-left:3px solid var(--brass);background:var(--surface-inset);line-height:1.6}.setup{display:grid;gap:12px;padding:16px;border:1px solid var(--brass-light);margin-block:12px}.setup h4{margin:0}.setup label{display:flex;align-items:center;gap:12px}.setup input{width:80px}.rules{border-top:1px solid var(--brass-light);margin-top:16px}.rules li,li,.rules p{font-size:13px;line-height:1.65;margin:8px 0}ol{padding-left:22px}@media(max-width:460px){main{padding:12px}header{padding:12px}header h3{font-size:20px}.seal b{font-size:12px}.directions{flex-direction:column}.circle{gap:4px}.seal{padding:9px 3px}}
</style>
