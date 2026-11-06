import { computed, type Ref } from 'vue';
import type { FeatureView, ChoicePath, SpellEntry, ActionBarProps } from './types';

export type FeatureChoicesDeps = {
  props: ActionBarProps;
  perform: (action: () => Promise<unknown>, keepOpen?: boolean) => Promise<void>;
  features: Ref<FeatureView[]>;
  loadFeatures: () => Promise<void>;
};

export function useFeatureChoices({ props, perform, features, loadFeatures }: FeatureChoicesDeps) {
  const CHOICE_PATH: Partial<Record<FeatureView['id'], ChoicePath>> = {
    'eldritch-invocations': 'invocations', metamagic: 'metamagic', 'combat-superiority': 'maneuvers', 'hunters-prey': 'hunters-prey',
    'defensive-tactics': 'defensive-tactics', 'hunter-multiattack': 'hunter-multiattack', 'fiendish-resilience': 'fiendish-resilience',
    'superior-hunters-defense': 'superior-hunters-defense', 'favored-enemy': 'favored-enemy',
    'elemental-affinity': 'draconic-ancestry', feats: 'feats', 'fighting-styles': 'fighting-styles',
    'spell-mastery': 'spell-mastery', 'signature-spells': 'signature-spells',
  };
  const CHIP_CHOICES = new Set<FeatureView['id']>(['feats', 'fighting-styles', 'spell-mastery', 'signature-spells']);

  function freeOf(entry: SpellEntry | null): { kind: 'arcanum' | 'mastery' | 'signature'; label: string } | null {
    if (!entry?.spell) return null;
    const level = entry.spell.level;
    const find = (id: FeatureView['id']) => features.value.find(feature => feature.id === id);
    const arcanum = find('mystic-arcanum')?.choices?.find(choice => Number(choice.value) === level);
    if (arcanum && arcanum.count !== 0) return { kind: 'arcanum', label: `мистическим арканумом — без ячейки, раз до долгого отдыха` };
    if (find('spell-mastery')?.choices?.some(choice => choice.value === entry.id && choice.active)) return { kind: 'mastery', label: 'мастерством заклинаний — без ячейки, своим уровнем' };
    const signature = find('signature-spells')?.choices?.find(choice => choice.value === entry.id && choice.active);
    if (signature && signature.count !== 0) return { kind: 'signature', label: 'фирменным — без ячейки (3 ур.), раз до короткого отдыха' };
    return null;
  }
  const knowsFeat = (id: string) => Boolean(features.value.find(feature => feature.id === 'feats')?.choices?.some(choice => choice.value === id && choice.active));
  const powerFeat = computed(() => (features.value.find(feature => feature.id === 'feats')?.choices ?? [])
    .filter(choice => choice.active && (choice.value === 'sharpshooter' || choice.value === 'great-weapon-master')).map(choice => choice.label).join(' / '));
  function pickSingle(feature: FeatureView, event: Event) {
    const value = (event.target as HTMLSelectElement).value;
    if (value) void setChoice(feature, value, true);
  }
  function knowsManeuver(id: string) {
    return Boolean(features.value.find(feature => feature.id === 'combat-superiority')?.choices?.some(choice => choice.value === id && choice.active));
  }
  function setChoice(feature: FeatureView, value: string, on: boolean) {
    const path = CHOICE_PATH[feature.id];
    if (!path) return;
    return toggleChoice(path, value, on);
  }
  function toggleChoice(path: ChoicePath, id: string, on: boolean) {
    const actor = props.actor;
    if (!actor) return;
    return perform(async () => {
      await props.request(`/campaigns/${props.campaignId}/characters/${actor.characterId}/${path}`, 'PUT', { [id]: on });
      await loadFeatures();
    }, true);
  }

  function setSubclass(classId: string, subclass: string) {
    const actor = props.actor;
    if (!actor) return;
    return perform(async () => {
      await props.request(`/campaigns/${props.campaignId}/characters/${actor.characterId}/subclass`, 'PUT', { classId, subclass });
      await loadFeatures();
    }, true);
  }

  return { CHOICE_PATH, CHIP_CHOICES, freeOf, knowsFeat, powerFeat, pickSingle, knowsManeuver, setChoice, setSubclass };
}
