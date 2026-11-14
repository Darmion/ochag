<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import GameIcon from '../game/GameIcon.vue';
import ClauseRow from './ClauseRow.vue';
import ConditionIcon from './ConditionIcon.vue';
import StagesEditor from './StagesEditor.vue';
import { rememberAssetImage } from '../../art/assetImages';
import type { GameIconName } from '../../ui/gameIcons';
import { confirmAction } from '../../ui/confirmDialog';
import { CLAUSE_CATALOG, CLAUSE_KINDS, clause as newClause, describeRule, type Clause, type ClauseKind, type ConditionKind, type ConditionStage } from '../../../../../packages/domain/combat/condition-rules';
import { conditionImage, loadCampaignConditions, setCampaignConditions, type ConditionRuleView } from '../../rules/campaignConditions';

const props = defineProps<{ campaignId: string; request: (path: string, method?: string, body?: unknown, file?: File) => Promise<any> }>();

const KINDS: Array<[ConditionKind, string, string]> = [
  ['condition', 'Состояние', 'Свои состояния и эффекты стола'],
  ['disease', 'Болезнь', 'Заразы, гнили и лихорадки'],
  ['poison', 'Яд', 'Отравы и токсины'],
  ['curse', 'Проклятие', 'Порчи и проклятия'],
  ['effect', 'Эффект', 'Магические и прочие эффекты'],
];
const ICONS: GameIconName[] = [
  'alert', 'skull', 'poison', 'flask', 'potion', 'spiral', 'heartOff', 'eyeOff', 'earOff', 'ghost', 'chain', 'stone', 'bolt', 'moon',
  'flame', 'snowflake', 'drop', 'mask', 'frown', 'ban', 'hand', 'holy', 'sparkle', 'wind', 'fog', 'paw', 'sprout', 'dmgPsychic', 'dmgAcid', 'hourglass',
  'stunned', 'unconscious', 'invisible', 'stupor', 'slowed', 'hasted', 'noReactions', 'blessed', 'baned', 'outlined', 'sanctuary', 'wings',
  'charmed', 'frightened', 'paralyzed', 'lethargic', 'blurred', 'stoneskin',
];

const rules = ref<ConditionRuleView[]>([]);
const canEdit = ref(false);
const selectedCode = ref('frightened');
const busy = ref(false);
const error = ref('');
const notice = ref('');
const search = ref('');
const iconsOpen = ref(false);
const addKind = ref<ClauseKind | ''>('');

type Draft = { name: string; icon: GameIconName; iconAssetId: string | null; kind: ConditionKind; description: string; clauses: Clause[]; stages: ConditionStage[] };
const draft = ref<Draft | null>(null);

const selected = computed(() => rules.value.find(rule => rule.code === selectedCode.value) ?? null);
const draftOf = (rule: ConditionRuleView): Draft => ({
  name: rule.name, icon: rule.icon, iconAssetId: rule.iconAssetId ?? null, kind: rule.kind, description: rule.description ?? '', clauses: rule.clauses.map(entry => ({ kind: entry.kind, values: { ...entry.values } })),
  stages: (rule.stages ?? []).map(stage => ({ name: stage.name, clauses: stage.clauses.map(entry => ({ kind: entry.kind, values: { ...entry.values } })) })),
});
const draftImage = computed(() => conditionImage({ iconAssetId: draft.value?.iconAssetId }));
const iconChoices = computed(() => [...new Set<GameIconName>([...(selected.value?.srd ? [selected.value.srd.icon] : []), ...ICONS])]);
const dirty = computed(() => Boolean(selected.value && draft.value && JSON.stringify(draftOf(selected.value)) !== JSON.stringify(draft.value)));

const matches = (rule: ConditionRuleView) => {
  const text = search.value.trim().toLowerCase();
  return !text || rule.name.toLowerCase().includes(text) || rule.summary.toLowerCase().includes(text);
};
const STANDARD_HEADINGS: Record<ConditionKind, string> = { condition: 'Стандартные (SRD)', disease: 'Болезни SRD', poison: 'Яды SRD', curse: 'Проклятия SRD', effect: 'Эффекты SRD' };
const standardGroups = computed(() => [
  ...KINDS.map(([kind]) => ({ kind, label: STANDARD_HEADINGS[kind], items: rules.value.filter(rule => rule.standard && rule.origin !== 'mod' && rule.kind === kind && matches(rule)) })),
  { kind: 'effect' as ConditionKind, label: 'Из модов', items: rules.value.filter(rule => rule.standard && rule.origin === 'mod' && matches(rule)) },
].filter(group => group.items.length));
const sourceName = (rule: ConditionRuleView) => (rule.origin === 'mod' ? `мод «${rule.modName ?? ''}»` : 'SRD 5.1');
const customGroups = computed(() => KINDS
  .map(([kind, label]) => ({ kind, label, items: rules.value.filter(rule => !rule.standard && rule.kind === kind && matches(rule)) }))
  .filter(group => group.items.length));
const changedCount = computed(() => rules.value.filter(rule => rule.standard && rule.changed).length);
const kindLabel = (kind: ConditionKind) => KINDS.find(entry => entry[0] === kind)?.[1] ?? 'Состояние';
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function apply(list: ConditionRuleView[], keep = selectedCode.value) {
  rules.value = list;
  setCampaignConditions(props.campaignId, list, canEdit.value);
  selectedCode.value = list.some(rule => rule.code === keep) ? keep : list[0]?.code ?? '';
  draft.value = selected.value ? draftOf(selected.value) : null;
}

async function run(action: () => Promise<void>) {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await action();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось сохранить. Проверьте связь с сервером и повторите.';
  } finally {
    busy.value = false;
  }
}

onMounted(() => run(async () => {
  const data = await loadCampaignConditions(props.request, props.campaignId);
  if (!data) return;
  canEdit.value = data.canEdit;
  apply(data.rules);
}));

async function choose(code: string) {
  if (code === selectedCode.value) return;
  if (dirty.value && !(await confirmAction('В этом состоянии есть несохранённые правки. Перейти и отбросить их?', { title: 'Несохранённые правки', confirmLabel: 'Отбросить правки', danger: true }))) return;
  selectedCode.value = code;
  draft.value = selected.value ? draftOf(selected.value) : null;
  iconsOpen.value = false;
}

function updateClause(index: number, value: Clause) {
  if (!draft.value) return;
  draft.value.clauses = draft.value.clauses.map((entry, at) => (at === index ? value : entry));
}
function removeClause(index: number) {
  if (draft.value) draft.value.clauses = draft.value.clauses.filter((_, at) => at !== index);
}
function moveClause(index: number, step: -1 | 1) {
  if (!draft.value) return;
  const list = [...draft.value.clauses];
  const [item] = list.splice(index, 1);
  list.splice(index + step, 0, item!);
  draft.value.clauses = list;
}
function addClause() {
  if (!draft.value || !addKind.value) return;
  draft.value.clauses = [...draft.value.clauses, newClause(addKind.value)];
  addKind.value = '';
}

function save() {
  const rule = selected.value;
  if (!rule || !draft.value) return;
  return run(async () => {
    const body = rule.standard
      ? { clauses: draft.value!.clauses, stages: draft.value!.stages, description: draft.value!.description, icon: draft.value!.icon, iconAssetId: draft.value!.iconAssetId }
      : { ...draft.value!, name: draft.value!.name.trim() || rule.name };
    const saved: ConditionRuleView = await props.request(`/campaigns/${props.campaignId}/condition-rules/${rule.code}`, 'PUT', body);
    apply(rules.value.map(entry => (entry.code === saved.code ? saved : entry)), saved.code);
    notice.value = `Сохранено: «${capital(saved.name)}» теперь работает так за столом.`;
  });
}

async function resetToSrd() {
  const rule = selected.value;
  if (!rule?.standard) return;
  const fromMod = rule.origin === 'mod';
  const question = fromMod
    ? `Вернуть «${capital(rule.name)}» к правилам мода «${rule.modName ?? ''}»? Ваши правки этого состояния пропадут.`
    : `Вернуть «${capital(rule.name)}» к правилам SRD? Ваши правки этого состояния пропадут.`;
  if (!(await confirmAction(question, { title: fromMod ? 'Вернуть правила мода' : 'Вернуть правила SRD', confirmLabel: fromMod ? 'Вернуть правила мода' : 'Вернуть SRD', danger: true }))) return;
  await run(async () => {
    const result = await props.request(`/campaigns/${props.campaignId}/condition-rules/${rule.code}`, 'DELETE');
    apply(result.rules, rule.code);
    notice.value = fromMod ? `«${capital(rule.name)}» снова работает по правилам мода.` : `«${capital(rule.name)}» снова работает по правилам SRD.`;
  });
}

function pickIcon(icon: GameIconName) {
  if (!draft.value) return;
  draft.value.icon = icon;
  draft.value.iconAssetId = null;
  iconsOpen.value = false;
}

function clearPicture() {
  if (draft.value) draft.value.iconAssetId = null;
  iconsOpen.value = false;
}

async function uploadPicture(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || !draft.value) return;
  const target = draft.value;
  iconsOpen.value = false;
  await run(async () => {
    const uploaded = await props.request(`/campaigns/${props.campaignId}/assets?kind=object_image`, 'POST', undefined, file);
    rememberAssetImage(props.campaignId, uploaded.id, file);
    target.iconAssetId = uploaded.id;
    notice.value = 'Картинка загружена. Сохраните правила — и её увидят все за столом.';
  });
}

function discard() {
  if (selected.value) draft.value = draftOf(selected.value);
}

function create(kind: ConditionKind) {
  return run(async () => {
    const name = { condition: 'Новое состояние', disease: 'Новая болезнь', poison: 'Новый яд', curse: 'Новое проклятие', effect: 'Новый эффект' }[kind];
    const icon: GameIconName = kind === 'disease' ? 'sprout' : kind === 'poison' ? 'poison' : kind === 'curse' ? 'skull' : kind === 'effect' ? 'sparkle' : 'alert';
    const created: ConditionRuleView = await props.request(`/campaigns/${props.campaignId}/condition-rules`, 'POST', { name, kind, icon, clauses: [] });
    apply([...rules.value, created], created.code);
    notice.value = 'Готово: назовите состояние и добавьте, что оно делает.';
  });
}

async function remove() {
  const rule = selected.value;
  if (!rule || rule.standard) return;
  if (!(await confirmAction(`Удалить «${capital(rule.name)}»? Его правила пропадут, на существах оно сейчас не висит.`, { title: 'Удалить состояние', confirmLabel: 'Удалить состояние', danger: true }))) return;
  await run(async () => {
    const result = await props.request(`/campaigns/${props.campaignId}/condition-rules/${rule.code}`, 'DELETE');
    apply(result.rules, 'frightened');
  });
}

const newKind = ref<ConditionKind | ''>('');
function onCreatePick() {
  if (!newKind.value) return;
  const kind = newKind.value;
  newKind.value = '';
  void create(kind);
}
</script>

<template>
  <section class="conditions-tab panel">
    <header class="conditions-hero">
      <span class="hero-mark" aria-hidden="true"><GameIcon name="spiral" :size="30" /></span>
      <div class="hero-text">
        <h2>Состояния, болезни и яды</h2>
        <p class="muted">
          Как состояния работают за этим столом. Каждое — набор положений: помехи, запреты, скорость.
          {{ canEdit ? 'Измените любое положение — игра сразу начнёт его соблюдать. Правила SRD всегда можно вернуть.' : 'Правила задаёт мастер; здесь видно, как он их настроил.' }}
        </p>
      </div>
      <span v-if="changedCount" class="hero-badge" :title="'Стандартных состояний, изменённых мастером'">Изменено мастером: {{ changedCount }}</span>
    </header>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <div class="conditions-layout">
      <aside class="conditions-list" aria-label="Состояния кампании">
        <input v-model="search" type="search" class="list-search" placeholder="Найти: испуг, яд, скорость…" aria-label="Найти состояние" />
        <label v-if="canEdit" class="create-pick">
          <GameIcon name="plus" :size="16" />
          <select v-model="newKind" :disabled="busy" aria-label="Создать своё" @change="onCreatePick">
            <option value="" disabled>Создать своё…</option>
            <option v-for="[kind, label, hint] in KINDS" :key="kind" :value="kind" :title="hint">{{ label }}</option>
          </select>
        </label>

        <template v-for="group in standardGroups" :key="`srd-${group.label}`">
          <h3 class="list-heading" :class="`kind-${group.kind}`">{{ group.label }}</h3>
          <ul class="list-items">
            <li v-for="rule in group.items" :key="rule.code">
              <button type="button" class="list-item" :class="{ active: rule.code === selectedCode }" :aria-current="rule.code === selectedCode ? 'true' : undefined" @click="choose(rule.code)">
                <span class="item-icon" :class="`kind-${rule.kind}`"><ConditionIcon :name="rule.icon" :image="conditionImage(rule)" :size="conditionImage(rule) ? 28 : 18" /></span>
                <span class="item-name">{{ capital(rule.name) }}</span>
                <span v-if="rule.changed" class="item-dot" title="Изменено мастером" aria-label="изменено" />
                <span v-if="rule.inUse" class="item-count" :title="`Сейчас на существах: ${rule.inUse}`">{{ rule.inUse }}</span>
              </button>
            </li>
          </ul>
        </template>

        <template v-for="group in customGroups" :key="group.kind">
          <h3 class="list-heading" :class="`kind-${group.kind}`">{{ group.label }}</h3>
          <ul class="list-items">
            <li v-for="rule in group.items" :key="rule.code">
              <button type="button" class="list-item" :class="{ active: rule.code === selectedCode }" :aria-current="rule.code === selectedCode ? 'true' : undefined" @click="choose(rule.code)">
                <span class="item-icon" :class="`kind-${rule.kind}`"><ConditionIcon :name="rule.icon" :image="conditionImage(rule)" :size="conditionImage(rule) ? 28 : 18" /></span>
                <span class="item-name" translate="no">{{ capital(rule.name) }}</span>
                <span v-if="rule.inUse" class="item-count" :title="`Сейчас на существах: ${rule.inUse}`">{{ rule.inUse }}</span>
              </button>
            </li>
          </ul>
        </template>
        <p v-if="!standardGroups.length && !customGroups.length" class="muted list-empty">Ничего не нашлось.</p>
      </aside>

      <article v-if="selected && draft" class="condition-card" :class="`kind-${draft.kind}`">
        <header class="card-head">
          <div class="card-icon-wrap">
            <button v-if="canEdit" type="button" class="card-icon" :class="{ 'has-image': draftImage }" :aria-expanded="iconsOpen" title="Выбрать значок или свою картинку" :disabled="busy" @click="iconsOpen = !iconsOpen">
              <ConditionIcon :name="draft.icon" :image="draftImage" :size="draftImage ? 64 : 34" />
              <span class="card-icon-edit" aria-hidden="true"><GameIcon name="pencil" :size="13" /></span>
            </button>
            <span v-else class="card-icon" :class="{ 'has-image': draftImage }"><ConditionIcon :name="draft.icon" :image="draftImage" :size="draftImage ? 64 : 34" /></span>
            <div v-if="iconsOpen" class="icon-popover g-frame" role="dialog" aria-label="Значок состояния" @keydown.esc.stop="iconsOpen = false">
              <div class="icon-grid" role="listbox" aria-label="Значки">
                <button class="icon-only"
                  v-for="icon in iconChoices" :key="icon" type="button" role="option" :aria-selected="!draft.iconAssetId && draft.icon === icon"
                  :class="{ picked: !draft.iconAssetId && draft.icon === icon, srd: selected.srd?.icon === icon }" :title="selected.srd?.icon === icon ? 'Значок из правил SRD' : undefined"
                  @click="pickIcon(icon)"
                ><GameIcon :name="icon" :size="20" /></button>
              </div>
              <div class="picture-row">
                <label class="picture-upload">
                  <GameIcon name="image" :size="16" /> Своя картинка…
                  <input type="file" accept="image/png,image/jpeg,image/webp" :disabled="busy" @change="uploadPicture" />
                </label>
                <button v-if="draft.iconAssetId" type="button" :disabled="busy" @click="clearPicture">Убрать картинку</button>
              </div>
              <small class="muted">PNG, JPEG или WebP, лучше квадратная. Её видят все: на поле, в листе, в панели.</small>
            </div>
          </div>
          <div class="card-title">
            <input v-if="canEdit && !selected.standard" v-model="draft.name" class="title-input" maxlength="60" aria-label="Название" translate="no" :disabled="busy" />
            <h3 v-else :translate="selected.standard ? undefined : 'no'">{{ capital(selected.name) }}</h3>
            <div class="card-chips">
              <select v-if="canEdit && !selected.standard" v-model="draft.kind" class="kind-select" :disabled="busy" aria-label="Вид">
                <option v-for="[kind, label] in KINDS" :key="kind" :value="kind">{{ label }}</option>
              </select>
              <span v-else class="chip kind-chip">{{ selected.standard ? `${sourceName(selected)} · ${kindLabel(selected.kind)}` : kindLabel(selected.kind) }}</span>
              <span v-if="selected.changed && selected.standard" class="chip changed-chip">Изменено мастером</span>
              <span v-if="selected.inUse" class="chip">Сейчас на существах: {{ selected.inUse }}</span>
            </div>
          </div>
        </header>

        <section v-if="selected.srd" class="srd-box" :class="{ differs: selected.changed }">
          <h4>{{ selected.origin === 'mod' ? `Как в моде «${selected.modName ?? ''}»` : 'Как в правилах SRD' }}</h4>
          <p>{{ selected.srd.summary }}</p>
        </section>

        <section class="clauses">
          <h4>Как это работает за вашим столом</h4>
          <ol v-if="draft.clauses.length" class="clause-list">
            <ClauseRow
              v-for="(entry, index) in draft.clauses" :key="`${index}-${entry.kind}`"
              :clause="entry" :index="index" :count="draft.clauses.length" :editable="canEdit" :busy="busy"
              @update="updateClause(index, $event)" @remove="removeClause(index)" @move="moveClause(index, $event)"
            />
          </ol>
          <p v-else class="muted empty-clauses">{{ canEdit ? 'Пока это состояние ничего не делает — добавьте первое положение.' : 'Это состояние ничего не меняет в бросках и движении: его ведёт мастер.' }}</p>
          <div v-if="canEdit" class="add-clause">
            <select v-model="addKind" :disabled="busy" aria-label="Добавить положение">
              <option value="" disabled>Добавить положение…</option>
              <option v-for="kind in CLAUSE_KINDS" :key="kind" :value="kind" :title="CLAUSE_CATALOG[kind].hint">{{ CLAUSE_CATALOG[kind].label }}</option>
            </select>
            <button type="button" :disabled="busy || !addKind" @click="addClause"><GameIcon name="plus" :size="14" /> Добавить</button>
            <small v-if="addKind" class="muted add-hint">{{ CLAUSE_CATALOG[addKind].hint }}</small>
          </div>
        </section>

        <StagesEditor
          v-if="canEdit || draft.stages.length" :stages="draft.stages" :editable="canEdit" :busy="busy" :own="!selected.standard"
          @update="draft.stages = $event"
        />

        <section class="description">
          <h4>Пояснение для игроков</h4>
          <textarea
            v-if="canEdit" v-model="draft.description" rows="3" maxlength="2000" :disabled="busy" translate="no"
            placeholder="Что видят игроки в подсказке: откуда берётся, как лечится, сколько длится"
          />
          <p v-else-if="selected.description" translate="no">{{ selected.description }}</p>
          <p v-else class="muted">Пояснения нет.</p>
        </section>

        <section class="preview" aria-live="polite">
          <h4>Итог одной строкой</h4>
          <p>{{ describeRule(draft) || '—' }}</p>
        </section>

        <footer v-if="canEdit" class="card-actions">
          <button type="button" class="primary" :disabled="busy || !dirty" @click="save">Сохранить правила</button>
          <button type="button" :disabled="busy || !dirty" @click="discard">Отменить правки</button>
          <span class="spacer" />
          <button v-if="selected.standard && selected.changed" type="button" :disabled="busy" @click="resetToSrd">{{ selected.origin === 'mod' ? 'Вернуть правила мода' : 'Вернуть правила SRD' }}</button>
          <button v-if="!selected.standard" type="button" class="danger" :disabled="busy || selected.inUse > 0" :title="selected.inUse ? 'Сначала снимите его со всех существ' : 'Удалить это состояние из кампании'" @click="remove">Удалить</button>
        </footer>
        <p v-if="notice" class="notice">{{ notice }}</p>
        <p v-if="dirty" class="unsaved">Есть несохранённые правки.</p>
      </article>
    </div>
  </section>
</template>

<style scoped>
.conditions-tab{display:flex;flex-direction:column;gap:14px}
.conditions-hero{display:flex;align-items:center;gap:16px;padding:16px 18px;border:1px solid var(--brass-light);border-radius:8px;background:radial-gradient(circle at 0 0,color-mix(in srgb,#b08d57 22%,transparent),transparent 60%),var(--surface-inset)}
.hero-mark{display:grid;place-items:center;flex:none;width:58px;height:58px;border-radius:50%;background:linear-gradient(145deg,#c9a66b,#7a5a2c);color:#fff8e6;box-shadow:inset 0 0 0 3px #ffffff30,0 4px 12px #0000002e}
.hero-text{flex:1;min-width:0}
.hero-text h2{margin:0 0 4px}
.hero-text p{margin:0;max-width:72ch;line-height:1.5}
.hero-badge{flex:none;padding:4px 12px;border-radius:12px;background:#a2453f;color:#fff;font-size:12px;font-weight:700}
.conditions-layout{display:grid;grid-template-columns:280px minmax(0,1fr);gap:16px;align-items:start}
.conditions-list{position:sticky;top:8px;display:flex;flex-direction:column;gap:8px;max-height:calc(100vh - 160px);overflow:auto;padding:12px;border:1px solid var(--brass-light);border-radius:8px;background:var(--surface-inset)}
.list-search{width:100%;box-sizing:border-box}
.create-pick{position:relative;display:flex;align-items:center;gap:6px;margin:0;padding:0 0 0 10px;border:1px dashed var(--brass-light);border-radius:6px;color:var(--muted-ink)}
.create-pick select{flex:1;border:0;background:transparent;box-shadow:none;font-weight:700;color:var(--ink)}
.list-heading.kind-disease{color:#3f6b37}
.list-heading.kind-poison{color:#5b3a7a}
.list-heading{margin:8px 2px 2px;font:700 12px var(--heading-font);letter-spacing:.06em;text-transform:uppercase;color:var(--muted-ink)}
.list-items{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:3px}
.list-item{display:flex;align-items:center;gap:9px;width:100%;min-height:36px;padding:4px 8px;justify-content:flex-start;text-align:left;border-color:transparent;background:transparent;box-shadow:none}
.list-item:hover{background:color-mix(in srgb,#b08d57 14%,transparent)}
.list-item.active{border-color:var(--brass-light);background:color-mix(in srgb,#b08d57 24%,transparent);box-shadow:inset 3px 0 0 #b08d57}
.item-icon{display:grid;place-items:center;flex:none;width:28px;height:28px;border-radius:50%;background:#00000014;color:var(--ink)}
.item-icon.kind-disease{background:#5c8a5233;color:#3f6b37}
.item-icon.kind-poison{background:#7a4f9e33;color:#5b3a7a}
.item-icon.kind-curse{background:#a2453f33;color:#7a2f2a}
.item-icon.kind-effect{background:#4f7f9e33;color:#2f5f7e}
.item-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.item-dot{flex:none;width:8px;height:8px;border-radius:50%;background:#a2453f}
.item-count{flex:none;min-width:20px;padding:0 6px;border-radius:9px;background:#b08d57;color:#fff;font-size:11px;font-weight:700;text-align:center}
.list-empty{margin:6px 2px}
.condition-card{display:flex;flex-direction:column;gap:14px;padding:18px 20px;border:1px solid var(--brass-light);border-top:5px solid #b08d57;border-radius:8px;background:var(--surface-inset);box-shadow:0 6px 18px #0000001a}
.condition-card.kind-disease{border-top-color:#5c8a52}
.condition-card.kind-poison{border-top-color:#7a4f9e}
.condition-card.kind-curse{border-top-color:#a2453f}
.condition-card.kind-effect{border-top-color:#4f7f9e}
.card-head{display:flex;align-items:center;gap:16px}
.card-icon-wrap{position:relative;flex:none}
.card-icon{display:grid;place-items:center;width:64px;height:64px;min-height:64px;padding:0;border-radius:50%;background:linear-gradient(145deg,#efe2c4,#cdb487);color:#4a3517;box-shadow:inset 0 0 0 3px #ffffff60,0 3px 10px #00000026}
.card-icon{position:relative;overflow:visible}
.card-icon.has-image{background:#00000026}
.card-icon :deep(.condition-image){border-radius:50%}
.card-icon-edit{position:absolute;right:-2px;bottom:-2px;display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#b08d57;color:#fff;box-shadow:0 1px 4px #0000004d}
.icon-popover{position:absolute;z-index:6;top:calc(100% + 6px);left:0;display:flex;flex-direction:column;gap:8px;width:max-content;max-width:280px;padding:8px;background:var(--surface-inset,#f4ead6);box-shadow:0 10px 24px #0000004d}
.icon-grid{display:grid;grid-template-columns:repeat(6,36px);gap:4px}
.icon-grid button{display:grid;place-items:center;width:36px;min-width:36px;height:36px;min-height:36px;padding:0}
.icon-grid button.srd{box-shadow:inset 0 0 0 2px #b08d57}
.icon-grid button.picked{background:#b08d57;color:#fff}
.picture-row{display:flex;flex-wrap:wrap;gap:6px;padding-top:8px;border-top:1px solid var(--brass-light)}
.picture-upload{position:relative;display:inline-flex;align-items:center;gap:6px;min-height:32px;padding:0 12px;border:1px solid var(--brass-light);border-radius:6px;cursor:pointer;font-weight:700}
.picture-upload:hover{background:color-mix(in srgb,#b08d57 16%,transparent)}
.picture-upload input{position:absolute;inset:0;opacity:0;cursor:pointer}
.icon-popover small{font-size:12px;line-height:1.35}
.item-icon :deep(.condition-image){border-radius:50%}
.card-title{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.card-title h3{margin:0;font-size:24px}
.title-input{font:700 22px var(--heading-font);max-width:420px}
.card-chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.chip{padding:2px 10px;border-radius:11px;border:1px solid var(--brass-light);font-size:12px;color:var(--muted-ink)}
.kind-chip{font-weight:700;color:var(--ink)}
.changed-chip{border-color:#a2453f;color:#a2453f;font-weight:700}
.kind-select{width:auto;min-width:150px;max-width:220px;min-height:28px;font-size:13px}
.srd-box{padding:10px 14px;border-radius:6px;border:1px dashed var(--brass-light);background:color-mix(in srgb,var(--surface-inset) 86%,#b08d57 14%)}
.srd-box.differs{border-color:#a2453f80}
.srd-box h4,.clauses h4,.description h4,.preview h4{margin:0 0 8px;font:700 13px var(--heading-font);letter-spacing:.05em;text-transform:uppercase;color:var(--muted-ink)}
.srd-box p{margin:0;line-height:1.5;font-style:italic}
.clause-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.empty-clauses{margin:0;padding:14px;border:1px dashed var(--brass-light);border-radius:6px;text-align:center}
.add-clause{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.add-clause select{flex:1 1 320px;min-width:0}
.add-clause button{display:inline-flex;align-items:center;gap:6px}
.add-hint{flex-basis:100%}
.description textarea{width:100%;box-sizing:border-box;resize:vertical}
.description p,.preview p{margin:0;line-height:1.5}
.preview{padding:10px 14px;border-radius:6px;background:color-mix(in srgb,#b08d57 12%,transparent)}
.card-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding-top:6px;border-top:1px solid var(--brass-light)}
.spacer{flex:1}
.notice{margin:0;color:#3f6b37;font-weight:700}
.unsaved{margin:0;color:#a2453f;font-size:13px}
.error{margin:0;color:#8e2a2f}
@media(max-width:900px){.conditions-layout{grid-template-columns:1fr}.conditions-list{position:static;max-height:none}}
@media(max-width:600px){.conditions-hero{flex-wrap:wrap}.card-head{align-items:flex-start}}
</style>
