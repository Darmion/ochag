<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { DAMAGE_TYPES } from '../../rules/objectRules';
import ItemArt from '../rpg/ItemArt.vue';
import GameIcon from '../game/GameIcon.vue';

type Magic = {
  rarity: string; rarityLabel: string; description: string; requiresAttunement: boolean; attuned: boolean; equipped: boolean;
  active: boolean; destroyed: boolean; bonusText: string; srdIndex: string | null;
  bonuses: { armorClass?: number; saves?: number; speed?: number; abilities?: Record<string, number>; resistances?: string[] };
  charges: { current: number; max: number; recharge: 'dawn' | 'short' | 'long' | null; rechargeLabel: string | null; formula: string | null; destroyOnEmpty: boolean } | null;
};
type Item = { id: string; name: string; contents_count: number; magic: Magic | null };
type Data = {
  items: Item[]; attunedCount: number; attunementLimit: number; fromItems: string[]; gm: boolean;
  recharged: Array<{ name: string; gained: number; current: number; max: number }>;
};
type Preset = { index: string; nameRu: string; rarity: string; attunement: boolean };

const props = defineProps<{
  campaignId: string;
  characterId: string;
  revision: number;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();
const emit = defineEmits<{ changed: [] }>();

const RARITIES = [
  ['common', 'обычный'], ['uncommon', 'необычный'], ['rare', 'редкий'], ['very_rare', 'очень редкий'], ['legendary', 'легендарный'], ['artifact', 'артефакт'],
] as const;
const ABILITIES = [
  ['strength', 'Сила'], ['dexterity', 'Ловкость'], ['constitution', 'Телосложение'],
  ['intelligence', 'Интеллект'], ['wisdom', 'Мудрость'], ['charisma', 'Харизма'],
] as const;

const data = ref<Data | null>(null);
const hidden = ref(false);
const error = ref('');
const notice = ref('');
const working = ref(false);
const presets = ref<Preset[]>([]);
const presetIndex = ref('');

const path = (itemId: string, tail: string) => `/campaigns/${props.campaignId}/characters/${itemId}/${tail}`;

async function load() {
  try {
    data.value = await props.request(`/campaigns/${props.campaignId}/characters/${props.characterId}/items`);
    hidden.value = false;
    if (data.value?.recharged.length) {
      notice.value = `На рассвете: ${data.value.recharged.map(entry => `«${entry.name}» +${entry.gained} (${entry.current}/${entry.max})`).join(', ')}.`;
    }
    if (data.value?.gm && !presets.value.length) {
      presets.value = (await props.request('/srd/magic-items')).items ?? [];
    }
  } catch {
    hidden.value = true;
  }
}
watch(() => [props.characterId, props.revision], load, { immediate: true });

async function act(action: () => Promise<any>, sheetChanged = true) {
  if (working.value) return;
  working.value = true;
  error.value = '';
  try {
    const result = await action();
    if (result?.message) notice.value = result.message;
    await load();
    if (sheetChanged) emit('changed');
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не получилось.';
  } finally {
    working.value = false;
  }
}

const equip = (item: Item) => act(() => props.request(path(item.id, 'equip'), 'POST', { equipped: !item.magic!.equipped }));
const attune = (item: Item) => act(() => props.request(path(item.id, 'attune'), 'POST', { attuned: !item.magic!.attuned }));
const spend = (item: Item) => act(() => props.request(path(item.id, 'charges'), 'POST', { spend: 1 }), false);
const setCharges = (item: Item, value: number) => act(() => props.request(path(item.id, 'charges'), 'POST', { set: value }), false);
const gift = () => act(async () => {
  const preset = presets.value.find(entry => entry.index === presetIndex.value);
  await props.request(`/campaigns/${props.campaignId}/characters/${props.characterId}/items`, 'POST', { srdIndex: presetIndex.value });
  presetIndex.value = '';
  return { message: `Подарено: «${preset?.nameRu ?? 'предмет'}».` };
});

const editing = ref<string | null>(null);
const form = ref({
  rarity: 'uncommon', description: '', requiresAttunement: false, chargesMax: '' as number | '', recharge: '' as '' | 'dawn' | 'short' | 'long',
  rechargeFormula: '', destroyOnEmpty: false, armorClass: '' as number | '', saves: '' as number | '', speed: '' as number | '',
  ability: '' as string, abilityValue: '' as number | '', resistances: [] as string[],
});

function openEditor(item: Item) {
  const magic = item.magic;
  const ability = Object.entries(magic?.bonuses.abilities ?? {})[0];
  form.value = {
    rarity: magic?.rarity ?? 'uncommon', description: magic?.description ?? '', requiresAttunement: magic?.requiresAttunement ?? false,
    chargesMax: magic?.charges?.max ?? '', recharge: magic?.charges?.recharge ?? '', rechargeFormula: magic?.charges?.formula ?? '',
    destroyOnEmpty: magic?.charges?.destroyOnEmpty ?? false, armorClass: magic?.bonuses.armorClass ?? '', saves: magic?.bonuses.saves ?? '',
    speed: magic?.bonuses.speed ?? '', ability: ability?.[0] ?? '', abilityValue: ability?.[1] ?? '', resistances: [...(magic?.bonuses.resistances ?? [])],
  };
  editing.value = item.id;
}

const number = (value: number | '') => (value === '' || !Number.isFinite(value) ? undefined : Math.round(value));

function saveMagic(item: Item) {
  const value = form.value;
  const bonuses: Record<string, unknown> = {};
  if (number(value.armorClass)) bonuses.armorClass = number(value.armorClass);
  if (number(value.saves)) bonuses.saves = number(value.saves);
  if (number(value.speed)) bonuses.speed = number(value.speed);
  if (value.ability && number(value.abilityValue)) bonuses.abilities = { [value.ability]: number(value.abilityValue) };
  if (value.resistances.length) bonuses.resistances = value.resistances;
  const chargesMax = number(value.chargesMax) ?? null;
  return act(async () => {
    await props.request(path(item.id, 'magic'), 'PUT', {
      rarity: value.rarity, description: value.description, requiresAttunement: value.requiresAttunement,
      chargesMax, recharge: chargesMax && value.recharge ? value.recharge : null,
      rechargeFormula: chargesMax && value.rechargeFormula.trim() ? value.rechargeFormula.trim() : null,
      destroyOnEmpty: Boolean(chargesMax) && value.destroyOnEmpty, bonuses,
    });
    editing.value = null;
    return { message: `«${item.name}»: свойства сохранены.` };
  });
}

const removeMagic = (item: Item) => act(async () => {
  await props.request(path(item.id, 'magic'), 'DELETE');
  editing.value = null;
  return { message: `«${item.name}» — снова обычный предмет.` };
});

const magicItems = computed(() => data.value?.items.filter(item => item.magic) ?? []);
const plainItems = computed(() => data.value?.items.filter(item => !item.magic) ?? []);
const plainChoice = ref('');
const plainEditing = computed(() => plainItems.value.find(item => item.id === editing.value) ?? null);
function chooseItem() {
  const item = plainItems.value.find(entry => entry.id === plainChoice.value);
  plainChoice.value = '';
  if (item) openEditor(item);
}
</script>

<template>
  <section v-if="data && !hidden" class="character-items" aria-label="Вещи">
    <p class="items-summary">
      <span>Настроено: <b>{{ data.attunedCount }}</b> из {{ data.attunementLimit }}</span>
      <span v-if="data.fromItems.length"> · от предметов: {{ data.fromItems.join('; ') }}</span>
    </p>
    <p v-if="notice" class="muted items-notice" aria-live="polite">{{ notice }}</p>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>

    <ul class="items">
      <li v-for="item in [...magicItems, ...(plainEditing ? [plainEditing] : [])]" :key="item.id" :class="{ magic: item.magic, active: item.magic?.active, destroyed: item.magic?.destroyed }">
        <div class="item-head">
          <span class="item-name"><ItemArt :name="item.name" :srd-index="item.magic?.srdIndex" :rarity="item.magic?.rarity" :size="36" :fallback-icon="item.magic ? 'sparkle' : null" placeholder /> {{ item.name }}</span>
          <small v-if="item.magic" class="rarity" :class="item.magic.rarity">{{ item.magic.rarityLabel }}{{ item.magic.requiresAttunement ? ', нужна настройка' : '' }}</small>
          <small v-if="item.contents_count" class="muted">внутри: {{ item.contents_count }}</small>
        </div>

        <template v-if="item.magic">
          <p v-if="item.magic.destroyed" class="muted">Уничтожен.</p>
          <p v-else-if="item.magic.bonusText" class="bonus">{{ item.magic.bonusText }}<b v-if="item.magic.active"> — действует</b></p>
          <div v-if="!item.magic.destroyed" class="item-actions">
            <button
              v-if="item.magic.bonusText || item.magic.equipped" type="button" :disabled="working" :aria-pressed="item.magic.equipped" @click="equip(item)"
            >{{ item.magic.equipped ? 'Снять' : 'Надеть' }}</button>
            <button
              v-if="item.magic.requiresAttunement" type="button" :disabled="working" :aria-pressed="item.magic.attuned"
              title="Настройка — короткий отдых с предметом; не больше трёх предметов" @click="attune(item)"
            >{{ item.magic.attuned ? 'Прервать настройку' : 'Настроиться' }}</button>
            <span v-if="item.magic.charges" class="charges" :title="item.magic.charges.destroyOnEmpty ? 'Последний заряд — к20: на 1 предмет рассыпается' : ''">
              <GameIcon class="inline-icon" name="bolt" :size="16" /> {{ item.magic.charges.current }}/{{ item.magic.charges.max }}
              <small v-if="item.magic.charges.recharge" class="muted">{{ item.magic.charges.formula ? `+${item.magic.charges.formula}` : 'все' }} {{ item.magic.charges.rechargeLabel }}</small>
            </span>
            <button v-if="item.magic.charges" type="button" :disabled="working || item.magic.charges.current < 1" @click="spend(item)">−1 заряд</button>
            <button
              v-if="data.gm && item.magic.charges && item.magic.charges.current < item.magic.charges.max" type="button" class="link-button" :disabled="working"
              @click="setCharges(item, item.magic.charges.max)"
            >полные</button>
            <button v-if="data.gm" type="button" class="link-button" :disabled="working" @click="editing === item.id ? (editing = null) : openEditor(item)">Свойства</button>
          </div>
          <details v-if="item.magic.description" class="item-description">
            <summary>Описание</summary>
            <p>{{ item.magic.description }}</p>
          </details>
        </template>

        <div v-if="editing === item.id" class="magic-editor">
          <div class="editor-row">
            <label>Редкость
              <select v-model="form.rarity" :disabled="working">
                <option v-for="[id, label] in RARITIES" :key="id" :value="id">{{ label }}</option>
              </select>
            </label>
            <label class="checkbox-label"><input v-model="form.requiresAttunement" type="checkbox" :disabled="working" /> нужна настройка</label>
          </div>
          <textarea v-model="form.description" rows="3" maxlength="2000" placeholder="Что делает" :disabled="working" aria-label="Описание" />
          <div class="editor-row">
            <label>КД <input v-model.number="form.armorClass" type="number" min="-5" max="10" :disabled="working" /></label>
            <label>Спасброски <input v-model.number="form.saves" type="number" min="-5" max="10" :disabled="working" /></label>
            <label>Скорость <input v-model.number="form.speed" type="number" min="-30" max="120" step="5" :disabled="working" /></label>
          </div>
          <div class="editor-row">
            <label>Характеристика становится
              <select v-model="form.ability" :disabled="working">
                <option value="">— нет —</option>
                <option v-for="[id, label] in ABILITIES" :key="id" :value="id">{{ label }}</option>
              </select>
            </label>
            <input v-if="form.ability" v-model.number="form.abilityValue" type="number" min="1" max="30" :disabled="working" aria-label="Значение" />
          </div>
          <fieldset class="resistances">
            <legend>Сопротивление</legend>
            <label v-for="type in DAMAGE_TYPES" :key="type.id" class="checkbox-label">
              <input v-model="form.resistances" type="checkbox" :value="type.id" :disabled="working" /> {{ type.label }}
            </label>
          </fieldset>
          <div class="editor-row">
            <label>Зарядов <input v-model.number="form.chargesMax" type="number" min="1" max="100" placeholder="нет" :disabled="working" /></label>
            <template v-if="form.chargesMax">
              <label>Восстановление
                <select v-model="form.recharge" :disabled="working">
                  <option value="">не восстанавливаются</option>
                  <option value="dawn">на рассвете</option>
                  <option value="short">после короткого отдыха</option>
                  <option value="long">после долгого отдыха</option>
                </select>
              </label>
              <label v-if="form.recharge">Сколько <input v-model="form.rechargeFormula" maxlength="20" placeholder="все или 1d6+1" :disabled="working" /></label>
              <label class="checkbox-label"><input v-model="form.destroyOnEmpty" type="checkbox" :disabled="working" /> последний заряд: к20, на 1 — рассыпается</label>
            </template>
          </div>
          <div class="editor-row">
            <button type="button" class="primary" :disabled="working" @click="saveMagic(item)">Сохранить</button>
            <button type="button" :disabled="working" @click="editing = null">Отмена</button>
            <button v-if="item.magic" type="button" class="link-button" :disabled="working" @click="removeMagic(item)">Сделать обычным</button>
          </div>
        </div>
      </li>
    </ul>
    <p v-if="!magicItems.length" class="muted">Магических предметов нет.</p>

    <div v-if="data.gm && plainItems.length" class="gift-row">
      <select v-model="plainChoice" :disabled="working" aria-label="Обычная вещь">
        <option value="">— сделать магической вещь из снаряжения —</option>
        <option v-for="item in plainItems" :key="item.id" :value="item.id">{{ item.name }}</option>
      </select>
      <button type="button" :disabled="working || !plainChoice" @click="chooseItem"><GameIcon class="inline-icon" name="sparkle" :size="16" /> Свойства…</button>
    </div>
    <div v-if="data.gm && presets.length" class="gift-row">
      <select v-model="presetIndex" :disabled="working" aria-label="Готовый магический предмет">
        <option value="">— готовый магический предмет (SRD 5.1) —</option>
        <option v-for="preset in presets" :key="preset.index" :value="preset.index">{{ preset.nameRu }}</option>
      </select>
      <button type="button" :disabled="working || !presetIndex" @click="gift"><GameIcon class="inline-icon" name="sparkle" :size="16" /> Подарить</button>
    </div>
  </section>
</template>

<style scoped>
.character-items{display:grid;gap:10px}
.items-summary{margin:0;font-size:13px;padding:7px 10px;border-left:2px solid #8a6fc9;background:color-mix(in srgb,var(--surface-inset) 72%,transparent)}
.items-notice{margin:0}
.items{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:8px}
.items li{padding:10px;border:1px solid var(--border,#5a4a35);border-radius:7px;display:grid;gap:7px;min-width:0;background:var(--surface-inset)}
.items li.magic{border-color:#8a6fc9}
.items li.active{box-shadow:inset 3px 0 0 #b48cff}
.items li.destroyed{opacity:.6}
.item-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.item-name{font-weight:600;overflow-wrap:anywhere;display:inline-flex;align-items:center;gap:8px}
.rarity{font-size:12px;color:#c8b6f0}
.rarity.rare{color:#7fb2ff}.rarity.very_rare{color:#d58bff}.rarity.legendary{color:#ffb35c}.rarity.artifact{color:#ff8a7a}
.bonus{margin:0;font-size:13px}
.item-actions{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding-top:5px;border-top:1px solid var(--brass-light)}
.item-actions button{min-height:28px;padding:2px 10px;font-size:13px}
.charges{font-size:13px;white-space:nowrap}
.character-items .item-description > summary{font:inherit;font-size:13px;letter-spacing:0;text-transform:none;cursor:pointer;color:var(--g-text-dim,#bfae8e)}
.item-description p{margin:4px 0 0;font-size:13px;white-space:pre-wrap}
.magic-editor{display:grid;gap:6px;padding:8px;border-radius:6px;background:#0002}
.editor-row{display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px}
.editor-row label{margin:0;font-size:13px}
.editor-row input[type=number]{width:72px}
.magic-editor textarea{width:100%;min-width:0;box-sizing:border-box}
.resistances{display:flex;flex-wrap:wrap;gap:2px 10px;margin:0;padding:4px 8px;font-size:13px}
.resistances .checkbox-label{margin:0}
.gift-row{display:flex;flex-wrap:wrap;gap:6px;padding:9px 10px;border:1px dashed var(--brass-light);border-radius:6px}
.gift-row select{flex:1 1 220px;min-width:0}
</style>
