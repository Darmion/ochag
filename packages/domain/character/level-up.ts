import { abilityModifier } from '../dice/dice.ts';
import {
  CLASS_IDS, CLASS_LABELS, SUBCLASSES, advanceClassText, characterClassLevels, characterClassText, hitDieForClass,
  multiclassPrerequisiteProblems, type ClassId,
} from './classes.ts';
import { FEATS, FEAT_ABILITIES } from './feats.ts';
import { pactMagic, spellSlotsFor } from '../spells/spell-slots.ts';
import { levelForExperience } from './experience.ts';
import { MULTICLASS_GAINS, multiclassGainText } from './multiclass-gains.ts';
import { FIGHTING_STYLES, SRD_CLASSES } from '../srd/heroes.ts';
import {
  ASI_LEVELS, CLASS_FEATURES, anyListSpellsAt, cantripsKnown, expertiseAt, fightingStyleAt, firstLevelSpells, newSpellsAt,
} from '../srd/progression.ts';

export type Ability = 'strength' | 'dexterity' | 'constitution' | 'intelligence' | 'wisdom' | 'charisma';
export const ABILITIES: Ability[] = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];

const SPELL_LIST: Partial<Record<ClassId, string>> = {
  bard: 'Bard', cleric: 'Cleric', druid: 'Druid', paladin: 'Paladin', ranger: 'Ranger', sorcerer: 'Sorcerer', warlock: 'Warlock', wizard: 'Wizard',
};
const SWAPS_SPELLS = new Set<ClassId>(['bard', 'ranger', 'sorcerer', 'warlock']);
const ABILITY_LABEL: Record<Ability, string> = {
  strength: 'Сила', dexterity: 'Ловкость', constitution: 'Телосложение', intelligence: 'Интеллект', wisdom: 'Мудрость', charisma: 'Харизма',
};

export type LevelUpCharacter = {
  level: number | null;
  experience: number;
  class_name?: string | null;
  sheet_extra?: any;
  hit_die?: number | null;
  constitution: number;
  strength?: number;
  dexterity?: number;
  intelligence?: number;
  wisdom?: number;
  charisma?: number;
};

export type LevelUpPlan = {
  from: number;
  to: number;
  ready: number;
  classId: ClassId | null;
  className: string | null;
  classLevel: number;
  newClass: boolean;
  multiclass: boolean;
  classText: string | null;
  prerequisites: string[];
  classOptions: Array<{ id: ClassId; label: string; level: number }>;
  classProblem: string | null;
  hitDie: number;
  averageHp: number;
  hpBonus: number;
  asi: boolean;
  cantrips: number;
  spells: number;
  anyList: boolean;
  spellList: string | null;
  maxSpellLevel: number;
  expertise: number;
  fightingStyles: string[] | null;
  features: string[];
  multiclassGain: { text: string; skills: { count: number; from: string[] | 'any' } | null } | null;
  subclass: { options: Array<{ value: string; label: string }>; current: string; srd: string; srdFeatures: string[] } | null;
  replaceSpell: boolean;
};

function hpBonusPerLevel(character: LevelUpCharacter, classId: ClassId | null): number {
  const builder = character.sheet_extra?.builder;
  return (builder?.subrace === 'hill' ? 1 : 0) + (builder?.class === 'sorcerer' && classId === 'sorcerer' ? 1 : 0);
}

export function maxSpellLevelAt(classId: ClassId | null, level: number): number {
  if (classId === 'warlock') return pactMagic(level).slotLevel;
  const slots = spellSlotsFor(classId, level) ?? [];
  let max = 0;
  slots.forEach((count, index) => { if (count > 0) max = index + 1; });
  return max;
}

export function levelUpPlan(character: LevelUpCharacter, force = false, classId?: ClassId | null): LevelUpPlan | null {
  const from = Math.max(1, character.level ?? 1);
  const ready = Math.max(from, levelForExperience(character.experience));
  if (from >= 20 || (!force && ready <= from)) return null;
  const to = from + 1;
  const parsed = characterClassLevels(character as any);
  const chosen = classId ?? parsed.classes[0]?.id ?? null;
  const own = parsed.classes.find(entry => entry.id === chosen);
  const classFrom = own?.level ?? (parsed.classes.length ? 0 : from);
  const classLevel = classFrom + 1;
  const newClass = Boolean(chosen) && !own && parsed.classes.length > 0;
  const multiclass = parsed.multiclass || newClass;
  const hitDie = !multiclass && character.hit_die && [6, 8, 10, 12].includes(character.hit_die) ? character.hit_die : hitDieForClass(chosen);
  const hpBonus = hpBonusPerLevel(character, chosen);
  const con = abilityModifier(character.constitution);
  const firstLevel = newClass && chosen ? SRD_CLASSES.find(entry => entry.id === chosen) : undefined;
  const scores = {
    strength: character.strength ?? 10, dexterity: character.dexterity ?? 10, constitution: character.constitution,
    intelligence: character.intelligence ?? 10, wisdom: character.wisdom ?? 10, charisma: character.charisma ?? 10,
  };
  return {
    from, to, ready: Math.max(ready, force ? to : ready), classId: chosen, className: chosen ? CLASS_LABELS[chosen] : null,
    classLevel, newClass, multiclass,
    classText: chosen ? advanceClassText(characterClassText(character as any), from, chosen) : null,
    prerequisites: chosen && newClass ? multiclassPrerequisiteProblems(parsed.classes, chosen, scores) : [],
    classOptions: CLASS_IDS.map(id => ({ id, label: CLASS_LABELS[id], level: parsed.classes.find(entry => entry.id === id)?.level ?? 0 })),
    classProblem: parsed.problem,
    hitDie, hpBonus,
    averageHp: Math.max(1, hitDie / 2 + 1 + con) + hpBonus,
    asi: chosen ? ASI_LEVELS[chosen].includes(classLevel) : [4, 8, 12, 16, 19].includes(to),
    cantrips: !chosen ? 0 : newClass ? cantripsKnown(chosen, 1) : Math.max(0, cantripsKnown(chosen, classLevel) - cantripsKnown(chosen, classFrom)),
    spells: !chosen ? 0 : newClass ? firstLevelSpells(chosen) : newSpellsAt(chosen, classLevel),
    anyList: chosen ? anyListSpellsAt(chosen, classLevel) : false,
    spellList: chosen ? SPELL_LIST[chosen] ?? null : null,
    maxSpellLevel: maxSpellLevelAt(chosen, classLevel),
    expertise: firstLevel ? firstLevel.expertise ?? 0 : chosen ? expertiseAt(chosen, classLevel) : 0,
    fightingStyles: firstLevel?.fightingStyle ? FIGHTING_STYLES.map(style => style.id) : chosen ? fightingStyleAt(chosen, classLevel) : null,
    features: levelFeatures(character, to, chosen, classLevel, firstLevel ? firstLevel.features.map(([title]) => title) : chosen ? CLASS_FEATURES[chosen][classLevel] ?? [] : []),
    multiclassGain: chosen && newClass ? { text: multiclassGainText(chosen), skills: MULTICLASS_GAINS[chosen].skills } : null,
    subclass: subclassChoice(character, to, chosen, classLevel, firstLevel ? firstLevel.features.map(([title]) => title) : chosen ? CLASS_FEATURES[chosen][classLevel] ?? [] : []),
    replaceSpell: Boolean(chosen && !newClass && classLevel >= 2 && SWAPS_SPELLS.has(chosen)),
  };
}

function subclassAfter(character: LevelUpCharacter, to: number, classId: ClassId): string | null {
  const rule = SUBCLASSES[classId];
  if (!rule) return null;
  const text = advanceClassText(characterClassText(character as any), to - 1, classId);
  return characterClassLevels({ ...character, level: to, class_name: text, sheet_extra: character.sheet_extra })
    .classes.find(entry => entry.id === classId)?.subclass ?? rule.default;
}

function isSubclassFeature(classId: ClassId, feature: string): boolean {
  const rule = SUBCLASSES[classId];
  const srd = rule?.list.find(item => item.id === rule.default);
  const at = feature.indexOf(': ');
  return Boolean(srd && at > 0 && srd.pattern.test(feature.slice(0, at)));
}

export function subclassFeatureNote(classId: ClassId, subclass: string, classLevel: number): string {
  const label = SUBCLASSES[classId]?.list.find(item => item.id === subclass)?.nameRu ?? 'подкласса';
  return `Умения подкласса «${label}» ${classLevel}-го уровня впишите в лист вручную`;
}

function levelFeatures(character: LevelUpCharacter, to: number, classId: ClassId | null, classLevel: number, features: string[]): string[] {
  const rule = classId ? SUBCLASSES[classId] : undefined;
  if (!classId || !rule || classLevel < rule.level) return features;
  if (classLevel === rule.level) return features.filter(feature => !isSubclassFeature(classId, feature));
  const subclass = subclassAfter(character, to, classId);
  if (!subclass || subclass === rule.default) return features;
  let noted = false;
  return features.flatMap(feature => {
    if (!isSubclassFeature(classId, feature)) return [feature];
    if (noted) return [];
    noted = true;
    return [subclassFeatureNote(classId, subclass, classLevel)];
  });
}

function subclassChoice(character: LevelUpCharacter, to: number, classId: ClassId | null, classLevel: number, features: string[]): LevelUpPlan['subclass'] {
  const rule = classId ? SUBCLASSES[classId] : undefined;
  if (!classId || !rule || classLevel !== rule.level) return null;
  return {
    options: rule.list.map(item => ({ value: item.id, label: item.nameRu })),
    current: subclassAfter(character, to, classId) ?? rule.default,
    srd: rule.default,
    srdFeatures: features.filter(feature => isSubclassFeature(classId, feature)),
  };
}

export type LevelUpChoice = {
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

export type LevelUpContext = {
  scores: Record<Ability, number>;
  proficientSkills: string[];
  expertiseSkills: string[];
  knownSpells: string[];
  spellBook: Array<{ index: string; level: number; classes: string[] }>;
  skillIndexes?: string[];
  knownFeats?: string[];
  swappableSpells?: string[];
};

export function featOf(choice: LevelUpChoice['asi']) {
  if (!choice || choice.kind !== 'feat' || !choice.id) return null;
  return FEATS.find(feat => feat.id === choice.id) ?? null;
}

export function levelUpProblems(plan: LevelUpPlan, choice: LevelUpChoice, context: LevelUpContext): string[] {
  const problems: string[] = [];
  if (choice.hp !== 'average' && choice.hp !== 'roll') problems.push('Хиты — средние или броском кости.');

  if (plan.asi) {
    const asi = choice.asi;
    if (!asi) problems.push('Выберите улучшение характеристик или черту.');
    else if (asi.kind === 'asi') {
      const entries = Object.entries(asi.increases ?? {}).filter(([, value]) => value);
      const total = entries.reduce((sum, [, value]) => sum + Number(value), 0);
      const valid = entries.every(([ability, value]) => ABILITIES.includes(ability as Ability) && (value === 1 || value === 2));
      if (!valid || total !== 2) problems.push('Улучшение: +2 к одной характеристике или +1 к двум.');
      for (const [ability, value] of entries) {
        if (ABILITIES.includes(ability as Ability) && context.scores[ability as Ability] + Number(value) > 20) problems.push('Характеристика не выше 20.');
      }
    } else if (asi.id !== undefined) {
      const feat = featOf(asi);
      const options = feat ? FEAT_ABILITIES[feat.id] : undefined;
      if (!feat) problems.push('Такой черты в списке нет.');
      else if (context.knownFeats?.includes(feat.id)) problems.push(`Черта «${feat.nameRu}» уже есть.`);
      else if (options && (!asi.increase || !options.includes(asi.increase))) {
        problems.push(`«${feat.nameRu}»: +1 — ${options.map(ability => ABILITY_LABEL[ability]).join(' или ')}.`);
      } else if (!options && asi.increase) problems.push(`«${feat.nameRu}» характеристику не повышает.`);
    } else if (!asi.name?.trim()) problems.push('Назовите черту.');
    if (asi?.kind === 'feat' && asi.increase) {
      if (!ABILITIES.includes(asi.increase)) problems.push('+1 — к одной из шести характеристик.');
      else if (context.scores[asi.increase] + 1 > 20) problems.push('Характеристика не выше 20.');
    }
  } else if (choice.asi) problems.push('Улучшение характеристик на этом уровне не положено.');

  if (plan.subclass) {
    if (!choice.subclass || !plan.subclass.options.some(option => option.value === choice.subclass)) problems.push('Выберите подкласс.');
  } else if (choice.subclass) problems.push('Подкласс на этом уровне не выбирают.');

  const known = new Set(context.knownSpells);
  const book = new Map(context.spellBook.map(spell => [spell.index, spell]));
  const cantrips = choice.cantrips ?? [];
  if (cantrips.length !== plan.cantrips || new Set(cantrips).size !== cantrips.length
    || cantrips.some(index => known.has(index) || book.get(index)?.level !== 0 || !(plan.spellList && book.get(index)!.classes.includes(plan.spellList)))) {
    problems.push(plan.cantrips ? `Новые заговоры: ${plan.cantrips} из списка класса, которых ещё нет.` : 'Новых заговоров на этом уровне нет.');
  }
  const spells = choice.spells ?? [];
  const goodSpell = (index: string) => {
    const spell = book.get(index);
    return Boolean(spell && spell.level >= 1 && spell.level <= plan.maxSpellLevel && !known.has(index)
      && (plan.anyList || (plan.spellList && spell.classes.includes(plan.spellList))));
  };
  if (spells.length !== plan.spells || new Set(spells).size !== spells.length || spells.some(index => !goodSpell(index))) {
    problems.push(plan.spells
      ? `Новые заклинания: ${plan.spells}, не выше ${plan.maxSpellLevel} уровня${plan.anyList ? ' (из списка любого класса)' : ' из списка класса'}, которых ещё нет.`
      : 'Новых заклинаний на этом уровне выбирать не нужно.');
  }

  if (choice.replace) {
    const { from, to } = choice.replace;
    const old = book.get(from);
    const next = book.get(to);
    if (!plan.replaceSpell) problems.push('Заменить заклинание на этом уровне нельзя.');
    else if (!old || old.level < 1 || !(context.swappableSpells ?? []).includes(from)) problems.push('Заменить можно известное заклинание (не заговор и не дарованное).');
    else if (!next || next.level < 1 || next.level > plan.maxSpellLevel || known.has(to) || spells.includes(to)
      || !(plan.spellList && next.classes.includes(plan.spellList))) {
      problems.push(`Замена: новое заклинание не выше ${plan.maxSpellLevel} уровня из списка класса, которого ещё нет.`);
    }
  }

  const expertise = choice.expertise ?? [];
  const proficient = new Set([...context.proficientSkills, ...(plan.multiclassGain?.skills ? choice.skills ?? [] : [])]);
  const already = new Set(context.expertiseSkills);
  if (expertise.length !== plan.expertise || new Set(expertise).size !== expertise.length || expertise.some(skill => !proficient.has(skill) || already.has(skill))) {
    problems.push(plan.expertise ? `Компетентность: ${plan.expertise} навыка, которыми владеете (ещё без компетентности).` : 'Компетентность на этом уровне не выбирают.');
  }

  if (plan.fightingStyles) {
    if (!choice.fightingStyle || !plan.fightingStyles.includes(choice.fightingStyle)) problems.push('Выберите боевой стиль.');
  } else if (choice.fightingStyle) problems.push('Боевой стиль на этом уровне не выбирают.');

  const wanted = plan.multiclassGain?.skills ?? null;
  const skills = choice.skills ?? [];
  if (wanted) {
    const allowed = (skill: string) => (wanted.from === 'any' ? !context.skillIndexes || context.skillIndexes.includes(skill) : wanted.from.includes(skill));
    if (skills.length !== wanted.count || new Set(skills).size !== skills.length || skills.some(skill => !allowed(skill) || context.proficientSkills.includes(skill))) {
      problems.push(`Навык нового класса: ${wanted.count}${wanted.from === 'any' ? ' любой' : ' из списка класса'}, которым ещё не владеете.`);
    }
  } else if (skills.length) problems.push('Навыков на этом уровне не выбирают.');
  return problems;
}

export function levelHp(plan: LevelUpPlan, constitution: number, roll: number | null): number {
  const con = abilityModifier(constitution);
  return roll === null ? plan.averageHp : Math.max(1, roll + con) + plan.hpBonus;
}

export function applyIncreases(scores: Record<Ability, number>, increases: Partial<Record<Ability, number>>): Record<Ability, number> {
  const next = { ...scores };
  for (const ability of ABILITIES) next[ability] = Math.min(20, next[ability] + Number(increases[ability] ?? 0));
  return next;
}
