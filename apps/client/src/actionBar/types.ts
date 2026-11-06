import type { GameIconName } from '../ui/gameIcons';
import type { AutoTarget } from '../tabletop/autoTarget';
import type { SpellMechanicsView } from '../spells/spellMechanics';

export type { AttackOptions, Weapon } from './attackTypes';

export type ActionActor = {
  characterId: string;
  name: string;
  imageUrl: string | null;
  imageCrop?: unknown;
  crest?: string | null;
  side: string;
  kind: 'character' | 'npc' | 'object';
  hp: { current: number; max: number; temp: number } | null;
  canAct: boolean;
  conditions: string[];
  inspired: boolean;
};

export type AttackTarget = { characterId: string; name: string; side: string; distanceFeet: number | null };
export type ActionUsing = 'action' | 'bonus';
export type StandardAction = 'dash' | 'disengage' | 'dodge';
export type StealthKind = 'hide' | 'search' | 'unhide';
export type CombatCommand = 'grapple' | 'shove-prone' | 'shove-push' | 'escape' | 'help' | 'ready';
export type SlotRecovery = 'arcane-recovery' | 'natural-recovery';
export type SlotPicks = Record<SlotRecovery, Record<string, number>>;

export type MenuButton = { id: string; label: string; icon: GameIconName; pressed: boolean; hotkey?: string };

export type Metamagic = '' | 'quickened' | 'twinned' | 'careful' | 'heightened' | 'distant' | 'extended' | 'subtle';
export type SpellSlot = { level: number; current: number; max: number };
export type PactSlots = { current: number; max: number; slotLevel: number };

export type ProjectileRule = { base: number; noun: 'ray' | 'dart' | 'beam'; perSlotFrom: number | null; byLevel: Array<[number, number]> | null };
export type SpellEntry = {
  id: string; prepared: boolean; slotless?: boolean;
  spell: {
    name: string; nameRu?: string | null; level: number; range?: string; mechanics?: SpellMechanicsView; ritual?: boolean;
    projectiles?: ProjectileRule | null; riders?: string[]; targetLimit?: number | null;
    singleTarget?: boolean;
    area?: SpellAreaView | null;
    summon?: { kind: 'familiar' | 'steed' | 'conjure-animals'; concentration: boolean; forms: BeastForm[]; options: Array<{ cr: number; count: number }> | null } | null;
    shape?: { kind: 'polymorph' | 'animal-shapes'; maxCr: number | null; forms: BeastForm[] } | null;
    element?: string[] | null;
    modes?: Array<{ id: string; name: string }>;
    art?: string | null;
    needsTarget?: boolean;
    teleport?: { rangeFeet: number } | null;
  } | null;
};
export type BeastForm = { index: string; name: string; nameEn: string; cr: number; size: string };
export type SpellAreaView = { shape: 'circle' | 'cone' | 'square' | 'line'; sizeFeet: number; widthFeet: number | null; fromSelf: boolean };
export type FeatureView = {
  id: 'rage' | 'second-wind' | 'action-surge' | 'cunning-action' | 'sneak-attack' | 'divine-smite'
    | 'bardic-inspiration' | 'turn-undead' | 'sacred-weapon' | 'unarmored-defense' | 'unarmored-defense-monk'
    | 'flurry-of-blows' | 'patient-defense' | 'step-of-the-wind' | 'lay-on-hands' | 'wild-shape' | 'protection-style'
    | 'stunning-strike' | 'deflect-missiles'
    | 'improved-critical' | 'uncanny-dodge' | 'evasion' | 'evasion-monk' | 'eldritch-invocations'
    | 'reckless-attack' | 'danger-sense' | 'aura-of-protection' | 'metamagic' | 'arcane-recovery'
    | 'disciple-of-life' | 'preserve-life' | 'combat-superiority' | 'hunters-prey'
    | 'sculpt-spells' | 'dark-ones-blessing' | 'elemental-affinity' | 'cutting-words'
    | 'open-hand-technique' | 'frenzy' | 'turn-the-unholy' | 'natural-recovery' | 'blessed-healer' | 'empowered-evocation'
    | 'mindless-rage' | 'aura-of-devotion' | 'wholeness-of-body' | 'dark-ones-own-luck' | 'divine-strike'
    | 'aura-of-courage' | 'improved-divine-smite' | 'brutal-critical' | 'relentless-rage' | 'reliable-talent'
    | 'stillness-of-mind' | 'purity-of-body'
    | 'indomitable' | 'diamond-soul' | 'fast-movement' | 'unarmored-movement' | 'feral-instinct' | 'jack-of-all-trades'
    | 'remarkable-athlete' | 'slippery-mind' | 'elusive' | 'song-of-rest' | 'survivor' | 'indomitable-might' | 'cleansing-touch'
    | 'stroke-of-luck' | 'divine-intervention'
    | 'vanish' | 'feral-senses' | 'mystic-arcanum' | 'spell-mastery' | 'signature-spells' | 'sorcerous-restoration'
    | 'hide-in-plain-sight' | 'blindsense' | 'beast-spells'
    | 'superior-inspiration' | 'perfect-self' | 'eldritch-master' | 'persistent-rage' | 'primal-champion'
    | 'draconic-resilience' | 'potent-cantrip' | 'overchannel' | 'fiendish-resilience' | 'supreme-healing'
    | 'defensive-tactics' | 'hunter-multiattack' | 'slow-fall'
    | 'retaliation' | 'superior-hunters-defense' | 'empty-body' | 'quivering-palm' | 'hurl-through-hell' | 'holy-nimbus'
    | 'lands-stride' | 'lands-stride-ranger' | 'dragon-wings' | 'peerless-skill'
    | 'countercharm' | 'flexible-casting' | 'archdruid' | 'supreme-sneak' | 'tranquility' | 'favored-enemy' | 'foe-slayer'
    | 'intimidating-presence' | 'draconic-presence' | 'purity-of-spirit' | 'natures-ward' | 'natures-sanctuary' | 'thiefs-reflexes'
    | 'lucky' | 'brave' | 'fey-ancestry' | 'dwarven-resilience' | 'gnome-cunning' | 'relentless-endurance' | 'savage-attacks'
    | 'breath-weapon' | 'draconic-resistance' | 'hellish-resistance' | 'infernal-legacy'
    | 'feats' | 'fighting-styles';
  name: string; text: string; use: 'bonus' | 'action' | 'free' | 'passive'; detail: string; active: boolean;
  resource: { name: string; current: number; max: number } | null; available: boolean; reason: string | null;
  choices?: Array<{ value: string; label: string; active?: boolean; count?: number; hint?: string }>;
  limit?: number;
  legacy?: Array<{ index: string; name: string; minLevel: number; castAt: number; open: boolean; entryId: string | null; charge: { current: number; max: number } | null }>;
  ready?: string[];
};
export type SmiteOffer = { characterId: string; rollId: string; targetName: string; slots: Array<{ level: number; current: number }> };
export type StunOffer = { characterId: string; rollId: string; targetName: string; ki: number; dc: number };
export type QuiveringOffer = { characterId: string; rollId: string; targetName: string; ki: number; cost: number };
export type HurlOffer = { characterId: string; rollId: string; targetName: string; left: number };
export type ManeuverOffer = { characterId: string; rollId: string; targetName: string; dice: number; die: number; maneuvers: Array<{ id: string; name: string }> };
export type SubclassView = { classId: string; className: string; value: string; options: Array<{ value: string; label: string }> };

export type Popover = 'attack' | 'spell' | 'skill' | 'save' | 'ability' | 'rest' | 'loot' | 'trade' | 'actions' | 'features' | 'auto'
  | 'checks' | 'dice' | null;

export type AttackPreview = { hitChance: number | null; averageDamage: number | null; tooFar: string | null };

export type FeatureAim = { id: string; label: string; art: string | null; rangeFeet: number | null; self: boolean; only?: string[]; run: (characterId: string) => unknown };

export type FeatureCall = 'rage' | 'end-rage' | 'second-wind' | 'action-surge' | 'bardic-inspiration' | 'turn-undead' | 'sacred-weapon'
  | 'flurry-of-blows' | 'patient-defense' | 'step-of-the-wind' | 'lay-on-hands' | 'wild-shape' | 'end-wild-shape'
  | 'reckless-attack' | 'arcane-recovery' | 'preserve-life' | 'natural-recovery' | 'turn-the-unholy' | 'frenzy-attack'
  | 'wholeness-of-body' | 'stillness-of-mind' | 'cleansing-touch' | 'divine-intervention' | 'hide-in-plain-sight' | 'eldritch-master'
  | 'volley' | 'whirlwind' | 'empty-body' | 'holy-nimbus' | 'dragon-wings' | 'quivering-palm'
  | 'countercharm' | 'flexible-casting' | 'intimidating-presence' | 'draconic-presence';

export type ChoicePath = 'invocations' | 'metamagic' | 'maneuvers' | 'hunters-prey' | 'draconic-ancestry' | 'feats' | 'fighting-styles' | 'spell-mastery' | 'signature-spells'
  | 'defensive-tactics' | 'hunter-multiattack' | 'fiendish-resilience' | 'superior-hunters-defense' | 'favored-enemy';

export type MapAimState = {
  rangeFeet: number | null; walls: boolean; area: (SpellAreaView & { color: string }) | null;
  chosen: string[]; self: boolean; only: string[] | null; living: boolean;
  place?: { size: string; count: number };
};

export type ActionBarProps = {
  campaignId: string;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
  actor: ActionActor | null;
  inCombat: boolean;
  isActorTurn: boolean;
  canAdvance: boolean;
  canJoin: boolean;
  canLeave?: boolean;
  canHide: boolean;
  canStartCombat: boolean;
  busy: boolean;
  targets: AttackTarget[];
  sceneId: string;
  areas: Array<{ id: string; label: string }>;
  movementLeft: { feet: number; budget: number } | null;
  canInspire: boolean;
  canAutoTurn: boolean;
  autoTarget?: AutoTarget;
  economy: { entryId: string; action: boolean; bonus: boolean; reaction: boolean; attacksMade: number; perAction: number; disengaged: boolean; hasteUsed?: boolean } | null;
  deathSaveNote?: string | null;
  lootTargets: Array<{ characterId: string; name: string; count: number }>;
  tradeTargets: Array<{ characterId: string; name: string }>;
  eyes?: { on: boolean; name: string | null } | null;
};

export type ActionBarEvents = {
  startCombat: [];
  restParty: [kind: 'short' | 'long'];
  beginRest: [kind: 'short' | 'long'];
  awardParty: [amount: number];
  autoTurn: [];
  autoTarget: [mode: AutoTarget];
  join: [];
  leave: [];
  dash: [];
  advance: [];
  openSheet: [];
  focus: [];
  acted: [message: string];
  range: [feet: number | null];
  trade: [merchant: { characterId: string; name: string }];
  deselect: [];
  roll: [formula: string, hidden: boolean];
  eyes: [on: boolean];
};

type UnionToIntersection<U> = (U extends unknown ? (arg: U) => void : never) extends (arg: infer I) => void ? I : never;
export type ActionBarEmit = UnionToIntersection<{ [K in keyof ActionBarEvents]: (event: K, ...args: ActionBarEvents[K]) => void }[keyof ActionBarEvents]>;

export type LegacySpell = NonNullable<FeatureView['legacy']>[number];
export type CastView = {
  slots: SpellSlot[];
  twinCost: number;
  conjureCounts: number[];
  beasts: Array<{ index: string; label: string }>;
  projectileTotal: number;
  chosen: Array<{ id: string; name: string }>;
  shotsPer: Record<string, number>;
  shotsAssigned: number;
  hasArea: boolean;
  freeCast: { label: string } | null;
  legacy: LegacySpell | null;
  pactCastable: boolean;
  pactSlots: PactSlots | null;
  overchannelReady: boolean;
  overchannelDetail: string | undefined;
  metamagic: string[];
  sorcery: { current: number; max: number };
};
