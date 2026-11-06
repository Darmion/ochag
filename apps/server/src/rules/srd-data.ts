import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Open Game Content (SRD 5.1, OGL 1.0a) — see packages/domain/srd/ATTRIBUTION.md.

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

function load<T>(relativePath: string): T {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export const srdSpells: SrdSpell[] = load('../../../../packages/domain/srd/spells.json');
export const srdSkills: SrdSkill[] = load('../../../../packages/domain/srd/skills.json');

const spellsByIndex = new Map(srdSpells.map(spell => [spell.index, spell]));
const skillsByIndex = new Map(srdSkills.map(skill => [skill.index, skill]));

export function findSrdSpell(index: string): SrdSpell | undefined {
  return spellsByIndex.get(index);
}

export function findSrdSkill(index: string): SrdSkill | undefined {
  return skillsByIndex.get(index);
}

export type SrdSpellRu = { name: string; desc: string; higherLevel?: string };
const spellsRu: Record<string, SrdSpellRu> = load('../../../../packages/domain/srd/spells.ru.json');

export function srdSpellRu(index: string | null | undefined): SrdSpellRu | undefined {
  return index && Object.hasOwn(spellsRu, index) ? spellsRu[index] : undefined;
}

export function srdSpellRuFields(index: string | null | undefined) {
  const ru = srdSpellRu(index);
  return { nameRu: ru?.name ?? null, descRu: ru?.desc ?? null, higherLevelRu: ru?.higherLevel ?? null };
}

export function srdSpellName(index: string | null | undefined): string {
  return srdSpellRu(index)?.name ?? (index ? findSrdSpell(index)?.name : undefined) ?? index ?? 'заклинание';
}
