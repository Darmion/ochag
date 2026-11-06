import type { GameIconName } from '../ui/gameIcons.ts';

export type CardChoice = { value: string; label: string; active?: boolean; count?: number; hint?: string };

export type CardFeature = {
  id: string;
  name: string;
  detail: string;
  active: boolean;
  available: boolean;
  reason: string | null;
  resource: { current: number; max: number } | null;
  choices?: CardChoice[];
  ready?: string[];
};

export type FeatureButtonCard = { icon: GameIconName; label: string; note: string; active: boolean; blocked: boolean };

const BUTTON_ICONS: Record<string, GameIconName> = {
  'rage': 'flame', 'second-wind': 'heartPlus', 'action-surge': 'bolt', 'wholeness-of-body': 'yinYang', 'stillness-of-mind': 'ghost', 'divine-intervention': 'sun',
  'hide-in-plain-sight': 'leaf', 'eldritch-master': 'sparkle', 'turn-undead': 'holy', 'turn-the-unholy': 'sun', 'sacred-weapon': 'holy',
  'flurry-of-blows': 'burst', 'patient-defense': 'shield', 'countercharm': 'music', 'intimidating-presence': 'skull',
  'empty-body': 'ghost', 'holy-nimbus': 'sun', 'dragon-wings': 'dragonEye',
};

export const FEATURE_BUTTONS = new Set(Object.keys(BUTTON_ICONS));

const CHANNEL = new Set(['turn-undead', 'sacred-weapon', 'turn-the-unholy']);
const TOGGLED = new Set(['empty-body', 'holy-nimbus', 'dragon-wings']);
const MAP_HINT = ' · цель — щелчком по карте';

const left = (feature: CardFeature) => (feature.resource ? `${feature.resource.current}/${feature.resource.max}` : '');
const kiLeft = (feature: CardFeature) => (feature.resource ? `ци ${feature.resource.current}/${feature.resource.max}` : '');
const uses = (feature: CardFeature, count = left) => (feature.resource ? ` · ${count(feature)}` : '');
const why = (reason: string | null | false, fallback = '') => (reason ? ` · ${reason}` : fallback);

export function featureButton(feature: CardFeature, rageFrenzy: boolean): FeatureButtonCard {
  const icon = BUTTON_ICONS[feature.id] ?? 'bolt';
  const base = { icon, active: false, blocked: !feature.available };
  if (feature.id === 'rage') {
    return {
      ...base, active: feature.active,
      label: feature.active ? 'Закончить ярость' : rageFrenzy ? 'Ярость — в бешенство' : 'Ярость',
      note: feature.detail + uses(feature) + why(!feature.active && feature.reason),
    };
  }
  if (CHANNEL.has(feature.id)) {
    return {
      ...base, active: feature.active, blocked: !feature.available || feature.active,
      label: feature.name.replace('Божественный канал: ', ''),
      note: `Божественный канал · ${feature.detail}${uses(feature)}${why(feature.reason)}`,
    };
  }
  if (feature.id === 'flurry-of-blows' || feature.id === 'patient-defense') {
    const flurry = feature.id === 'flurry-of-blows';
    return {
      ...base,
      label: feature.name + (flurry ? '…' : ''),
      note: feature.detail.replace('; цель — выбранная', '') + uses(feature, kiLeft) + why(feature.reason, flurry ? MAP_HINT : ''),
    };
  }
  if (feature.id === 'countercharm') {
    return { ...base, active: feature.active, label: feature.name, note: feature.detail + why(feature.reason) };
  }
  if (feature.id === 'intimidating-presence') {
    return {
      ...base,
      label: `${feature.name.replace('Путь берсерка: ', '')}…`,
      note: feature.detail.replace(', цель в 30 фт. — выбранная', '') + why(feature.reason, MAP_HINT),
    };
  }
  if (TOGGLED.has(feature.id)) {
    const folding = feature.id === 'dragon-wings' && feature.active;
    return {
      ...base, active: feature.active, blocked: !feature.available && !folding,
      label: folding ? 'Сложить крылья' : feature.name.replace('Клятва преданности: ', '').replace('Драконья кровь: ', ''),
      note: feature.detail + uses(feature) + why(feature.reason),
    };
  }
  return { ...base, label: feature.name.replace('Путь открытой ладони: ', ''), note: feature.detail + uses(feature) + why(feature.reason) };
}

export function passiveIcon(feature: { id: string; name: string }): GameIconName {
  if (feature.id === 'sneak-attack') return 'dagger';
  if (feature.id.startsWith('unarmored')) return 'shield';
  return feature.name.startsWith('Раса:') ? 'person' : 'sparkle';
}

export type FeatureHeadCard = { icon: GameIconName; label: string; note: string | null };

const HEAD_ICONS: Record<string, GameIconName> = {
  'bardic-inspiration': 'music', 'step-of-the-wind': 'wind', 'breath-weapon': 'dragonEye', 'infernal-legacy': 'horns', 'cleansing-touch': 'sparkle',
  'lay-on-hands': 'hand', 'wild-shape': 'paw', 'flexible-casting': 'swap', 'draconic-presence': 'dragonEye', 'quivering-palm': 'yinYang',
  'fiendish-resilience': 'sparkle', 'preserve-life': 'heartPlus', 'reckless-attack': 'swords', 'frenzy': 'flame', 'open-hand-technique': 'yinYang',
  'arcane-recovery': 'sparkle', 'natural-recovery': 'sparkle', 'cunning-action': 'dash',
  'feats': 'star', 'fighting-styles': 'swords', 'spell-mastery': 'sparkle', 'signature-spells': 'sparkle',
  'metamagic': 'sparkle', 'combat-superiority': 'swords', 'hunters-prey': 'target', 'defensive-tactics': 'shield', 'hunter-multiattack': 'dash',
};

const SUBCLASS_HEADS = new Set(['draconic-presence', 'quivering-palm', 'open-hand-technique', 'fiendish-resilience', 'frenzy']);

const poolLeft = (feature: CardFeature) => (feature.resource ? `запас ${feature.resource.current}/${feature.resource.max}` : '');
const pointsLeft = (feature: CardFeature) => (feature.resource ? `очки ${feature.resource.current}/${feature.resource.max}` : '');
const detailAndUses = (feature: CardFeature) => feature.detail + uses(feature);
const noNote = () => null;

const HEAD_NOTES: Record<string, (feature: CardFeature) => string | null> = {
  'bardic-inspiration': feature => feature.detail.replace(', кому — выбранная цель', '') + uses(feature),
  'step-of-the-wind': kiLeft,
  'cleansing-touch': left,
  'lay-on-hands': poolLeft,
  'infernal-legacy': () => 'заклинания без ячеек, Харизмой — в «Магии»',
  'open-hand-technique': () => 'в «Шквале ударов»',
  'draconic-presence': feature => feature.detail + uses(feature, pointsLeft),
  'quivering-palm': feature => feature.detail + uses(feature, kiLeft),
  'breath-weapon': detailAndUses, 'wild-shape': detailAndUses, 'preserve-life': detailAndUses,
  'arcane-recovery': detailAndUses, 'natural-recovery': detailAndUses,
  'cunning-action': noNote, 'feats': noNote, 'fighting-styles': noNote, 'spell-mastery': noNote, 'signature-spells': noNote,
};

export const headIcon = (id: string) => HEAD_ICONS[id] ?? 'sparkle';

export function featureHead(feature: CardFeature): FeatureHeadCard {
  const note = HEAD_NOTES[feature.id] ?? (() => feature.detail);
  return { icon: headIcon(feature.id), label: SUBCLASS_HEADS.has(feature.id) ? feature.name.replace(/^[^:]+: /, '') : feature.name, note: note(feature) };
}

export type ChoiceHeadCard = { icon: GameIconName; label: string; points: string | null; detail: string | null };

const DETAIL_IN_CHOICE_HEAD = new Set(['combat-superiority', 'hunters-prey', 'defensive-tactics', 'hunter-multiattack']);
const SINGLE_CHOICE = new Set(['hunters-prey', 'elemental-affinity', 'defensive-tactics', 'hunter-multiattack', 'superior-hunters-defense']);

export function choiceHead(feature: CardFeature): ChoiceHeadCard {
  const unit = feature.id === 'metamagic' ? 'очки' : 'кости';
  return {
    icon: headIcon(feature.id),
    label: feature.name.replace('Охотник: ', ''),
    points: feature.resource ? `${unit} ${feature.resource.current}/${feature.resource.max}` : null,
    detail: DETAIL_IN_CHOICE_HEAD.has(feature.id) ? feature.detail : null,
  };
}

export const choiceInput = (id: string) => (SINGLE_CHOICE.has(id) ? 'radio' : 'checkbox');

export const hasChoice = (feature: CardFeature, value: string) => Boolean(feature.choices?.some(choice => choice.value === value && choice.active));
export const isReady = (feature: CardFeature, key: string) => (feature.ready ?? []).includes(key);

export type Multiattack = 'volley' | 'whirlwind';
export const MULTIATTACK: Record<Multiattack, { label: string; title: string }> = {
  volley: { label: 'Залп по цели…', title: 'Действием: выбранная цель и все враги в 10 футах от неё — каждому своя атака' },
  whirlwind: { label: 'Вихрь', title: 'Действием: все враги в 5 футах от вас — каждому своя атака' },
};

export function multiattackOf(feature: CardFeature): Multiattack | null {
  const value = feature.choices?.find(choice => choice.active)?.value;
  return value === 'volley' || value === 'whirlwind' ? value : null;
}

export type ManeuverToggle = { key: 'parry' | 'riposte'; label: string; title: string };
const MANEUVER_TOGGLES: ManeuverToggle[] = [
  { key: 'parry', label: 'Парирование', title: 'Рукопашная попала — урон меньше на кость + ЛОВ, реакцией' },
  { key: 'riposte', label: 'Ответный удар', title: 'Промахнулись рукопашной — реакцией атака, кость к урону' },
];

export const maneuverToggles = (feature: CardFeature) => MANEUVER_TOGGLES.filter(toggle => hasChoice(feature, toggle.key));

export type RowCall =
  | { kind: 'feature'; id: 'step-of-the-wind'; mode: 'dash' | 'disengage' }
  | { kind: 'feature'; id: 'draconic-presence'; mode: 'fear' | 'charm' }
  | { kind: 'standard'; action: 'dash' | 'disengage'; using: 'bonus' }
  | { kind: 'stealth'; action: 'hide'; using: 'bonus' };
export type RowAction = { label: string; icon: 'run' | 'door' | 'eye' | null; call: RowCall };

const ROW_ACTIONS: Record<string, RowAction[]> = {
  'step-of-the-wind': [
    { label: 'Рывок', icon: 'run', call: { kind: 'feature', id: 'step-of-the-wind', mode: 'dash' } },
    { label: 'Отход', icon: 'door', call: { kind: 'feature', id: 'step-of-the-wind', mode: 'disengage' } },
  ],
  'draconic-presence': [
    { label: 'Аура страха', icon: null, call: { kind: 'feature', id: 'draconic-presence', mode: 'fear' } },
    { label: 'Аура очарования', icon: null, call: { kind: 'feature', id: 'draconic-presence', mode: 'charm' } },
  ],
  'cunning-action': [
    { label: 'Рывок', icon: 'run', call: { kind: 'standard', action: 'dash', using: 'bonus' } },
    { label: 'Отход', icon: 'door', call: { kind: 'standard', action: 'disengage', using: 'bonus' } },
    { label: 'Спрятаться', icon: 'eye', call: { kind: 'stealth', action: 'hide', using: 'bonus' } },
  ],
};

export const ACTION_ROWS = new Set(Object.keys(ROW_ACTIONS));
export const rowActions = (id: string) => ROW_ACTIONS[id] ?? [];

export type ChipCard = { value: string; name: string; label: string; hint: string | undefined; spent: boolean };
export type ChipsCard = {
  chips: ChipCard[];
  add: { placeholder: string; ariaLabel: string; options: Array<{ value: string; label: string }> } | null;
};

const CHIP_ADD: Record<string, [string, string]> = {
  'feats': ['+ черта…', 'Добавить черту'], 'fighting-styles': ['+ стиль…', 'Добавить боевой стиль'],
  'spell-mastery': ['+ заклинание 1–2 ур.…', 'Выбрать заклинание для «Мастерства»'],
  'signature-spells': ['+ заклинание 3 ур.…', 'Выбрать фирменное заклинание'],
};
const CHIP_LIMITS: Record<string, number> = { 'signature-spells': 2 };

export function featureChips(feature: CardFeature): ChipsCard {
  const choices = feature.choices ?? [];
  const picked = choices.filter(choice => choice.active);
  const rest = choices.filter(choice => !choice.active);
  const spentNote = feature.id === 'signature-spells' ? ' · потрачено' : '';
  const full = picked.length >= (CHIP_LIMITS[feature.id] ?? Infinity);
  const [placeholder, ariaLabel] = CHIP_ADD[feature.id] ?? ['', ''];
  return {
    chips: picked.map(choice => ({
      value: choice.value, name: choice.label, hint: choice.hint, spent: choice.count === 0,
      label: choice.label + (choice.count === 0 ? spentNote : ''),
    })),
    add: rest.length > 0 && !full
      ? { placeholder, ariaLabel, options: rest.map(choice => ({ value: choice.value, label: choice.label + (choice.hint ? ` — ${choice.hint}` : '') })) }
      : null,
  };
}

export type FeatureToggleCard = { icon: GameIconName; label: string; note: string | null; active: boolean };

const TOGGLE_ICONS: Record<string, GameIconName> = {
  'protection-style': 'shield', 'deflect-missiles': 'hand', 'retaliation': 'swords', 'uncanny-dodge': 'bolt', 'cutting-words': 'music',
};

export const FEATURE_TOGGLES = new Set(Object.keys(TOGGLE_ICONS));

const readyDetail = (feature: CardFeature) => feature.detail.replace(/^(не )?наготове: /, '');

export function featureToggle(feature: CardFeature): FeatureToggleCard {
  const card = { icon: TOGGLE_ICONS[feature.id] ?? 'sparkle', label: feature.name, active: feature.active };
  if (feature.id === 'deflect-missiles') return { ...card, note: readyDetail(feature) };
  if (feature.id === 'retaliation') return { ...card, label: feature.name.replace('Путь берсерка: ', ''), note: 'ранили в 5 фт. — реакцией удар' };
  if (feature.id === 'uncanny-dodge') return { ...card, note: 'урон попавшей атаки вдвое, реакцией' };
  if (feature.id === 'cutting-words') return { ...card, note: readyDetail(feature) + uses(feature) };
  return { ...card, note: null };
}
