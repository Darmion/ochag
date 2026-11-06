import { ref, type Ref } from 'vue';
import type { SpellEntry, ActionBarProps, FeatureView, ActionBarEmit } from './types';

export type LegacyTraitsDeps = {
  props: ActionBarProps;
  emit: ActionBarEmit;
  loadedFor: Ref<string>;
  targetId: Ref<string>;
  ensureActorData: () => Promise<void>;
  perform: (action: () => Promise<unknown>, keepOpen?: boolean) => Promise<void>;
  features: Ref<FeatureView[]>;
  loadFeatures: () => Promise<void>;
};

export function useLegacyTraits({ props, emit, loadedFor, targetId, ensureActorData, perform, features, loadFeatures }: LegacyTraitsDeps) {
  const flexLevel = ref(0);

  function legacyOf(entry: SpellEntry | null) {
    if (!entry) return null;
    const spell = features.value.find(feature => feature.id === 'infernal-legacy')?.legacy?.find(item => item.entryId === entry.id && item.open);
    return spell && (!spell.charge || spell.charge.current > 0) ? spell : null;
  }
  function addLegacySpell(index: string) {
    const actor = props.actor;
    if (!actor) return;
    return perform(async () => {
      await props.request(`/campaigns/${props.campaignId}/characters/${actor.characterId}/spells`, 'POST', { source: 'srd', srdIndex: index });
      loadedFor.value = '';
      await ensureActorData();
      await loadFeatures();
    }, true);
  }

  function inspiringSpeech() {
    const actor = props.actor;
    if (!actor || !props.sceneId) return;
    return perform(async () => {
      await props.request(`/campaigns/${props.campaignId}/characters/${actor.characterId}/inspiring-leader`, 'POST', { sceneId: props.sceneId });
    });
  }

  function setAncestry(ancestry: string) {
    const actor = props.actor;
    if (!actor || !ancestry) return;
    return perform(async () => {
      await props.request(`/campaigns/${props.campaignId}/characters/${actor.characterId}/dragon-ancestry`, 'PUT', { ancestry });
      await loadFeatures();
    }, true);
  }
  function breathe() {
    const actor = props.actor;
    if (!actor || !props.sceneId || !targetId.value) return;
    return perform(async () => {
      const result = await props.request(`/campaigns/${props.campaignId}/characters/${actor.characterId}/breath-weapon`, 'POST', { sceneId: props.sceneId, targetId: targetId.value });
      emit('acted', result.message);
      await loadFeatures();
    });
  }

  function toggleProtection(on: boolean, key: 'protection' | 'deflect-missiles' | 'uncanny-dodge' | 'parry' | 'riposte' | 'cutting-words' | 'lucky' | 'retaliation' = 'protection') {
    const actor = props.actor;
    if (!actor) return;
    return perform(async () => {
      await props.request(`/campaigns/${props.campaignId}/characters/${actor.characterId}/reactions`, 'PUT', { [key]: on });
      await loadFeatures();
    }, true);
  }

  function toggleReady(feature: FeatureView) {
    return toggleProtection(!feature.active, feature.id === 'protection-style' ? 'protection' : feature.id as 'deflect-missiles' | 'retaliation' | 'uncanny-dodge' | 'cutting-words');
  }

  return { flexLevel, legacyOf, addLegacySpell, inspiringSpeech, setAncestry, breathe, toggleProtection, toggleReady };
}
