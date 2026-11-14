import { abilityModifier } from '../dice/dice.ts';
import {
  CLASS_IDS, CLASS_LABELS, SUBCLASSES, advanceClassText, characterClassLevels, characterClassText, hitDieForClass,
  multiclassPrerequisiteProblems, type ClassId,
} from './classes.ts';
import { featAbilities, featCatalog, knownFightingStyles } from './feats.ts';
import { heroRace } from './races.ts';
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
  const race = heroRace(builder?.race);
  const subrace = race?.subraces.find(entry => entry.id === builder?.subrace);
  return (race?.hpPerLevel ?? 0) + (subrace?.hpPerLevel ?? 0) + (builder?.class === 'sorcerer' && classId === 'sorcerer' ? 1 : 0);
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
    fightingStyles: firstLevel?.fightingStyle ? FIGHTING_STYLES.map(style => style.id) : chosen ? fightingStyleAt(chosen, classLevel) ?? championStyles(character, to, chosen, classLevel) : null,
    features: levelFeatures(character, to, chosen, classLevel, firstLevel ? firstLevel.features.map(([title]) => title) : chosen ? CLASS_FEATURES[chosen][classLevel] ?? [] : []),
    multiclassGain: chosen && newClass ? { text: multiclassGainText(chosen), skills: MULTICLASS_GAINS[chosen].skills } : null,
    subclass: subclassChoice(character, to, chosen, classLevel, firstLevel ? firstLevel.features.map(([title]) => title) : chosen ? CLASS_FEATURES[chosen][classLevel] ?? [] : []),
    replaceSpell: Boolean(chosen && !newClass && classLevel >= 2 && SWAPS_SPELLS.has(chosen)),
  };
}

// The Champion's additional fighting style at fighter 10: any style the hero does not have yet.
function championStyles(character: LevelUpCharacter, to: number, classId: ClassId, classLevel: number): string[] | null {
  if (classId !== 'fighter' || classLevel !== 10 || subclassAfter(character, to, classId) !== 'champion') return null;
  const known = knownFightingStyles(character.sheet_extra).ids;
  const left = FIGHTING_STYLES.map(style => style.id).filter(id => !known.includes(id));
  return left.length ? left : null;
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
  return featCatalog().find(feat => feat.id === choice.id) ?? null;
}

export function levelReady(character: { level: number | null; experience: number }): boolean {
  const level = Math.max(1, character.level ?? 1);
  return level < 20 && levelForExperience(character.experience) > level;
}

function choiceChecks(plan: LevelUpPlan, choice: LevelUpChoice, context: LevelUpContext) {
  const known = new Set(context.knownSpells);
  const book = new Map(context.spellBook.map(spell => [spell.index, spell]));
  const wanted = plan.multiclassGain?.skills ?? null;
  const proficient = new Set([...context.proficientSkills, ...(wanted ? choice.skills ?? [] : [])]);
  const already = new Set(context.expertiseSkills);
  return {
    cantrip: (index: string) => {
      const spell = book.get(index);
      return Boolean(spell && spell.level === 0 && !known.has(index) && plan.spellList && spell.classes.includes(plan.spellList));
    },
    spell: (index: string) => {
      const spell = book.get(index);
      return Boolean(spell && spell.level >= 1 && spell.level <= plan.maxSpellLevel && !known.has(index)
        && (plan.anyList || (plan.spellList && spell.classes.includes(plan.spellList))));
    },
    expertise: (skill: string) => proficient.has(skill) && !already.has(skill),
    skill: (skill: string) => Boolean(wanted) && !context.proficientSkills.includes(skill)
      && (wanted!.from === 'any' ? !context.skillIndexes || context.skillIndexes.includes(skill) : wanted!.from.includes(skill)),
  };
}

const badList = (list: string[], count: number, good: (item: string) => boolean) =>
  list.length !== count || new Set(list).size !== list.length || list.some(item => !good(item));

export function levelUpProblems(plan: LevelUpPlan, choice: LevelUpChoice, context: LevelUpContext): string[] {
  const check = choiceChecks(plan, choice, context);
  const problems: string[] = [];
  if (choice.hp !== 'average' && choice.hp !== 'roll') problems.push('Хиты — средние или броском кости.');
  problems.push(...asiProblems(plan, choice.asi ?? null, context), ...subclassProblems(plan, choice.subclass ?? null));

  if (badList(choice.cantrips ?? [], plan.cantrips, check.cantrip)) {
    problems.push(plan.cantrips ? `Новые заговоры: ${plan.cantrips} из списка класса, которых ещё нет.` : 'Новых заговоров на этом уровне нет.');
  }
  if (badList(choice.spells ?? [], plan.spells, check.spell)) {
    problems.push(plan.spells
      ? `Новые заклинания: ${plan.spells}, не выше ${plan.maxSpellLevel} уровня${plan.anyList ? ' (из списка любого класса)' : ' из списка класса'}, которых ещё нет.`
      : 'Новых заклинаний на этом уровне выбирать не нужно.');
  }
  problems.push(...replaceProblems(plan, choice, context));
  if (badList(choice.expertise ?? [], plan.expertise, check.expertise)) {
    problems.push(plan.expertise ? `Компетентность: ${plan.expertise} навыка, которыми владеете (ещё без компетентности).` : 'Компетентность на этом уровне не выбирают.');
  }
  problems.push(...styleProblems(plan, choice.fightingStyle ?? null));

  const wanted = plan.multiclassGain?.skills ?? null;
  const skills = choice.skills ?? [];
  if (wanted) {
    if (badList(skills, wanted.count, check.skill)) {
      problems.push(`Навык нового класса: ${wanted.count}${wanted.from === 'any' ? ' любой' : ' из списка класса'}, которым ещё не владеете.`);
    }
  } else if (skills.length) problems.push('Навыков на этом уровне не выбирают.');
  return problems;
}

// A dry run previews what is already chosen correctly: unfinished or wrong parts are left out instead of refusing the preview.
export function usableLevelUpChoice(plan: LevelUpPlan, choice: LevelUpChoice, context: LevelUpContext): LevelUpChoice {
  const pick = (list: string[] | undefined, count: number, good: (item: string) => boolean) => [...new Set(list ?? [])].filter(good).slice(0, count);
  const check = choiceChecks(plan, choice, context);
  const usable: LevelUpChoice = {
    hp: choice.hp === 'roll' ? 'roll' : 'average',
    asi: plan.asi && choice.asi && !asiProblems(plan, choice.asi, context).length ? choice.asi : null,
    subclass: plan.subclass && !subclassProblems(plan, choice.subclass ?? null).length ? choice.subclass ?? null : null,
    cantrips: pick(choice.cantrips, plan.cantrips, check.cantrip),
    spells: pick(choice.spells, plan.spells, check.spell),
    skills: pick(choice.skills, plan.multiclassGain?.skills?.count ?? 0, check.skill),
    fightingStyle: plan.fightingStyles && !styleProblems(plan, choice.fightingStyle ?? null).length ? choice.fightingStyle ?? null : null,
  };
  usable.expertise = pick(choice.expertise, plan.expertise, choiceChecks(plan, usable, context).expertise);
  usable.replace = choice.replace && !replaceProblems(plan, { ...usable, replace: choice.replace }, context).length ? choice.replace : null;
  return usable;
}

function subclassProblems(plan: LevelUpPlan, subclass: string | null): string[] {
  if (plan.subclass) return !subclass || !plan.subclass.options.some(option => option.value === subclass) ? ['Выберите подкласс.'] : [];
  return subclass ? ['Подкласс на этом уровне не выбирают.'] : [];
}

function styleProblems(plan: LevelUpPlan, style: string | null): string[] {
  if (plan.fightingStyles) return !style || !plan.fightingStyles.includes(style) ? ['Выберите боевой стиль.'] : [];
  return style ? ['Боевой стиль на этом уровне не выбирают.'] : [];
}

function replaceProblems(plan: LevelUpPlan, choice: LevelUpChoice, context: LevelUpContext): string[] {
  if (!choice.replace) return [];
  const known = new Set(context.knownSpells);
  const book = new Map(context.spellBook.map(spell => [spell.index, spell]));
  const { from, to } = choice.replace;
  const old = book.get(from);
  const next = book.get(to);
  if (!plan.replaceSpell) return ['Заменить заклинание на этом уровне нельзя.'];
  if (!old || old.level < 1 || !(context.swappableSpells ?? []).includes(from)) return ['Заменить можно известное заклинание (не заговор и не дарованное).'];
  if (!next || next.level < 1 || next.level > plan.maxSpellLevel || known.has(to) || (choice.spells ?? []).includes(to)
    || !(plan.spellList && next.classes.includes(plan.spellList))) {
    return [`Замена: новое заклинание не выше ${plan.maxSpellLevel} уровня из списка класса, которого ещё нет.`];
  }
  return [];
}

function asiProblems(plan: LevelUpPlan, asi: LevelUpChoice['asi'] | null, context: LevelUpContext): string[] {
  const problems: string[] = [];
  if (plan.asi) {
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
      const options = feat ? featAbilities(feat.id) : undefined;
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
  } else if (asi) problems.push('Улучшение характеристик на этом уровне не положено.');
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
