import { HERO_SKILLS } from './character-builder.ts';
import type { Feat } from './feats.ts';
import type { ModRace, RaceTrait } from './races.ts';
import { describeTraitEffect, normalizeTraitEffects, TRAIT_ABILITIES, traitHpPerLevel, traitResistances, sourced, type TraitAbility, type TraitEffect } from './traits.ts';
import type { HeroAbility, Subrace } from '../srd/heroes.ts';
import { SRD_WEAPONS } from '../srd/weapons.ts';
import { DAMAGE_TYPES } from '../spells/template/options.ts';

export const MOD_HERO_ID = /^mod_[a-z0-9_]{2,40}$/;
const DAMAGE_CODES = new Set(DAMAGE_TYPES.map(([value]) => value));
const DARKVISION = [30, 60, 90, 120];

const line = (value: unknown, limit: number) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, limit) : '');
const isAbility = (value: unknown): value is TraitAbility => typeof value === 'string' && (TRAIT_ABILITIES as readonly string[]).includes(value);

function idOf(raw: Record<string, unknown>, what: string): string {
  const id = typeof raw.id === 'string' ? raw.id : '';
  if (!MOD_HERO_ID.test(id)) throw new Error(`${what} «${id}»: id — mod_ и строчные латинские буквы, цифры, «_»`);
  return id;
}

function bonusesOf(raw: unknown, who: string): Partial<Record<HeroAbility, number>> {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${who}: bonuses — объект { constitution: 2 }`);
  const bonuses: Partial<Record<HeroAbility, number>> = {};
  for (const [ability, value] of Object.entries(raw)) {
    if (!isAbility(ability) || !Number.isInteger(value) || (value as number) < -2 || (value as number) > 3 || !value) {
      throw new Error(`${who}: bonuses.${ability} — характеристика и целое от −2 до 3`);
    }
    bonuses[ability] = value as number;
  }
  return bonuses;
}

function listOf<T>(raw: unknown, limit: number, who: string, check: (value: unknown) => value is T, hint: string): T[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > limit || !raw.every(check)) throw new Error(`${who}: ${hint}`);
  return [...new Set(raw)];
}

const isDamage = (value: unknown): value is string => typeof value === 'string' && DAMAGE_CODES.has(value);
const isSkill = (value: unknown): value is string => typeof value === 'string' && HERO_SKILLS.includes(value);
const isWeapon = (value: unknown): value is string => typeof value === 'string' && SRD_WEAPONS.some(weapon => weapon.index === value);

function speedOf(raw: unknown, who: string, fallback: number | undefined): number | undefined {
  if (raw === undefined) return fallback;
  if (!Number.isInteger(raw) || (raw as number) < 10 || (raw as number) > 60 || (raw as number) % 5) throw new Error(`${who}: speed — от 10 до 60 футов, кратно 5`);
  return raw as number;
}

function darkvisionOf(raw: unknown, who: string): number | undefined {
  if (raw === undefined || raw === 0) return undefined;
  if (!DARKVISION.includes(raw as number)) throw new Error(`${who}: darkvision — 0, 30, 60, 90 или 120`);
  return raw as number;
}

type TraitDraft = { name: string; text: string; effects: TraitEffect[] };

function traitsOf(raw: unknown, who: string): TraitDraft[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 12) throw new Error(`${who}: traits — список до 12 черт`);
  return raw.map((item, index) => {
    const entry = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const name = line(entry.name, 60);
    if (!name) throw new Error(`${who}: у черты ${index + 1} нужно name`);
    const effects = normalizeTraitEffects(entry.effects);
    if (typeof effects === 'string') throw new Error(`${who}, «${name}»: ${effects}`);
    const text = line(entry.text, 600) || effects.map(describeTraitEffect).join('; ') || name;
    return { name, text, effects };
  });
}

function subraceOf(raw: unknown, who: string, modName: string): { subrace: Subrace; traits: TraitDraft[] } {
  if (!raw || typeof raw !== 'object') throw new Error(`${who}: подраса — объект`);
  const entry = raw as Record<string, unknown>;
  const id = idOf(entry, 'подраса');
  const nameRu = line(entry.name, 40);
  if (!nameRu) throw new Error(`подраса «${id}»: нужно name`);
  const traits = traitsOf(entry.traits, `подраса «${nameRu}»`);
  const effects = traits.flatMap(trait => trait.effects);
  const hpPerLevel = traitHpPerLevel(effects);
  const resistances = [...new Set([...listOf(entry.resistances, 13, nameRu, isDamage, 'resistances — виды урона'), ...traitResistances(sourced(nameRu, effects))])];
  const speed = speedOf(entry.speed, nameRu, undefined);
  const darkvision = darkvisionOf(entry.darkvision, nameRu);
  const weapons = listOf(entry.weapons, 12, nameRu, isWeapon, 'weapons — оружие SRD (longsword, shortbow…)');
  const subrace: Subrace = {
    id, nameRu, bonuses: bonusesOf(entry.bonuses, nameRu), traits: traits.map(trait => [trait.name, trait.text]), modName,
    ...(hpPerLevel ? { hpPerLevel } : {}), ...(resistances.length ? { resistances } : {}), ...(speed ? { speed } : {}),
    ...(darkvision ? { darkvision } : {}), ...(weapons.length ? { weapons } : {}),
  };
  return { subrace, traits };
}

const toRaceTraits = (owner: string, race: string, subrace: string | null, drafts: TraitDraft[], modName: string, start = 1): RaceTrait[] =>
  drafts.map((draft, index) => ({
    id: `${owner}-t${start + index}`, races: [race], ...(subrace ? { subraces: [subrace] } : {}),
    name: draft.name, text: draft.text, effects: draft.effects, modName,
  }));

export function normalizeModRace(input: unknown, modName: string): { race: ModRace; traits: RaceTrait[] } {
  if (!input || typeof input !== 'object') throw new Error('нужен объект расы');
  const raw = input as Record<string, unknown>;
  const id = idOf(raw, 'раса');
  const nameRu = line(raw.name, 40);
  if (!nameRu) throw new Error(`раса «${id}»: нужно name`);
  const size = raw.size === undefined ? 'medium' : raw.size;
  if (size !== 'small' && size !== 'medium') throw new Error(`${nameRu}: size — small или medium`);
  const drafts = traitsOf(raw.traits, nameRu);
  const effects = drafts.flatMap(trait => trait.effects);
  const subraceList = raw.subraces === undefined ? [] : raw.subraces;
  if (!Array.isArray(subraceList) || subraceList.length > 6) throw new Error(`${nameRu}: subraces — список до 6 подрас`);
  const subraces = subraceList.map(entry => subraceOf(entry, nameRu, modName));
  if (new Set(subraces.map(entry => entry.subrace.id)).size !== subraces.length) throw new Error(`${nameRu}: id подрас повторяются`);
  const skillChoices = raw.skillChoices === undefined ? 0 : raw.skillChoices;
  if (!Number.isInteger(skillChoices) || (skillChoices as number) < 0 || (skillChoices as number) > 4) throw new Error(`${nameRu}: skillChoices — от 0 до 4`);
  let racialCantrip: ModRace['racialCantrip'];
  if (raw.cantrip !== undefined) {
    const cantrip = (raw.cantrip && typeof raw.cantrip === 'object' ? raw.cantrip : {}) as Record<string, unknown>;
    if (typeof cantrip.index !== 'string' || !/^[a-z0-9-]{2,60}$/.test(cantrip.index) || !isAbility(cantrip.ability)) {
      throw new Error(`${nameRu}: cantrip — { index: заговор SRD, ability: характеристика }`);
    }
    racialCantrip = { index: cantrip.index, ability: cantrip.ability };
  }
  const hpPerLevel = traitHpPerLevel(effects);
  const resistances = [...new Set([...listOf(raw.resistances, 13, nameRu, isDamage, 'resistances — виды урона'), ...traitResistances(sourced(nameRu, effects))])];
  const darkvision = darkvisionOf(raw.darkvision, nameRu);
  const skills = listOf(raw.skills, 4, nameRu, isSkill, 'skills — навыки SRD (perception, stealth…)');
  const weapons = listOf(raw.weapons, 12, nameRu, isWeapon, 'weapons — оружие SRD (longsword, shortbow…)');
  const names = listOf(raw.names, 12, nameRu, (value): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 30, 'names — до 12 имён до 30 знаков');
  const icon = line(raw.icon, 40);
  const tagline = line(raw.tagline, 200);
  const race: ModRace = {
    id, nameRu, size, speed: speedOf(raw.speed, nameRu, 30)!, bonuses: bonusesOf(raw.bonuses, nameRu),
    languages: line(raw.languages, 200) || 'Общий', traits: drafts.map(trait => [trait.name, trait.text]), subraces: subraces.map(entry => entry.subrace),
    modName, ...(darkvision ? { darkvision } : {}), ...(resistances.length ? { resistances } : {}), ...(skills.length ? { skills } : {}),
    ...(skillChoices ? { skillChoices: skillChoices as number } : {}), ...(weapons.length ? { weapons } : {}), ...(racialCantrip ? { racialCantrip } : {}),
    ...(hpPerLevel ? { hpPerLevel } : {}), ...(icon && /^[A-Za-z0-9]+$/.test(icon) ? { icon } : {}), ...(tagline ? { tagline } : {}),
    ...(names.length ? { names: names.map(name => name.trim()) } : {}),
  };
  const traits = toRaceTraits(id, id, null, drafts, modName);
  for (const entry of subraces) traits.push(...toRaceTraits(id, id, entry.subrace.id, entry.traits, modName, traits.length + 1));
  return { race, traits };
}

export function normalizeModSubrace(raceId: string, input: unknown, modName: string): { subrace: Subrace; traits: RaceTrait[] } {
  const { subrace, traits } = subraceOf(input, `подраса для «${raceId}»`, modName);
  return { subrace, traits: toRaceTraits(subrace.id, raceId, subrace.id, traits, modName) };
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function normalizeModFeat(input: unknown, modName: string): Feat {
  if (!input || typeof input !== 'object') throw new Error('нужен объект черты');
  const raw = input as Record<string, unknown>;
  const id = idOf(raw, 'черта');
  const nameRu = line(raw.name, 60);
  if (!nameRu) throw new Error(`черта «${id}»: нужно name`);
  const effects = normalizeTraitEffects(raw.effects);
  if (typeof effects === 'string') throw new Error(`черта «${nameRu}»: ${effects}`);
  const abilities = listOf(raw.abilities, 6, nameRu, isAbility, 'abilities — характеристики, одну из которых черта повышает на 1');
  const en = line(raw.en, 60);
  const pattern = new RegExp(`${escape(nameRu)}${en ? `|${escape(en)}` : ''}`, 'i');
  return {
    id, nameRu, en, text: line(raw.text, 600) || effects.map(describeTraitEffect).join('; ') || nameRu, pattern, effects, modName,
    ...(abilities.length ? { abilities } : {}),
  };
}
