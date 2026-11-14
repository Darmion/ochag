export type Ability = 'strength' | 'dexterity' | 'constitution' | 'intelligence' | 'wisdom' | 'charisma';

export type Plan = {
  from: number; to: number; ready: number; classId: string | null; className: string | null; hitDie: number; averageHp: number; hpBonus: number;
  classLevel: number; newClass: boolean; multiclass: boolean; classText: string | null; prerequisites: string[];
  classOptions: Array<{ id: string; label: string; level: number }>; classProblem: string | null;
  asi: boolean; cantrips: number; spells: number; anyList: boolean; spellList: string | null; maxSpellLevel: number;
  expertise: number; fightingStyles: string[] | null; features: string[];
  multiclassGain: { text: string; skills: { count: number; from: string[] | 'any' } | null } | null;
  subclass: { options: Array<{ value: string; label: string }>; current: string; srd: string; srdFeatures: string[] } | null;
  replaceSpell: boolean;
};

export type Choice = {
  hp: 'average' | 'roll';
  asi?: { kind: 'asi'; increases: Partial<Record<Ability, number>> } | { kind: 'feat'; name: string; text?: string; id?: string; increase?: Ability } | null;
  subclass?: string | null;
  replace?: { from: string; to: string } | null;
  cantrips?: string[];
  spells?: string[];
  expertise?: string[];
  fightingStyle?: string | null;
  skills?: string[];
};

export type Feat = { id: string; nameRu: string; en: string; text: string; abilities: Ability[] | null; known: boolean; modName?: string };

export type Info = {
  plan: Plan | null; milestone: Plan | null; suggestion: Choice | null; name: string; scores: Record<Ability, number>;
  proficientSkills: string[]; expertiseSkills: string[]; knownSpells: string[]; swappableSpells: string[];
  fightingStyles: Array<{ id: string; nameRu: string; text: string }>;
  feats: Feat[];
  featureTexts?: Record<string, { text: string; automation: 'auto' | 'manual' | 'partial' | null }>;
};

export type Snapshot = {
  level: number; className: string | null; hpMax: number; armorClass: number; proficiency: number; attacks: number;
  scores: Record<Ability, number>; slots: Array<{ level: number; max: number }>; pact: { count: number; level: number } | null;
  resources: Array<{ name: string; max: number }>; spells: number;
};

export type Preview = {
  problems: string[]; before: Snapshot; after: Snapshot; hpGain: number; hpRange: [number, number] | null; features: string[]; className: string | null;
};

export type Result = { level: number; className: string | null; hpGain: number; roll: number | null; features: string[]; next: Plan | null };

export type StepId = 'class' | 'subclass' | 'improve' | 'talents' | 'spells' | 'summary';
