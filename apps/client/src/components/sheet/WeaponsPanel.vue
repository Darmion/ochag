<script setup lang="ts">
import { confirmAction } from '../../ui/confirmDialog';
import { computed, onMounted, ref } from 'vue';

import { DAMAGE_TYPES } from '../../rules/objectRules';
import ItemArt from '../rpg/ItemArt.vue';
import GameIcon from '../game/GameIcon.vue';

export type WeaponDTO = {
  id: string;
  name: string;
  ability: 'strength' | 'dexterity' | 'finesse';
  proficient: boolean;
  damage_formula: string | null;
  damage_type: string | null;
  range_feet: number;
  weapon_kind?: 'melee' | 'ranged';
  long_range_feet?: number | null;
  thrown_range_feet?: number | null;
  versatile_formula?: string | null;
  ammo_resource_id?: string | null;
  properties?: string[];
  srd_index?: string | null;
  attack_bonus?: number;
  extra_damage_formula?: string | null;
  extra_damage_type?: string | null;
};

type SrdWeapon = { index: string; nameRu: string; category: 'simple' | 'martial'; kind: 'melee' | 'ranged'; damage: string | null; properties: string[]; fields: Record<string, unknown> };

const props = defineProps<{
  campaignId: string;
  characterId: string;
  weapons: WeaponDTO[];
  legacy: unknown[];
  resources: Array<{ id: string; name: string }>;
  readOnly: boolean;
  busy: boolean;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();

const emit = defineEmits<{ changed: []; attack: [weaponId: string] }>();

const PROPERTY_LABELS: Record<string, string> = {
  ammunition: 'боеприпасы', finesse: 'фехтовальное', heavy: 'тяжёлое', light: 'лёгкое', loading: 'перезарядка',
  reach: 'досягаемость', special: 'особое', thrown: 'метательное', 'two-handed': 'двуручное', versatile: 'универсальное',
};
const ABILITY_SHORT: Record<string, string> = { strength: 'СИЛ', dexterity: 'ЛОВ', finesse: 'СИЛ/ЛОВ' };

const working = ref(false);
const error = ref('');
const newName = ref('');
const newAbility = ref<'strength' | 'dexterity' | 'finesse'>('strength');
const newFormula = ref('1d8+@mod');
const newType = ref('slashing');
const newRange = ref(5);
const srdWeapons = ref<SrdWeapon[]>([]);
const srdChoice = ref('');

const base = computed(() => `/campaigns/${props.campaignId}/characters/${props.characterId}/weapons`);

onMounted(async () => {
  if (props.readOnly) return;
  try {
    srdWeapons.value = (await props.request('/srd/weapons')).weapons;
  } catch {
    srdWeapons.value = [];
  }
});

async function act(action: () => Promise<unknown>) {
  if (working.value) return;
  working.value = true;
  error.value = '';
  try {
    await action();
    emit('changed');
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не получилось.';
  } finally {
    working.value = false;
  }
}

function update(weapon: WeaponDTO, field: string, value: unknown) {
  return act(() => props.request(`${base.value}/${weapon.id}`, 'PATCH', { [field]: value }));
}

const numberOrNull = (event: Event) => {
  const value = Math.round(Number((event.target as HTMLInputElement).value));
  return Number.isFinite(value) && value >= 5 ? value : null;
};

function add() {
  if (!newName.value.trim()) return;
  return act(async () => {
    await props.request(base.value, 'POST', {
      name: newName.value.trim(),
      ability: newAbility.value,
      proficient: true,
      damageFormula: newFormula.value.trim() || null,
      damageType: newType.value || null,
      rangeFeet: Math.max(5, Math.min(1000, Math.round(newRange.value || 5))),
    });
    newName.value = '';
  });
}

function addSrd() {
  const weapon = srdWeapons.value.find(entry => entry.index === srdChoice.value);
  if (!weapon) return;
  return act(async () => {
    await props.request(base.value, 'POST', { ...weapon.fields, proficient: true });
    srdChoice.value = '';
  });
}

async function remove(weapon: WeaponDTO) {
  if (!(await confirmAction(`Убрать оружие «${weapon.name}»?`, { title: 'Убрать', confirmLabel: 'Убрать', danger: true }))) return;
  return act(() => props.request(`${base.value}/${weapon.id}`, 'DELETE'));
}

function describe(weapon: WeaponDTO) {
  const type = weapon.damage_type ? ` ${DAMAGE_TYPES.find(entry => entry.id === weapon.damage_type)?.label ?? ''}` : '';
  const range = weapon.weapon_kind === 'ranged'
    ? `${weapon.range_feet}${weapon.long_range_feet ? `/${weapon.long_range_feet}` : ''} фут.`
    : `${weapon.range_feet} фут.${weapon.thrown_range_feet ? `, бросок ${weapon.thrown_range_feet}/${weapon.long_range_feet ?? weapon.thrown_range_feet}` : ''}`;
  const props2 = (weapon.properties ?? []).map(code => PROPERTY_LABELS[code] ?? code).join(', ');
  const bonus = weapon.attack_bonus ? `, ${weapon.attack_bonus > 0 ? '+' : ''}${weapon.attack_bonus} к попаданию` : '';
  const extraType = weapon.extra_damage_type ? ` ${DAMAGE_TYPES.find(entry => entry.id === weapon.extra_damage_type)?.label ?? ''}` : '';
  const extra = weapon.extra_damage_formula ? ` плюс ${weapon.extra_damage_formula}${extraType}` : '';
  return `${ABILITY_SHORT[weapon.ability] ?? weapon.ability}${weapon.proficient ? ', владение' : ''}${bonus} · ${weapon.damage_formula ?? 'урон не задан'}${type}${extra}${weapon.versatile_formula ? ` (двумя руками ${weapon.versatile_formula})` : ''} · ${range}${props2 ? ` · ${props2}` : ''}`;
}

type LegacyWeapon = { name: string; formula: string | null; ability: 'strength' | 'dexterity'; proficient: boolean };

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'value' in value) return String((value as any).value ?? '');
  return '';
}

const legacyWeapons = computed<LegacyWeapon[]>(() => props.legacy.flatMap(entry => {
  if (!entry || typeof entry !== 'object') return [];
  const record = entry as Record<string, unknown>;
  const name = text(record.name).trim();
  if (!name || props.weapons.some(weapon => weapon.name.toLowerCase() === name.toLowerCase())) return [];
  const damage = text(record.dmg ?? record.damage).toLowerCase().replace(/к/g, 'd').replace(/\s+/g, '');
  const formula = /^\d{1,2}d\d{1,3}([+-]\d{1,3})?$/.test(damage) ? damage : null;
  const abilityText = text(record.ability ?? record.stat).toLowerCase();
  const ability = /dex|лов/.test(abilityText) || /лук|арбалет|bow|dart|дротик|кинжал|dagger|рапира|rapier/i.test(name) ? 'dexterity' : 'strength';
  const proficient = record.isProf === undefined ? true : Boolean(record.isProf);
  return [{ name, formula, ability, proficient }];
}));

function importLegacy() {
  return act(async () => {
    for (const weapon of legacyWeapons.value) {
      const ranged = weapon.ability === 'dexterity' && /лук|арбалет|bow/i.test(weapon.name);
      await props.request(base.value, 'POST', {
        name: weapon.name.slice(0, 100),
        ability: weapon.ability,
        proficient: weapon.proficient,
        damageFormula: weapon.formula,
        weaponKind: ranged ? 'ranged' : 'melee',
        rangeFeet: ranged ? 80 : 5,
      });
    }
  });
}
</script>

<template>
  <section class="weapons-panel">
    <ul v-if="weapons.length" class="weapon-list">
      <li v-for="weapon in weapons" :key="weapon.id" class="weapon-row">
        <ItemArt :name="weapon.name" :srd-index="weapon.srd_index" :size="30" :fallback-icon="weapon.weapon_kind === 'ranged' ? 'bow' : 'swords'" />
        <template v-if="readOnly">
          <strong>{{ weapon.name }}</strong>
          <span class="muted">{{ describe(weapon) }}</span>
        </template>
        <template v-else>
          <div class="weapon-summary"><strong>{{ weapon.name }}</strong><span class="muted">{{ describe(weapon) }}</span></div>
          <button type="button" class="primary" :disabled="working || busy" title="Бросок атаки (без цели)" @click="emit('attack', weapon.id)">Атака</button>
          <details class="weapon-settings">
            <summary>Настройки оружия</summary>
            <div class="weapon-fields">
          <input class="w-name" :value="weapon.name" maxlength="100" aria-label="Название" :disabled="working || busy" @change="update(weapon, 'name', ($event.target as HTMLInputElement).value)" />
          <select :value="weapon.ability" aria-label="Характеристика" title="Фехтовальное — лучшая из Силы и Ловкости" :disabled="working || busy" @change="update(weapon, 'ability', ($event.target as HTMLSelectElement).value)">
            <option value="strength">СИЛ</option>
            <option value="dexterity">ЛОВ</option>
            <option value="finesse">фехт.</option>
          </select>
          <label class="checkbox-label" title="Владение: +бонус мастерства к атаке">
            <input type="checkbox" :checked="weapon.proficient" :disabled="working || busy" @change="update(weapon, 'proficient', ($event.target as HTMLInputElement).checked)" /> влад.
          </label>
          <input class="w-formula" :value="weapon.damage_formula ?? ''" maxlength="60" placeholder="1d8+@mod" title="Урон: кости и переменные @mod (характеристика оружия), @str, @dex… @prof" :disabled="working || busy" @change="update(weapon, 'damageFormula', ($event.target as HTMLInputElement).value.trim() || null)" />
          <select :value="weapon.damage_type ?? ''" aria-label="Тип урона" :disabled="working || busy" @change="update(weapon, 'damageType', ($event.target as HTMLSelectElement).value || null)">
            <option value="">— тип —</option>
            <option v-for="type in DAMAGE_TYPES" :key="type.id" :value="type.id">{{ type.label }}</option>
          </select>

          <button type="button" class="w-remove" :disabled="working || busy" aria-label="Убрать" @click="remove(weapon)"><GameIcon class="inline-icon" name="close" :size="16" /></button>
          <details class="w-more">
            <summary>{{ describe(weapon) }}</summary>
            <div class="w-more-fields">
              <label>
                Вид
                <select :value="weapon.weapon_kind ?? 'melee'" :disabled="working || busy" @change="update(weapon, 'weaponKind', ($event.target as HTMLSelectElement).value)">
                  <option value="melee">рукопашное</option>
                  <option value="ranged">дальнобойное</option>
                </select>
              </label>
              <label :title="weapon.weapon_kind === 'ranged' ? 'Обычная дистанция' : 'Досягаемость: 5, с «досягаемостью» — 10'">
                {{ weapon.weapon_kind === 'ranged' ? 'Дистанция' : 'Досягаемость' }}, фут.
                <input type="number" min="5" max="1000" step="5" :value="weapon.range_feet" :disabled="working || busy" @change="update(weapon, 'rangeFeet', numberOrNull($event) ?? 5)" />
              </label>
              <label v-if="weapon.weapon_kind !== 'ranged'" title="Метательное: обычная дистанция броска (пусто — не метательное)">
                Бросок, фут.
                <input type="number" min="5" max="1000" step="5" :value="weapon.thrown_range_feet ?? ''" :disabled="working || busy" @change="update(weapon, 'thrownRangeFeet', numberOrNull($event))" />
              </label>
              <label title="Дальняя дистанция: дальше обычной — с помехой, дальше дальней — нельзя">
                Дальняя, фут.
                <input type="number" min="5" max="2000" step="5" :value="weapon.long_range_feet ?? ''" :disabled="working || busy" @change="update(weapon, 'longRangeFeet', numberOrNull($event))" />
              </label>
              <label title="Универсальное: урон двумя руками">
                Двумя руками
                <input :value="weapon.versatile_formula ?? ''" maxlength="60" placeholder="1d10+@mod" :disabled="working || busy" @change="update(weapon, 'versatileFormula', ($event.target as HTMLInputElement).value.trim() || null)" />
              </label>
              <label title="Сверх характеристики и мастерства: магическое оружие +1…+3, особый бонус монстра">
                К попаданию
                <input type="number" min="-10" max="20" :value="weapon.attack_bonus ?? 0" :disabled="working || busy" @change="update(weapon, 'attackBonus', numberOrNull($event) ?? 0)" />
              </label>
              <label title="Второй урон другого типа при попадании: «плюс 1d6 огнём»">
                Ещё урон
                <input :value="weapon.extra_damage_formula ?? ''" maxlength="60" placeholder="1d6" :disabled="working || busy" @change="update(weapon, 'extraDamageFormula', ($event.target as HTMLInputElement).value.trim() || null)" />
              </label>
              <label>
                Его тип
                <select :value="weapon.extra_damage_type ?? ''" :disabled="working || busy" @change="update(weapon, 'extraDamageType', ($event.target as HTMLSelectElement).value || null)">
                  <option value="">— тип —</option>
                  <option v-for="type in DAMAGE_TYPES" :key="type.id" :value="type.id">{{ type.label }}</option>
                </select>
              </label>
              <label title="Ресурс листа: каждая атака — минус один">
                Боеприпасы
                <select :value="weapon.ammo_resource_id ?? ''" :disabled="working || busy" @change="update(weapon, 'ammoResourceId', ($event.target as HTMLSelectElement).value || null)">
                  <option value="">не тратит</option>
                  <option v-for="resource in resources" :key="resource.id" :value="resource.id">{{ resource.name }}</option>
                </select>
              </label>
            </div>
          </details>
            </div>
            <p class="muted">Изменения полей сохраняются сразу.</p>
          </details>
        </template>
      </li>
    </ul>
    <p v-else class="muted">Оружия для атак ещё нет — добавьте из справочника или вручную: формула урона бросается сама при попадании.</p>

    <details v-if="!readOnly" class="weapon-create">
      <summary>Добавить оружие</summary>
      <div class="weapon-create-body">
        <form v-if="srdWeapons.length" class="weapon-add" @submit.prevent="addSrd">
          <span class="weapon-add-label">Из справочника</span>
          <select v-model="srdChoice" :disabled="working || busy" aria-label="Оружие из справочника SRD">
            <option value="">— выберите оружие SRD —</option>
            <optgroup v-for="group in [['simple', 'Простое'], ['martial', 'Воинское']] as const" :key="group[0]" :label="group[1]">
              <option v-for="weapon in srdWeapons.filter(entry => entry.category === group[0])" :key="weapon.index" :value="weapon.index">
                {{ weapon.nameRu }} — {{ weapon.damage ?? 'без урона' }}{{ weapon.properties.length ? ` (${weapon.properties.map(code => PROPERTY_LABELS[code] ?? code).join(', ')})` : '' }}
              </option>
            </optgroup>
          </select>
          <button type="submit" class="primary" :disabled="working || busy || !srdChoice">Добавить</button>
        </form>

        <form class="weapon-add custom" @submit.prevent="add">
          <span class="weapon-add-label">Своё оружие</span>
          <input v-model="newName" maxlength="100" placeholder="Например, Посох мага" :disabled="working || busy" />
          <select v-model="newAbility" :disabled="working || busy" aria-label="Характеристика">
            <option value="strength">СИЛ</option>
            <option value="dexterity">ЛОВ</option>
            <option value="finesse">фехт.</option>
          </select>
          <input v-model="newFormula" class="w-formula" maxlength="60" placeholder="1d8+@mod" :disabled="working || busy" />
          <select v-model="newType" :disabled="working || busy" aria-label="Тип урона">
            <option v-for="type in DAMAGE_TYPES" :key="type.id" :value="type.id">{{ type.label }}</option>
          </select>
          <label class="w-range"><input v-model.number="newRange" type="number" min="5" max="1000" step="5" :disabled="working || busy" /> фут.</label>
          <button type="submit" :disabled="working || busy || !newName.trim()">Добавить</button>
        </form>
      </div>
    </details>

    <div v-if="!readOnly && legacyWeapons.length" class="notice">
      В импортированном листе есть оружие без механики: {{ legacyWeapons.map(weapon => weapon.name).join(', ') }}.
      <button type="button" :disabled="working || busy" @click="importLegacy">Перенести для атак</button>
    </div>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.weapon-list{list-style:none;margin:0 0 10px;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:8px}
.weapon-row,.weapon-add{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.weapon-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;padding:10px;border:1px solid var(--brass-light);border-radius:7px;background:var(--surface-inset);min-width:0}
.weapon-row input,.weapon-row select,.weapon-add input,.weapon-add select{width:auto;min-height:34px;padding:3px 8px}
.w-name{flex:1 1 150px}
.weapon-add > input:first-child,.weapon-add > select:first-child{flex:1 1 220px}
.w-formula{width:110px !important}
.w-range{display:inline-flex;align-items:center;gap:4px;margin:0;font-size:13px}
.w-range input{width:70px !important}
.weapon-row .checkbox-label{margin:0;gap:4px;font-size:13px}
.weapon-row button,.weapon-add button{min-height:32px;padding:3px 10px;font-size:13px}
.w-remove{width:32px;padding:0}
.w-more{flex:1 1 100%;font-size:12px}
.w-more summary{cursor:pointer;color:var(--muted-ink,#8a7c68)}
.w-more-fields{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:6px 10px;margin-top:6px}
.w-more-fields label{margin:0;font-size:12px}
.w-more-fields input,.w-more-fields select{width:100% !important}

.weapon-summary{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.weapon-summary strong{font-size:15px;overflow-wrap:anywhere}
.weapon-summary .muted{font-size:12px}
.weapon-row > strong,.weapon-row > .muted{grid-column:2 / -1}
.weapon-settings{grid-column:1 / -1;min-width:0;padding:4px 0}
.weapon-settings > summary{cursor:pointer;font-size:12px;color:var(--muted-ink)}
.weapon-fields{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:12px;margin-top:8px;background:var(--surface-inset);border-radius:6px}
.weapon-fields > input,.weapon-fields > select{max-width:100%;min-width:0}
.weapon-settings p{font-size:12px;margin:8px 0 0}
.weapon-create{padding:10px 12px;border:1px dashed var(--brass-light);border-radius:6px}
.weapon-create > summary{cursor:pointer;font-size:13px;color:var(--muted-ink)}
.weapon-create[open] > summary{margin-bottom:10px}
.weapon-create-body{display:grid;gap:8px}
.weapon-add{display:grid;grid-template-columns:minmax(110px,.5fr) minmax(190px,1.5fr) auto;gap:8px;padding:10px;background:var(--surface-inset);border-radius:6px;margin:0}
.weapon-add.custom{grid-template-columns:minmax(110px,.5fr) minmax(160px,1.2fr) auto auto auto auto auto}
.weapon-add-label{align-self:center;font-size:12px;font-weight:700;color:var(--muted-ink)}
.weapon-add > input,.weapon-add > select{max-width:100%;min-width:0}
@media(max-width:760px){.weapon-add,.weapon-add.custom{grid-template-columns:minmax(0,1fr) auto}.weapon-add-label{grid-column:1 / -1}.weapon-add > input:first-of-type,.weapon-add > select:first-of-type{grid-column:1 / -1}}
@media(max-width:420px){.weapon-add,.weapon-add.custom{grid-template-columns:1fr}.weapon-add > *{grid-column:auto!important}}
</style>
