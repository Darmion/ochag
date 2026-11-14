<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import GameIcon from './GameIcon.vue';
import ExamineCard, { type ExamineCardView } from './ExamineCard.vue';
import { useEscapeClose } from '../../ui/escapeStack';
import { EXAMINE_PARTS, EXAMINE_PART_LABELS, type ExaminePart } from '../../../../../packages/domain/world/examine';
import type { PortraitFace } from '../../tabletop/view/hudPortraits';

// «Осмотреть» (complaint list 2026-11-11, item 2): a player's hero rolls the GM's skill once and sees what it revealed;
// the GM sees everything and sets the skill, the DC and a DC per part.
const props = defineProps<{
  campaignId: string; characterId: string; name: string; face: PortraitFace | null; defaultHeroId: string | null;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();
const emit = defineEmits<{ close: [] }>();
useEscapeClose(() => emit('close'));

type Settings = { skill: string; dc: number; dcs: Partial<Record<ExaminePart, number>>; text: string };
type View = {
  manager: boolean; skill: { id: string; name: string }; card: ExamineCardView | null; heroes: Array<{ id: string; name: string }>;
  total?: number; own?: boolean; settings?: Settings; skills?: Array<{ id: string; name: string }>; partDcs?: Record<ExaminePart, number>;
  results?: Array<{ heroId: string; name: string; total: number }>;
};
const view = ref<View | null>(null);
const heroId = ref(props.defaultHeroId ?? '');
const busy = ref(false), error = ref(''), rolledNow = ref(false);
const form = ref<{ skill: string; dc: number; dcs: Record<string, number | ''>; text: string }>({ skill: '', dc: 12, dcs: {}, text: '' });
const path = `/campaigns/${props.campaignId}/characters/${props.characterId}/examine`;

async function load() {
  error.value = '';
  try {
    const result: View = await props.request(heroId.value ? `${path}?heroId=${heroId.value}` : path);
    view.value = result;
    if (!heroId.value || !result.heroes.some(hero => hero.id === heroId.value)) heroId.value = result.heroes[0]?.id ?? '';
    if (result.settings) {
      form.value = {
        skill: result.settings.skill, dc: result.settings.dc, text: result.settings.text,
        dcs: Object.fromEntries(EXAMINE_PARTS.map(part => [part, result.settings!.dcs[part] ?? ''])),
      };
    }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось открыть осмотр. Закройте окно и попробуйте ещё раз.'; }
}
onMounted(load);
watch(heroId, (next, previous) => { if (previous && next !== previous && !view.value?.manager) { rolledNow.value = false; void load(); } });

async function examine() {
  if (!heroId.value || busy.value) return;
  busy.value = true; error.value = '';
  try {
    const result = await props.request(path, 'POST', { heroId: heroId.value });
    if (view.value) view.value = { ...view.value, card: result.card, total: result.total };
    rolledNow.value = result.rolled;
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Осмотреть не удалось. Попробуйте ещё раз.'; }
  finally { busy.value = false; }
}
async function save() {
  busy.value = true; error.value = '';
  try {
    const dcs = Object.fromEntries(EXAMINE_PARTS.map(part => [part, form.value.dcs[part] === '' ? null : Number(form.value.dcs[part])]));
    await props.request(path, 'PUT', { skill: form.value.skill, dc: Number(form.value.dc), dcs, text: form.value.text });
    await load();
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Сохранить осмотр не удалось. Проверьте числа и попробуйте ещё раз.'; }
  finally { busy.value = false; }
}
async function reset() {
  busy.value = true; error.value = '';
  try { await props.request(path, 'DELETE'); await load(); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Разрешить новый осмотр не удалось. Попробуйте ещё раз.'; }
  finally { busy.value = false; }
}
const heroName = computed(() => view.value?.heroes.find(hero => hero.id === heroId.value)?.name ?? '');
</script>

<template>
  <div class="modal-overlay examine-overlay" role="dialog" aria-modal="true" aria-labelledby="examine-title">
    <div class="modal-card examine-window g-frame">
      <div class="examine-scroll">
      <header>
        <span class="seal" aria-hidden="true"><GameIcon name="examine" :size="22" /></span>
        <div><small>Осмотр</small><h3 id="examine-title" translate="no">{{ name }}</h3></div>
        <button type="button" class="close icon-only" aria-label="Закрыть осмотр" @click="emit('close')"><GameIcon name="close" :size="16" /></button>
      </header>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-if="!view" role="status">Присматриваюсь…</p>
      <template v-else>
        <ExamineCard v-if="view.card" :card="view.card" :face="face" />
        <p v-if="view.card && !view.manager && view.total !== undefined" class="note">
          {{ rolledNow ? 'Бросок' : 'Уже осматривали — бросок' }}: {{ view.skill.name }} {{ view.total }}<template v-if="heroName"> · <span translate="no">{{ heroName }}</span></template>
        </p>
        <section v-if="!view.manager && !view.card" class="ask">
          <p>Проверка: <b>{{ view.skill.name }}</b>. Сложность задаёт мастер; каждый герой осматривает один раз.</p>
          <div class="row">
            <label>Кто осматривает
              <select v-model="heroId" :disabled="busy || !view.heroes.length">
                <option v-for="hero in view.heroes" :key="hero.id" :value="hero.id" translate="no">{{ hero.name }}</option>
              </select>
            </label>
            <button type="button" class="primary" :disabled="busy || !heroId" @click="examine">Осмотреть</button>
          </div>
          <p v-if="!view.heroes.length" class="muted">У вас нет героя в этой кампании.</p>
        </section>
        <details v-if="view.manager" class="setup" :open="!view.own">
          <summary>Настройка осмотра <small class="muted">— навык {{ view.skill.name }}, СЛ {{ view.settings?.dc }}</small></summary>
          <div class="row">
            <label>Навык
              <select v-model="form.skill" :disabled="busy"><option v-for="skill in view.skills" :key="skill.id" :value="skill.id">{{ skill.name }}</option></select>
            </label>
            <label>СЛ<input v-model.number="form.dc" type="number" min="1" max="40" :disabled="busy" /></label>
          </div>
          <details class="parts">
            <summary>Сложность по частям</summary>
            <p class="muted">Пусто — по общей СЛ: вид и состояния легче (−5), характеристики труднее (+2), сопротивления ещё труднее (+5).</p>
            <label v-for="part in EXAMINE_PARTS" :key="part" class="part">{{ EXAMINE_PART_LABELS[part] }}
              <input v-model.number="form.dcs[part]" type="number" min="1" max="40" :placeholder="String(view.partDcs?.[part] ?? '')" :disabled="busy" />
            </label>
          </details>
          <label class="text">Что видно при осмотре<textarea v-model="form.text" rows="3" maxlength="2000" placeholder="Свежий шрам на шее, пахнет болотом…" :disabled="busy" /></label>
          <div class="row">
            <button type="button" class="primary" :disabled="busy" @click="save">Сохранить осмотр</button>
            <button v-if="view.results?.length" type="button" :disabled="busy" @click="reset">Разрешить осмотреть снова</button>
          </div>
          <p v-if="view.results?.length" class="muted">Уже осматривали: <span translate="no">{{ view.results.map(result => `${result.name} (${result.total})`).join(', ') }}</span></p>
        </details>
      </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.examine-overlay{position:fixed;inset:0;z-index:3000;display:flex;align-items:center;justify-content:center;padding:18px;background:#000a;backdrop-filter:blur(3px)}
.examine-window{width:min(760px,100%);max-height:90vh;overflow:hidden;display:flex;flex-direction:column;padding:0;background:var(--parchment-background);color:var(--ink);border:1px solid var(--brass);border-radius:10px}
.examine-scroll{display:grid;gap:12px;min-height:0;padding:16px 18px;overflow-y:auto;overflow-x:hidden}
header{display:flex;align-items:center;gap:10px;border-bottom:3px double var(--brass-light);padding-bottom:10px}
header h3{margin:2px 0 0;font-size:22px}
header small{color:var(--muted-ink);font-size:12px}
.seal{color:var(--g-gold,var(--brass))}
.close{margin-left:auto;width:32px;min-height:32px;padding:0}
.row{display:flex;flex-wrap:wrap;align-items:end;gap:10px}
.row label,.part,.text{display:grid;gap:4px;font-size:13px}
.row input{width:80px}
.ask{display:grid;gap:8px;padding:12px;border:1px solid var(--brass-light);border-radius:8px;background:var(--surface-inset)}
.ask p{margin:0;font-size:13px}
.note{margin:0;font-size:12px;color:var(--muted-ink)}
.setup{border-top:1px solid var(--brass-light);padding-top:8px;display:grid;gap:8px}
.setup>summary{cursor:pointer;font-weight:600}
.parts{display:grid;gap:6px}
.parts>summary{cursor:pointer;font-size:13px}
.part{grid-template-columns:1fr 80px;align-items:center}
.text textarea{width:100%;resize:vertical}
.muted{color:var(--muted-ink);font-size:12px}
.error{color:var(--g-warn,#e0a14c)}
</style>
