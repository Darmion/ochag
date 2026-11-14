import { computed, reactive, ref, watch } from 'vue';
import type { Doll, EquipSlot, ItemCategory, WearFamily } from '../../../../packages/domain/character/inventory';
import { priceLabel } from './icons';

export type InventoryEntry = {
  id: string;
  name: string;
  containerId: string | null;
  quantity: number;
  weightLb: number | null;
  priceCp: number | null;
  category: ItemCategory;
  storedCategory: ItemCategory | null;
  srd: string | null;
  wear: WearFamily | null;
  slot: EquipSlot | null;
  grip: 'one' | 'two' | null;
  infinite: boolean;
  note: string | null;
  imageAssetId: string | null;
  depth: number;
  slots: EquipSlot[];
  hands: 1 | 2;
  stackable: boolean;
  container: boolean;
  versatile: boolean;
  armor: { kind: string; ac: number; dex: 'full' | 'max2' | 'none'; strength: number | null; stealth: boolean } | null;
  weapon: { damage: string | null; damageType: string | null; properties: string[]; range: [number, number] | null } | null;
  attackId: string | null;
  magic: { rarity: string; requiresAttunement: boolean; attuned: boolean; equipped: boolean; destroyed: boolean; useLabel?: string | null; charges: { current: number; max: number } | null } | null;
};

export type InventoryView = {
  holder: {
    id: string; name: string; kind: string; size: string; strength: number; armorClass: number; acMode: 'manual' | 'gear';
    imageAssetId: string | null; imageCrop: unknown; doll: Doll; wallet: Record<'cp' | 'sp' | 'ep' | 'gp' | 'pp', number>;
  };
  items: InventoryEntry[];
  weight: { pounds: number; unknown: number; capacity: number; level: 'light' | 'loaded' | 'heavy' | 'over'; penalty: number; thresholds: [number, number, number]; coinsLb: number };
  gearAc: { value: number; parts: string[] };
  rules: { encumbrance: boolean; encumbranceSpeed: boolean; ammoUse: boolean };
  editable: boolean;
  manager: boolean;
};

export type InventoryProps = {
  campaignId: string;
  characterId: string;
  revision: number;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
};

export function useInventory(props: InventoryProps, onChanged: () => void) {
  const view = ref<InventoryView | null>(null);
  const loadError = ref('');
  const error = ref('');
  const notice = ref('');
  const working = ref(false);
  const selectedId = ref('');
  const base = computed(() => `/campaigns/${props.campaignId}/characters`);
  let loads = 0;

  async function load() {
    const ticket = ++loads;
    try {
      const fresh = await props.request(`${base.value}/${props.characterId}/inventory`) as InventoryView;
      if (ticket !== loads) return;
      view.value = fresh;
      loadError.value = '';
      if (selectedId.value && !fresh.items.some(item => item.id === selectedId.value)) selectedId.value = '';
    } catch (cause) {
      if (ticket === loads) loadError.value = cause instanceof Error ? cause.message : String(cause);
    }
  }
  watch(() => [props.campaignId, props.characterId], () => {
    view.value = null;
    selectedId.value = '';
    notice.value = '';
    error.value = '';
  });
  watch(() => [props.campaignId, props.characterId, props.revision], load, { immediate: true });

  async function run(action: () => Promise<string | void>, sheetChanged = true) {
    if (working.value) return false;
    working.value = true;
    error.value = '';
    try {
      const message = await action();
      if (message) notice.value = message;
      await load();
      if (sheetChanged) onChanged();
      return true;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
      return false;
    } finally {
      working.value = false;
    }
  }

  const items = computed(() => view.value?.items ?? []);
  const selected = computed(() => items.value.find(item => item.id === selectedId.value) ?? null);
  const worn = computed(() => items.value.filter(item => item.slot && item.containerId === view.value?.holder.id));
  const containers = computed(() => items.value.filter(item => item.container));

  const item = (id: string) => items.value.find(entry => entry.id === id);

  return reactive({
    view, loadError, error, notice, working, selectedId, items, selected, worn, containers, load, item,
    equip: (id: string, slot: EquipSlot | null, grip?: 'one' | 'two') => run(async () => {
      const result = await props.request(`${base.value}/${id}/equip-slot`, 'POST', { slot, ...(grip ? { grip } : {}) });
      const name = item(id)?.name ?? 'Предмет';
      return slot ? `${name}: надето${result.armorClass !== null && result.armorClass !== undefined ? ` · КД ${result.armorClass}` : ''}` : `${name}: снято`;
    }),
    use: (id: string, count = 1) => run(async () => {
      const name = item(id)?.name ?? 'Предмет';
      const result = await props.request(`${base.value}/${id}/use`, 'POST', { count });
      return result.infinite ? `${name}: не расходуется` : result.gone ? `${name}: больше нет` : `${name}: осталось ${result.left}`;
    }),
    split: (id: string, count: number) => run(async () => {
      await props.request(`${base.value}/${id}/split`, 'POST', { count });
      return `Отделено: ${count}`;
    }, false),
    give: (id: string, toCharacterId: string, count: number, toName: string) => run(async () => {
      const result = await props.request(`${base.value}/${id}/give`, 'POST', { toCharacterId, count });
      return `${result.name} ×${result.amount} → ${toName}`;
    }),
    drop: (id: string) => run(async () => {
      await props.request(`${base.value}/${id}/container`, 'PUT', { containerId: null, nearHolder: true });
      return `${item(id)?.name ?? 'Предмет'}: лежит на столе рядом с героем`;
    }),
    move: (id: string, containerId: string) => run(async () => {
      await props.request(`${base.value}/${id}/container`, 'PUT', { containerId });
      return `${item(id)?.name ?? 'Предмет'}: переложено`;
    }, false),
    remove: (id: string) => run(async () => {
      const name = item(id)?.name ?? 'Предмет';
      await props.request(`${base.value}/${id}`, 'DELETE');
      if (selectedId.value === id) selectedId.value = '';
      return `«${name}» удалён`;
    }),
    patch: (id: string, body: Record<string, unknown>) => run(async () => {
      await props.request(`${base.value}/${id}/item`, 'PATCH', body);
      return 'Сохранено';
    }),
    add: (body: Record<string, unknown>) => run(async () => {
      const result = await props.request(`${base.value}/${props.characterId}/inventory`, 'POST', body);
      selectedId.value = result.itemId;
      const price = result.paid ? priceLabel(result.paid) : '';
      if (result.merged) {
        return price
          ? `${result.name}: добавлено ${result.added} шт., теперь ${result.total} шт. Списано ${price}.`
          : `${result.name}: добавлено ${result.added} шт., теперь ${result.total} шт.`;
      }
      if (result.added > 1) return price ? `${result.name} ×${result.added} — в сумке, не надето. Списано ${price}.` : `${result.name} ×${result.added} — в сумке, не надето.`;
      return price ? `${result.name} — в сумке, не надето. Списано ${price}.` : `${result.name} — в сумке, не надето.`;
    }),
    saveDoll: (doll: Doll) => run(async () => {
      await props.request(`${base.value}/${props.characterId}/doll`, 'PUT', { doll });
      return 'Расположение сохранено';
    }, false),
    setAcMode: (mode: 'manual' | 'gear') => run(async () => {
      const result = await props.request(`${base.value}/${props.characterId}/ac-mode`, 'PUT', { mode });
      return mode === 'gear' ? `КД по снаряжению: ${result.armorClass}` : 'КД — вручную';
    }),
  });
}

export type Inventory = ReturnType<typeof useInventory>;
