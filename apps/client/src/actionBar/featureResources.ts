import { ref, computed, type Ref } from 'vue';
import type { FeatureView, ActionBarProps, FeatureCall, ActionBarEmit, SlotPicks, SlotRecovery } from './types';

export type FeatureResourcesDeps = {
  props: ActionBarProps;
  emit: ActionBarEmit;
  perform: (action: () => Promise<unknown>, keepOpen?: boolean) => Promise<void>;
  maneuverOffer: Ref<{ characterId: string; rollId: string; targetName: string; dice: number; die: number; maneuvers: { id: string; name: string; }[]; } | null>;
  slotPicks: Ref<SlotPicks>;
  useFeature: (id: FeatureCall, extra?: Record<string, unknown>) => Promise<void> | undefined;
};

export function useFeatureResources({ props, emit, perform, maneuverOffer, slotPicks, useFeature }: FeatureResourcesDeps) {
  const preservePick = ref<Record<string, number>>({});
  const preserveSum = computed(() => Object.values(preservePick.value).reduce((sum, value) => sum + (Number(value) || 0), 0));
  function preserveSpread(feature: FeatureView) {
    let left = feature.limit ?? 0;
    const next: Record<string, number> = {};
    const wants = [...(feature.choices ?? [])].sort((a, b) => (a.count ?? 0) - (b.count ?? 0));
    wants.forEach((choice, index) => {
      const share = Math.floor(left / (wants.length - index));
      const give = Math.min(choice.count ?? 0, share);
      next[choice.value] = give;
      left -= give;
    });
    preservePick.value = next;
  }
  function preserveLife() {
    const heals = Object.entries(preservePick.value).filter(([, amount]) => Number(amount) > 0).map(([targetId, amount]) => ({ targetId, amount: Number(amount) }));
    const done = useFeature('preserve-life', { heals });
    preservePick.value = {};
    return done;
  }

  function useManeuver(id: string) {
    const offer = maneuverOffer.value;
    if (!offer) return;
    return perform(async () => {
      const result = await props.request(`/campaigns/${props.campaignId}/rolls/${offer.rollId}/maneuver`, 'POST', { maneuver: id });
      maneuverOffer.value = null;
      emit('acted', `${result.name} по «${offer.targetName}»: +${result.value} урона — ${result.effect}${result.save ? ` (спасбросок ${result.save.total})` : ''}.`);
    });
  }

  const slotSum = (id: SlotRecovery) => Object.entries(slotPicks.value[id]).reduce((sum, [level, count]) => sum + Number(level) * count, 0);
  function recoverSlots(id: SlotRecovery) {
    const slots = Object.entries(slotPicks.value[id]).flatMap(([level, count]) => Array.from({ length: count }, () => Number(level)));
    return useFeature(id, { slots });
  }

  return { preservePick, preserveSum, preserveSpread, preserveLife, useManeuver, slotSum, recoverSlots };
}
