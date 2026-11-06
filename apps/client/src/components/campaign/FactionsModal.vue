<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import { confirmAction } from '../../ui/confirmDialog';
import { useEscapeClose } from '../../ui/escapeStack';
import GameIcon from '../game/GameIcon.vue';

type Registry = { id: string; label: string; text?: string };
type Member = { id: string; name: string; kind: string; explicit: boolean };
type Faction = {
  id: string; name: string; color: string; system: 'party' | 'enemies' | null;
  rights: string[]; bonuses: Array<{ kind: string; value: number }>; members: Member[];
};
type Relation = { a: string; b: string; relation: 'ally' | 'neutral' | 'enemy'; restrictions: string[] };
type FactionsData = {
  manage: boolean; factions: Faction[]; relations: Relation[];
  rights: Registry[]; restrictions: Registry[]; bonusKinds: Registry[];
};

const props = defineProps<{
  campaignId: string;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
  creatures: Array<{ id: string; name: string; kind: string }>;
  revision?: number;
  portraits?: Record<string, string | null>;
}>();
const portraitOf = (id: string) => props.portraits?.[id] ?? null;
const emit = defineEmits<{ close: [] }>();
useEscapeClose(() => emit('close'));

const data = ref<FactionsData | null>(null);
const error = ref('');
const busy = ref(false);
const newName = ref('');
const openMembers = ref<string | null>(null);
const openPair = ref<string | null>(null);
const BONUS_VALUES = Array.from({ length: 21 }, (_, index) => index - 10);
const RELATIONS: Array<[Relation['relation'], string]> = [['ally', 'Союз'], ['neutral', 'Нейтралитет'], ['enemy', 'Вражда']];

const base = computed(() => `/campaigns/${props.campaignId}`);

async function load() {
  try {
    data.value = await props.request(`${base.value}/factions`);
    error.value = '';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось загрузить фракции. Попробуйте ещё раз.';
  }
}
onMounted(load);
watch(() => props.revision, load);

async function act(work: () => Promise<unknown>) {
  if (busy.value) return;
  busy.value = true;
  try {
    await work();
    await load();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не получилось.';
  } finally {
    busy.value = false;
  }
}

const patch = (faction: Faction, body: Record<string, unknown>) => act(() => props.request(`${base.value}/factions/${faction.id}`, 'PATCH', body));

function create() {
  const name = newName.value.trim();
  if (!name) return;
  void act(async () => {
    await props.request(`${base.value}/factions`, 'POST', { name });
    newName.value = '';
  });
}

function rename(faction: Faction, event: Event) {
  const name = (event.target as HTMLInputElement).value.trim();
  if (!name || name === faction.name) {
    (event.target as HTMLInputElement).value = faction.name;
    return;
  }
  void patch(faction, { name });
}

function toggleRight(faction: Faction, right: string, on: boolean) {
  const rights = on ? [...new Set([...faction.rights, right])] : faction.rights.filter(id => id !== right);
  void patch(faction, { rights });
}

const bonusOf = (faction: Faction, kind: string) => faction.bonuses.find(bonus => bonus.kind === kind)?.value ?? 0;
function setBonus(faction: Faction, kind: string, value: number) {
  const bonuses = [...faction.bonuses.filter(bonus => bonus.kind !== kind), ...(value ? [{ kind, value }] : [])];
  void patch(faction, { bonuses });
}

async function remove(faction: Faction) {
  const ok = await confirmAction(`Фракция «${faction.name}» исчезнет; её участники останутся в остальных своих фракциях.`, {
    title: 'Удалить фракцию?', confirmLabel: 'Удалить', danger: true,
  });
  if (ok) void act(() => props.request(`${base.value}/factions/${faction.id}`, 'DELETE'));
}

function factionsOf(creatureId: string) {
  return (data.value?.factions ?? []).filter(faction => faction.members.some(member => member.id === creatureId)).map(faction => faction.id);
}
function setMembership(creatureId: string, factionId: string, on: boolean) {
  const now = factionsOf(creatureId);
  const next = on ? [...new Set([...now, factionId])] : now.filter(id => id !== factionId);
  void act(() => props.request(`${base.value}/characters/${creatureId}/factions`, 'PUT', { factionIds: next }));
}
function resetMembership(creatureId: string) {
  void act(() => props.request(`${base.value}/characters/${creatureId}/factions`, 'DELETE'));
}
const outsiders = (faction: Faction) => props.creatures
  .filter(creature => creature.kind !== 'object' && !faction.members.some(member => member.id === creature.id))
  .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
function addMember(faction: Faction, event: Event) {
  const select = event.target as HTMLSelectElement;
  const id = select.value;
  select.value = '';
  if (id) setMembership(id, faction.id, true);
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const pairs = computed(() => new Map((data.value?.relations ?? []).map(relation => [pairKey(relation.a, relation.b), relation])));
const relationOf = (a: Faction, b: Faction) => pairs.value.get(pairKey(a.id, b.id))?.relation ?? 'neutral';
const restrictionsOf = (a: Faction, b: Faction) => pairs.value.get(pairKey(a.id, b.id))?.restrictions ?? [];
function setRelation(a: Faction, b: Faction, relation: Relation['relation'], restrictions = restrictionsOf(a, b)) {
  void act(() => props.request(`${base.value}/factions/relations`, 'PUT', { a: a.id, b: b.id, relation, restrictions }));
}
function toggleRestriction(a: Faction, b: Faction, id: string, on: boolean) {
  const now = restrictionsOf(a, b);
  setRelation(a, b, relationOf(a, b), on ? [...new Set([...now, id])] : now.filter(item => item !== id));
}
const restrictionLabel = (id: string) => data.value?.restrictions.find(item => item.id === id)?.label ?? id;
</script>

<template>
  <div class="factions-dialog" role="dialog" aria-modal="true" aria-labelledby="factions-title" @click.self="emit('close')">
    <div class="factions-card">
      <header class="factions-header">
        <h3 id="factions-title">Фракции и союзы</h3>
        <button type="button" class="factions-close" aria-label="Закрыть" @click="emit('close')"><GameIcon class="inline-icon" name="close" :size="16" /></button>
      </header>
      <p class="hint">
        Существо бывает в нескольких фракциях. Общая фракция — союзники; иначе решают отношения фракций ниже.
        Без своих фракций персонаж игрока и союзный НПС — в «Отряде», враждебный НПС — во «Врагах», нейтральный — ни в какой.
      </p>
      <p v-if="error" class="notice error" role="alert">{{ error }}</p>
      <p v-if="!data" class="hint">Загрузка…</p>

      <template v-if="data">
        <section class="factions-section">
          <h4>Фракции</h4>
          <article v-for="faction in data.factions" :key="faction.id" class="faction">
            <div class="faction-head">
              <input
                type="color" class="swatch" :value="faction.color" :disabled="busy" :aria-label="`Цвет: ${faction.name}`"
                @change="patch(faction, { color: ($event.target as HTMLInputElement).value })"
              />
              <input class="name" :value="faction.name" maxlength="60" :disabled="busy" :aria-label="`Название: ${faction.name}`" @change="rename(faction, $event)" />
              <small v-if="faction.system" class="badge" title="Встроенная: её не удалить, только переименовать">встроенная</small>
              <button
                type="button" class="members-button" :aria-expanded="openMembers === faction.id"
                @click="openMembers = openMembers === faction.id ? null : faction.id"
              >
                <span v-if="faction.members.length" class="portrait-stack" aria-hidden="true">
                  <span v-for="member in faction.members.slice(0, 5)" :key="member.id" class="member-portrait small" :title="member.name">
                    <img v-if="portraitOf(member.id)" :src="portraitOf(member.id)!" alt="" />
                    <span v-else>{{ member.name.slice(0, 1) }}</span>
                  </span>
                </span>
                Участники: {{ faction.members.length }} ▾
              </button>
              <button v-if="!faction.system" type="button" class="danger" :disabled="busy" title="Удалить фракцию" @click="remove(faction)"><GameIcon class="inline-icon" name="close" :size="16" /></button>
            </div>

            <div v-if="openMembers === faction.id" class="members-popup">
              <p v-if="!faction.members.length" class="hint">Пока никого.</p>
              <ul v-else>
                <li v-for="member in faction.members" :key="member.id">
                  <span class="member-portrait" aria-hidden="true">
                    <img v-if="portraitOf(member.id)" :src="portraitOf(member.id)!" alt="" />
                    <span v-else>{{ member.name.slice(0, 1) }}</span>
                  </span>
                  <span>{{ member.name }}<small v-if="!member.explicit" title="Фракции по умолчанию — по виду и отношению"> · по умолчанию</small></span>
                  <button type="button" :disabled="busy" :title="`Убрать ${member.name} из «${faction.name}»`" @click="setMembership(member.id, faction.id, false)">Убрать</button>
                  <button v-if="member.explicit" type="button" :disabled="busy" title="Снова по виду и отношению" @click="resetMembership(member.id)">По умолчанию</button>
                </li>
              </ul>
              <select :disabled="busy || !outsiders(faction).length" aria-label="Добавить во фракцию" @change="addMember(faction, $event)">
                <option value="">+ Добавить существо…</option>
                <option v-for="creature in outsiders(faction)" :key="creature.id" :value="creature.id">{{ creature.name }}</option>
              </select>
            </div>

            <div class="faction-grid">
              <fieldset>
                <legend>Права своих</legend>
                <label v-for="right in data.rights" :key="right.id" :title="right.text">
                  <input type="checkbox" :checked="faction.rights.includes(right.id)" :disabled="busy" @change="toggleRight(faction, right.id, ($event.target as HTMLInputElement).checked)" />
                  {{ right.label }}
                </label>
              </fieldset>
              <fieldset class="bonuses">
                <legend>Прибавки всем</legend>
                <label v-for="kind in data.bonusKinds" :key="kind.id" class="bonus">
                  <select :value="bonusOf(faction, kind.id)" :disabled="busy" @change="setBonus(faction, kind.id, Number(($event.target as HTMLSelectElement).value))">
                    <option v-for="value in BONUS_VALUES" :key="value" :value="value">{{ value > 0 ? `+${value}` : value }}</option>
                  </select>
                  {{ kind.label }}
                </label>
              </fieldset>
            </div>
          </article>
          <form class="new-faction" @submit.prevent="create">
            <input v-model="newName" maxlength="60" placeholder="Новая фракция: гильдия, культ, город…" :disabled="busy" aria-label="Название новой фракции" />
            <button type="submit" class="primary" :disabled="busy || !newName.trim()">Создать</button>
          </form>
        </section>

        <section v-if="data.factions.length > 1" class="factions-section">
          <h4>Отношения</h4>
          <p class="hint">Союз — групповой ход, общий опыт и добыча; вражда — атаки при уходе, «Авто-ход», опыт за победу. Шестерёнка — ограничения между фракциями при любом отношении.</p>
          <div class="matrix-wrap">
            <table class="matrix">
              <thead>
                <tr>
                  <th />
                  <th v-for="column in data.factions" :key="column.id" scope="col"><span class="dot" :style="{ background: column.color }" />{{ column.name }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, rowIndex) in data.factions" :key="row.id">
                  <th scope="row"><span class="dot" :style="{ background: row.color }" />{{ row.name }}</th>
                  <td v-for="(column, columnIndex) in data.factions" :key="column.id" :class="[columnIndex > rowIndex ? relationOf(row, column) : 'mirror']">
                    <template v-if="columnIndex > rowIndex">
                      <div class="cell">
                        <select :value="relationOf(row, column)" :disabled="busy" :aria-label="`${row.name} и ${column.name}`" @change="setRelation(row, column, ($event.target as HTMLSelectElement).value as Relation['relation'])">
                          <option v-for="[value, label] in RELATIONS" :key="value" :value="value">{{ label }}</option>
                        </select>
                        <button
                          type="button" class="gear" :aria-expanded="openPair === pairKey(row.id, column.id)"
                          :title="restrictionsOf(row, column).length ? restrictionsOf(row, column).map(restrictionLabel).join(', ') : 'Ограничения между фракциями'"
                          @click="openPair = openPair === pairKey(row.id, column.id) ? null : pairKey(row.id, column.id)"
                        ><GameIcon name="gear" :size="14" /><small v-if="restrictionsOf(row, column).length">{{ restrictionsOf(row, column).length }}</small></button>
                      </div>
                      <div v-if="openPair === pairKey(row.id, column.id)" class="pair-popup" role="group" :aria-label="`Ограничения: ${row.name} и ${column.name}`">
                        <b>{{ row.name }} ↔ {{ column.name }}</b>
                        <label v-for="restriction in data.restrictions" :key="restriction.id" :title="restriction.text">
                          <input
                            type="checkbox" :checked="restrictionsOf(row, column).includes(restriction.id)" :disabled="busy"
                            @change="toggleRestriction(row, column, restriction.id, ($event.target as HTMLInputElement).checked)"
                          />
                          {{ restriction.label }}
                        </label>
                        <small>Наведите на пункт — что он значит. Действует в обе стороны.</small>
                      </div>
                    </template>
                    <span v-else-if="columnIndex === rowIndex" class="self">—</span>
                    <span v-else class="mirror-text">{{ RELATIONS.find(([value]) => value === relationOf(row, column))?.[1] }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.factions-dialog{position:fixed;inset:0;z-index:3100;background:#000a;display:flex;align-items:center;justify-content:center;padding:20px}
.factions-card{width:min(860px,100%);max-height:90vh;overflow-y:auto;padding:22px;background:var(--parchment-background);color:var(--ink);border:1px solid var(--brass);border-radius:4px;box-shadow:0 16px 40px #0008}
.factions-header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px}
.factions-header h3{margin:0}
.factions-close{min-height:32px;width:32px;padding:0}
.hint{margin:0 0 8px;font-size:13px;color:var(--muted-ink)}
.factions-section{margin-top:14px;padding-top:10px;border-top:1px solid var(--brass-light)}
.factions-section h4{margin:0 0 8px}
.faction{display:flex;flex-direction:column;gap:8px;padding:10px;margin-bottom:10px;border:1px solid var(--brass-light);border-radius:4px}
.faction-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.faction-head .swatch{flex:none;width:36px;min-width:0;height:32px;padding:0;border:1px solid var(--brass-light);background:none;cursor:pointer}
.faction-head .name{flex:1 1 180px;width:auto;min-width:0;font-weight:600}
.badge{padding:1px 7px;border:1px solid var(--brass-light);border-radius:10px;font-size:11px;color:var(--muted-ink)}
.members-button{min-height:30px;padding:2px 10px;font-size:13px;display:inline-flex;align-items:center;gap:8px}
.member-portrait{flex:none;width:34px;height:34px;border-radius:50%;overflow:hidden;display:grid;place-items:center;background:var(--parchment-dark,#3a2a1c);border:1px solid var(--brass-light);font-weight:700;color:var(--muted-ink)}
.member-portrait img{width:100%;height:100%;object-fit:cover;object-position:top}
.member-portrait.small{width:22px;height:22px;font-size:11px;margin-left:-8px;box-shadow:0 0 0 2px var(--parchment,#1c130c)}
.member-portrait.small:first-child{margin-left:0}
.portrait-stack{display:inline-flex;align-items:center}
.danger{min-height:30px;width:30px;padding:0;color:#a03a2c}
.members-popup{padding:8px;border:1px dashed var(--brass-light);border-radius:4px;display:flex;flex-direction:column;gap:6px}
.members-popup ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px}
.members-popup li{display:flex;align-items:center;gap:6px}
.members-popup li span:not(.member-portrait){flex:1;min-width:0}
.members-popup li small{color:var(--muted-ink)}
.members-popup li button{min-height:26px;padding:1px 8px;font-size:12px}
.faction-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.faction-grid fieldset{margin:0;padding:6px 10px;border:1px solid var(--brass-light);border-radius:4px;display:flex;flex-direction:column;gap:4px}
.faction-grid legend{font-size:12px;color:var(--muted-ink);padding:0 4px}
.faction-grid label{display:flex;align-items:center;gap:6px;margin:0;font-size:14px}
.faction-grid .bonuses{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 10px}
.faction-grid .bonuses legend{grid-column:1/-1}
.bonus select{flex:none;width:64px}
.new-faction{display:flex;gap:8px}
.new-faction input{flex:1;min-width:0}
.matrix-wrap{overflow-x:auto}
.matrix{border-collapse:collapse;font-size:13px}
.matrix th,.matrix td{padding:4px 6px;border:1px solid var(--brass-light);text-align:left;vertical-align:top;white-space:nowrap}
.matrix thead th{font-weight:600}
.dot{display:inline-block;width:10px;height:10px;margin-right:5px;border-radius:50%;vertical-align:middle}
.cell{display:flex;align-items:center;gap:4px}
.cell select{min-height:28px}
.gear{display:inline-flex;align-items:center;flex:none;min-height:28px;padding:0 6px;font-size:13px;white-space:nowrap}
.gear small{margin-left:2px;font-size:10px}
td.ally{background:#5ea76422}
td.enemy{background:#cf4a3d22}
td.mirror{background:#0000000a}
.self,.mirror-text{color:var(--muted-ink)}
.pair-popup{display:flex;flex-direction:column;gap:4px;margin-top:6px;padding:8px;white-space:normal;max-width:280px;border:1px solid var(--brass);border-radius:4px;background:var(--parchment-background)}
.pair-popup label{display:flex;align-items:center;gap:6px;margin:0}
.pair-popup small{color:var(--muted-ink)}
@media(max-width:600px){.faction-grid{grid-template-columns:1fr}}
</style>
