import { abilityModifier } from '../dice/dice.ts';
import { CLASS_LABELS, hitDieForClass, type ClassId } from './classes.ts';
import { spellSlotsFor } from '../spells/spell-slots.ts';
import { SRD_WEAPONS, srdWeaponFields } from '../srd/weapons.ts';
import {
  ARMOR, DRAGON_ANCESTRIES, EXPLORER_PACK, FIGHTING_STYLES, POINT_BUY_BUDGET, POINT_BUY_COST, SRD_BACKGROUNDS, SRD_CLASSES, SRD_RACES,
  STANDARD_ARRAY, type HeroAbility,
} from '../srd/heroes.ts';

export const HERO_ABILITIES: HeroAbility[] = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
export const HERO_SKILLS = [
  'acrobatics', 'animal-handling', 'arcana', 'athletics', 'deception', 'history', 'insight', 'intimidation', 'investigation',
  'medicine', 'nature', 'perception', 'performance', 'persuasion', 'religion', 'sleight-of-hand', 'stealth', 'survival',
];

export type BuildInput = {
  name: string;
  race: string;
  subrace?: string | null;
  raceName?: string | null;
  ancestry?: string | null;
  flexible?: HeroAbility[];
  className: string;
  method: 'free' | 'standard' | 'pointbuy' | 'roll';
  abilities: Record<HeroAbility, number>;
  rolled?: number[];
  background: string;
  classSkills: string[];
  backgroundSkills?: string[];
  raceSkills?: string[];
  expertise?: string[];
  fightingStyle?: string | null;
  kit: string;
  cantrips?: string[];
  spells?: string[];
  raceCantrip?: string | null;
};

export type SpellInfo = { index: string; level: number; classes: string[] };

type BuiltWeapon = {
  name: string; ability: string; proficient: boolean; damage_formula: string | null; damage_type: string | null; range_feet: number;
  weapon_kind: string; long_range_feet: number | null; thrown_range_feet: number | null; versatile_formula: string | null;
  properties: string[]; srd_index: string | null; ammo_name: string | null; attack_bonus: number;
  extra_damage_formula: string | null; extra_damage_type: string | null;
};

const SAVE_LABEL: Record<HeroAbility, string> = {
  strength: 'Сила', dexterity: 'Ловкость', constitution: 'Телосложение', intelligence: 'Интеллект', wisdom: 'Мудрость', charisma: 'Харизма',
};

export function pointBuyCost(scores: number[]): number | null {
  let total = 0;
  for (const score of scores) {
    const cost = POINT_BUY_COST[score];
    if (cost === undefined) return null;
    total += cost;
  }
  return total;
}

export function abilityFromDice(dice: number[]): number {
  return [...dice].sort((a, b) => b - a).slice(0, 3).reduce((sum, value) => sum + value, 0);
}

const sameMultiset = (a: number[], b: number[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

export function buildCharacter(input: BuildInput, spellList: SpellInfo[]) {
  const problems: string[] = [];
  const race = SRD_RACES.find(entry => entry.id === input.race);
  const heroClass = SRD_CLASSES.find(entry => entry.id === input.className);
  const background = SRD_BACKGROUNDS.find(entry => entry.id === input.background);
  if (!input.name.trim()) problems.push('Нужно имя.');
  if (!race) problems.push('Выберите расу.');
  if (!heroClass) problems.push('Выберите класс.');
  if (!background) problems.push('Выберите предысторию.');
  if (!race || !heroClass || !background) return { problems };

  const subrace = race.subraces.find(entry => entry.id === input.subrace) ?? null;
  if (race.subraces.length && !subrace) problems.push(`Выберите подрасу: ${race.subraces.map(entry => entry.nameRu).join(', ')}.`);

  const base = HERO_ABILITIES.map(ability => input.abilities[ability]);
  if (base.some(value => !Number.isInteger(value))) problems.push('Характеристики — целые числа.');
  if (input.method === 'standard' && !sameMultiset(base, STANDARD_ARRAY)) problems.push('Стандартный набор — 15, 14, 13, 12, 10, 8, каждое по разу.');
  if (input.method === 'pointbuy') {
    const cost = pointBuyCost(base);
    if (cost === null) problems.push('Покупка очков: каждая характеристика от 8 до 15.');
    else if (cost > POINT_BUY_BUDGET) problems.push(`Покупка очков: потрачено ${cost} из ${POINT_BUY_BUDGET}.`);
  }
  if (input.method === 'roll' && !(input.rolled && sameMultiset(base, input.rolled))) problems.push('Характеристики должны быть теми, что выпали на костях.');
  if (input.method === 'free' && base.some(value => value < 1 || value > 20)) problems.push('Свободно: каждая характеристика от 1 до 20 (до расовых бонусов).');

  const flexible = input.flexible ?? [];
  if (race.custom && (flexible.length !== 2 || flexible[0] === flexible[1] || flexible.some(ability => !HERO_ABILITIES.includes(ability)))) {
    problems.push('Своя раса: выберите характеристику для +2 и другую — для +1.');
  }
  if (race.flexibleBonuses) {
    if (flexible.length !== race.flexibleBonuses || new Set(flexible).size !== flexible.length || flexible.includes('charisma') || flexible.some(ability => !HERO_ABILITIES.includes(ability))) {
      problems.push(`Выберите ${race.flexibleBonuses} разные характеристики для +1 (кроме Харизмы).`);
    }
  }
  const scores = {} as Record<HeroAbility, number>;
  for (const [index, ability] of HERO_ABILITIES.entries()) {
    const custom = race.custom ? (flexible[0] === ability ? 2 : flexible[1] === ability ? 1 : 0) : 0;
    const bonus = (race.bonuses[ability] ?? 0) + (subrace?.bonuses[ability] ?? 0) + (race.flexibleBonuses && flexible.includes(ability) ? 1 : 0) + custom;
    scores[ability] = Math.min(20, (base[index] ?? 10) + bonus);
  }
  const mods = Object.fromEntries(HERO_ABILITIES.map(ability => [ability, abilityModifier(scores[ability])])) as Record<HeroAbility, number>;

  const needsAncestry = race.ancestry || heroClass.subclass?.ancestry;
  const ancestry = DRAGON_ANCESTRIES.find(entry => entry.id === input.ancestry) ?? null;
  if (needsAncestry && !ancestry) problems.push('Выберите дракона-предка.');

  const granted = new Set<string>([...(race.skills ?? []), ...(background.skills ?? [])]);
  const classPool = heroClass.skills.from === 'any' ? HERO_SKILLS : heroClass.skills.from;
  const chosen = [...input.classSkills, ...(input.backgroundSkills ?? []), ...(input.raceSkills ?? [])];
  if (input.classSkills.length !== heroClass.skills.count || input.classSkills.some(skill => !classPool.includes(skill))) {
    problems.push(`Навыки класса: выберите ${heroClass.skills.count} из списка класса.`);
  }
  const backgroundCount = background.skills ? 0 : 2;
  if ((input.backgroundSkills ?? []).length !== backgroundCount || (input.backgroundSkills ?? []).some(skill => !HERO_SKILLS.includes(skill))) {
    if (backgroundCount) problems.push('Своя предыстория: выберите два навыка.');
    else if ((input.backgroundSkills ?? []).length) problems.push('Навыки этой предыстории заданы.');
  }
  const raceCount = race.skillChoices ?? 0;
  if ((input.raceSkills ?? []).length !== raceCount || (input.raceSkills ?? []).some(skill => !HERO_SKILLS.includes(skill))) {
    problems.push(raceCount ? `${race.nameRu}: выберите ${raceCount} навыка.` : 'Раса не даёт навыков на выбор.');
  }
  if (new Set(chosen).size !== chosen.length || chosen.some(skill => granted.has(skill))) {
    problems.push('Навык не выбирают дважды: уже данный расой или предысторией замените другим.');
  }
  const proficientSkills = new Set([...granted, ...chosen]);
  const expertise = input.expertise ?? [];
  if ((heroClass.expertise ?? 0) !== expertise.length || expertise.some(skill => !proficientSkills.has(skill)) || new Set(expertise).size !== expertise.length) {
    if (heroClass.expertise) problems.push(`Компетентность: ${heroClass.expertise} навыка из тех, которыми владеете.`);
    else if (expertise.length) problems.push('Компетентность у этого класса на 1-м уровне не выбирают.');
  }

  const style = FIGHTING_STYLES.find(entry => entry.id === input.fightingStyle) ?? null;
  if (heroClass.fightingStyle && !style) problems.push('Выберите боевой стиль.');

  const kit = heroClass.kits.find(entry => entry.id === input.kit);
  if (!kit) problems.push('Выберите набор снаряжения.');
  const armorGroups = new Set([...heroClass.armor, ...(heroClass.subclass?.heavyArmor ? ['heavy' as const] : [])]);
  const armor = kit?.armor ? ARMOR[kit.armor] : undefined;
  if (armor && !armorGroups.has(armor.group)) problems.push('Этим доспехом класс не владеет.');
  if (kit?.shield && !armorGroups.has('shield')) problems.push('Щитом класс не владеет.');

  const caster = heroClass.caster;
  const listName = caster?.list;
  const byIndex = new Map(spellList.map(spell => [spell.index, spell]));
  const ofList = (index: string, level: number, list = listName) => {
    const spell = byIndex.get(index);
    return Boolean(spell && list && spell.level === level && spell.classes.includes(list));
  };
  const cantrips = input.cantrips ?? [];
  const spells = input.spells ?? [];
  const preparedLimit = caster ? Math.max(1, mods[caster.ability] + 1) : 0;
  const spellCount = !caster ? 0 : caster.spells === 'prepared' ? preparedLimit : caster.spells === 'spellbook' ? 6 : caster.spells;
  if ((caster?.cantrips ?? 0) !== cantrips.length || cantrips.some(index => !ofList(index, 0)) || new Set(cantrips).size !== cantrips.length) {
    if (caster) problems.push(`Заговоры: ${caster.cantrips} разных из списка класса.`);
    else if (cantrips.length) problems.push('Этот класс не знает заговоров на 1-м уровне.');
  }
  if (spellCount !== spells.length || spells.some(index => !ofList(index, 1)) || new Set(spells).size !== spells.length) {
    if (caster) problems.push(`Заклинания 1-го круга: ${spellCount} разных из списка класса${caster.spells === 'prepared' ? ` (подготовлено: модификатор ${SAVE_LABEL[caster.ability]} + 1)` : ''}.`);
    else if (spells.length) problems.push('Этот класс не знает заклинаний на 1-м уровне.');
  }
  if (subrace?.wizardCantrip) {
    if (!input.raceCantrip || !ofList(input.raceCantrip, 0, 'Wizard')) problems.push('Высший эльф: выберите заговор волшебника.');
  }
  const classId = heroClass.id as ClassId;
  const hitDie = hitDieForClass(classId);
  const hpMax = Math.max(1, hitDie + mods.constitution + (subrace?.hpPerLevel ?? 0) + (heroClass.subclass?.hpPerLevel ?? 0));
  const shield = kit?.shield ? 2 : 0;
  let armorClass: number;
  if (armor) {
    const dex = armor.dexCap === null ? mods.dexterity : armor.dexCap === 0 ? 0 : Math.min(mods.dexterity, armor.dexCap);
    armorClass = armor.base + dex + shield + (style?.id === 'defense' ? 1 : 0);
  } else if (heroClass.subclass?.unarmoredBase) {
    armorClass = heroClass.subclass.unarmoredBase + mods.dexterity + shield;
  } else if (heroClass.unarmored) {
    armorClass = 10 + mods.dexterity + mods[heroClass.unarmored] + shield;
  } else {
    armorClass = 10 + mods.dexterity + shield;
  }
  if (problems.length) return { problems, summary: { hpMax, armorClass, scores, mods, speed: race.speed, hitDie } };

  const raceWeapons = new Set([...(race.weapons ?? []), ...(subrace?.weapons ?? [])]);
  const monkWeapon = (index: string) => classId === 'monk' && (index === 'shortsword' || SRD_WEAPONS.some(w => w.index === index && w.category === 'simple' && w.kind === 'melee' && !w.properties.includes('two-handed') && !w.properties.includes('heavy')));
  const weapons: BuiltWeapon[] = kit!.weapons.map(index => {
    const srd = SRD_WEAPONS.find(weapon => weapon.index === index)!;
    const fields = srdWeaponFields(srd);
    const proficient = heroClass.weapons.groups.includes(srd.category) || (heroClass.weapons.extra ?? []).includes(index) || raceWeapons.has(index);
    const dueling = style?.id === 'dueling' && srd.kind === 'melee' && !srd.properties.includes('two-handed');
    return {
      name: fields.name,
      ability: monkWeapon(index) ? 'finesse' : fields.ability,
      proficient,
      damage_formula: fields.damageFormula && dueling ? `${fields.damageFormula}+2` : fields.damageFormula,
      damage_type: fields.damageType,
      range_feet: fields.rangeFeet,
      weapon_kind: fields.weaponKind,
      long_range_feet: fields.longRangeFeet,
      thrown_range_feet: fields.thrownRangeFeet,
      versatile_formula: fields.versatileFormula,
      properties: [...fields.properties],
      srd_index: index,
      ammo_name: srd.properties.includes('ammunition') && kit!.ammo ? kit!.ammo.name : null,
      attack_bonus: style?.id === 'archery' && srd.kind === 'ranged' ? 2 : 0,
      extra_damage_formula: null,
      extra_damage_type: null,
    };
  });
  if (classId === 'monk') {
    weapons.push({
      name: 'Безоружный удар', ability: 'finesse', proficient: true, damage_formula: '1d4+@mod', damage_type: 'bludgeoning', range_feet: 5,
      weapon_kind: 'melee', long_range_feet: null, thrown_range_feet: null, versatile_formula: null, properties: [], srd_index: null,
      ammo_name: null, attack_bonus: 0, extra_damage_formula: null, extra_damage_type: null,
    });
  }

  const resources = [
    ...heroClass.resources.map(resource => ({ name: resource.name, max: resource.max(mods), recharge: resource.recharge })),
    ...(race.id === 'dragonborn' ? [{ name: 'Оружие дыхания', max: 1, recharge: 'short' as const }] : []),
    ...(race.id === 'half-orc' ? [{ name: 'Неумолимая стойкость', max: 1, recharge: 'long' as const }] : []),
    ...(kit!.ammo ? [{ name: kit!.ammo.name, max: kit!.ammo.count, recharge: 'none' as const }] : []),
  ];

  const always = heroClass.subclass?.alwaysPrepared ?? [];
  const spellRows = [
    ...cantrips.map(index => ({ index, prepared: true })),
    ...spells.map((index, position) => ({ index, prepared: caster?.spells !== 'spellbook' || position < preparedLimit })),
    ...always.filter(index => !spells.includes(index)).map(index => ({ index, prepared: true })),
    ...(race.racialCantrip && !cantrips.includes(race.racialCantrip.index) ? [{ index: race.racialCantrip.index, prepared: true }] : []),
    ...(input.raceCantrip && subrace?.wizardCantrip && !cantrips.includes(input.raceCantrip) ? [{ index: input.raceCantrip, prepared: true }] : []),
  ];
  const slots = spellSlotsFor(classId, 1) ?? [];
  const spellcastingAbility = caster?.ability ?? race.racialCantrip?.ability ?? (subrace?.wizardCantrip ? 'intelligence' : null);

  const resistances = [...new Set([...(race.resistances ?? []), ...(race.ancestry && ancestry ? [ancestry.damage] : [])])];
  const ancestryText = ancestry ? `${ancestry.nameRu} дракон: ${ancestry.breath}, спасбросок ${SAVE_LABEL[ancestry.save]}.` : '';
  const features = [
    ...race.traits, ...(subrace?.traits ?? []),
    ...heroClass.features, ...(heroClass.subclass?.traits ?? []),
    ...(style ? [[`Боевой стиль: ${style.nameRu}`, style.text] as [string, string]] : []),
    ...background.traits,
  ].map(([title, text]) => `${title}. ${text}`);
  if (ancestryText) features.push(`Дракон-предок. ${ancestryText}`);

  const armorNames = [...armorGroups].map(group => ({ light: 'лёгкие', medium: 'средние', heavy: 'тяжёлые', shield: 'щиты' })[group]);
  const proficiencies = [
    `Языки: ${race.languages}${subrace?.extraLanguage ? ', ещё один' : ''}${background.languages ? `, ещё ${background.languages === 1 ? 'один' : 'два'} (${background.nameRu.toLowerCase()})` : ''}${heroClass.subclass?.ancestry ? ', Драконий' : ''}.`,
    `Доспехи: ${armorNames.length ? armorNames.join(', ') : 'нет'}.`,
    ...(background.tools ? [`Инструменты: ${background.tools}.`] : []),
    `Спасброски: ${heroClass.saves.map(ability => SAVE_LABEL[ability]).join(', ')}.`,
  ].join('\n');

  const items = [
    ...EXPLORER_PACK, ...kit!.gear, ...background.gear,
    ...(kit!.armor ? [kit!.armor] : []), ...(kit!.shield ? ['shield'] : []), ...(kit!.ammo ? [kit!.ammo.gear] : []),
  ];

  const character = {
    name: input.name.trim(),
    kind: 'character',
    disposition: null,
    size: race.size,
    level: 1,
    shared: false,
    model_asset_id: null,
    image_asset_id: null,
    sheet_version: 1,
    ...scores,
    hp_max: hpMax,
    armor_class: armorClass,
    speed_feet: race.speed,
    sheet_extra: {
      ...(race.darkvision ? { darkvisionFeet: race.darkvision } : {}),
      builder: {
        race: race.id, subrace: subrace?.id ?? null, class: classId, background: background.id, method: input.method,
        ...(race.custom ? { raceName: input.raceName?.trim().slice(0, 40) || race.nameRu } : {}),
        ancestry: ancestry?.id ?? null, fightingStyle: style?.id ?? null, kit: kit!.id,
      },
      text: {
        features: { name: 'Умения и особенности', value: features.join('\n\n') },
        prof: { name: 'Владения и языки', value: proficiencies },
      },
    },
    damage_threshold: null,
    damage_resistances: resistances,
    damage_immunities: [],
    damage_vulnerabilities: [],
    spellcasting_ability: spellcastingAbility,
    hit_die: hitDie,
    challenge_rating: null,
    xp_award: null,
    class_name: CLASS_LABELS[classId],
    attacks_per_action: null,
    cp: 0, sp: 0, ep: 0, gp: background.gp, pp: 0, price_cp: null, weight_lb: null, merchant: false,
  };

  return {
    problems,
    sheet: {
      character,
      skills: [...proficientSkills].map(skill => ({ skill_index: skill, proficient: true, expertise: expertise.includes(skill) })),
      saves: heroClass.saves.map(ability => ({ ability, proficient: true, custom_bonus: 0 })),
      weapons,
      resources,
      spells: spellRows.map(row => ({ source: 'srd' as const, srd_index: row.index, custom_spell_id: null, prepared: row.prepared })),
      spellSlots: slots.flatMap((max, index) => (max > 0 ? [{ level: index + 1, max }] : [])),
    },
    items,
    summary: { hpMax, armorClass, scores, mods, speed: race.speed, hitDie },
  };
}
