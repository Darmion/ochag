<script setup lang="ts">
import { ref } from 'vue';
import { CONDITIONS } from '../../rules/conditions';

export type TemplateRow = {
  id: string;
  shape: 'circle' | 'cone' | 'square' | 'line';
  size_feet: number;
  width_feet?: number | null;
  direction?: number;
  label: string | null;
  color: string;
  created_by: string;
  author_name: string;
  affected: string[];
};

const props = defineProps<{
  templates: TemplateRow[];
  currentUserId: string;
  canManage: boolean;
  busy: boolean;
}>();

const emit = defineEmits<{
  remove: [templateId: string];
  saves: [payload: {
    templateId: string; ability: string; dc: number; hidden: boolean;
    effect?: { code: string; durationRounds?: number; repeatSave?: 'end' };
  }];
}>();

const SHAPE_LABELS = { circle: 'Круг', cone: 'Конус', square: 'Куб', line: 'Линия' } as const;
const ABILITIES = [
  ['dexterity', 'ЛОВ'], ['constitution', 'ТЕЛ'], ['wisdom', 'МДР'],
  ['strength', 'СИЛ'], ['intelligence', 'ИНТ'], ['charisma', 'ХАР'],
] as const;

const saveFor = ref('');
const ability = ref('dexterity');
const dc = ref(15);
const hidden = ref(false);
const effectCode = ref('');
const effectRounds = ref<number | null>(null);
const effectRepeat = ref(true);

function rollSaves(templateId: string) {
  emit('saves', {
    templateId,
    ability: ability.value,
    dc: Math.max(1, Math.min(40, Math.round(dc.value || 10))),
    hidden: hidden.value,
    ...(effectCode.value
      ? { effect: {
          code: effectCode.value,
          ...(effectRounds.value ? { durationRounds: Math.round(effectRounds.value) } : {}),
          ...(effectRepeat.value ? { repeatSave: 'end' as const } : {}),
        } }
      : {}),
  });
  saveFor.value = '';
}
</script>

<template>
  <section v-if="templates.length" class="area-templates" aria-label="Области на сцене">
    <h4>Области</h4>
    <ul>
      <li v-for="template in templates" :key="template.id">
        <div class="row">
          <span class="swatch" :style="{ background: template.color }" aria-hidden="true" />
          <strong>{{ template.label || SHAPE_LABELS[template.shape] }}</strong>
          <span class="muted">{{ SHAPE_LABELS[template.shape] }} {{ template.size_feet }} фут. · {{ template.author_name }}</span>
          <button
            v-if="template.created_by === currentUserId || canManage"
            type="button"
            :disabled="busy"
            aria-label="Убрать область"
            @click="emit('remove', template.id)"
          >
            ×
          </button>
        </div>
        <small class="muted">Задеты: {{ template.affected.length ? template.affected.join(', ') : 'никто' }}</small>

        <template v-if="canManage && template.affected.length">
          <button v-if="saveFor !== template.id" type="button" class="link" :disabled="busy" @click="saveFor = template.id">
            Спасбросок задетым…
          </button>
          <div v-else class="save-form">
            <select v-model="ability" :disabled="busy" aria-label="Характеристика">
              <option v-for="[id, short] in ABILITIES" :key="id" :value="id">{{ short }}</option>
            </select>
            <label>СЛ <input v-model.number="dc" type="number" min="1" max="40" :disabled="busy" /></label>
            <label class="checkbox-label"><input v-model="hidden" type="checkbox" :disabled="busy" /> скрыто</label>
            <select v-model="effectCode" :disabled="busy" aria-label="Состояние при провале" title="Состояние, которое получат провалившие спасбросок">
              <option value="">без состояния</option>
              <option v-for="condition in CONDITIONS" :key="condition.code" :value="condition.code">при провале: {{ condition.label.toLowerCase() }}</option>
            </select>
            <template v-if="effectCode">
              <label title="Сколько ходов цели (пусто — пока не снимут)">ходов <input v-model.number="effectRounds" type="number" min="1" max="1000" :disabled="busy" placeholder="∞" /></label>
              <label class="checkbox-label" title="Повторный спасбросок в конце каждого её хода — успех снимает"><input v-model="effectRepeat" type="checkbox" :disabled="busy" /> повтор в конце хода</label>
            </template>
            <button type="button" class="primary" :disabled="busy" @click="rollSaves(template.id)">Бросить</button>
            <button type="button" :disabled="busy" @click="saveFor = ''">Отмена</button>
          </div>
        </template>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.area-templates{display:grid;gap:6px;margin-bottom:10px}
.area-templates h4{margin:0}
ul{list-style:none;margin:0;padding:0;display:grid;gap:6px}
li{display:grid;gap:3px;padding:4px 6px;border:1px solid var(--brass-light, #c9a22755);border-radius:3px}
.row{display:flex;align-items:center;gap:6px}
.row .muted{font-size:12px;flex:1}
.row button{min-width:24px;min-height:24px;padding:0 4px}
.swatch{width:12px;height:12px;border-radius:2px;flex-shrink:0}
.link{justify-self:start;min-height:26px;padding:2px 8px;font-size:12px}
.save-form{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.save-form input[type="number"]{width:56px}
</style>
