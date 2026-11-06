<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { DAMAGE_TYPES } from '../../rules/objectRules';

export type ObjectState = {
  full: boolean;
  openable: boolean;
  open: boolean;
  locked: boolean | null;
  broken: boolean;
  blocks?: boolean;
  blockKind?: 'both' | 'sight' | 'move';
  light?: { bright: number; dim: number; lit: boolean; openFlame?: boolean; cone?: boolean } | null;
  lockDc?: number | null;
  lockKnown?: boolean;
  breakDc?: number | null;
  trap: { armed: boolean; detected: boolean; detectDc?: number | null; disarmDc?: number | null; note?: string | null } | null;
  secret?: { dc: number; found: boolean } | null;
  passage?: { sceneId: string; targetId?: string | null } | null;
  hazard?: Hazard | null;
};

type Hazard = {
  types: string[]; radiusFeet: number; formula: string; damageType: string;
  save: string | null; dc: number | null; halfOnSuccess: boolean; message: string | null;
};

const HAZARD_PRESETS: Array<{ label: string; hazard: Hazard }> = [
  { label: 'Бочка с маслом', hazard: { types: ['fire'], radiusFeet: 10, formula: '4d6', damageType: 'fire', save: 'dexterity', dc: 12, halfOnSuccess: true, message: 'Масло вспыхивает!' } },
  { label: 'Бочонок пороха', hazard: { types: ['fire', 'lightning'], radiusFeet: 15, formula: '6d6', damageType: 'fire', save: 'dexterity', dc: 13, halfOnSuccess: true, message: 'Грохот взрыва!' } },
  { label: 'Склянка кислоты', hazard: { types: [], radiusFeet: 5, formula: '2d6', damageType: 'acid', save: 'dexterity', dc: 11, halfOnSuccess: true, message: 'Кислота разлетается брызгами.' } },
  { label: 'Подпиленная колонна', hazard: { types: ['bludgeoning', 'force', 'thunder'], radiusFeet: 10, formula: '3d10', damageType: 'bludgeoning', save: 'dexterity', dc: 14, halfOnSuccess: true, message: 'Колонна рушится!' } },
];
const ABILITIES = [['strength', 'Сила'], ['dexterity', 'Ловкость'], ['constitution', 'Телосложение'], ['wisdom', 'Мудрость']] as const;

type Actor = { id: string; name: string };

const props = defineProps<{
  campaignId: string;
  characterId: string;
  name: string;
  state: ObjectState | null;
  canEdit: boolean;
  actors: Actor[];
  busy: boolean;
  scenes?: Array<{ id: string; name: string }>;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();

const emit = defineEmits<{ result: [payload: { message: string; outcome: string }]; travelled: [payload: { sceneId: string; sceneName: string }] }>();

const actorId = ref('');
const working = ref(false);
const error = ref('');

watch(() => props.actors, list => {
  if (!list.some(actor => actor.id === actorId.value)) actorId.value = list[0]?.id ?? '';
}, { immediate: true });

const state = computed(() => props.state);

type Obstacle = 'none' | 'both' | 'sight' | 'move';
const OBSTACLES: Array<{ id: Obstacle; label: string; hint: string }> = [
  { id: 'none', label: 'Не препятствие', hint: 'сквозь видно и можно пройти' },
  { id: 'both', label: 'Загораживает обзор и проход', hint: 'дом, стена, шкаф, закрытая дверь; даёт укрытие' },
  { id: 'sight', label: 'Только обзор', hint: 'занавес, густые кусты, дым — пройти можно, укрытия нет' },
  { id: 'move', label: 'Только проход', hint: 'решётка, витрина, стеклянная стена — видно насквозь, укрытие есть' },
];
const obstacleOf = (value: ObjectState | null | undefined): Obstacle => (value?.blocks ? value.blockKind ?? 'both' : 'none');
const OBSTACLE_STATUS: Record<Exclude<Obstacle, 'none'>, string> = {
  both: 'загораживает проход и обзор', sight: 'загораживает обзор', move: 'загораживает проход, видно насквозь',
};

async function setObstacle(value: Obstacle) {
  working.value = true;
  error.value = '';
  try {
    await props.request(`/campaigns/${props.campaignId}/characters/${props.characterId}/state`, 'PUT', {
      blocks: value !== 'none', ...(value !== 'none' ? { blockKind: value } : {}),
    });
    emit('result', { message: value === 'none' ? `«${props.name}» больше не препятствие.` : `«${props.name}»: ${OBSTACLE_STATUS[value]}.`, outcome: 'saved' });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    working.value = false;
  }
}

const statusText = computed(() => {
  const current = state.value;
  if (!current) return '';
  const parts: string[] = [];
  if (current.broken) parts.push('сломан');
  else if (current.openable) parts.push(current.open ? 'открыт' : 'закрыт');
  if (current.locked) parts.push('заперт');
  if (current.blocks && !current.broken && !(current.openable && current.open)) parts.push(OBSTACLE_STATUS[current.blockKind ?? 'both']);
  if (current.light) parts.push(current.light.lit ? `светит на ${current.light.bright} + ${current.light.dim} фут.` : 'погашен');
  if (current.trap?.armed && (current.trap.detected || current.full)) parts.push(current.trap.detected ? 'найдена ловушка' : 'ловушка (не найдена)');
  if (current.secret) parts.push(current.secret.found ? 'тайное — найдено' : `тайное — не найдено (СЛ ${current.secret.dc})`);
  if (current.passage) parts.push(`ведёт: ${passageSceneName.value}`);
  return parts.join(', ');
});

const passageSceneName = computed(() => props.scenes?.find(scene => scene.id === state.value?.passage?.sceneId)?.name ?? 'другая сцена');
const withNearby = ref(false);
async function travel() {
  if (!actorId.value) {
    error.value = 'Выберите, кто идёт.';
    return;
  }
  working.value = true;
  error.value = '';
  try {
    const result = await props.request(`/campaigns/${props.campaignId}/characters/${props.characterId}/travel`, 'POST', {
      actorIds: [actorId.value], withNearby: withNearby.value,
    });
    emit('result', { message: `${result.moved.join(', ')} → ${result.sceneName}.`, outcome: 'travelled' });
    emit('travelled', { sceneId: result.sceneId, sceneName: result.sceneName });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    working.value = false;
  }
}

const passageTargets = ref<Array<{ id: string; name: string }>>([]);
async function loadPassageTargets(sceneId: string) {
  passageTargets.value = [];
  if (!sceneId) return;
  try {
    const result = await props.request(`/campaigns/${props.campaignId}/scenes/${sceneId}`);
    passageTargets.value = (result.objects as Array<any>)
      .filter(object => object.kind === 'object' && object.character_id !== props.characterId)
      .map(object => ({ id: object.character_id as string, name: object.name as string }));
  } catch {
    passageTargets.value = [];
  }
}

async function act(action: string, needsActor: boolean | 'optional' = true) {
  if (needsActor === true && !actorId.value) {
    error.value = 'Выберите, кто это делает.';
    return;
  }
  const withActor = needsActor === true || (needsActor === 'optional' && Boolean(actorId.value));

  working.value = true;
  error.value = '';
  try {
    const result = await props.request(
      `/campaigns/${props.campaignId}/characters/${props.characterId}/interact`,
      'POST',
      { action, ...(withActor ? { actorId: actorId.value } : {}) },
    );
    emit('result', { message: result.roll ? `${result.message} (бросок ${result.roll.total})` : result.message, outcome: result.outcome });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    working.value = false;
  }
}

const editOpen = ref(false);
const form = ref({
  openable: false, open: false, locked: false, lockDc: null as number | null, lockKnown: false,
  breakDc: null as number | null, broken: false,
  trapArmed: false, trapDetectDc: null as number | null, trapDisarmDc: null as number | null, trapDetected: false, trapNote: '',
  obstacle: 'none' as Obstacle,
  lightBright: null as number | null, lightDim: null as number | null, lit: true, openFlame: false,
  secretDc: null as number | null, secretFound: false, passageSceneId: '', passageTargetId: '',
  hazardOn: false,
  hazard: { ...HAZARD_PRESETS[0]!.hazard } as Hazard,
});

function useHazardPreset(index: number) {
  const preset = HAZARD_PRESETS[index];
  if (!preset) return;
  form.value.hazardOn = true;
  form.value.hazard = { ...preset.hazard, types: [...preset.hazard.types] };
}

function toggleHazardType(type: string) {
  const types = form.value.hazard.types;
  form.value.hazard.types = types.includes(type) ? types.filter(entry => entry !== type) : [...types, type];
}
watch(() => form.value.passageSceneId, id => void loadPassageTargets(id));

function fillForm() {
  const current = state.value;
  form.value = {
    openable: current?.openable ?? false,
    open: current?.open ?? false,
    locked: current?.locked === true,
    lockDc: current?.lockDc ?? null,
    lockKnown: current?.lockKnown ?? false,
    breakDc: current?.breakDc ?? null,
    broken: current?.broken ?? false,
    trapArmed: current?.trap?.armed ?? false,
    trapDetectDc: current?.trap?.detectDc ?? null,
    trapDisarmDc: current?.trap?.disarmDc ?? null,
    trapDetected: current?.trap?.detected ?? false,
    trapNote: current?.trap?.note ?? '',
    obstacle: obstacleOf(current),
    lightBright: current?.light?.bright ?? null,
    lightDim: current?.light?.dim ?? null,
    openFlame: current?.light?.openFlame ?? false,
    secretDc: current?.secret?.dc ?? null,
    secretFound: current?.secret?.found ?? false,
    passageSceneId: current?.passage?.sceneId ?? '',
    passageTargetId: current?.passage?.targetId ?? '',
    hazardOn: Boolean(current?.hazard),
    hazard: current?.hazard ? { ...current.hazard, types: [...(current.hazard.types ?? [])] } : { ...HAZARD_PRESETS[0]!.hazard, types: [...HAZARD_PRESETS[0]!.hazard.types] },
    lit: current?.light?.lit ?? true,
  };
}

watch(() => [props.characterId, editOpen.value], () => { if (editOpen.value) fillForm(); });

const feet = (value: unknown) => (value === '' || value === null || value === undefined ? null : Math.max(0, Math.min(1000, Math.round(Number(value)))));

const dc = (value: unknown) => (value === '' || value === null || value === undefined ? null : Math.max(1, Math.min(40, Math.round(Number(value)))));

async function save() {
  working.value = true;
  error.value = '';
  try {
    const f = form.value;
    await props.request(`/campaigns/${props.campaignId}/characters/${props.characterId}/state`, 'PUT', {
      openable: f.openable, open: f.open, locked: f.locked, lockDc: dc(f.lockDc), lockKnown: f.lockKnown,
      breakDc: dc(f.breakDc), broken: f.broken,
      trapArmed: f.trapArmed, trapDetectDc: dc(f.trapDetectDc), trapDisarmDc: dc(f.trapDisarmDc),
      trapDetected: f.trapDetected, trapNote: f.trapNote.trim() || null,
      blocks: f.obstacle !== 'none', ...(f.obstacle !== 'none' ? { blockKind: f.obstacle } : {}),
      lightBrightFeet: feet(f.lightBright), lightDimFeet: feet(f.lightDim), lit: f.lit, lightOpenFlame: f.openFlame,
      secretDc: dc(f.secretDc), secretFound: f.secretFound,
      passageSceneId: f.passageSceneId || null, passageTargetId: f.passageSceneId && f.passageTargetId ? f.passageTargetId : null,
      hazard: f.hazardOn ? {
        types: f.hazard.types, radiusFeet: Math.max(1, Math.min(120, Number(f.hazard.radiusFeet) || 5)),
        formula: f.hazard.formula.trim() || '1d6', damageType: f.hazard.damageType,
        save: f.hazard.save || null, dc: f.hazard.save ? Math.max(1, Math.min(40, Math.round(Number(f.hazard.dc) || 12))) : null,
        halfOnSuccess: f.hazard.halfOnSuccess, message: f.hazard.message?.trim() || null,
      } : null,
    });
    emit('result', { message: `Состояния «${props.name}» сохранены.`, outcome: 'saved' });
    editOpen.value = false;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    working.value = false;
  }
}
</script>

<template>
  <section class="object-state" aria-label="Состояние предмета">
    <p v-if="statusText" class="state-line">Состояние: <strong>{{ statusText }}</strong></p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <div class="state-actions">
      <template v-if="state?.openable && !state.broken">
        <button v-if="!state.open" type="button" :disabled="busy || working" @click="act('open', 'optional')">Открыть</button>
        <button v-else type="button" :disabled="busy || working" @click="act('close', false)">Закрыть</button>
      </template>
      <button v-if="state?.locked" type="button" :disabled="busy || working || !actors.length" title="Ловкость рук против СЛ замка" @click="act('pick')">Взломать</button>
      <button v-if="state?.openable && !state.open && !state.broken" type="button" :disabled="busy || working || !actors.length" title="Атлетика против СЛ двери" @click="act('force')">Выбить</button>
      <template v-if="state?.light">
        <button v-if="state.light.lit" type="button" :disabled="busy || working" @click="act('douse', false)">Погасить</button>
        <button v-else type="button" :disabled="busy || working" @click="act('light', false)">Зажечь</button>
      </template>
      <button type="button" :disabled="busy || working || !actors.length" title="Восприятие против СЛ ловушки" @click="act('search')">Искать ловушки</button>
      <button v-if="state?.trap?.detected && state.trap.armed" type="button" :disabled="busy || working || !actors.length" title="Ловкость рук; провал на 5 и больше — ловушка сработает" @click="act('disarm')">Обезвредить</button>
      <button v-if="state?.passage" type="button" class="primary" :disabled="busy || working || !actors.length" title="Встаньте вплотную к проходу" @click="travel">Пройти: {{ passageSceneName }}</button>
    </div>
    <label v-if="state?.passage && actors.length" class="checkbox-label"><input v-model="withNearby" type="checkbox" /> И все мои существа в 10 футах</label>

    <label v-if="canEdit" class="obstacle" :title="OBSTACLES.find(entry => entry.id === obstacleOf(state))?.hint">
      Препятствие
      <select :value="obstacleOf(state)" :disabled="busy || working" @change="setObstacle(($event.target as HTMLSelectElement).value as Obstacle)">
        <option v-for="entry in OBSTACLES" :key="entry.id" :value="entry.id">{{ entry.label }} — {{ entry.hint }}</option>
      </select>
    </label>

    <label v-if="actors.length" class="actor">
      Кто действует
      <select v-model="actorId" :disabled="busy || working">
        <option v-for="actor in actors" :key="actor.id" :value="actor.id">{{ actor.name }}</option>
      </select>
    </label>
    <small v-else class="muted">Взломать, выбить или искать ловушки может ваш персонаж на этой сцене.</small>

    <details v-if="canEdit" :open="editOpen" @toggle="editOpen = ($event.target as HTMLDetailsElement).open">
      <summary>Состояния (видит мастер)</summary>
      <div class="state-form">
        <label>
          Препятствие (открытое или сломанное — нет)
          <select v-model="form.obstacle">
            <option v-for="entry in OBSTACLES" :key="entry.id" :value="entry.id">{{ entry.label }} — {{ entry.hint }}</option>
          </select>
        </label>
        <label class="checkbox-label"><input v-model="form.openable" type="checkbox" /> Открывается (дверь, сундук)</label>
        <template v-if="form.openable">
          <label class="checkbox-label"><input v-model="form.open" type="checkbox" :disabled="form.locked" /> Открыт</label>
          <label class="checkbox-label"><input v-model="form.locked" type="checkbox" /> Заперт</label>
          <label v-if="form.locked">СЛ взлома (пусто — только ключом) <input v-model="form.lockDc" type="number" min="1" max="40" /></label>
          <label v-if="form.locked" class="checkbox-label"><input v-model="form.lockKnown" type="checkbox" /> Игроки знают, что заперт</label>
          <label>СЛ, чтобы выбить (пусто — не выбить) <input v-model="form.breakDc" type="number" min="1" max="40" /></label>
        </template>
        <label class="checkbox-label"><input v-model="form.broken" type="checkbox" /> Сломан</label>
        <label class="checkbox-label"><input v-model="form.trapArmed" type="checkbox" /> Ловушка взведена</label>
        <template v-if="form.trapArmed">
          <label>СЛ обнаружения <input v-model="form.trapDetectDc" type="number" min="1" max="40" /></label>
          <label>СЛ обезвреживания <input v-model="form.trapDisarmDc" type="number" min="1" max="40" /></label>
          <label class="checkbox-label"><input v-model="form.trapDetected" type="checkbox" /> Уже обнаружена</label>
          <label>Что происходит, когда срабатывает <textarea v-model="form.trapNote" rows="2" maxlength="500" placeholder="Отравленная игла: 1d4 урона ядом" /></label>
        </template>
        <fieldset class="light-fields">
          <legend>Опасность: взрывается, рушится, разбрызгивается</legend>
          <div class="presets">
            <button v-for="(preset, index) in HAZARD_PRESETS" :key="preset.label" type="button" @click="useHazardPreset(index)">{{ preset.label }}</button>
          </div>
          <label class="checkbox-label"><input v-model="form.hazardOn" type="checkbox" /> Срабатывает от урона</label>
          <template v-if="form.hazardOn">
            <div class="types">
              <small class="muted">От урона (ничего не выбрано — от любого):</small>
              <button
                v-for="type in DAMAGE_TYPES" :key="type.id" type="button" class="type-chip"
                :aria-pressed="form.hazard.types.includes(type.id)" @click="toggleHazardType(type.id)"
              >{{ type.label }}</button>
            </div>
            <label>Радиус, фут. <input v-model.number="form.hazard.radiusFeet" type="number" min="1" max="120" /></label>
            <label>Урон <input v-model="form.hazard.formula" maxlength="20" placeholder="4d6" /></label>
            <label>Тип урона
              <select v-model="form.hazard.damageType">
                <option v-for="type in DAMAGE_TYPES" :key="type.id" :value="type.id">{{ type.label }}</option>
              </select>
            </label>
            <label>Спасбросок
              <select v-model="form.hazard.save">
                <option :value="null">— без спасброска —</option>
                <option v-for="[key, label] in ABILITIES" :key="key" :value="key">{{ label }}</option>
              </select>
            </label>
            <label v-if="form.hazard.save">СЛ <input v-model.number="form.hazard.dc" type="number" min="1" max="40" /></label>
            <label v-if="form.hazard.save" class="checkbox-label"><input v-model="form.hazard.halfOnSuccess" type="checkbox" /> При успехе — половина урона</label>
            <label>Что происходит <input v-model="form.hazard.message" maxlength="300" placeholder="Масло вспыхивает!" /></label>
            <small class="muted">Срабатывает один раз, предмет ломается; такие же предметы в радиусе срабатывают следом.</small>
          </template>
        </fieldset>
        <fieldset class="light-fields">
          <legend>Тайное: дверь, тайник, рычаг</legend>
          <label>СЛ обнаружения (пусто — не тайное) <input v-model="form.secretDc" type="number" min="1" max="40" /></label>
          <small class="muted">Пока не найдено, игроки его не видят; закрытая тайная дверь — как стена. Находят пассивным Восприятием в 30 футах или «Искать».</small>
          <label class="checkbox-label"><input v-model="form.secretFound" type="checkbox" /> Найдено</label>
        </fieldset>
        <fieldset class="light-fields">
          <legend>Проход: лестница, люк, портал</legend>
          <label>Ведёт на сцену
            <select v-model="form.passageSceneId">
              <option value="">— никуда —</option>
              <option v-for="scene in scenes ?? []" :key="scene.id" :value="scene.id">{{ scene.name }}</option>
            </select>
          </label>
          <label v-if="form.passageSceneId">К предмету там
            <select v-model="form.passageTargetId">
              <option value="">— в центр сцены —</option>
              <option v-for="item in passageTargets" :key="item.id" :value="item.id">{{ item.name }}</option>
            </select>
          </label>
          <small class="muted">Существо рядом с проходом — «Пройти»: окажется у цели на той сцене, игрок перейдёт за ним.</small>
        </fieldset>
        <fieldset class="light-fields">
          <legend>Свет (факел — 20 и 20, фонарь — 30 и 30, свеча — 5 и 5)</legend>
          <label>Яркий, фут. <input v-model="form.lightBright" type="number" min="0" max="1000" /></label>
          <label>Ещё тусклого, фут. <input v-model="form.lightDim" type="number" min="0" max="1000" /></label>
          <label class="checkbox-label"><input v-model="form.lit" type="checkbox" /> Горит</label>
          <label class="checkbox-label" title="Факел, свеча, костёр — гаснет под ливнем"><input v-model="form.openFlame" type="checkbox" /> Открытый огонь</label>
        </fieldset>
        <button type="button" class="primary" :disabled="busy || working" @click="save">Сохранить состояния</button>
      </div>
    </details>
  </section>
</template>

<style scoped>
.object-state{display:grid;gap:6px;margin-top:10px}
.state-line{margin:0}
.state-actions{display:flex;flex-wrap:wrap;gap:6px}
.obstacle{display:flex;flex-direction:column;gap:4px;margin:8px 0;font-size:13px}
.obstacle select{min-height:30px;max-width:100%}
.state-actions button{min-height:30px;padding:2px 10px}
.state-form{display:grid;gap:6px;margin-top:6px}
.state-form input[type="number"]{width:80px;margin-left:6px}
.light-fields{display:grid;gap:4px;border:1px solid var(--brass-light, #c9a22755);border-radius:3px;padding:4px 8px;margin:0}
.presets,.types{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.presets button,.type-chip{min-height:24px;padding:1px 8px;font-size:11px}
.type-chip[aria-pressed="true"]{background:var(--burgundy);color:var(--burgundy-text,#fff)}
</style>
