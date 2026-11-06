import { abilityModifier, parseFormula, proficiencyBonusForChallenge } from '../dice/dice.ts';
import { challengeExperience } from '../character/experience.ts';
import { SRD_MONSTERS, type MonsterAbility, type MonsterAttack, type MonsterDamageType, type SrdMonster } from '../srd/monsters.ts';

export { SRD_MONSTERS, type SrdMonster, type MonsterAttack };

export const MONSTER_ABILITIES: MonsterAbility[] = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];

const SKILL_ABILITY: Record<string, MonsterAbility> = {
  acrobatics: 'dexterity', 'animal-handling': 'wisdom', arcana: 'intelligence', athletics: 'strength',
  deception: 'charisma', history: 'intelligence', insight: 'wisdom', intimidation: 'charisma',
  investigation: 'intelligence', medicine: 'wisdom', nature: 'intelligence', perception: 'wisdom',
  performance: 'charisma', persuasion: 'charisma', religion: 'intelligence', 'sleight-of-hand': 'dexterity',
  stealth: 'dexterity', survival: 'wisdom',
};

export const MONSTER_ATTRIBUTION =
  'This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC, '
  + 'available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the '
  + 'Creative Commons Attribution 4.0 International License (https://creativecommons.org/licenses/by/4.0/legalcode).';

export function findMonster(index: string): SrdMonster | undefined {
  return SRD_MONSTERS.find(monster => monster.index === index);
}

export function scoreOf(monster: SrdMonster, ability: MonsterAbility): number {
  return monster.abilities[MONSTER_ABILITIES.indexOf(ability)]!;
}

export function modifierOf(monster: SrdMonster, ability: MonsterAbility): number {
  return abilityModifier(scoreOf(monster, ability));
}

export function monsterProficiency(monster: SrdMonster): number {
  return proficiencyBonusForChallenge(monster.cr);
}

export function skillAbility(skill: string): MonsterAbility | undefined {
  return SKILL_ABILITY[skill];
}

export function challengeText(challenge: number): string {
  if (challenge === 0.125) return '1/8';
  if (challenge === 0.25) return '1/4';
  if (challenge === 0.5) return '1/2';
  return String(challenge);
}

export function averageOf(formula: string): number | null {
  const parsed = parseFormula(formula);
  if (!parsed) return null;
  return Math.floor(parsed.count * (parsed.sides + 1) / 2) + parsed.modifier;
}

export function rollHitPoints(hitDice: string, rollDie: (sides: number) => number): number {
  const parsed = parseFormula(hitDice);
  if (!parsed) return 1;
  let total = parsed.modifier;
  for (let i = 0; i < parsed.count; i += 1) total += rollDie(parsed.sides);
  return Math.max(1, total);
}

export function proficiencyLevel(base: number, total: number, proficiency: number): 'proficient' | 'expertise' | null {
  if (total === base + proficiency) return 'proficient';
  if (total === base + 2 * proficiency) return 'expertise';
  return null;
}

export function attackBonusOf(monster: SrdMonster, attack: MonsterAttack): number {
  return attack.toHit - modifierOf(monster, attack.ability) - monsterProficiency(monster);
}

const DAMAGE_PHRASE: Record<MonsterDamageType, string> = {
  acid: 'урона кислотой', bludgeoning: 'дробящего урона', cold: 'урона холодом', fire: 'урона огнём',
  force: 'урона силовым полем', lightning: 'урона электричеством', necrotic: 'некротического урона',
  piercing: 'колющего урона', poison: 'урона ядом', psychic: 'психического урона', radiant: 'урона излучением',
  slashing: 'рубящего урона', thunder: 'урона звуком',
};

const spaced = (formula: string) => formula.replace(/([+-])/g, ' $1 ');
const signed = (value: number) => (value >= 0 ? `+${value}` : String(value));

export function attackText(attack: MonsterAttack): string {
  const kind = attack.kind === 'ranged'
    ? 'Дальнобойная атака оружием'
    : attack.range ? 'Рукопашная или дальнобойная атака оружием' : 'Рукопашная атака оружием';
  const reach = attack.kind === 'ranged'
    ? `дистанция ${attack.range![0]}/${attack.range![1]} фт.`
    : `досягаемость ${attack.reach ?? 5} фт.${attack.range ? ` или дистанция ${attack.range[0]}/${attack.range[1]} фт.` : ''}`;
  let hit = '';
  if (attack.damage && attack.type) {
    hit = attack.damage === '1d1' ? `1 ${DAMAGE_PHRASE[attack.type]}` : `${attack.average} (${spaced(attack.damage)}) ${DAMAGE_PHRASE[attack.type]}`;
    if (attack.versatile) hit += `, или ${averageOf(attack.versatile)} (${spaced(attack.versatile)}) ${DAMAGE_PHRASE[attack.type]}, если двумя руками`;
    if (attack.extra) hit += ` плюс ${attack.extra.average} (${spaced(attack.extra.damage)}) ${DAMAGE_PHRASE[attack.extra.type]}`;
    hit += '.';
  }
  const tail = [hit, attack.note ?? ''].filter(Boolean).join(' ');
  return `${attack.name}. ${kind}: ${signed(attack.toHit)} к попаданию, ${reach}, одна цель.${tail ? ` Попадание: ${tail}` : ''}`;
}

const pairs = (list: Array<[string, string]> | undefined) => (list ?? []).map(([name, text]) => `${name}. ${text}`);

export function monsterTexts(monster: SrdMonster) {
  const senses = [
    monster.darkvision ? `тёмное зрение ${monster.darkvision} фт.` : '',
    monster.senses ?? '',
    `пассивное Восприятие ${monster.passive}`,
  ].filter(Boolean).join(', ');
  const about = [
    `${monster.type}, ${monster.alignment}.`,
    `КД ${monster.ac}${monster.acNote ? ` (${monster.acNote})` : ''}; хиты ${monster.hp} (${spaced(monster.hitDice)}); скорость ${monster.speed} фт.${monster.speedNote ? `, ${monster.speedNote}` : ''}.`,
    `Чувства: ${senses}.`,
    `Языки: ${monster.languages}.`,
    monster.conditionImmunities ? `Иммунитет к состояниям: ${monster.conditionImmunities}.` : '',
    `Опасность ${challengeText(monster.cr)} (${challengeExperience(monster.cr)} опыта), бонус мастерства ${signed(monsterProficiency(monster))}.`,
  ].filter(Boolean).join('\n');
  const traits = [...pairs(monster.traits), ...(monster.spellcasting ? [`Использование заклинаний. ${monster.spellcasting.text}`] : [])];
  const actions = [
    ...(monster.multiattack ? [`Мультиатака. ${monster.multiattack.text}`] : []),
    ...monster.attacks.map(attackText),
    ...pairs(monster.actions),
  ];
  return {
    about,
    traits: traits.join('\n\n'),
    actions: actions.join('\n\n'),
    reactions: pairs(monster.reactions).join('\n\n'),
  };
}

export function monsterSheet(monster: SrdMonster, hpMax: number) {
  const proficiency = monsterProficiency(monster);
  const texts = monsterTexts(monster);
  const text: Record<string, unknown> = {
    about: { name: 'Существо', value: texts.about },
    ...(texts.traits ? { features: { name: 'Умения', value: texts.traits } } : {}),
    actions: { name: 'Действия', value: texts.actions },
    ...(texts.reactions ? { reactions: { name: 'Реакции', value: texts.reactions } } : {}),
    source: { name: 'Источник', value: 'System Reference Document 5.1, Wizards of the Coast, CC-BY-4.0' },
  };

  const character = {
    name: monster.nameRu,
    kind: 'npc',
    disposition: 'hostile',
    size: monster.size,
    level: null,
    owner_user_id: null,
    shared: false,
    model_asset_id: null,
    image_asset_id: null,
    sheet_version: 1,
    strength: monster.abilities[0], dexterity: monster.abilities[1], constitution: monster.abilities[2],
    intelligence: monster.abilities[3], wisdom: monster.abilities[4], charisma: monster.abilities[5],
    hp_max: hpMax,
    armor_class: monster.ac,
    speed_feet: monster.speed,
    sheet_extra: {
      srdMonster: monster.index,
      hitDice: monster.hitDice,
      ...(monster.darkvision ? { darkvisionFeet: monster.darkvision } : {}),
      text,
    },
    damage_threshold: null,
    damage_resistances: monster.resistant ?? [],
    damage_immunities: monster.immune ?? [],
    damage_vulnerabilities: monster.vulnerable ?? [],
    spellcasting_ability: monster.spellcasting?.ability ?? null,
    hit_die: null,
    challenge_rating: monster.cr,
    xp_award: null,
    class_name: null,
    attacks_per_action: monster.multiattack?.count ?? null,
    cp: 0, sp: 0, ep: 0, gp: 0, pp: 0, price_cp: null, weight_lb: null, merchant: false,
  };

  const skills = Object.entries(monster.skills ?? {}).map(([skill, total]) => {
    const level = proficiencyLevel(modifierOf(monster, SKILL_ABILITY[skill]!), total, proficiency);
    return { skill_index: skill, proficient: level !== null, expertise: level === 'expertise' };
  });
  const saves = Object.keys(monster.saves ?? {}).map(ability => ({ ability, proficient: true, custom_bonus: 0 }));

  const weapons = monster.attacks.map(attack => ({
    name: attack.name,
    ability: attack.ability,
    proficient: true,
    damage_formula: attack.damage,
    damage_type: attack.type ?? null,
    range_feet: attack.kind === 'ranged' ? attack.range![0] : attack.reach ?? 5,
    weapon_kind: attack.kind,
    long_range_feet: attack.range ? attack.range[1] : null,
    thrown_range_feet: attack.kind === 'melee' && attack.range ? attack.range[0] : null,
    versatile_formula: attack.versatile ?? null,
    properties: [
      ...(attack.kind === 'melee' && attack.range ? ['thrown'] : []),
      ...(attack.versatile ? ['versatile'] : []),
      ...((attack.reach ?? 5) > 5 ? ['reach'] : []),
    ],
    srd_index: null,
    ammo_name: null,
    attack_bonus: attackBonusOf(monster, attack),
    extra_damage_formula: attack.extra?.damage ?? null,
    extra_damage_type: attack.extra?.type ?? null,
  }));

  const spells = (monster.spellcasting?.spells ?? []).map(index => ({ source: 'srd' as const, srd_index: index, custom_spell_id: null, prepared: true }));
  const spellSlots = (monster.spellcasting?.slots ?? []).map((max, index) => ({ level: index + 1, max }));

  return { character, skills, saves, weapons, spells, spellSlots };
}
