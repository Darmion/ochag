import { computed, type ComputedRef, type Ref } from 'vue';
import type { ActionBarProps, BeastForm, CastView, FeatureView, LegacySpell, PactSlots, SpellEntry, SpellSlot } from './types';

export type CastViewDeps = {
  props: ActionBarProps;
  castingEntry: Ref<SpellEntry | null>;
  castTargets: Ref<string[]>;
  castArea: Ref<string>;
  shotsPer: Ref<Record<string, number>>;
  shotsAssigned: ComputedRef<number>;
  pactSlots: Ref<PactSlots | null>;
  beastChoices: ComputedRef<BeastForm[]>;
  metamagicKnown: ComputedRef<string[]>;
  metamagicFeature: ComputedRef<FeatureView | null>;
  overchannelFeature: ComputedRef<FeatureView | null>;
  slotChoices: (entry: SpellEntry) => SpellSlot[];
  castSlotLevel: (entry: SpellEntry) => number;
  conjureCountOf: (entry: SpellEntry, option: number) => number;
  beastLabel: (form: BeastForm) => string;
  projectileTotal: (entry: SpellEntry) => number;
  freeOf: (entry: SpellEntry | null) => { label: string } | null;
  legacyOf: (entry: SpellEntry | null) => LegacySpell | null;
  pactCastable: (entry: SpellEntry) => boolean;
  overchannelReady: (entry: SpellEntry | null) => boolean;
};

export function useCastView({
  props, castingEntry, castTargets, castArea, shotsPer, shotsAssigned, pactSlots, beastChoices, metamagicKnown, metamagicFeature,
  overchannelFeature, slotChoices, castSlotLevel, conjureCountOf, beastLabel, projectileTotal, freeOf, legacyOf, pactCastable, overchannelReady,
}: CastViewDeps) {
  const targetName = (id: string) => props.targets.find(target => target.characterId === id)?.name ?? (props.actor?.characterId === id ? props.actor.name : 'цель');

  const castView = computed<CastView | null>(() => {
    const entry = castingEntry.value;
    if (!entry) return null;
    return {
      slots: slotChoices(entry),
      twinCost: Math.max(1, castSlotLevel(entry)),
      conjureCounts: entry.spell?.summon?.options?.map((_, index) => conjureCountOf(entry, index)) ?? [],
      beasts: beastChoices.value.map(form => ({ index: form.index, label: beastLabel(form) })),
      projectileTotal: entry.spell?.projectiles ? projectileTotal(entry) : 0,
      chosen: castTargets.value.map(id => ({ id, name: targetName(id) })),
      shotsPer: shotsPer.value,
      shotsAssigned: shotsAssigned.value,
      hasArea: Boolean(castArea.value),
      freeCast: freeOf(entry),
      legacy: legacyOf(entry),
      pactCastable: pactCastable(entry),
      pactSlots: pactSlots.value,
      overchannelReady: overchannelReady(entry),
      overchannelDetail: overchannelFeature.value?.detail,
      metamagic: metamagicKnown.value,
      sorcery: { current: metamagicFeature.value?.resource?.current ?? 0, max: metamagicFeature.value?.resource?.max ?? 0 },
    };
  });

  return { castView };
}
