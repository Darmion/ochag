import type { GameIconName } from '../ui/gameIcons';

const ABILITY_ICONS: Readonly<Record<string, GameIconName>> = {
  strength: 'abilityStrength', dexterity: 'abilityDexterity', constitution: 'abilityConstitution',
  intelligence: 'abilityIntelligence', wisdom: 'abilityWisdom', charisma: 'abilityCharisma',
  str: 'abilityStrength', dex: 'abilityDexterity', con: 'abilityConstitution',
  int: 'abilityIntelligence', wis: 'abilityWisdom', cha: 'abilityCharisma',
};

const SKILL_ICONS: Readonly<Record<string, GameIconName>> = {
  acrobatics: 'skillAcrobatics', 'animal-handling': 'skillAnimalHandling', arcana: 'skillArcana', athletics: 'skillAthletics',
  deception: 'skillDeception', history: 'skillHistory', insight: 'skillInsight', intimidation: 'skillIntimidation',
  investigation: 'skillInvestigation', medicine: 'skillMedicine', nature: 'skillNature', perception: 'skillPerception',
  performance: 'skillPerformance', persuasion: 'skillPersuasion', religion: 'skillReligion', 'sleight-of-hand': 'skillSleightOfHand',
  stealth: 'skillStealth', survival: 'skillSurvival',
};

export const abilityIcon = (key: string): GameIconName | null => ABILITY_ICONS[key] ?? null;
export const skillIcon = (key: string): GameIconName | null => SKILL_ICONS[key] ?? null;
