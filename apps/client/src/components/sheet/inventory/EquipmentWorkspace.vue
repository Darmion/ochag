<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { ENCUMBRANCE_LABELS, type EquipSlot } from '../../../../../../packages/domain/character/inventory';
import { useInventory, type InventoryEntry } from '../../../inventory/useInventory';
import { weightLabel } from '../../../inventory/icons';
import EquipmentDoll from './EquipmentDoll.vue';
import InventoryBrowser from './InventoryBrowser.vue';
import ItemInspector from './ItemInspector.vue';
import AddItemDialog from './AddItemDialog.vue';
import WalletPopover from './WalletPopover.vue';
import InvPopover from './InvPopover.vue';
import GameIcon from '../../game/GameIcon.vue';

const props = defineProps<{
  campaignId: string;
  characterId: string;
  revision: number;
  readOnly: boolean;
  portraitUrl: string | null;
  portraitCropped: boolean;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();
const emit = defineEmits<{ changed: [] }>();

const inv = useInventory(props, () => emit('changed'));
const adding = ref(false);
const dragging = ref<InventoryEntry | null>(null);
const party = ref<Array<{ id: string; name: string }>>([]);
onMounted(async () => {
  try {
    const roster = await props.request(`/campaigns/${props.campaignId}/characters`);
    party.value = (roster.characters ?? []).filter((entry: any) => entry.kind !== 'object' && entry.id !== props.characterId).map((entry: any) => ({ id: entry.id, name: entry.name }));
  } catch {
    party.value = [];
  }
});

const editable = computed(() => !props.readOnly && Boolean(inv.view?.editable));
const weight = computed(() => inv.view?.weight ?? null);
const barPercent = computed(() => (weight.value ? Math.min(100, (weight.value.pounds / Math.max(1, weight.value.thresholds[2])) * 100) : 0));
const ticks = computed(() => (weight.value ? weight.value.thresholds.map(value => (value / weight.value!.thresholds[2]) * 100) : []));

function equip(id: string, slot: EquipSlot | null, grip?: 'one' | 'two') {
  void inv.equip(id, slot, grip);
}
const drinking = ref(false);
async function drink(item: InventoryEntry) {
  const holder = inv.view?.holder;
  if (!holder || drinking.value || inv.working) return;
  drinking.value = true;
  try {
    if (item.magic?.useLabel) {
      const used = await props.request(`/campaigns/${props.campaignId}/characters/${item.id}/use-magic`, 'POST', {});
      inv.notice = used.summary;
      emit('changed');
      return;
    }
    if (!(await inv.use(item.id))) return;
    const roll = await props.request(`/campaigns/${props.campaignId}/rolls`, 'POST', { formula: '2d4+2', label: `${item.name} → ${holder.name}`.slice(0, 100) });
    await props.request(`/campaigns/${props.campaignId}/rolls/${roll.id}/apply`, 'POST', { characterId: holder.id, mode: 'heal' });
    inv.notice = `${holder.name} пьёт «${item.name}»: +${roll.total} хитов`;
    emit('changed');
  } catch (cause) {
    inv.error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    drinking.value = false;
  }
}
watch(() => inv.selectedId, async id => {
  if (!id) return;
  await nextTick();
  document.querySelector('.ws-inspector')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
});
async function attune(item: InventoryEntry, on: boolean) {
  inv.error = '';
  try {
    await props.request(`/campaigns/${props.campaignId}/characters/${item.id}/attune`, 'POST', { attuned: on });
    await inv.load();
    emit('changed');
  } catch (cause) {
    inv.error = cause instanceof Error ? cause.message : String(cause);
  }
}
async function walletChanged(message: string) {
  inv.notice = message;
  await inv.load();
  emit('changed');
}
</script>

<template>
  <section class="workspace" aria-label="Снаряжение героя">
    <div class="ws-toolbar">
      <button v-if="editable" type="button" class="primary" :disabled="inv.working" @click="inv.notice = ''; inv.error = ''; adding = true"><GameIcon name="plus" :size="14" /> Добавить предмет</button>
      <InvPopover v-if="inv.view && inv.view.holder.kind !== 'object'" title="Как считать защиту?" :disabled="!editable">
        <template #button><GameIcon name="shield" :size="14" /> КД {{ inv.view.holder.armorClass }} · {{ inv.view.holder.acMode === 'gear' ? 'по снаряжению' : 'вручную' }} ▾</template>
        <template #default="{ close }">
          <b>Расчёт КД</b>
          <p class="pop-text">Сейчас: <strong>КД {{ inv.view.holder.armorClass }}</strong>. По снаряжению: <strong>КД {{ inv.view.gearAc.value }}</strong> — {{ inv.view.gearAc.parts.join(', ') }}.</p>
          <p class="pop-text muted">По снаряжению КД меняется сам, когда вы надеваете доспех и щит, растёт Ловкость или действует магия. Вручную — число из листа: смена доспеха и щита его не меняет.</p>
          <button type="button" :class="{ primary: inv.view.holder.acMode !== 'gear' }" :disabled="inv.working || inv.view.holder.acMode === 'gear'" @click="inv.setAcMode('gear'); close()">Считать по снаряжению</button>
          <button type="button" :disabled="inv.working || inv.view.holder.acMode === 'manual'" @click="inv.setAcMode('manual'); close()">Перейти к ручному КД</button>
        </template>
      </InvPopover>
      <span v-if="inv.notice" class="ws-notice" role="status">{{ inv.notice }}</span>
    </div>

    <p v-if="inv.error" class="error" role="alert">{{ inv.error }}</p>

    <div v-if="inv.view" class="ws-main">
      <EquipmentDoll
        class="ws-doll" :holder="inv.view.holder" :items="inv.items" :portrait-url="portraitUrl" :portrait-cropped="portraitCropped"
        :editable="editable" :working="inv.working" :dragging="dragging"
        @equip="(id, slot) => equip(id, slot)" @unequip="id => equip(id, null)" @select="id => (inv.selectedId = id)" @save="doll => inv.saveDoll(doll)"
      />
      <div class="ws-bag">
        <InventoryBrowser
          :items="inv.items" :holder-id="inv.view.holder.id" :selected-id="inv.selectedId" :editable="editable" :load-error="inv.loadError"
          @select="id => (inv.selectedId = inv.selectedId === id ? '' : id)" @drag="item => (dragging = item)" @reload="inv.load()"
        />
        <ItemInspector
          v-if="inv.selected" class="ws-inspector" :item="inv.selected" :holder-id="inv.view.holder.id" :party="party" :containers="inv.containers"
          :working="inv.working" :editable="editable" :manager="inv.view.manager"
          @close="inv.selectedId = ''" @equip="(slot, grip) => equip(inv.selected!.id, slot, grip)" @use="count => inv.use(inv.selected!.id, count)"
          @drink="drink(inv.selected!)" @split="count => inv.split(inv.selected!.id, count)"
          @give="(toId, count, name) => inv.give(inv.selected!.id, toId, count, name)" @drop="inv.drop(inv.selected!.id)"
          @move="containerId => inv.move(inv.selected!.id, containerId)" @patch="body => inv.patch(inv.selected!.id, body)"
          @remove="inv.remove(inv.selected!.id)" @attune="on => attune(inv.selected!, on)"
        />
      </div>
    </div>
    <p v-else-if="inv.loadError" class="error" role="alert">Не удалось загрузить снаряжение: {{ inv.loadError }} <button type="button" @click="inv.load()">Повторить</button></p>
    <p v-else class="muted">Загружаю снаряжение…</p>

    <div v-if="inv.view && weight" class="ws-strip">
      <div class="ws-weight" :title="`Монеты: ${weightLabel(weight.coinsLb)}`">
        <span><b>{{ weightLabel(weight.pounds) }}</b><template v-if="inv.view.rules.encumbrance"> / {{ weight.capacity }}</template><template v-if="weight.unknown"> · вес {{ weight.unknown }} шт. не указан</template></span>
        <template v-if="inv.view.rules.encumbrance">
          <span class="weight-bar" :class="`level-${weight.level}`" role="meter" :aria-valuenow="weight.pounds" :aria-valuemax="weight.capacity" aria-label="Нагрузка">
            <span class="weight-fill" :style="{ width: `${barPercent}%` }" />
            <span v-for="(tick, index) in ticks" :key="index" class="weight-tick" :style="{ left: `${tick}%` }" />
          </span>
          <span class="weight-state" :class="`level-${weight.level}`">
            {{ ENCUMBRANCE_LABELS[weight.level] }}<template v-if="inv.view.rules.encumbranceSpeed && weight.level !== 'light'"> · {{ weight.level === 'over' ? 'скорость не больше 5 фт.' : `скорость −${weight.penalty} фт.` }}</template>
          </span>
        </template>
      </div>
      <WalletPopover
        :wallet="inv.view.holder.wallet" :revision="revision" :campaign-id="campaignId" :character-id="characterId" :editable="editable"
        :party="party" :request="request" @changed="walletChanged"
      />
    </div>

    <AddItemDialog
      v-if="adding && inv.view" :wallet="inv.view.holder.wallet" :manager="inv.view.manager" :working="inv.working" :notice="inv.notice" :error="inv.error"
      @add="body => inv.add(body)" @clear="inv.notice = ''; inv.error = ''" @close="adding = false; inv.notice = ''"
    />
  </section>
</template>

<style scoped>
.workspace{display:flex;flex-direction:column;gap:10px;min-width:0}
.ws-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.ws-toolbar :deep(button){display:inline-flex;align-items:center;gap:6px;min-height:34px;padding:2px 12px;font-size:13px}
.ws-notice{font-size:12px;color:var(--g-good,#5ea764)}
.pop-text{margin:0;font-size:13px;line-height:1.45}
.ws-main{display:grid;grid-template-columns:minmax(200px,280px) 1fr;gap:12px;align-items:start}
.ws-bag{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;align-items:start;min-width:0}
.ws-bag:has(> .ws-inspector){grid-template-columns:minmax(0,1fr) 300px}
.ws-inspector{position:sticky;top:12px;height:440px;max-height:calc(100dvh - 48px);box-sizing:border-box;z-index:1}
.ws-strip{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 16px;padding:8px 10px;border-radius:8px;background:#0003;box-shadow:inset 0 0 0 1px var(--g-line,#3b3125)}
.ws-weight{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;font-size:13px}
.weight-bar{position:relative;display:block;width:200px;height:6px;border-radius:3px;background:#0006;overflow:visible}
.weight-fill{position:absolute;left:0;top:0;bottom:0;border-radius:3px;background:var(--g-good,#5ea764)}
.weight-bar.level-loaded .weight-fill{background:var(--g-warn,#e0aa3e)}
.weight-bar.level-heavy .weight-fill,.weight-bar.level-over .weight-fill{background:var(--g-bad,#cf4a3d)}
.weight-tick{position:absolute;top:-2px;bottom:-2px;width:1px;background:var(--g-text-dim,#ab9a7b)}
.weight-state.level-loaded{color:var(--g-warn,#e0aa3e)}
.weight-state.level-heavy,.weight-state.level-over{color:var(--g-bad,#cf4a3d)}
.ws-strip :deep(.inv-pop > button){display:inline-flex;align-items:center;min-height:32px;padding:2px 12px;font-size:13px}
@media (min-width:861px) and (max-width:1100px){.ws-main{grid-template-columns:220px minmax(0,1fr)}}
@media (max-width:860px){.ws-main{grid-template-columns:1fr}.ws-doll{max-width:280px}.ws-bag:has(> .ws-inspector){grid-template-columns:minmax(0,1fr)}}
</style>
