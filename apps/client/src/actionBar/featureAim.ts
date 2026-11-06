import { computed, type ComputedRef, type Ref } from 'vue';
import { libraryArt } from '../art/itemArt';
import type { FeatureView, FeatureCall, ActionBarProps, FeatureAim } from './types';

export type FeatureAimDeps = {
  props: ActionBarProps;
  targetId: Ref<string>;
  bardicTarget: Ref<string>;
  quiveringTarget: Ref<string>;
  handsTarget: Ref<string>;
  cleanseTarget: Ref<string>;
  cleanseSpell: Ref<string>;
  handsAmount: Ref<number | ''>;
  handsCure: Ref<boolean>;
  useFeature: (id: FeatureCall, extra?: Record<string, unknown>) => Promise<void> | undefined;
  breathe: () => Promise<void> | undefined;
  aimFeature: (spec: FeatureAim) => void;
  meleeReach: ComputedRef<number>;
  rageFrenzy: Ref<boolean>;
  flurryTechnique: Ref<'' | 'prone' | 'push' | 'no-reactions'>;
};

export function useFeatureAim({ props, targetId, bardicTarget, quiveringTarget, handsTarget, cleanseTarget, cleanseSpell, handsAmount, handsCure, useFeature, breathe, aimFeature, meleeReach, rageFrenzy, flurryTechnique }: FeatureAimDeps) {
  function aimTargeted(feature: FeatureView, id: FeatureCall, rangeFeet: number | null, art: string, extra: Record<string, unknown> = {}) {
    aimFeature({ id, label: feature.name.replace(/^[^:]+: /, ''), art: libraryArt(art), rangeFeet, self: false, run: target => { targetId.value = target; return useFeature(id, extra); } });
  }
  function aimBreath(feature: FeatureView) {
    aimFeature({ id: 'breath-weapon', label: feature.name, art: libraryArt('ui/symbols/target'), rangeFeet: null, self: false, run: target => { targetId.value = target; return breathe(); } });
  }
  function aimBardic(feature: FeatureView) {
    aimFeature({ id: 'bardic-inspiration', label: feature.name, art: libraryArt('ui/symbols/speech'), rangeFeet: 60, self: false, run: target => { bardicTarget.value = target; return useFeature('bardic-inspiration'); } });
  }
  function aimHands(feature: FeatureView) {
    aimFeature({
      id: 'lay-on-hands', label: feature.name, art: libraryArt('ui/symbols/hand-open'), rangeFeet: 5, self: true,
      run: target => { handsTarget.value = target === props.actor?.characterId ? '' : target; return useFeature('lay-on-hands', { ...(handsAmount.value ? { amount: handsAmount.value } : {}), ...(handsCure.value ? { cure: true } : {}) }); },
    });
  }
  const cleanseName = computed(() => (cleanseTarget.value ? props.targets.find(target => target.characterId === cleanseTarget.value)?.name : props.actor?.name) ?? '');
  function aimCleanse(feature: FeatureView) {
    aimFeature({
      id: 'cleansing-touch', label: feature.name, art: libraryArt('ui/symbols/hand-palm'), rangeFeet: 5, self: true,
      run: target => {
        const next = target === props.actor?.characterId ? '' : target;
        if (next !== cleanseTarget.value) {
          cleanseTarget.value = next;
          cleanseSpell.value = '';
        }
        return useFeature('cleansing-touch');
      },
    });
  }
  function aimQuivering(feature: FeatureView) {
    const choices = (feature.choices ?? []).map(choice => choice.value);
    if (choices.length <= 1) return useFeature('quivering-palm');
    aimFeature({ id: 'quivering-palm', label: feature.name.replace(/^[^:]+: /, ''), art: libraryArt('ui/symbols/hand-palm'), rangeFeet: null, self: false, only: choices,
      run: target => { quiveringTarget.value = target; return useFeature('quivering-palm'); } });
  }

  function pressFeature(feature: FeatureView) {
    if (feature.id === 'rage') return useFeature(feature.active ? 'end-rage' : 'rage', !feature.active && rageFrenzy.value ? { frenzy: true } : {});
    if (feature.id === 'flurry-of-blows') return aimTargeted(feature, 'flurry-of-blows', meleeReach.value, 'ui/symbols/hand-open', flurryTechnique.value ? { technique: flurryTechnique.value } : {});
    if (feature.id === 'intimidating-presence') return aimTargeted(feature, 'intimidating-presence', 30, 'ui/symbols/eye');
    return useFeature(feature.id as FeatureCall);
  }

  return { aimTargeted, aimBreath, aimBardic, aimHands, cleanseName, aimCleanse, aimQuivering, pressFeature };
}
