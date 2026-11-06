export type Ability = 'strength' | 'dexterity' | 'constitution' | 'intelligence' | 'wisdom' | 'charisma';
export type Trait = [string, string];
export type Race = {
  id: string; nameRu: string; size: string; speed: number; bonuses: Partial<Record<Ability, number>>; flexibleBonuses?: number;
  darkvision?: number; skills?: string[]; skillChoices?: number; languages: string; traits: Trait[]; ancestry?: true; custom?: true;
  subraces: Array<{ id: string; nameRu: string; bonuses: Partial<Record<Ability, number>>; traits: Trait[]; wizardCantrip?: boolean }>;
};
export type Kit = { id: string; nameRu: string; weaponNames: string[]; armorName: string | null; shield?: boolean; gearNames: string[]; ammo?: { name: string; count: number } };
export type HeroClass = {
  id: string; nameRu: string; saves: Ability[]; skills: { count: number; from: string[] | 'any' }; features: Trait[];
  caster?: { ability: Ability; list: string; cantrips: number; spells: number | 'prepared' | 'spellbook' };
  subclass?: { nameRu: string; traits: Trait[]; ancestry?: true };
  fightingStyle?: true; expertise?: number; kits: Kit[];
};
export type Heroes = {
  races: Race[]; classes: HeroClass[];
  backgrounds: Array<{ id: string; nameRu: string; skills: string[] | null; gp: number; gearNames: string[]; traits: Trait[] }>;
  fightingStyles: Array<{ id: string; nameRu: string; text: string }>;
  ancestries: Array<{ id: string; nameRu: string; damage: string; breath: string }>;
  standardArray: number[]; pointBuy: { cost: Record<string, number>; budget: number }; explorerPack: string[];
};
export type Preview = {
  problems: string[];
  summary: { hpMax: number; armorClass: number; speed: number; hitDie: number; scores: Record<Ability, number>; mods: Record<Ability, number> } | null;
  skills: Array<{ skill_index: string; expertise: boolean }>;
  weapons: Array<{ name: string; damage: string | null; toHit: number | null }>;
  resources: Array<{ name: string; max: number }>;
  spells: string[];
  items: string[];
};
export type StepId = 'race' | 'class' | 'abilities' | 'skills' | 'kit' | 'spells' | 'summary';
