<script setup lang="ts">
import { confirmAction } from '../../ui/confirmDialog';
import { computed, ref, watch } from 'vue';
import { DAMAGE_TYPES } from '../../rules/objectRules';

export type TriggerRow = {
  id: string;
  kind: 'enter' | 'open';
  shape: string | null;
  size_feet: number | null;
  object_id: string | null;
  object_name: string | null;
  name: string;
  message: string | null;
  check_kind: 'save' | 'skill' | null;
  check_key: string | null;
  dc: number | null;
  damage_formula: string | null;
  damage_type: string | null;
  half_on_success: boolean;
  once: boolean;
  enabled: boolean;
  secret: boolean;
  fired_count: number;
  detect_dc?: number | null;
  detected?: boolean;
  on_turn?: boolean;
  fall_feet?: number | null;
};

const props = defineProps<{
  triggers: TriggerRow[];
  items: Array<{ id: string; name: string }>;
  busy: boolean;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
  basePath: string;
  focusId?: string | null;
}>();

const emit = defineEmits<{ changed: [message: string]; done: [] }>();

const ABILITIES = [['dexterity', 'ЛОВ'], ['constitution', 'ТЕЛ'], ['wisdom', 'МДР'], ['strength', 'СИЛ'], ['intelligence', 'ИНТ'], ['charisma', 'ХАР']] as const;
const SKILLS = [['perception', 'Восприятие'], ['investigation', 'Анализ'], ['athletics', 'Атлетика'], ['acrobatics', 'Акробатика'], ['stealth', 'Скрытность'], ['arcana', 'Магия']] as const;
const SHAPE_LABELS: Record<string, string> = { circle: 'круг', cone: 'конус', square: 'куб', line: 'линия' };
const PIT_DEPTHS = [10, 20, 30, 40, 50, 60, 80, 100, 150, 200];

const editing = ref('');
const form = ref<Record<string, any>>({});
const newItemId = ref('');
const error = ref('');
const working = ref(false);
const disabled = computed(() => props.busy || working.value);

const shown = computed(() => (props.focusId ? props.triggers.filter(trigger => trigger.id === props.focusId) : props.triggers));
watch(() => props.focusId, id => {
  const trigger = id ? props.triggers.find(entry => entry.id === id) : undefined;
  if (trigger) startEdit(trigger);
}, { immediate: true });
function stopEdit() {
  editing.value = '';
  if (props.focusId) emit('done');
}

watch(() => props.items, list => { if (!list.some(item => item.id === newItemId.value)) newItemId.value = list[0]?.id ?? ''; }, { immediate: true });

function startEdit(trigger: TriggerRow) {
  editing.value = trigger.id;
  form.value = {
    name: trigger.name,
    message: trigger.message ?? '',
    checkKind: trigger.check_kind ?? '',
    checkKey: trigger.check_key ?? (trigger.check_kind === 'skill' ? 'perception' : 'dexterity'),
    dc: trigger.dc ?? 12,
    damageFormula: trigger.damage_formula ?? '',
    damageType: trigger.damage_type ?? '',
    halfOnSuccess: trigger.half_on_success,
    once: trigger.once,
    enabled: trigger.enabled,
    secret: trigger.secret,
    detectDc: trigger.detect_dc ?? '',
    detected: trigger.detected ?? false,
    onTurn: trigger.on_turn ?? false,
    fallFeet: trigger.fall_feet ?? 0,
  };
}

async function call(path: string, method: string, body: unknown, message: string) {
  working.value = true;
  error.value = '';
  try {
    await props.request(path, method, body);
    emit('changed', message);
    return true;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
    return false;
  } finally {
    working.value = false;
  }
}

async function save(trigger: TriggerRow) {
  const f = form.value;
  const ok = await call(`${props.basePath}/triggers/${trigger.id}`, 'PATCH', {
    name: f.name.trim() || trigger.name,
    message: f.message.trim() || null,
    checkKind: f.checkKind || null,
    checkKey: f.checkKind ? f.checkKey : null,
    dc: f.checkKind ? Math.max(1, Math.min(40, Math.round(Number(f.dc) || 10))) : null,
    damageFormula: f.damageFormula.trim() || null,
    damageType: f.damageType || null,
    halfOnSuccess: f.halfOnSuccess,
    once: f.once,
    enabled: f.enabled,
    secret: f.secret,
    ...(trigger.kind === 'enter' ? {
      detectDc: f.detectDc === '' || f.detectDc === null ? null : Math.max(1, Math.min(40, Math.round(Number(f.detectDc)))),
      detected: f.detected,
      onTurn: f.onTurn,
      fallFeet: Number(f.fallFeet) > 0 ? Number(f.fallFeet) : null,
    } : {}),
  }, `Триггер «${f.name || trigger.name}» сохранён`);
  if (ok) stopEdit();
}

async function remove(trigger: TriggerRow) {
  if (!(await confirmAction(`Удалить триггер «${trigger.name}»?`, { title: 'Удалить', confirmLabel: 'Удалить', danger: true }))) return;
  if (await call(`${props.basePath}/triggers/${trigger.id}`, 'DELETE', undefined, `Триггер «${trigger.name}» удалён`)) stopEdit();
}

function addOpenTrigger() {
  const item = props.items.find(entry => entry.id === newItemId.value);
  if (!item) return;
  void call(`${props.basePath}/triggers`, 'POST', { kind: 'open', objectId: item.id, name: `При открытии: ${item.name}` }, 'Триггер добавлен');
}

function describe(trigger: TriggerRow) {
  const where = trigger.kind === 'enter'
    ? `вход в ${SHAPE_LABELS[trigger.shape ?? ''] ?? 'область'} ${trigger.size_feet} фут.`
    : `открыли «${trigger.object_name ?? '?'}»`;
  const check = trigger.check_kind ? `, ${trigger.check_kind === 'save' ? 'спасбросок' : 'проверка'} ${trigger.check_key} СЛ ${trigger.dc}` : '';
  const damage = trigger.damage_formula ? `, урон ${trigger.damage_formula}` : '';
  return `${where}${check}${damage}`;
}
</script>

<template>
  <div class="triggers-panel">
    <p v-if="!focusId" class="muted">
      Область-ловушку ставит «Конструктор карты» → «Ловушки» (или «Область» с флажком «как ловушку») — её видит только мастер.
      Срабатывает, когда существо входит в неё или открывают предмет. Правый щелчок по ловушке на столе — её настройки.
    </p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <ul v-if="shown.length" class="trigger-list">
      <li v-for="trigger in shown" :key="trigger.id" :class="{ off: !trigger.enabled }">
        <div class="row">
          <strong>{{ trigger.name }}</strong>
          <small class="muted">{{ describe(trigger) }}{{ trigger.secret ? ' · тайно' : '' }}{{ trigger.detect_dc ? ` · заметить СЛ ${trigger.detect_dc}` : '' }}{{ trigger.detected ? ' · замечена' : '' }}{{ trigger.on_turn ? ' · в начале хода' : '' }}{{ trigger.fall_feet ? ` · яма ${trigger.fall_feet} фут.` : '' }}{{ trigger.once ? ' · один раз' : '' }}{{ trigger.enabled ? '' : ' · выключен' }} · сработал {{ trigger.fired_count }}</small>
        </div>
        <div v-if="editing !== trigger.id" class="actions">
          <button type="button" :disabled="disabled" @click="startEdit(trigger)">Настроить</button>
          <button type="button" :disabled="disabled" @click="remove(trigger)">Удалить</button>
        </div>
        <div v-else class="trigger-form">
          <label>Название <input v-model="form.name" maxlength="100" /></label>
          <label>Что происходит (видят все, если не тайно) <textarea v-model="form.message" rows="2" maxlength="500" /></label>
          <div class="inline">
            <label>Проверка
              <select v-model="form.checkKind">
                <option value="">— нет —</option>
                <option value="save">спасбросок</option>
                <option value="skill">навык</option>
              </select>
            </label>
            <label v-if="form.checkKind === 'save'">Чем
              <select v-model="form.checkKey"><option v-for="[id, label] in ABILITIES" :key="id" :value="id">{{ label }}</option></select>
            </label>
            <label v-if="form.checkKind === 'skill'">Навык
              <select v-model="form.checkKey"><option v-for="[id, label] in SKILLS" :key="id" :value="id">{{ label }}</option></select>
            </label>
            <label v-if="form.checkKind">СЛ <input v-model.number="form.dc" type="number" min="1" max="40" /></label>
          </div>
          <div class="inline">
            <label>Урон (формула) <input v-model="form.damageFormula" maxlength="100" placeholder="2d6" /></label>
            <label>Тип
              <select v-model="form.damageType">
                <option value="">—</option>
                <option v-for="type in DAMAGE_TYPES" :key="type.id" :value="type.id">{{ type.label }}</option>
              </select>
            </label>
          </div>
          <label class="checkbox-label"><input v-model="form.halfOnSuccess" type="checkbox" /> При успешной проверке — половина урона (иначе без урона)</label>
          <label class="checkbox-label"><input v-model="form.once" type="checkbox" /> Только один раз</label>
          <label class="checkbox-label"><input v-model="form.secret" type="checkbox" /> Тайно — уведомление только мастеру, без бросков в журнале</label>
          <label class="checkbox-label"><input v-model="form.enabled" type="checkbox" /> Включён</label>
          <template v-if="trigger.kind === 'enter'">
            <label>СЛ обнаружения (пусто — не заметить)
              <input v-model.number="form.detectDc" type="number" min="1" max="40" placeholder="—" />
            </label>
            <small class="muted">Пассивное Восприятие отряда в 30 футах или «Искать». Замеченную ловушку игроки видят на карте.</small>
            <label class="checkbox-label"><input v-model="form.detected" type="checkbox" /> Уже замечена</label>
            <label class="checkbox-label" title="Горящая земля, ядовитое облако"><input v-model="form.onTurn" type="checkbox" /> Бьёт и того, кто начинает ход в области</label>
            <label title="Провалил проверку (или её нет) — падает: 1к6 за 10 футов, ничком; успех — удержался на краю. Летящему яма не страшна">Яма — падение
              <select v-model.number="form.fallFeet">
                <option :value="0">не яма</option>
                <option v-for="feet in PIT_DEPTHS" :key="feet" :value="feet">{{ feet }} фут. ({{ Math.min(20, feet / 10) }}к6)</option>
              </select>
            </label>
          </template>
          <div class="actions">
            <button type="button" class="primary" :disabled="disabled" @click="save(trigger)">Сохранить</button>
            <button type="button" :disabled="disabled" @click="stopEdit">Отмена</button>
            <button v-if="focusId" type="button" :disabled="disabled" @click="remove(trigger)">Удалить</button>
          </div>
        </div>
      </li>
    </ul>
    <p v-else class="muted">Триггеров на этой сцене нет.</p>

    <div v-if="items.length && !focusId" class="inline add-open">
      <label>При открытии предмета
        <select v-model="newItemId" :disabled="disabled">
          <option v-for="item in items" :key="item.id" :value="item.id">{{ item.name }}</option>
        </select>
      </label>
      <button type="button" :disabled="disabled || !newItemId" @click="addOpenTrigger">Добавить</button>
    </div>
  </div>
</template>

<style scoped>
.triggers-panel{display:grid;gap:8px}
.trigger-list{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.trigger-list li{display:grid;gap:4px;padding:6px 8px;border:1px solid var(--brass-light, #c9a22755);border-radius:3px}
.trigger-list li.off{opacity:.65}
.row{display:grid;gap:2px}
.actions{display:flex;gap:6px;flex-wrap:wrap}
.trigger-form{display:grid;gap:6px}
.inline{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end}
.inline label{flex:1 1 110px}
.inline input[type="number"]{width:70px}
</style>
