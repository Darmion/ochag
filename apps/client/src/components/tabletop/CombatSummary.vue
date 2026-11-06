<script setup lang="ts">
import { useEscapeClose } from '../../ui/escapeStack';
import { computed } from 'vue';
import GameIcon from '../game/GameIcon.vue';

export type CombatSummaryData = {
  sceneId: string;
  rounds: number;
  startedAt: string;
  endedAt: string;
  participants: Array<{
    characterId: string; name: string; side: 'party' | 'enemy' | 'neutral';
    damageDealt: number; damageTaken: number; hits: number; misses: number; crits: number; kills: number; healing: number;
    experience: number | null;
  }>;
  unrolled?: { trap: number; zone: number; hazard: number; manual: number };
};

const props = defineProps<{ summary: CombatSummaryData }>();
const emit = defineEmits<{ close: [] }>();
useEscapeClose(() => emit('close'));

const party = computed(() => props.summary.participants.filter(entry => entry.side === 'party'));
const active = (entry: CombatSummaryData['participants'][number]) =>
  entry.damageDealt + entry.damageTaken + entry.hits + entry.misses + entry.kills + entry.healing > 0;
const others = computed(() => props.summary.participants.filter(entry => entry.side !== 'party' && active(entry)));
const idle = computed(() => props.summary.participants.filter(entry => entry.side !== 'party' && !active(entry)).map(entry => entry.name));
const best = computed(() => party.value.reduce<string | null>((top, entry) => {
  const leader = party.value.find(other => other.characterId === top);
  return entry.damageDealt > 0 && (!leader || entry.damageDealt > leader.damageDealt) ? entry.characterId : top;
}, null));
const minutes = computed(() => Math.max(1, Math.round((Date.parse(props.summary.endedAt) - Date.parse(props.summary.startedAt)) / 60000)));
const unrolledText = computed(() => {
  const source = props.summary.unrolled;
  if (!source) return '';
  return [
    source.trap ? `ловушки — ${source.trap}` : '', source.zone ? `зоны заклинаний — ${source.zone}` : '',
    source.hazard ? `взрывы — ${source.hazard}` : '', source.manual ? `правка хитов мастером — ${source.manual}` : '',
  ].filter(Boolean).join(', ');
});
</script>

<template>
  <div class="modal-overlay" role="dialog" aria-modal="true" aria-label="Итоги боя" @click.self="emit('close')">
    <div class="modal-card combat-summary">
      <header class="modal-header">
        <h3><GameIcon class="inline-icon" name="swords" :size="18" /> Итоги боя</h3>
        <button type="button" class="modal-close" aria-label="Закрыть" @click="emit('close')"><GameIcon class="inline-icon" name="close" :size="16" /></button>
      </header>
      <p class="muted">Раундов: {{ summary.rounds }} · около {{ minutes }} мин.</p>
      <template v-for="group in [{ title: 'Отряд', rows: party }, { title: 'Противники и прочие', rows: others }]" :key="group.title">
        <h4 v-if="group.rows.length">{{ group.title }}</h4>
        <table v-if="group.rows.length">
          <thead>
            <tr>
              <th>Имя</th><th title="Урон нанесён">Нанёс</th><th title="Урон получен">Получил</th>
              <th title="Попадания / промахи">Попад.</th><th>Криты</th><th title="Повергнуто">Поверг.</th><th>Лечение</th><th>Опыт</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in group.rows" :key="row.characterId" :class="{ best: row.characterId === best }">
              <td><template v-if="row.characterId === best"><GameIcon class="inline-icon" name="starFilled" :size="13" /> </template>{{ row.name }}</td>
              <td>{{ row.damageDealt }}</td>
              <td>{{ row.damageTaken }}</td>
              <td>{{ row.hits }} / {{ row.misses }}</td>
              <td>{{ row.crits }}</td>
              <td>{{ row.kills }}</td>
              <td>{{ row.healing }}</td>
              <td>{{ row.experience === null ? '—' : `+${row.experience}` }}</td>
            </tr>
          </tbody>
        </table>
      </template>
      <p v-if="idle.length" class="muted">Не участвовали: {{ idle.join(', ') }}.</p>
      <p v-if="!summary.participants.length" class="muted">В бою никого не было.</p>
      <p v-if="unrolledText" class="muted">Урон без броска (в «Получил»): {{ unrolledText }}.</p>
      <small class="muted">Считаются все броски с начала боя (и скрытые — только числами), урон кнопкой «Урон», ловушки, зоны, взрывы и правка хитов мастером.</small>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay{position:fixed;inset:0;z-index:3000;background:#000a;display:flex;align-items:center;justify-content:center;padding:20px}
.modal-card{width:min(760px,100%);max-height:90vh;overflow-y:auto;padding:24px;background:var(--parchment-background);color:var(--ink);border:1px solid var(--brass);border-radius:4px;box-shadow:0 16px 40px #0008}
.modal-header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
.modal-header h3{margin:0}
.modal-close{min-height:32px;width:32px;padding:0}
.combat-summary{max-width:760px}
.combat-summary table{width:100%;border-collapse:collapse;font-size:14px;margin-bottom:10px}
.combat-summary th,.combat-summary td{padding:4px 6px;text-align:right;border-bottom:1px solid var(--brass-light,#8a6a3544)}
.combat-summary th:first-child,.combat-summary td:first-child{text-align:left}
.combat-summary tr.best td{color:#b8862e;font-weight:700}
</style>
