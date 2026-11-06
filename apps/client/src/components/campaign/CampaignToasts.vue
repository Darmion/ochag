<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import TableToasts from '../tabletop/TableToasts.vue';
import { onCampaignEvent } from '../../campaign/campaignEvents';
import { naturalMark, type TableToast } from '../../tabletop/toasts';
import { describeGroups } from '../../rules/dice';
import { alertMyTurn } from '../../campaign/turnAlert';

const props = defineProps<{
  campaignId: string;
  currentUserId: string;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();

const toasts = ref<TableToast[]>([]);
const seenRolls = new Set<string>();
let primed = false;
let lastTurnEntry = '';
let sequence = 0;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function push(toast: Omit<TableToast, 'id'>, ms = 7000) {
  const id = ++sequence;
  toasts.value = [...toasts.value, { ...toast, id }].slice(-4);
  timers.set(id, setTimeout(() => dismiss(id), ms));
}

function dismiss(id: number) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  toasts.value = toasts.value.filter(toast => toast.id !== id);
}

async function checkRolls() {
  try {
    const rolls = (await props.request(`/campaigns/${props.campaignId}/rolls`)).rolls as any[];
    const fresh = primed ? rolls.filter(roll => !seenRolls.has(roll.id)) : [];
    for (const roll of rolls) seenRolls.add(roll.id);
    primed = true;
    for (const roll of fresh.reverse()) {
      if (roll.user_id === props.currentUserId) continue;
      const mark = naturalMark(roll);
      push({
        tone: mark ? mark.kind : 'roll',
        title: roll.user_display_name ?? 'Бросок',
        value: mark ? mark.text : String(roll.total),
        detail: [
          roll.label, `${roll.formula}: ${roll.breakdown?.length ? describeGroups(roll.breakdown) : roll.dice_results.join(', ')}`,
          mark?.total != null ? `итог с модификаторами ${mark.total}` : '',
        ].filter(Boolean).join(' · '),
      });
    }
  } catch {
  }
}

async function checkTurn(sceneId: string | null) {
  if (!sceneId) return;
  try {
    const [initiative, roster] = await Promise.all([
      props.request(`/campaigns/${props.campaignId}/scenes/${sceneId}/initiative`),
      props.request(`/campaigns/${props.campaignId}/characters`),
    ]);
    const current = (initiative.entries as any[]).find(entry => entry.is_current);
    if (!current || current.id === lastTurnEntry) return;
    lastTurnEntry = current.id;
    const mine = (roster.characters as any[]).some(character => character.id === current.character_id && character.owner_user_id === props.currentUserId);
    if (mine) {
      push({ tone: 'mine', title: 'Ваш ход!', value: current.name, detail: 'Откройте «Стол».' }, 12000);
      alertMyTurn(current.name);
    }
  } catch {
  }
}

void checkRolls();
const stops = [
  onCampaignEvent('rolls', () => void checkRolls()),
  onCampaignEvent('initiative', sceneId => void checkTurn(sceneId)),
];

onBeforeUnmount(() => {
  stops.forEach(stop => stop());
  for (const timer of timers.values()) clearTimeout(timer);
});
</script>

<template>
  <div class="campaign-toasts">
    <TableToasts :toasts="toasts" @dismiss="dismiss" @focus="() => {}" />
  </div>
</template>

<style scoped>
.campaign-toasts{position:fixed;left:0;bottom:0;width:min(420px,100vw);height:70vh;pointer-events:none;z-index:1500}
</style>
