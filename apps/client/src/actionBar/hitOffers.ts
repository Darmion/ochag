import type { Ref } from 'vue';
import type { ActionBarProps, ActionBarEmit } from './types';

export type HitOffersDeps = {
  props: ActionBarProps;
  emit: ActionBarEmit;
  perform: (action: () => Promise<unknown>, keepOpen?: boolean) => Promise<void>;
  stunOffer: Ref<{ characterId: string; rollId: string; targetName: string; ki: number; dc: number; } | null>;
  quiveringOffer: Ref<{ characterId: string; rollId: string; targetName: string; ki: number; cost: number; } | null>;
  loadFeatures: () => Promise<void>;
  hurlOffer: Ref<{ characterId: string; rollId: string; targetName: string; left: number; } | null>;
  smiteOffer: Ref<{ characterId: string; rollId: string; targetName: string; slots: { level: number; current: number; }[]; } | null>;
};

export function useHitOffers({ props, emit, perform, stunOffer, quiveringOffer, loadFeatures, hurlOffer, smiteOffer }: HitOffersDeps) {
  function stunningStrike() {
    const offer = stunOffer.value;
    if (!offer) return;
    return perform(async () => {
      const result = await props.request(`/campaigns/${props.campaignId}/rolls/${offer.rollId}/stunning-strike`, 'POST');
      stunOffer.value = null;
      emit('acted', `Ошеломляющий удар по «${offer.targetName}»: спасбросок ТЕЛ ${result.total} против СЛ ${result.dc} — ${result.stunned ? 'ошеломлён до конца вашего следующего хода' : 'устоял'}.`);
    });
  }

  function quiveringPalm() {
    const offer = quiveringOffer.value;
    if (!offer) return;
    return perform(async () => {
      const result = await props.request(`/campaigns/${props.campaignId}/rolls/${offer.rollId}/quivering-palm`, 'POST');
      quiveringOffer.value = null;
      emit('acted', result.message);
      await loadFeatures();
    });
  }
  function hurlThroughHell() {
    const offer = hurlOffer.value;
    if (!offer) return;
    return perform(async () => {
      const result = await props.request(`/campaigns/${props.campaignId}/rolls/${offer.rollId}/hurl-through-hell`, 'POST');
      hurlOffer.value = null;
      emit('acted', result.message);
      await loadFeatures();
    });
  }

  function smite(level: number) {
    const offer = smiteOffer.value;
    if (!offer) return;
    return perform(async () => {
      const result = await props.request(`/campaigns/${props.campaignId}/rolls/${offer.rollId}/smite`, 'POST', { slotLevel: level });
      smiteOffer.value = null;
      emit('acted', `Божественная кара (ячейка ${level}-го уровня) по «${offer.targetName}»: ${result.applied} урона излучением${result.undead ? ' — нежить или исчадие, +1d8' : ''}.`);
    });
  }

  return { stunningStrike, quiveringPalm, hurlThroughHell, smite };
}
