<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  INVENTORY_CATALOG, ITEM_CATEGORIES, ITEM_CATEGORY_LABELS, SLOT_LABELS, WEAR_FAMILIES, itemSlots, type CatalogEntry, type ItemCategory, type WearFamily,
} from '../../../../../../packages/domain/character/inventory';
import { useEscapeClose } from '../../../ui/escapeStack';
import { CATEGORY_ICONS, priceLabel, srdArtIndex, weightLabel } from '../../../inventory/icons';
import ItemArt from '../../rpg/ItemArt.vue';
import GameIcon from '../../game/GameIcon.vue';

const props = defineProps<{ wallet: Record<'cp' | 'sp' | 'ep' | 'gp' | 'pp', number>; manager: boolean; working: boolean; notice: string; error: string }>();
const emit = defineEmits<{ add: [body: Record<string, unknown>]; close: []; clear: [] }>();
useEscapeClose(() => emit('close'));
const opener = document.activeElement as HTMLElement | null;
onMounted(() => (document.querySelector('.add-search input') as HTMLElement | null)?.focus());
onBeforeUnmount(() => opener?.focus?.());

const WEAR_LABELS: Record<WearFamily, string> = {
  head: 'Голова', neck: 'Шея', cloak: 'Плечи', body: 'Тело', hand: 'В руку', hands: 'Кисти', ring: 'Кольцо', belt: 'Пояс', feet: 'Ноги', ammo: 'Колчан',
};
const tab = ref<'reference' | 'own'>('reference');
const query = ref('');
const category = ref<ItemCategory | ''>('');
const pickedRef = ref('');
const packs = ref(1);

const wealth = computed(() => props.wallet.cp + props.wallet.sp * 10 + props.wallet.ep * 50 + props.wallet.gp * 100 + props.wallet.pp * 1000);
const results = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase('ru-RU');
  return INVENTORY_CATALOG.filter(entry => (!category.value || entry.category === category.value)
    && (!needle || `${entry.nameRu} ${entry.name}`.toLocaleLowerCase('ru-RU').includes(needle)))
    .sort((a, b) => a.nameRu.localeCompare(b.nameRu, 'ru'));
});
const picked = computed<CatalogEntry | null>(() => INVENTORY_CATALOG.find(entry => entry.ref === pickedRef.value) ?? null);
watch(results, list => { if (!list.some(entry => entry.ref === pickedRef.value)) pickedRef.value = list[0]?.ref ?? ''; }, { immediate: true });
watch(pickedRef, () => { packs.value = 1; emit('clear'); });
watch(tab, () => emit('clear'));

const units = computed(() => (picked.value ? picked.value.pack * Math.max(1, packs.value || 1) : 0));
const total = computed(() => (picked.value?.priceCp == null ? null : picked.value.priceCp * Math.max(1, packs.value || 1)));
const weight = computed(() => (picked.value?.weightLb == null ? null : picked.value.weightLb * Math.max(1, packs.value || 1)));
const shortBy = computed(() => (total.value === null ? 0 : Math.max(0, total.value - wealth.value)));
const slots = computed(() => (picked.value ? itemSlots({ name: picked.value.nameRu, srd: picked.value.ref, category: picked.value.category, wear: null }) : []));
const armorLine = computed(() => {
  const armor = picked.value?.armor;
  if (!armor) return '';
  if (armor.kind === 'shield') return `КД +${armor.ac}`;
  return `КД ${armor.ac}${armor.dex === 'full' ? ' + Лов' : armor.dex === 'max2' ? ' + Лов (не больше 2)' : ''}${armor.strength ? ` · Сила ${armor.strength}` : ''}${armor.stealth ? ' · помеха Скрытности' : ''}`;
});
const weaponLine = computed(() => {
  const weapon = picked.value?.weapon;
  return weapon?.damage ? `${weapon.damage}${weapon.range ? ` · ${weapon.range[0]}/${weapon.range[1]} фт.` : ''}` : '';
});

function addReference(buy: boolean) {
  if (!picked.value) return;
  emit('add', { ref: picked.value.ref, quantity: Math.max(1, Math.min(10000, Math.round(packs.value || 1))), buy });
}

const own = ref({ name: '', category: 'gear' as ItemCategory, quantity: 1, weight: '' as number | '', price: '' as number | '', wear: '' as WearFamily | '', note: '', infinite: false });
const ownPrice = computed(() => (own.value.price === '' ? null : Math.round(Number(own.value.price) * 100)));
const ownTotal = computed(() => (ownPrice.value === null ? null : ownPrice.value * Math.max(1, own.value.quantity || 1)));
function addOwn(buy: boolean) {
  const value = own.value;
  if (!value.name.trim()) return;
  emit('add', {
    quantity: Math.max(1, Math.min(10000, Math.round(value.quantity || 1))), buy,
    custom: {
      name: value.name.trim(), category: value.category, weightLb: value.weight === '' ? null : Number(value.weight), priceCp: ownPrice.value,
      wear: value.wear || null, note: value.note.trim() || null, ...(props.manager && value.infinite ? { infinite: true } : {}),
    },
  });
}
</script>

<template>
  <div class="modal-overlay" role="dialog" aria-modal="true" aria-label="Добавить предмет">
    <section class="modal-card add-item">
      <header class="add-head">
        <h3>Добавить предмет</h3>
        <div class="add-tabs" role="tablist">
          <button type="button" role="tab" :aria-selected="tab === 'reference'" @click="tab = 'reference'">Справочник</button>
          <button type="button" role="tab" :aria-selected="tab === 'own'" @click="tab = 'own'">Свой предмет</button>
        </div>
        <button type="button" class="add-close icon-only" aria-label="Закрыть" @click="emit('close')"><GameIcon name="close" :size="16" /></button>
      </header>

      <div v-if="tab === 'reference'" class="add-body">
        <div class="add-search">
          <input v-model="query" type="search" placeholder="Название предмета…" aria-label="Поиск по справочнику" />
          <select v-model="category" aria-label="Категория">
            <option value="">Все категории</option>
            <option v-for="id in ITEM_CATEGORIES.filter(id => INVENTORY_CATALOG.some(entry => entry.category === id))" :key="id" :value="id">{{ ITEM_CATEGORY_LABELS[id] }}</option>
          </select>
        </div>
        <div class="add-columns">
          <ul class="add-results" aria-label="Предметы справочника">
            <li v-for="entry in results" :key="entry.ref">
              <button type="button" :aria-pressed="pickedRef === entry.ref" @click="pickedRef = entry.ref">
                <ItemArt :name="entry.nameRu" :srd-index="srdArtIndex(entry.ref)" :size="40" :fallback-icon="CATEGORY_ICONS[entry.category]" />
                <span class="result-copy">
                  <strong>{{ entry.nameRu }}</strong>
                  <small>{{ ITEM_CATEGORY_LABELS[entry.category] }} · {{ entry.pack > 1 ? `${entry.pack} шт. · ` : '' }}{{ priceLabel(entry.priceCp) }} · {{ weightLabel(entry.weightLb) }}</small>
                </span>
              </button>
            </li>
            <li v-if="!results.length" class="muted">Ничего не нашлось — попробуйте другое слово или «Свой предмет».</li>
          </ul>
          <aside v-if="picked" class="add-preview">
            <ItemArt :name="picked.nameRu" :srd-index="srdArtIndex(picked.ref)" :size="72" :fallback-icon="CATEGORY_ICONS[picked.category]" placeholder />
            <h4>{{ picked.nameRu }}</h4>
            <small class="muted">{{ ITEM_CATEGORY_LABELS[picked.category] }}<template v-if="picked.pack > 1"> · упаковка {{ picked.pack }} шт.</template></small>
            <p v-if="armorLine" class="preview-line">{{ armorLine }}</p>
            <p v-if="weaponLine" class="preview-line">{{ weaponLine }}</p>
            <p v-if="slots.length" class="preview-line">Надевают: {{ slots.map(slot => SLOT_LABELS[slot]).join(', ') }}</p>
            <p v-if="picked.desc" class="preview-desc">{{ picked.desc }}</p>
          </aside>
        </div>
      </div>

      <div v-else class="add-body own-body">
        <label class="own-row wide">Название<input v-model="own.name" maxlength="100" placeholder="Например, Кинжал деда" /></label>
        <label class="own-row">Категория
          <select v-model="own.category"><option v-for="id in ITEM_CATEGORIES" :key="id" :value="id">{{ ITEM_CATEGORY_LABELS[id] }}</option></select>
        </label>
        <label class="own-row">Количество<input v-model.number="own.quantity" type="number" min="1" max="10000" /></label>
        <label class="own-row">Вес за штуку, фнт.<input v-model.number="own.weight" type="number" min="0" step="0.05" placeholder="не указан" /></label>
        <label class="own-row">Цена за штуку, зм<input v-model.number="own.price" type="number" min="0" step="0.01" placeholder="без цены" /></label>
        <details class="own-more wide">
          <summary>Куда надевают, заметка{{ manager ? ', бесконечный' : '' }}</summary>
          <label class="own-row">Можно надеть
            <select v-model="own.wear"><option value="">определять по названию</option><option v-for="id in WEAR_FAMILIES" :key="id" :value="id">{{ WEAR_LABELS[id] }}</option></select>
          </label>
          <label class="own-row">Заметка<textarea v-model="own.note" rows="2" maxlength="2000" /></label>
          <label v-if="manager" class="check-row"><input v-model="own.infinite" type="checkbox" /> Бесконечный — не расходуется</label>
        </details>
      </div>

      <footer class="add-foot">
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <p v-else-if="notice" class="add-notice" role="status">{{ notice }}</p>
        <template v-if="tab === 'reference' && picked">
          <div class="foot-sum">
            <label class="qty">{{ picked.pack > 1 ? 'Упаковок' : 'Количество' }}
              <span class="stepper">
                <button type="button" aria-label="Меньше" :disabled="packs <= 1" @click="packs = Math.max(1, packs - 1)">−</button>
                <input v-model.number="packs" type="number" min="1" max="10000" aria-label="Сколько" />
                <button type="button" aria-label="Больше" @click="packs = Math.min(10000, packs + 1)">+</button>
              </span>
            </label>
            <span>Итого: <b>{{ units }} шт.</b> · <b>{{ priceLabel(total) }}</b> · {{ weightLabel(weight) }}</span>
            <small class="muted">В кошельке {{ priceLabel(wealth) }}<template v-if="total !== null && !shortBy"> → останется {{ priceLabel(wealth - total) }}</template><template v-else-if="shortBy"> · не хватает {{ priceLabel(shortBy) }}</template></small>
          </div>
          <div class="foot-buttons">
            <button type="button" :disabled="working" @click="addReference(false)">Взять бесплатно</button>
            <button type="button" class="primary" :disabled="working || total === null || shortBy > 0" @click="addReference(true)">Купить за {{ priceLabel(total) }}</button>
          </div>
        </template>
        <template v-else-if="tab === 'own'">
          <div class="foot-sum"><small class="muted">В кошельке {{ priceLabel(wealth) }}</small></div>
          <div class="foot-buttons">
            <button type="button" :disabled="working || !own.name.trim()" @click="addOwn(false)">Добавить бесплатно</button>
            <button v-if="ownTotal !== null" type="button" class="primary" :disabled="working || !own.name.trim() || ownTotal > wealth" @click="addOwn(true)">Купить за {{ priceLabel(ownTotal) }}</button>
          </div>
        </template>
        <button type="button" class="done" @click="emit('close')">Готово</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.modal-overlay{position:fixed;inset:0;z-index:3600;display:flex;align-items:center;justify-content:center;padding:18px;background:#0b0704cc}
.add-item{width:min(880px,calc(100vw - 32px));height:min(620px,calc(100vh - 32px));display:flex;flex-direction:column;gap:10px;padding:16px 18px}
.add-head{display:flex;align-items:center;gap:14px}
.add-head h3{margin:0}
.add-tabs{display:flex;gap:4px;margin-right:auto}
.add-tabs button{min-height:30px;padding:2px 14px;font-size:13px;border-radius:15px}
.add-tabs button[aria-selected="true"]{color:var(--g-gold-hi,#f6e2a0);box-shadow:inset 0 0 0 1px var(--g-gold-hi,#f6e2a0)}
.add-close{min-height:32px;width:32px;padding:0}
.add-body{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px}
.add-search{display:grid;grid-template-columns:1fr 200px;gap:8px}
.add-search input,.add-search select{min-height:36px}
.add-columns{flex:1;min-height:0;display:grid;grid-template-columns:1fr 280px;gap:12px}
.add-results{list-style:none;margin:0;padding:2px;overflow-y:auto;display:flex;flex-direction:column;gap:4px}
.add-results button{display:flex;align-items:center;gap:10px;width:100%;min-height:56px;padding:6px 10px;text-align:left;justify-content:flex-start}
.add-results button[aria-pressed="true"]{box-shadow:inset 0 0 0 2px var(--g-gold-hi,#f6e2a0)}
.result-copy{display:flex;flex-direction:column;min-width:0}
.result-copy small{color:var(--g-text-dim,#ab9a7b)}
.add-preview{display:flex;flex-direction:column;align-items:flex-start;gap:6px;padding:12px;border-radius:8px;background:#0003;overflow-y:auto}
.add-preview h4{margin:0}
.preview-line,.preview-desc{margin:0;font-size:13px;line-height:1.45}
.own-body{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;align-content:start;overflow-y:auto}
.add-head,.add-foot{flex:0 0 auto}
.own-row{display:flex;flex-direction:column;gap:4px;margin:0;font-size:13px;font-weight:600}
.own-row input,.own-row select,.own-row textarea{width:100%}
.wide{grid-column:1 / -1}
.own-more{display:flex;flex-direction:column;gap:8px}
.check-row{display:flex;align-items:center;gap:6px;margin:0;font-size:13px}
.add-foot{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;padding-top:10px;box-shadow:inset 0 1px 0 var(--g-line,#3b3125)}
.add-foot .error,.add-notice{flex-basis:100%;margin:0}
.add-notice{color:var(--g-good,#5ea764)}
.foot-sum{display:flex;flex-direction:column;gap:2px;margin-right:auto;font-size:13px}
.qty{display:flex;align-items:center;gap:8px;margin:0;font-size:13px;font-weight:600}
.stepper{display:inline-flex;gap:4px}
.stepper button{min-height:30px;width:30px;padding:0}
.stepper input{width:64px;min-height:30px;text-align:center}
.foot-buttons{display:flex;gap:8px}
.foot-buttons button,.done{min-height:36px;padding:4px 14px}
@media (max-width:760px){.add-columns{grid-template-columns:1fr}.add-preview{display:none}}
</style>
