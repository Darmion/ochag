<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { INGREDIENTS, RECIPES, alchemyReady, type Alchemy } from '../../../../../packages/domain/minigames/alchemy';
import { useEscapeClose } from '../../ui/escapeStack';
import { confirmAction } from '../../ui/confirmDialog';
import GameIcon from '../game/GameIcon.vue';
const props = defineProps<{ campaignId: string; request: (path: string, method?: string, body?: unknown) => Promise<any> }>();
const emit = defineEmits<{ close: []; back: [] }>();
useEscapeClose(() => emit('close'));
const game = ref<Alchemy | null>(null), manager = ref(false), loaded = ref(false), busy = ref(false), error = ref('');
const limit = ref(8), recipe = ref(0);
const ready = computed(() => game.value ? alchemyReady(game.value) : false);
const working = computed(() => active.value && game.value!.moves < game.value!.limit);
function delta(n: number) { return n > 0 ? `+${n}` : String(n); }
function risky(index: number) { const g = game.value; const i = INGREDIENTS[index]; return g && (g.heat + i.heat > 6 || g.stability + i.stability < 0); }
const active = computed(() => game.value?.phase === 'brewing' && !busy.value);
const path = `/campaigns/${props.campaignId}/minigames/alchemy`;
let timer: ReturnType<typeof setTimeout> | undefined, disposed = false, generation = 0;
function apply(result: { game: Alchemy | null; manager: boolean }) { game.value = result.game; manager.value = result.manager; loaded.value = true; }
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
    if (action === 'cancel' && !await confirmAction('Завершить приготовление для всего отряда?', { title: 'Алхимический котёл', confirmLabel: 'Завершить' })) return;
    if (action === 'bottle' && !ready.value && !await confirmAction('Рецепт пока не соблюдён. Разлить смесь с побочным эффектом? Приготовление завершится.', { title: 'Нестандартная смесь', confirmLabel: 'Разлить' })) return;
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
  <div class="modal-overlay alchemy-overlay" role="dialog" aria-modal="true" aria-labelledby="alchemy-title"><div class="modal-card alchemy-card">
    <header><button type="button" aria-label="К списку мини-игр" @click="emit('back')">←</button><div><small>Лаборатория · совместное приготовление</small><h3 id="alchemy-title">Алхимический котёл</h3></div><button type="button" aria-label="Закрыть мини-игру" @click="emit('close')"><GameIcon class="inline-icon" name="close" :size="16" /></button></header>
    <main>
      <p v-if="error" role="alert">{{ error }} <button type="button" :disabled="busy" @click="refresh">Обновить</button></p>
      <p v-if="!loaded" role="status">Разжигаю очаг…</p>
      <template v-else>
        <template v-if="game">
          <div class="recipe"><small>Рецепт</small><h4>{{ RECIPES[game.recipe].name }}</h4><p>{{ RECIPES[game.recipe].description }}</p><span>Жар {{ RECIPES[game.recipe].heat.join('–') }} · эссенция ровно {{ RECIPES[game.recipe].essence }} · устойчивость от {{ RECIPES[game.recipe].stability }}</span></div>
          <div class="workbench">
            <div class="cauldron" :class="{ ready, ruined: game.phase === 'burned' }" aria-hidden="true"><div class="steam">✧ · ✧</div><div class="vessel"><span>{{ game.phase === 'perfect' ? '✦' : game.phase === 'burned' ? '×' : '≈' }}</span></div><div class="fire">♨ ♨ ♨</div></div>
            <div class="gauges"><label>Жар <b>{{ game.heat }} / 6</b><meter :value="game.heat" min="0" max="7" :aria-label="`Жар ${game.heat}`" /></label><label>Эссенция <b>{{ game.essence }} / {{ RECIPES[game.recipe].essence }}</b><meter :value="game.essence" min="0" max="12" :aria-label="`Эссенция ${game.essence}`" /></label><label>Устойчивость <b>{{ game.stability }} / 6</b><meter :value="Math.max(0, game.stability)" min="0" max="6" :aria-label="`Устойчивость ${game.stability}`" /></label></div>
          </div>
          <div class="status"><b>{{ game.phase === 'brewing' ? ready ? 'Рецепт соблюдён — пора разливать' : 'Смесь готовится' : game.phase === 'perfect' ? 'Безупречный результат' : game.phase === 'flawed' ? 'Смесь с побочным эффектом' : game.phase === 'burned' ? 'Смесь испорчена' : 'Приготовление завершено' }}</b><span>Действия: {{ game.moves }} / {{ game.limit }}</span></div>
          <template v-if="game.phase === 'brewing'">
            <p v-if="game.moves === game.limit" class="event">{{ game.essence ? 'Действия закончились. Разлейте смесь — результат зависит от её текущих свойств.' : 'Действия закончились, но ингредиенты не добавлены. Попросите мастера завершить приготовление и начать заново.' }}</p>
            <div class="ingredients"><button v-for="(ingredient, index) in INGREDIENTS" :key="ingredient.name" type="button" :disabled="!working || !game.stock[index]" @click="act('add', { ingredient: index })"><span aria-hidden="true">{{ ingredient.glyph }}</span><strong>{{ ingredient.name }}</strong><small>Жар {{ delta(ingredient.heat) }} · эссенция {{ delta(ingredient.essence) }} · устойчивость {{ delta(ingredient.stability) }}</small><b>В запасе: {{ game.stock[index] }}</b><em v-if="risky(index)">Испортит смесь!</em></button></div>
            <div class="tools"><button type="button" :disabled="!working" @click="act('heat')">Подогреть +1 <small v-if="game.heat === 6">Испортит смесь!</small></button><button type="button" :disabled="!working || !game.heat" @click="act('cool')">Охладить −1</button><button type="button" :disabled="!working || game.stability === 6" @click="act('stir')">Перемешать · устойчивость +1</button></div>
            <button type="button" class="bottle primary" :disabled="!active || !game.essence" @click="act('bottle')">{{ ready ? 'Разлить готовое зелье' : 'Разлить текущую смесь' }}</button>
          </template>
          <p class="event" role="status">{{ game.message }}</p>
          <details v-if="game.history.length"><summary>Журнал приготовления</summary><ol><li v-for="(entry, index) in game.history" :key="index">{{ entry }}</li></ol></details>
          <button v-if="manager && game.phase === 'brewing'" type="button" :disabled="busy" @click="act('cancel')">Завершить приготовление</button>
        </template>
        <form v-if="manager && (!game || game.phase !== 'brewing')" class="setup" @submit.prevent="act('create', { recipe, limit })"><h4>Новый котёл</h4><label>Рецепт<select v-model.number="recipe" :disabled="busy"><option v-for="(entry, index) in RECIPES" :key="entry.name" :value="index">{{ entry.name }}</option></select></label><label>Запас действий<input v-model.number="limit" type="number" min="4" max="16" required :disabled="busy" /></label><button type="submit" class="primary" :disabled="busy">Начать приготовление</button></form>
        <p v-else-if="!game">Мастер выбирает рецепт и начинает приготовление. Котёл появится у всех участников кампании.</p>
      </template>
      <details class="rules"><summary>Правила — шаг за шагом</summary><ol><li><b>Цель:</b> попасть в диапазон жара рецепта, набрать ровно нужную эссенцию и не меньше указанной устойчивости. Затем нажать «Разлить».</li><li>Начальные свойства: жар 2, эссенция 0, устойчивость 3. Есть по две порции каждого ингредиента. Их эффекты указаны на карточках и применяются сразу.</li><li>Добавление ингредиента, подогрев, охлаждение и перемешивание расходуют по одному общему действию. Все участники работают с одним котлом без очереди — договоритесь, кто нажимает.</li><li>Жар выше 6 или устойчивость ниже 0 сразу портят смесь. Холоднее 0 и устойчивее 6 смесь стать не может. Эссенцию нельзя убрать: следите, чтобы не добавить лишнего.</li><li>Разлив не тратит действие. Если рецепт соблюдён, получится безупречная смесь. Иначе — смесь со светящимся осадком и резким запахом. Разлить чистую воду без ингредиентов нельзя.</li><li>Когда действия закончились, остаётся разлить смесь. Если ингредиенты так и не добавлены, мастер завершает приготовление и начинает заново. Закрытие окна не останавливает приготовление; мастер может завершить его и начать заново.</li></ol><p><b>Пример:</b> два корня мандрагоры и один уголь саламандры дадут жар 4, эссенцию 5 и устойчивость 2 — готовый согревающий эликсир за три действия. Остаётся разлить.</p><p>Ингредиенты здесь учебные: инвентарь, золото и характеристики персонажей не меняются. Выдачу зелья и последствия определяет мастер. Партия сохраняется до перезапуска сервера.</p></details>
    </main>
  </div></div>
</template>
<style scoped>
.alchemy-overlay{position:fixed;inset:0;z-index:3000;display:flex;align-items:center;justify-content:center;padding:18px;background:#000a;backdrop-filter:blur(3px)}.alchemy-card{width:min(720px,100%);max-height:90vh;display:flex;flex-direction:column;overflow:hidden;padding:0;background:var(--parchment-background);color:var(--ink);border:1px solid var(--brass);border-radius:12px;box-shadow:var(--g-ring),var(--g-shadow)}header{display:flex;align-items:center;gap:12px;padding:18px;background:var(--surface-inset);border-bottom:3px double var(--brass-light)}header h3{margin:3px 0 0;font-size:24px}header>button:last-child{margin-left:auto}main{padding:20px;overflow:auto;min-height:0}small{font-size:12px;color:var(--muted-ink)}.recipe{padding:16px;border:1px solid var(--brass-light);border-radius:8px;background:var(--surface-inset)}.recipe h4{margin:4px 0;font-size:21px}.recipe p{font-style:italic;margin:8px 0}.recipe span{font-size:13px}.workbench{display:flex;align-items:center;justify-content:center;gap:28px;padding:20px 0}.cauldron{width:160px;flex-shrink:0;text-align:center}.steam{font-size:30px;color:var(--muted-ink)}.vessel{border:5px double var(--brass);border-top-width:9px;border-radius:14px 14px 60px 60px;background:radial-gradient(ellipse at top,color-mix(in srgb,var(--g-accent,var(--brass)) 50%,transparent),var(--surface-inset));height:100px;display:grid;place-items:center;box-shadow:inset 0 -14px 24px #0004}.vessel span{font-size:46px;color:var(--brass)}.fire{font-size:28px;color:var(--g-warn,var(--brass))}.ready .vessel{border-color:var(--g-good,var(--brass))}.ruined .vessel{border-color:var(--g-bad,var(--brass))}.gauges{display:grid;gap:12px;flex:1;max-width:280px}.gauges label{display:flex;flex-wrap:wrap;justify-content:space-between;font-size:13px;gap:4px}.gauges meter{width:100%;height:12px;accent-color:var(--brass)}.status{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px}.status span{font-size:12px;color:var(--muted-ink)}.ingredients{display:grid;grid-template-columns:1fr 1fr;gap:10px}.ingredients button{display:flex;flex-direction:column;align-items:flex-start;gap:8px;padding:14px;white-space:normal;text-align:left;background:var(--surface-inset);border:1px solid var(--brass-light);border-radius:8px;color:var(--ink)}.ingredients button>span{font-size:30px;color:var(--brass)}.ingredients small{line-height:1.5}.ingredients b{font-size:12px}.ingredients em,.tools small{color:var(--g-bad,var(--ink));font-size:12px}.tools{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}.tools button{flex:1;font-size:12px}.bottle{width:100%}.event{padding:12px;border-left:3px solid var(--brass);background:var(--surface-inset);line-height:1.6}.setup{display:grid;gap:12px;padding:16px;border:1px solid var(--brass-light);margin-block:12px}.setup h4{margin:0}.setup label{display:grid;gap:6px}.setup input{width:100px}.rules{border-top:1px solid var(--brass-light);margin-top:16px}li,.rules p{font-size:13px;line-height:1.65;margin:8px 0}ol{padding-left:22px}@media(max-width:480px){main{padding:12px}header{padding:12px}header h3{font-size:20px}.cauldron{width:110px}.workbench{gap:14px}.ingredients{grid-template-columns:1fr}.tools{flex-direction:column}}
</style>
