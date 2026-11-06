import { ref } from 'vue';

import type { SpellMechanicsView } from '../spells/spellMechanics';

export type SrdSpell = {
  index: string;
  name: string;
  level: number;
  school: string;
  castingTime: string;
  range: string;
  components: string;
  material: string | null;
  duration: string;
  concentration: boolean;
  ritual: boolean;
  classes: string[];
  desc: string;
  higherLevel: string | null;
  nameRu: string | null;
  descRu: string | null;
  higherLevelRu: string | null;
  damageFormula: string | null;
  healingFormula: string | null;
  mechanics?: SpellMechanicsView;
  mechanicsOverrides?: Record<string, unknown> | null;
};

export type SrdSkill = {
  index: string;
  nameEn: string;
  nameRu: string;
  ability: string;
  abilityRu: string;
  descRu: string;
  descEn?: string;
};

type RequestFn = (path: string, method?: string, body?: unknown) => Promise<any>;

const spells = ref<SrdSpell[] | null>(null);
const skills = ref<SrdSkill[] | null>(null);
let spellsPromise: Promise<void> | null = null;
let skillsPromise: Promise<void> | null = null;

export async function ensureSrdSpells(request: RequestFn): Promise<SrdSpell[]> {
  if (!spells.value) {
    spellsPromise ??= request('/srd/spells').then(data => { spells.value = data.spells; });
    await spellsPromise;
  }
  return spells.value!;
}

export async function ensureSrdSkills(request: RequestFn): Promise<SrdSkill[]> {
  if (!skills.value) {
    skillsPromise ??= request('/srd/skills').then(data => { skills.value = data.skills; });
    await skillsPromise;
  }
  return skills.value!;
}

export function invalidateSrdSpells() {
  spells.value = null;
  spellsPromise = null;
}

export type SrdMonsterAttack = {
  name: string; kind: 'melee' | 'ranged'; ability: 'strength' | 'dexterity'; toHit: number;
  reach?: number; range?: [number, number]; damage: string | null; average?: number; type?: string;
};
export type SrdMonster = {
  index: string; name: string; nameRu: string; size: string; type: string; alignment: string;
  ac: number; acNote?: string; hp: number; hitDice: string; speed: number; speedNote?: string;
  abilities: [number, number, number, number, number, number];
  saves?: Record<string, number>; skills?: Record<string, number>;
  vulnerable?: string[]; resistant?: string[]; immune?: string[]; conditionImmunities?: string;
  darkvision?: number; senses?: string; passive: number; languages: string;
  cr: number; crText: string; xp: number; proficiency: number;
  multiattack?: { count: number; text: string };
  attacks: SrdMonsterAttack[];
  spellcasting?: { ability: string; slots: number[]; spells: string[]; text: string };
  texts: { about: string; traits: string; actions: string; reactions: string };
  attackLines: string[];
};

const monsters = ref<{ monsters: SrdMonster[]; attribution: string } | null>(null);
let monstersPromise: Promise<void> | null = null;

export async function ensureSrdMonsters(request: RequestFn): Promise<{ monsters: SrdMonster[]; attribution: string }> {
  if (!monsters.value) {
    monstersPromise ??= request('/srd/monsters').then(data => { monsters.value = data; }).catch(error => { monstersPromise = null; throw error; });
    await monstersPromise;
  }
  return monsters.value!;
}
