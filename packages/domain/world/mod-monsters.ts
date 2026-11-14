import { parseFormula } from '../dice/dice.ts';
import { averageHitPoints, averageOf, MONSTER_ABILITIES, monsterProficiency, skillAbility } from './bestiary.ts';
import type { MonsterAbility, MonsterAttack, MonsterDamageType, MonsterDefense, MonsterSize, SrdMonster } from '../srd/monsters.ts';

export const MOD_MONSTER_ID = /^mod_[a-z0-9_]{2,40}$/;
const SIZES: MonsterSize[] = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'];
const DAMAGE: MonsterDamageType[] = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'];
const CHALLENGES = [0, 0.125, 0.25, 0.5, ...Array.from({ length: 30 }, (_, index) => index + 1)];
const HIT_DICE = /^\d{1,3}d(4|6|8|10|12|20)([+-]\d{1,4})?$/;

// The words the conditions engine reads in «Иммунитет к состояниям».
const CONDITION_WORDS: Record<string, string> = {
  blinded: 'ослепление', charmed: 'очарование', deafened: 'глухота', frightened: 'испуг', grappled: 'захват',
  incapacitated: 'недееспособность', paralyzed: 'паралич', petrified: 'окаменение', poisoned: 'отравление', prone: 'сбит с ног',
  restrained: 'опутанность', stunned: 'ошеломление', unconscious: 'бессознательность', exhaustion: 'истощение',
};

const line = (value: unknown, limit: number) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, limit) : '');
const whole = (value: unknown, min: number, max: number) => Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
const isAbility = (value: unknown): value is MonsterAbility => typeof value === 'string' && (MONSTER_ABILITIES as string[]).includes(value);
const isDamage = (value: unknown): value is MonsterDamageType => typeof value === 'string' && (DAMAGE as string[]).includes(value);

function fail(who: string, what: string): never {
  throw new Error(`${who}: ${what}`);
}

function defenses(raw: unknown, who: string, key: string, nonmagical: boolean): MonsterDefense[] | undefined {
  if (raw === undefined) return undefined;
  const ok = (value: unknown) => isDamage(value) || (nonmagical && value === 'nonmagical');
  if (!Array.isArray(raw) || raw.length > 14 || !raw.every(ok)) fail(who, `${key} — виды урона${nonmagical ? ' или nonmagical' : ''}`);
  return raw.length ? [...new Set(raw as MonsterDefense[])] : undefined;
}

function textPairs(raw: unknown, who: string, key: string): Array<[string, string]> | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > 20) fail(who, `${key} — список до 20 записей { name, text }`);
  const list = raw.map((item, index) => {
    const entry = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const name = line(entry.name, 80);
    const text = line(entry.text, 1200);
    if (!name || !text) fail(who, `${key}[${index}] — нужны name и text`);
    return [name, text] as [string, string];
  });
  return list.length ? list : undefined;
}

function abilitiesOf(raw: unknown, who: string): SrdMonster['abilities'] {
  const values = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? MONSTER_ABILITIES.map(ability => (raw as Record<string, unknown>)[ability]) : null;
  if (!values || values.length !== 6 || !values.every(value => whole(value, 1, 30))) {
    fail(who, 'abilities — { strength, dexterity, constitution, intelligence, wisdom, charisma }, каждая от 1 до 30');
  }
  return values as SrdMonster['abilities'];
}

function attackOf(raw: unknown, index: number, who: string, monster: Pick<SrdMonster, 'abilities' | 'cr'>): MonsterAttack {
  const entry = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const at = `${who}, атака ${index + 1}`;
  const name = line(entry.name, 60);
  if (!name) fail(at, 'нужно name');
  const kind = entry.kind === undefined ? 'melee' : entry.kind;
  if (kind !== 'melee' && kind !== 'ranged') fail(at, 'kind — melee или ranged');
  const ability = entry.ability === undefined ? (kind === 'ranged' ? 'dexterity' : 'strength') : entry.ability;
  if (ability !== 'strength' && ability !== 'dexterity') fail(at, 'ability — strength или dexterity');
  const score = monster.abilities[MONSTER_ABILITIES.indexOf(ability)]!;
  const toHit = entry.toHit === undefined ? Math.floor((score - 10) / 2) + monsterProficiency(monster as SrdMonster) : entry.toHit;
  if (!whole(toHit, -5, 25)) fail(at, 'toHit — целое от −5 до 25');
  const attack: MonsterAttack = { name, kind, ability, toHit: toHit as number, damage: null };
  if (entry.reach !== undefined) {
    if (!whole(entry.reach, 5, 30) || (entry.reach as number) % 5) fail(at, 'reach — от 5 до 30 футов, кратно 5');
    attack.reach = entry.reach as number;
  }
  if (entry.range !== undefined) {
    const range = entry.range;
    if (!Array.isArray(range) || range.length !== 2 || !whole(range[0], 5, 600) || !whole(range[1], range[0], 1200)) fail(at, 'range — [обычная, дальняя] в футах');
    attack.range = [range[0], range[1]];
  }
  if (kind === 'ranged' && !attack.range) fail(at, 'у дальнобойной атаки нужна range');
  if (entry.damage !== undefined && entry.damage !== null) {
    if (typeof entry.damage !== 'string' || !parseFormula(entry.damage) || !isDamage(entry.type)) fail(at, 'damage — формула вроде 2d6+3 и type — вид урона');
    attack.damage = entry.damage;
    attack.average = averageOf(entry.damage) ?? 0;
    attack.type = entry.type;
  }
  if (entry.versatile !== undefined) {
    if (typeof entry.versatile !== 'string' || !parseFormula(entry.versatile) || !attack.damage) fail(at, 'versatile — формула урона двумя руками');
    attack.versatile = entry.versatile;
  }
  if (entry.extra !== undefined) {
    const extra = (entry.extra && typeof entry.extra === 'object' ? entry.extra : {}) as Record<string, unknown>;
    if (typeof extra.damage !== 'string' || !parseFormula(extra.damage) || !isDamage(extra.type) || !attack.damage) fail(at, 'extra — { damage, type }: дополнительный урон');
    attack.extra = { damage: extra.damage, average: averageOf(extra.damage) ?? 0, type: extra.type };
  }
  const note = line(entry.note, 300);
  if (note) attack.note = note;
  return attack;
}

export function normalizeModMonster(input: unknown, modName: string): SrdMonster {
  if (!input || typeof input !== 'object') throw new Error('нужен объект существа');
  const raw = input as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id : '';
  if (!MOD_MONSTER_ID.test(id)) throw new Error(`существо «${id}»: id — mod_ и строчные латинские буквы, цифры, «_»`);
  const nameRu = line(raw.name, 60);
  if (!nameRu) throw new Error(`существо «${id}»: нужно name`);
  const who = nameRu;
  const size = raw.size === undefined ? 'medium' : raw.size;
  if (!SIZES.includes(size as MonsterSize)) fail(who, `size — ${SIZES.join(', ')}`);
  const type = line(raw.type, 60);
  if (!type) fail(who, 'нужен type — тип существа («зверь», «нежить», «гуманоид (гоблин)»)');
  if (!CHALLENGES.includes(raw.cr as number)) fail(who, 'cr — опасность: 0, 0.125, 0.25, 0.5 или от 1 до 30');
  const cr = raw.cr as number;
  if (!whole(raw.ac, 1, 30)) fail(who, 'ac — класс доспеха от 1 до 30');
  if (typeof raw.hitDice !== 'string' || !HIT_DICE.test(raw.hitDice.trim())) fail(who, 'hitDice — кости хитов вроде 4d8+4');
  const hitDice = raw.hitDice.trim();
  const hp = raw.hp === undefined ? Math.max(1, averageHitPoints(hitDice) ?? 1) : raw.hp;
  if (!whole(hp, 1, 2000)) fail(who, 'hp — от 1 до 2000');
  const speed = raw.speed === undefined ? 30 : raw.speed;
  if (!whole(speed, 0, 120) || (speed as number) % 5) fail(who, 'speed — от 0 до 120 футов, кратно 5');
  const abilities = abilitiesOf(raw.abilities, who);
  const base = { abilities, cr };

  let saves: SrdMonster['saves'];
  if (raw.saves !== undefined) {
    const entries = raw.saves && typeof raw.saves === 'object' ? Object.entries(raw.saves) : null;
    if (!entries || !entries.every(([ability, value]) => isAbility(ability) && whole(value, -5, 30))) fail(who, 'saves — { wisdom: 5 }: итог спасброска');
    if (entries.length) saves = Object.fromEntries(entries) as SrdMonster['saves'];
  }
  let skills: SrdMonster['skills'];
  if (raw.skills !== undefined) {
    const entries = raw.skills && typeof raw.skills === 'object' ? Object.entries(raw.skills) : null;
    if (!entries || !entries.every(([skill, value]) => skillAbility(skill) && whole(value, -5, 30))) fail(who, 'skills — { perception: 4 }: навыки SRD и итог проверки');
    if (entries.length) skills = Object.fromEntries(entries) as Record<string, number>;
  }
  let conditionImmunities: string | undefined;
  if (raw.conditionImmunities !== undefined) {
    const list = raw.conditionImmunities;
    if (!Array.isArray(list) || !list.every(code => typeof code === 'string' && CONDITION_WORDS[code])) {
      fail(who, `conditionImmunities — коды состояний: ${Object.keys(CONDITION_WORDS).join(', ')}`);
    }
    if (list.length) conditionImmunities = [...new Set(list as string[])].map(code => CONDITION_WORDS[code]).join(', ');
  }
  const darkvision = raw.darkvision === undefined || raw.darkvision === 0 ? undefined : raw.darkvision;
  if (darkvision !== undefined && (!whole(darkvision, 5, 240) || (darkvision as number) % 5)) fail(who, 'darkvision — от 5 до 240 футов, кратно 5');
  const wisdom = Math.floor((abilities[4] - 10) / 2);
  const passive = raw.passive === undefined ? 10 + (skills?.perception ?? wisdom) : raw.passive;
  if (!whole(passive, 1, 40)) fail(who, 'passive — пассивное Восприятие от 1 до 40');

  if (raw.attacks !== undefined && (!Array.isArray(raw.attacks) || raw.attacks.length > 8)) fail(who, 'attacks — список до 8 атак');
  const attacks = ((raw.attacks as unknown[] | undefined) ?? []).map((entry, index) => attackOf(entry, index, who, base));

  let multiattack: SrdMonster['multiattack'];
  if (raw.multiattack !== undefined) {
    const entry = (raw.multiattack && typeof raw.multiattack === 'object' ? raw.multiattack : {}) as Record<string, unknown>;
    const text = line(entry.text, 400);
    if (!whole(entry.count, 2, 10) || !/^Совершает(?![а-яё])/.test(text)) fail(who, 'multiattack — { count, text }: текст начинается со «Совершает…», варианты — с «Или…»');
    multiattack = { count: entry.count as number, text };
  }

  let legendary: SrdMonster['legendary'];
  if (raw.legendary !== undefined) {
    const entry = (raw.legendary && typeof raw.legendary === 'object' ? raw.legendary : {}) as Record<string, unknown>;
    const options = Array.isArray(entry.options) ? entry.options : [];
    if (!whole(entry.actions, 1, 5) || (entry.resistances !== undefined && !whole(entry.resistances, 0, 5)) || !options.length || options.length > 8) {
      fail(who, 'legendary — { actions: 1–5, resistances: 0–5, options: [{ name, cost, text }] }');
    }
    legendary = {
      actions: entry.actions as number,
      ...(entry.resistances ? { resistances: entry.resistances as number } : {}),
      options: options.map((option, index) => {
        const item = (option && typeof option === 'object' ? option : {}) as Record<string, unknown>;
        const name = line(item.name, 80);
        const text = line(item.text, 600);
        const cost = item.cost === undefined ? 1 : item.cost;
        if (!name || !text || !whole(cost, 1, 3)) fail(who, `legendary.options[${index}] — name, text и cost от 1 до 3`);
        return { name, cost: cost as number, text };
      }),
    };
  }

  let spellcasting: SrdMonster['spellcasting'];
  if (raw.spellcasting !== undefined) {
    const entry = (raw.spellcasting && typeof raw.spellcasting === 'object' ? raw.spellcasting : {}) as Record<string, unknown>;
    const slots = entry.slots === undefined ? [] : entry.slots;
    const spells = entry.spells;
    const slotless = entry.slotless === undefined ? [] : entry.slotless;
    const index = (value: unknown) => typeof value === 'string' && /^[a-z0-9-]{2,60}$/.test(value);
    if (!isAbility(entry.ability) || !Array.isArray(slots) || slots.length > 9 || !slots.every(value => whole(value, 0, 4))
      || !Array.isArray(spells) || !spells.length || spells.length > 40 || !spells.every(index)
      || !Array.isArray(slotless) || !slotless.every(value => (spells as unknown[]).includes(value))) {
      fail(who, 'spellcasting — { ability, slots: [ячейки по кругам], spells: [индексы SRD], slotless?: [без ячеек], text }');
    }
    spellcasting = {
      ability: entry.ability, slots: slots as number[], spells: [...new Set(spells as string[])],
      ...((slotless as string[]).length ? { slotless: slotless as string[] } : {}),
      text: line(entry.text, 1200) || 'Накладывает заклинания.',
    };
  }

  const monster: SrdMonster = {
    index: id, name: line(raw.en, 60) || nameRu, nameRu, size: size as MonsterSize, type,
    alignment: line(raw.alignment, 60) || 'без мировоззрения',
    ac: raw.ac as number, hp: hp as number, hitDice, speed: speed as number,
    abilities, passive: passive as number, languages: line(raw.languages, 200) || '—', cr, attacks, modName,
  };
  const optional: Partial<SrdMonster> = {
    acNote: line(raw.acNote, 80) || undefined, speedNote: line(raw.speedNote, 120) || undefined,
    saves, skills, conditionImmunities, darkvision: darkvision as number | undefined, senses: line(raw.senses, 120) || undefined,
    vulnerable: defenses(raw.vulnerable, who, 'vulnerable', false) as MonsterDamageType[] | undefined,
    resistant: defenses(raw.resistant, who, 'resistant', true), immune: defenses(raw.immune, who, 'immune', true),
    defenseNote: line(raw.defenseNote, 300) || undefined, multiattack,
    traits: textPairs(raw.traits, who, 'traits'), actions: textPairs(raw.actions, who, 'actions'), reactions: textPairs(raw.reactions, who, 'reactions'),
    legendary, spellcasting,
  };
  for (const [key, value] of Object.entries(optional)) if (value !== undefined) (monster as Record<string, unknown>)[key] = value;
  return monster;
}
