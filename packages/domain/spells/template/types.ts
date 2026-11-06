import type { EffectKind } from './effect-catalog.ts';

export const SPELL_TEMPLATE_VERSION = 1;

export type Effect = {
  id: string;
  kind: EffectKind;
  values: Record<string, unknown>;
  actions: Action[];
};

export type Outcome = 'always' | 'hit' | 'miss' | 'crit' | 'fail' | 'success' | 'met' | 'unmet';

export type Check = {
  kind: 'none' | 'attack' | 'save' | 'ability' | 'contest' | 'caster-d20' | 'hp-threshold';
  attackRange: 'melee' | 'ranged';
  attackCount: number;
  ability: string;
  dc: 'spell' | 'fixed';
  dcValue: number;
  skill: string;
  roller: 'target' | 'caster';
  advantageIf: string[];
  autoFailIf: string[];
  contestMine: string;
  contestTheirs: string;
  threshold: number;
  hpFormula: string;
};

export type Action = {
  id: string;
  name: string;
  when: string;
  times: string;
  timesCount: number;
  who: string;
  whoMax: number;
  check: Check;
  successHalf: boolean;
  outcomes: Partial<Record<Outcome, Effect[]>>;
};

export type Mode = { id: string; name: string; actions: Action[] };
export type Param = { id: string; key: string; label: string; kind: string; options: string[]; chooser: string };

export type Command = { id: string; name: string; cost: string; when: string; does: string; feet: number; actionId: string; limit: string; limitCount: number };

export type Scaling = {
  id: string;
  what: string;
  per: string;
  ref: string;
  amount: string;
  steps: Array<[number, string]>;
};

export type SpellTemplate = {
  schemaVersion: number;
  passport: { name: string; nameEn: string; level: number; school: string; classes: string[]; description: string; higherLevel: string; tags: string[]; element: string; art: string };
  casting: {
    time: string; minutes: number; trigger: string; triggerFeet: number; triggerText: string; ritual: boolean;
    verbal: boolean; somatic: boolean; material: boolean; materialText: string; materialCost: number; materialConsumed: boolean;
    range: string; rangeValue: number; rangeText: string; needsSight: boolean;
  };
  duration: { kind: string; value: number; text: string; concentration: boolean; dismiss: string; stacks: boolean };
  targeting: {
    kind: string;
    count: number; countMode: 'exact' | 'up-to'; side: string; includeSelf: boolean; distinct: boolean; maxApartFeet: number;
    typeMode: 'any' | 'only' | 'except'; types: string[]; maxSize: string; maxHp: number; maxInt: number;
    seesCaster: boolean; hearsCaster: boolean; understands: boolean;
    shape: string; sizeFeet: number; widthFeet: number; heightFeet: number; origin: string; affects: string; chosenMax: number; aroundCorners: boolean;
    hops: number; hopFeet: number; repeats: boolean;
    objectKind: string; objectOwner: 'self' | 'target'; objectFilter: string; maxWeight: number;
    segments: number; segmentFeet: number; wallHeight: number; wallThickness: number; wallShape: string;
  };
  options: { modes: Mode[]; params: Param[] };
  actions: Action[];
  commands: Command[];
  scaling: Scaling[];
  ending: {
    duration: boolean; concentration: boolean; casterDown: boolean; distanceFeet: number; targetActs: boolean; targetDamaged: boolean;
    targetSaves: boolean; dismissed: boolean; recast: boolean; afterUses: number; dispellable: boolean;
    onEnd: Action[];
  };
  hints: { purpose: string; prefer: string; avoidAllies: boolean; logPhrase: string; sound: string };
  origin: { srd: string; reviewed: boolean };
};
