import { ref, watch, type Ref } from 'vue';
import type { FeatureCall, ActionBarProps, FeatureView, ActionBarEmit, SlotPicks } from './types';

export type FeatureCallsDeps = {
  props: ActionBarProps;
  emit: ActionBarEmit;
  loadedFor: Ref<string>;
  targetId: Ref<string>;
  perform: (action: () => Promise<unknown>, keepOpen?: boolean) => Promise<void>;
  features: Ref<FeatureView[]>;
  quiveringOffer: Ref<{ characterId: string; rollId: string; targetName: string; ki: number; cost: number; } | null>;
  loadFeatures: () => Promise<void>;
};

export function useFeatureCalls({ props, emit, loadedFor, targetId, perform, features, quiveringOffer, loadFeatures }: FeatureCallsDeps) {
  const slotPicks = ref<SlotPicks>({ 'arcane-recovery': {}, 'natural-recovery': {} });
  const bardicTarget = ref('');
  watch(() => props.targets.map(target => target.characterId).join(','), () => {
    if (!props.targets.some(target => target.characterId === bardicTarget.value)) bardicTarget.value = '';
  });

  const quiveringTarget = ref('');
  const handsTarget = ref('');
  const cleanseTarget = ref('');
  const cleanseSpell = ref('');
  const cleanseSpells = ref<Array<{ value: string; label: string; level: number; harmful: boolean }>>([]);
  let cleanseRequest = 0;
  async function loadCleansable() {
    const actor = props.actor;
    const request = ++cleanseRequest;
    if (!actor || !features.value.some(feature => feature.id === 'cleansing-touch')) {
      cleanseSpells.value = [];
      return;
    }
    const target = cleanseTarget.value || actor.characterId;
    const stale = () => request !== cleanseRequest || props.actor?.characterId !== actor.characterId || (cleanseTarget.value || actor.characterId) !== target;
    try {
      const result = await props.request(`/campaigns/${props.campaignId}/characters/${actor.characterId}/cleansing-touch?targetId=${target}`);
      if (stale()) return;
      cleanseSpells.value = Array.isArray(result.spells) ? result.spells : [];
    } catch {
      if (stale()) return;
      cleanseSpells.value = [];
    }
    if (!cleanseSpells.value.some(spell => spell.value === cleanseSpell.value)) cleanseSpell.value = '';
  }
  watch([cleanseTarget, () => features.value], () => void loadCleansable());
  const handsAmount = ref<number | ''>('');
  const handsCure = ref(false);
  const beast = ref('');
  const rageFrenzy = ref(false);
  const flurryTechnique = ref<'' | 'prone' | 'push' | 'no-reactions'>('');

  function useFeature(id: FeatureCall, extra: Record<string, unknown> = {}) {
    const actor = props.actor;
    if (!actor) return;
    const target = id === 'bardic-inspiration' ? bardicTarget.value || targetId.value
      : id === 'flurry-of-blows' || id === 'frenzy-attack' || id === 'volley' ? targetId.value
      : id === 'lay-on-hands' ? handsTarget.value || actor.characterId
      : id === 'cleansing-touch' ? cleanseTarget.value || actor.characterId
      : id === 'quivering-palm' ? quiveringTarget.value
      : id === 'intimidating-presence' ? targetId.value : '';
    return perform(async () => {
      const result = await props.request(`/campaigns/${props.campaignId}/characters/${actor.characterId}/features/${id}`, 'POST', {
        ...(props.sceneId ? { sceneId: props.sceneId } : {}), ...(target ? { targetId: target } : {}),
        ...(id === 'cleansing-touch' && cleanseSpell.value ? { spell: cleanseSpell.value } : {}), ...extra,
      });
      if (id === 'wild-shape' || id === 'end-wild-shape' || id === 'arcane-recovery' || id === 'natural-recovery' || id === 'eldritch-master') loadedFor.value = '';
      if (id === 'arcane-recovery' || id === 'natural-recovery') slotPicks.value[id] = {};
      if (id === 'flexible-casting') loadedFor.value = '';
      if (result.quivering) quiveringOffer.value = { characterId: actor.characterId, ...result.quivering };
      emit('acted', result.message);
      await loadFeatures();
    });
  }

  return { slotPicks, bardicTarget, quiveringTarget, handsTarget, cleanseTarget, cleanseSpell, cleanseSpells, handsAmount, handsCure, beast, rageFrenzy, flurryTechnique, useFeature };
}
