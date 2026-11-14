<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ITEM_CATEGORIES, ITEM_CATEGORY_LABELS, SLOT_LABELS, WEAR_FAMILIES, type EquipSlot, type WearFamily } from '../../../../../../packages/domain/character/inventory';
import { CATEGORY_ICONS, priceLabel, srdArtIndex, weightLabel } from '../../../inventory/icons';
import type { InventoryEntry } from '../../../inventory/useInventory';
import { confirmAction } from '../../../ui/confirmDialog';
import ItemArt from '../../rpg/ItemArt.vue';
import GameIcon from '../../game/GameIcon.vue';
import DamageTag from '../../common/DamageTag.vue';
import InvPopover from './InvPopover.vue';

const props = defineProps<{
  item: InventoryEntry;
  holderId: string;
  party: Array<{ id: string; name: string }>;
  containers: InventoryEntry[];
  working: boolean;
  editable: boolean;
  manager: boolean;
}>();
const emit = defineEmits<{
  close: []; equip: [slot: EquipSlot | null, grip?: 'one' | 'two']; use: [count: number]; drink: []; split: [count: number];
  give: [toId: string, count: number, toName: string]; drop: []; move: [containerId: string]; patch: [body: Record<string, unknown>]; remove: []; attune: [on: boolean];
}>();

const WEAR_LABELS: Record<WearFamily, string> = {
  head: 'Голова', neck: 'Шея', cloak: 'Плечи', body: 'Тело', hand: 'В руку', hands: 'Кисти', ring: 'Кольцо', belt: 'Пояс', feet: 'Ноги', ammo: 'Колчан',
};
const RARITY: Record<string, string> = { common: 'обычный', uncommon: 'необычный', rare: 'редкий', very_rare: 'очень редкий', legendary: 'легендарный', artifact: 'артефакт' };
const DAMAGE: Record<string, string> = { slashing: 'рубящего', piercing: 'колющего', bludgeoning: 'дробящего' };
const PROPERTIES: Record<string, string> = {
  ammunition: 'боеприпасы', finesse: 'фехтовальное', heavy: 'тяжёлое', light: 'лёгкое', loading: 'перезарядка', reach: 'досягаемость',
  special: 'особое', thrown: 'метательное', 'two-handed': 'двуручное', versatile: 'универсальное',
};

const held = computed(() => props.item.containerId === props.holderId);
const potion = computed(() => props.item.srd === 'gear:potion-of-healing');
const consumable = computed(() => ['consumable', 'ammo'].includes(props.item.category));
const totalWeight = computed(() => (props.item.weightLb === null ? null : props.item.weightLb * props.item.quantity));
const totalPrice = computed(() => (props.item.priceCp === null ? null : props.item.priceCp * props.item.quantity));
const armorText = computed(() => {
  const armor = props.item.armor;
  if (!armor) return '';
  if (armor.kind === 'shield') return `КД +${armor.ac}`;
  const dex = armor.dex === 'full' ? '+ модификатор Ловкости' : armor.dex === 'max2' ? '+ модификатор Ловкости, максимум +2' : 'без Ловкости';
  return [`КД ${armor.ac} ${dex}`, armor.strength ? `при Силе ниже ${armor.strength} скорость −10 фт.` : '', armor.stealth ? 'помеха к Скрытности' : ''].filter(Boolean).join(' · ');
});
const weaponText = computed(() => {
  const weapon = props.item.weapon;
  if (!weapon) return '';
  return [weapon.damage ? `${weapon.damage} ${DAMAGE[weapon.damageType ?? ''] ?? ''}`.trim() : '', weapon.properties.map(code => PROPERTIES[code] ?? code).join(', '),
    weapon.range ? `дистанция ${weapon.range[0]}/${weapon.range[1]} фт.` : ''].filter(Boolean).join(' · ');
});

const giveTo = ref('');
const giveCount = ref(1);
const splitCount = ref(1);
const grip = ref<'one' | 'two'>('one');
const form = ref({ name: '', category: '' as string, weight: '' as number | '', price: '' as number | '', wear: '' as string, note: '' });
watch(() => props.item.id, () => {
  giveCount.value = props.item.quantity;
  splitCount.value = Math.max(1, Math.floor(props.item.quantity / 2));
  grip.value = props.item.grip ?? 'one';
  resetForm();
}, { immediate: true });

function resetForm() {
  form.value = {
    name: props.item.name, category: props.item.storedCategory ?? '', weight: props.item.weightLb ?? '',
    price: props.item.priceCp === null ? '' : props.item.priceCp / 100, wear: props.item.wear ?? '', note: props.item.note ?? '',
  };
}
function saveForm(close: () => void) {
  const value = form.value;
  emit('patch', {
    name: value.name.trim() || props.item.name,
    category: value.category || null,
    weightLb: value.weight === '' ? null : Number(value.weight),
    priceCp: value.price === '' ? null : Math.round(Number(value.price) * 100),
    wear: value.wear || null,
    note: value.note.trim() || null,
  });
  close();
}
async function remove() {
  const count = props.item.quantity > 1 ? ` — ${props.item.quantity} шт.` : '';
  if (await confirmAction(`Удалить «${props.item.name}»${count}? Вернуть не получится.`, { title: `Удалить «${props.item.name}»?`, confirmLabel: 'Удалить', danger: true })) emit('remove');
}
const target = computed(() => props.party.find(entry => entry.id === giveTo.value) ?? null);
</script>

<template>
  <aside class="inspector g-frame" :aria-label="`Предмет: ${item.name}`" @keydown.esc.prevent.stop="emit('close')">
    <header class="insp-head">
      <ItemArt :name="item.name" :srd-index="srdArtIndex(item.srd)" :size="64" :fallback-icon="CATEGORY_ICONS[item.category]" :rarity="item.magic?.rarity ?? null" placeholder />
      <div class="insp-title">
        <h4>{{ item.name }}<span v-if="item.quantity > 1 && !item.infinite" class="qty"> ×{{ item.quantity }}</span></h4>
        <small>{{ ITEM_CATEGORY_LABELS[item.category] }}<template v-if="item.magic"> · {{ RARITY[item.magic.rarity] ?? item.magic.rarity }}</template></small>
      </div>
      <button type="button" class="insp-close icon-only" aria-label="Закрыть карточку" @click="emit('close')"><GameIcon name="close" :size="14" /></button>
    </header>

    <div class="insp-body">
      <p v-if="item.slot || item.infinite || item.magic?.requiresAttunement" class="insp-status">
        <span v-if="item.slot"><GameIcon name="check" :size="12" /> Надето: {{ SLOT_LABELS[item.slot] }}<template v-if="item.hands === 2"> (обеими руками)</template></span>
        <span v-if="item.infinite" title="Задано мастером">∞ Бесконечный: не расходуется</span>
        <span v-if="item.magic?.requiresAttunement">{{ item.magic.attuned ? 'Настроен' : 'Требует настройки' }}</span>
      </p>
      <dl class="insp-facts">
        <div><dt>Вес</dt><dd>{{ weightLabel(item.weightLb) }}<template v-if="item.quantity > 1 && totalWeight !== null"> · всего {{ weightLabel(totalWeight) }}</template></dd></div>
        <div><dt>Цена</dt><dd>{{ priceLabel(item.priceCp) }}<template v-if="item.quantity > 1 && totalPrice !== null"> · всего {{ priceLabel(totalPrice) }}</template></dd></div>
        <div v-if="armorText"><dt>Защита</dt><dd>{{ armorText }}</dd></div>
        <div v-if="weaponText"><dt>Оружие</dt><dd><DamageTag v-if="item.weapon?.damageType" :type="item.weapon.damageType" icon-only /> {{ weaponText }}</dd></div>
        <div v-if="item.magic?.charges"><dt>Заряды</dt><dd>{{ item.magic.charges.current }} / {{ item.magic.charges.max }}</dd></div>
        <div v-if="item.slots.length && !item.slot"><dt>Надевают</dt><dd>{{ item.slots.map(slot => SLOT_LABELS[slot]).join(', ') }}</dd></div>
      </dl>
      <p v-if="item.note" class="insp-note">{{ item.note }}</p>
      <p v-if="!held && item.slots.length" class="muted insp-hint">Надеть можно то, что при себе: сначала достаньте предмет из сумки («Ещё» → «Переложить»).</p>
    </div>

    <footer v-if="editable" class="insp-actions">
      <div class="insp-primary">
        <button v-if="item.slot" type="button" class="primary" :disabled="working" @click="emit('equip', null)">Снять</button>
        <InvPopover v-else-if="item.slots.length && held" button-class="primary" :disabled="working" title="Надеть" up>
          <template #button>Надеть ▾</template>
          <template #default="{ close }">
            <b>Куда</b>
            <label v-if="item.versatile" class="pop-row">Хват
              <select v-model="grip"><option value="one">одной рукой</option><option value="two">двумя руками</option></select>
            </label>
            <button v-for="slot in item.slots" :key="slot" type="button" :disabled="working" @click="emit('equip', slot, item.versatile ? grip : undefined); close()">{{ SLOT_LABELS[slot] }}</button>
          </template>
        </InvPopover>
        <button v-if="item.magic?.useLabel" type="button" class="primary" :disabled="working" title="В бою — действием; предмет расходуется" @click="emit('drink')">{{ item.magic.useLabel }}</button>
        <button v-else-if="potion" type="button" class="primary" :disabled="working" title="Бросает 2к4+2 и лечит героя" @click="emit('drink')">Выпить: 2к4+2 хитов</button>
        <button v-else-if="consumable" type="button" :disabled="working || (!item.infinite && item.quantity < 1)" :title="item.infinite ? 'Не расходуется' : 'Количество уменьшится на 1; эффект примените сами'" @click="emit('use', 1)">Израсходовать 1</button>
        <button v-if="item.magic?.requiresAttunement" type="button" :disabled="working" @click="emit('attune', !item.magic.attuned)">{{ item.magic.attuned ? 'Прервать настройку' : 'Настроиться' }}</button>
      </div>
      <div class="insp-secondary">
        <InvPopover v-if="party.length" :disabled="working" title="Передать" up>
          <template #button>Передать ▾</template>
          <template #default="{ close }">
            <label class="pop-row">Кому
              <select v-model="giveTo"><option value="" disabled>— выберите —</option><option v-for="member in party" :key="member.id" :value="member.id">{{ member.name }}</option></select>
            </label>
            <label v-if="item.quantity > 1" class="pop-row">Сколько
              <input v-model.number="giveCount" type="number" min="1" :max="item.quantity" />
            </label>
            <button type="button" class="primary" :disabled="working || !target || !(giveCount >= 1)" @click="emit('give', giveTo, Math.min(item.quantity, giveCount), target!.name); close()">
              Передать{{ item.quantity > 1 ? ` ${Math.min(item.quantity, giveCount)} шт.` : '' }}{{ target ? ` → ${target.name}` : '' }}
            </button>
          </template>
        </InvPopover>
        <InvPopover :disabled="working" title="Ещё действия" align="right" up>
          <template #button>Ещё ▾</template>
          <template #default="{ close }">
            <button type="button" @click="emit('drop'); close()">Выложить на стол рядом с героем</button>
            <label v-if="containers.length || !held" class="pop-row">Переложить
              <select :value="''" @change="emit('move', ($event.target as HTMLSelectElement).value); close()">
                <option value="" disabled>— куда —</option>
                <option v-if="!held" :value="holderId">При себе</option>
                <option v-for="bag in containers.filter(entry => entry.id !== item.id && entry.id !== item.containerId)" :key="bag.id" :value="bag.id">В «{{ bag.name }}»</option>
              </select>
            </label>
            <div v-if="item.quantity > 1 && !item.magic" class="pop-line">
              <input v-model.number="splitCount" type="number" min="1" :max="item.quantity - 1" aria-label="Сколько отделить" />
              <button type="button" :disabled="!(splitCount >= 1 && splitCount < item.quantity)" @click="emit('split', splitCount); close()">Отделить {{ splitCount }} из {{ item.quantity }}</button>
            </div>
            <details class="pop-edit">
              <summary>Изменить свойства</summary>
              <label class="pop-row">Название<input v-model="form.name" maxlength="100" /></label>
              <label class="pop-row">Категория
                <select v-model="form.category"><option value="">определять по названию</option><option v-for="id in ITEM_CATEGORIES" :key="id" :value="id">{{ ITEM_CATEGORY_LABELS[id] }}</option></select>
              </label>
              <label class="pop-row">Надевают
                <select v-model="form.wear"><option value="">определять по названию</option><option v-for="id in WEAR_FAMILIES" :key="id" :value="id">{{ WEAR_LABELS[id] }}</option></select>
              </label>
              <div class="pop-line">
                <label class="pop-row">Вес, фнт.<input v-model.number="form.weight" type="number" min="0" step="0.05" /></label>
                <label class="pop-row">Цена, зм<input v-model.number="form.price" type="number" min="0" step="0.01" /></label>
              </div>
              <label class="pop-row">Заметка<textarea v-model="form.note" rows="2" maxlength="2000" /></label>
              <button type="button" class="primary" :disabled="working" @click="saveForm(close)">Сохранить</button>
            </details>
            <label v-if="manager" class="check-row"><input type="checkbox" :checked="item.infinite" @change="emit('patch', { infinite: ($event.target as HTMLInputElement).checked })" /> Бесконечный — не расходуется</label>
            <button type="button" class="danger" @click="close(); remove()">Удалить…</button>
          </template>
        </InvPopover>
      </div>
    </footer>
  </aside>
</template>

<style scoped>
.inspector{display:flex;flex-direction:column;min-height:0;max-height:100%;padding:12px}
.insp-head{display:flex;align-items:flex-start;gap:10px;flex:0 0 auto}
.insp-title{flex:1;min-width:0}
.insp-title h4{margin:0;font-size:16px;word-break:break-word}
.insp-title small{color:var(--g-text-dim,#ab9a7b)}
.qty{color:var(--g-gold-hi,#f6e2a0)}
.insp-close{min-height:28px;width:28px;padding:0;flex:none}
.insp-body{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:8px;margin:10px 0}
.insp-status{margin:0;display:flex;flex-direction:column;gap:2px;font-size:12px;color:var(--g-gold-hi,#f6e2a0)}
.insp-facts{margin:0;display:flex;flex-direction:column;gap:4px}
.insp-facts div{display:grid;grid-template-columns:76px 1fr;gap:8px;font-size:13px}
.insp-facts dt{color:var(--g-text-dim,#ab9a7b)}
.insp-facts dd{margin:0}
.insp-note,.insp-hint{margin:0;font-size:12px;line-height:1.4}
.insp-actions{display:flex;flex-direction:column;gap:6px;padding-top:8px;box-shadow:inset 0 1px 0 var(--g-line,#3b3125);flex:0 0 auto}
.insp-primary,.insp-secondary{display:flex;flex-wrap:wrap;gap:6px}
.insp-actions :deep(button){min-height:32px;padding:2px 12px;font-size:13px}
.pop-row{display:flex;flex-direction:column;gap:3px;margin:0;font-size:12px;font-weight:600}
.pop-row input,.pop-row select,.pop-row textarea{width:100%}
.pop-line{display:flex;gap:6px;align-items:flex-end}
.pop-line input{width:70px}
.pop-edit{display:flex;flex-direction:column;gap:6px;font-size:13px}
.pop-edit[open]{display:flex}
.check-row{display:flex;align-items:center;gap:6px;margin:0;font-size:13px}
.danger{color:#ffb4a6}
</style>
