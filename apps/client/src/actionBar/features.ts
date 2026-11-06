import { ref, computed, watch, type Ref } from 'vue';
import type { FeatureView, SmiteOffer, StunOffer, ManeuverOffer, QuiveringOffer, HurlOffer, SubclassView, ActionBarProps, Popover } from './types';

export type FeaturesDeps = {
  props: ActionBarProps;
  popover: Ref<Popover>;
  actionError: Ref<string>;
  loadedFor: Ref<string>;
};

export function useFeatures({ props, popover, actionError, loadedFor }: FeaturesDeps) {
  const features: Ref<FeatureView[]> = ref([]);
  const featureClass = ref('');
  const smiteOffer = ref<SmiteOffer | null>(null);
  const stunOffer = ref<StunOffer | null>(null);
  const maneuverOffer = ref<ManeuverOffer | null>(null);
  const quiveringOffer = ref<QuiveringOffer | null>(null);
  const hurlOffer = ref<HurlOffer | null>(null);
  const subclasses = ref<SubclassView[]>([]);
  let featuresRequest = 0;
  async function loadFeatures() {
    const actor = props.actor;
    const request = ++featuresRequest;
    if (!actor || actor.kind === 'object' || !actor.canAct) {
      features.value = [];
      return;
    }
    const stale = () => request !== featuresRequest || props.actor?.characterId !== actor.characterId;
    try {
      const query = props.sceneId ? `?sceneId=${props.sceneId}` : '';
      const result = await props.request(`/campaigns/${props.campaignId}/characters/${actor.characterId}/features${query}`);
      if (stale()) return;
      features.value = Array.isArray(result.features) ? result.features : [];
      subclasses.value = Array.isArray(result.subclasses) ? result.subclasses : [];
      featureClass.value = result.className ?? '';
    } catch {
      if (stale()) return;
      features.value = [];
    }
  }
  const hasCunningAction = computed(() => features.value.some(feature => feature.id === 'cunning-action'));

  watch(() => props.actor?.characterId, () => {
    popover.value = null;
    loadedFor.value = '';
    actionError.value = '';
    smiteOffer.value = null;
    stunOffer.value = null;
    maneuverOffer.value = null;
    quiveringOffer.value = null;
    hurlOffer.value = null;
    features.value = [];
    subclasses.value = [];
    void loadFeatures();
  }, { immediate: true });

  watch(() => `${(props.actor?.conditions ?? []).join(',')}|${props.actor?.hp?.current ?? ''}`, (next, previous) => {
    if (next !== previous && (popover.value === 'features' || popover.value === 'actions')) void loadFeatures();
  });

  function featureTitle(feature: FeatureView) {
    return feature.reason && !feature.active ? `${feature.text}\nСейчас нельзя: ${feature.reason}.` : feature.text;
  }

  return { features, featureClass, smiteOffer, stunOffer, maneuverOffer, quiveringOffer, hurlOffer, subclasses, loadFeatures, hasCunningAction, featureTitle };
}
