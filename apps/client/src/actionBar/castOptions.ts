import { ref, computed, type Ref } from 'vue';
import type { SpellEntry, FeatureView, Metamagic } from './types';

export type CastOptionsDeps = {
  castSlot: Ref<number>;
  features: Ref<FeatureView[]>;
};

export function useCastOptions({ castSlot, features }: CastOptionsDeps) {
  const castMetamagic = ref<Metamagic>('');
  const castEmpowered = ref(false);
  const castOverchannel = ref(false);
  const overchannelFeature = computed(() => features.value.find(feature => feature.id === 'overchannel') ?? null);
  function overchannelReady(entry: SpellEntry | null) {
    const level = entry?.spell?.level ?? 0;
    if (!overchannelFeature.value || !entry?.spell?.mechanics?.damageFormula || level < 1 || level > 5) return false;
    return (castSlot.value || level) <= 5;
  }
  const castHeightened = ref('');
  const metamagicFeature = computed(() => features.value.find(feature => feature.id === 'metamagic') ?? null);
  const metamagicKnown = computed(() => (metamagicFeature.value?.choices ?? []).filter(choice => choice.active).map(choice => choice.value));

  return { castMetamagic, castEmpowered, castOverchannel, overchannelFeature, overchannelReady, castHeightened, metamagicFeature, metamagicKnown };
}
