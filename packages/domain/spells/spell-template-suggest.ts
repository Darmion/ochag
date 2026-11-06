import { spellArea } from '../map/area-placement.ts';
import { deriveSpellMechanics } from './spell-mechanics.ts';
import { hitPointPool, projectileRule, spellCylinderFeet, spellRiders, targetLimit, type ExpiresAt, type SpellRider } from './spell-riders.ts';
import {
  AREA_SHAPES, CASTING_TIMES, DAMAGE_TYPES, DURATION_KINDS, RANGE_KINDS, describeAction, describeEffect, emptyAction, emptyEffect,
  newId, optionLabel, PURPOSES, type Action, type Effect, type Outcome, type Scaling, type Suggestion,
} from './spell-template.ts';

export type SuggestInput = {
  description: string;
  higherLevel?: string | null;
  level?: number;
  castingTime?: string | null;
  range?: string | null;
  duration?: string | null;
  components?: string[] | string | null;
  material?: string | null;
  concentration?: boolean;
  ritual?: boolean;
};

const flat = (value: string | null | undefined) => String(value ?? '').replace(/\s+/g, ' ').trim();
const cyrillic = (value: string) => (value.match(/[а-яё]/gi) ?? []).length > (value.match(/[a-z]/gi) ?? []).length;
const formula = (value: string) => value.replace(/\s+/g, '').replace(/[кd]/gi, 'к');

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  один: 1, одно: 1, одного: 1, одну: 1, два: 2, две: 2, двух: 2, три: 3, трёх: 3, трех: 3, четыре: 4, четырёх: 4, четырех: 4,
  пять: 5, пяти: 5, шесть: 6, шести: 6, семь: 7, восемь: 8, десять: 10,
};
const wordNumber = (word: string) => NUMBER_WORDS[word.toLowerCase()] ?? Number(word);

const ORDINALS: Readonly<Record<string, number>> = {
  первого: 1, второго: 2, третьего: 3, четвёртого: 4, четвертого: 4, пятого: 5, шестого: 6, седьмого: 7, восьмого: 8,
  '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5, '6th': 6, '7th': 7, '8th': 8,
};

const RU_ABILITY: Readonly<Record<string, string>> = {
  силы: 'strength', ловкости: 'dexterity', телосложения: 'constitution', интеллекта: 'intelligence', мудрости: 'wisdom', харизмы: 'charisma',
};

const RU_DAMAGE: ReadonlyArray<readonly [RegExp, string]> = [
  [/^кислот/, 'acid'], [/^дробящ/, 'bludgeoning'], [/^холод/, 'cold'], [/^огн/, 'fire'], [/^силов/, 'force'], [/^электрич|^молни/, 'lightning'],
  [/^некрот/, 'necrotic'], [/^колющ/, 'piercing'], [/^яд/, 'poison'], [/^психич/, 'psychic'], [/^излучен|^светом/, 'radiant'], [/^рубящ/, 'slashing'],
  [/^звук|^громов/, 'thunder'],
];

const RU_CONDITIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/ослепл[её]н/, 'blinded'], [/очарован/, 'charmed'], [/оглох/, 'deafened'], [/испуган/, 'frightened'], [/схвачен/, 'grappled'],
  [/недееспособ/, 'incapacitated'], [/парализован/, 'paralyzed'], [/окамен/, 'petrified'], [/отравлен/, 'poisoned'],
  [/сбит\S* с ног|падает ничком|опрокинут/, 'prone'], [/опутан/, 'restrained'], [/ошеломл[её]н/, 'stunned'], [/без сознания|теряет сознание/, 'unconscious'],
];

const EXPIRES: Readonly<Record<ExpiresAt, string>> = {
  'caster-start': 'caster-next-start', 'caster-end': 'caster-next-end', 'target-start': 'target-next-start', 'target-end': 'target-next-end',
};

function effect(kind: Effect['kind'], values: Record<string, unknown>): Effect {
  const made = emptyEffect(kind);
  Object.assign(made.values, values);
  return made;
}

export function riderEffects(rider: SpellRider): Effect[] {
  switch (rider.kind) {
    case 'slowed': return [effect('speed', { mode: 'minus', feet: rider.feet, lasts: EXPIRES[rider.expires] })];
    case 'no_reactions': return [effect('restrict', { what: ['no-reactions'], lasts: EXPIRES[rider.expires] })];
    case 'no_healing': return [effect('restrict', { what: ['no-healing'], lasts: EXPIRES[rider.expires] })];
    case 'guided': return [effect('attack-rolls', { whose: 'against', mode: 'advantage', scope: 'first', once: true, lasts: EXPIRES[rider.expires] })];
    case 'mocked': return [effect('attack-rolls', { whose: 'own', mode: 'disadvantage', scope: 'first', once: true, lasts: EXPIRES[rider.expires] })];
    case 'blessed': return [effect('attack-rolls', { whose: 'own', mode: 'die', die: String(rider.die) }), effect('checks', { roll: 'save', ability: 'all', mode: 'die', die: String(rider.die) })];
    case 'baned': return [effect('attack-rolls', { whose: 'own', mode: 'minus-die', die: String(rider.die) }), effect('checks', { roll: 'save', ability: 'all', mode: 'minus-die', die: String(rider.die) })];
    case 'marked': return [effect('extra-damage', { on: 'weapon', against: 'target', formula: formula(rider.dice), damageType: 'weapon' })];
    case 'outlined': return [effect('attack-rolls', { whose: 'against', mode: 'advantage', scope: 'all' })];
    case 'push': return [effect('move', { mode: 'push', feet: rider.feet, from: 'caster' })];
    case 'temp_hp': return [effect('temp-hp', { formula: formula(rider.dice) })];
    case 'heroism': return [effect('preset', { preset: 'heroism' })];
    case 'ac_bonus': return [effect('ac', { mode: 'plus', value: rider.bonus })];
    case 'sanctuary': return [effect('preset', { preset: 'sanctuary' })];
    case 'aid': return [effect('max-hp', { formula: String(rider.bonus) })];
    case 'mage_armor': return [effect('ac', { mode: 'base', value: rider.base })];
    case 'dispel': return [effect('remove', { what: 'spells', upTo: rider.upTo })];
    case 'restore': return [effect('remove', { what: 'one-condition', conditions: rider.conditions })];
    case 'protected_from_evil': return [effect('preset', { preset: 'protection-from-evil' })];
    case 'flying': return [effect('speed', { mode: 'fly', feet: rider.feet })];
    case 'light': return [effect('senses', { sense: 'light', feet: rider.bright, dimFeet: rider.dim })];
    case 'darkness': return [effect('preset', { preset: 'darkness' })];
    case 'dispel_darkness': return [effect('preset', { preset: 'daylight' })];
    case 'hasted': return [effect('preset', { preset: 'haste' })];
    case 'slow_spell': return [effect('preset', { preset: 'slow' })];
    case 'stupor': return [effect('preset', { preset: 'stupor' })];
  }
}

type Found = { suggestions: Suggestion[] };

function push(found: Found, path: string, label: string, value: unknown, display: string, phrase: string, confidence: Suggestion['confidence'] = 'sure') {
  found.suggestions.push({ id: newId('g'), path, label, value, display, phrase, confidence });
}

function damageTypeRu(words: string): string | null {
  for (const [pattern, type] of RU_DAMAGE) if (pattern.test(words.toLowerCase())) return type;
  return null;
}

function metaSuggestions(found: Found, input: SuggestInput) {
  const time = flat(input.castingTime).toLowerCase();
  if (time) {
    const value = /bonus/.test(time) ? 'bonus' : /reaction/.test(time) ? 'reaction' : /^1 action/.test(time) ? 'action'
      : /^1 minute/.test(time) ? '1m' : /^10 minutes/.test(time) ? '10m' : /^1 hour/.test(time) ? '1h' : /^8 hours/.test(time) ? '8h'
      : /^12 hours/.test(time) ? '12h' : /^24 hours/.test(time) ? '24h' : null;
    if (value) push(found, 'casting.time', 'Время сотворения', value, optionLabel(CASTING_TIMES, value), input.castingTime!);
  }
  const range = flat(input.range);
  if (range) {
    const feet = /^(\d+) feet/i.exec(range);
    const miles = /^(\d+) miles?/i.exec(range);
    const kind = /^self/i.test(range) ? 'self' : /^touch/i.test(range) ? 'touch' : feet ? 'feet' : miles ? 'miles' : /^sight/i.test(range) ? 'sight' : /^unlimited/i.test(range) ? 'unlimited' : 'special';
    push(found, 'casting.range', 'Дистанция', kind, optionLabel(RANGE_KINDS, kind), range);
    if (feet || miles) push(found, 'casting.rangeValue', 'Дистанция, число', Number((feet ?? miles)![1]), `${(feet ?? miles)![1]}`, range);
  }
  const duration = flat(input.duration);
  if (duration) {
    const span = /(\d+) (round|minute|hour|day)s?/i.exec(duration);
    const kind = /^instantaneous/i.test(duration) ? 'instant' : /until dispelled/i.test(duration) ? 'until-dispelled' : span
      ? ({ round: 'rounds', minute: 'minutes', hour: 'hours', day: 'days' } as Record<string, string>)[span[2]!.toLowerCase()]! : 'special';
    push(found, 'duration.kind', 'Длительность', kind, optionLabel(DURATION_KINDS, kind), duration);
    if (span) push(found, 'duration.value', 'Длительность, число', Number(span[1]), span[1]!, duration);
  }
  if (input.concentration !== undefined) push(found, 'duration.concentration', 'Концентрация', input.concentration, input.concentration ? 'да' : 'нет', duration || 'concentration');
  if (input.ritual !== undefined) push(found, 'casting.ritual', 'Ритуал', input.ritual, input.ritual ? 'да' : 'нет', 'ritual');
  if (input.components) {
    const list = (Array.isArray(input.components) ? input.components : String(input.components).split(/[\s,]+/)).map(entry => entry.trim().toUpperCase()).filter(Boolean);
    push(found, 'casting.verbal', 'Компонент В', list.includes('V'), list.includes('V') ? 'да' : 'нет', list.join(', '));
    push(found, 'casting.somatic', 'Компонент С', list.includes('S'), list.includes('S') ? 'да' : 'нет', list.join(', '));
    push(found, 'casting.material', 'Компонент М', list.includes('M'), list.includes('M') ? 'да' : 'нет', list.join(', '));
  }
  if (input.material) {
    push(found, 'casting.materialText', 'Материал', input.material, input.material, input.material);
    const cost = /worth at least ([\d,]+) gp/i.exec(input.material);
    if (cost) push(found, 'casting.materialCost', 'Цена материала, зм', Number(cost[1]!.replace(/,/g, '')), cost[1]!, cost[0]);
    if (/consumes?/i.test(input.material)) push(found, 'casting.materialConsumed', 'Материал расходуется', true, 'да', input.material);
  }
}

type Parsed = {
  attack: { range: 'melee' | 'ranged'; phrase: string } | null;
  save: { ability: string; phrase: string } | null;
  damage: { formula: string; type: string; phrase: string } | null;
  half: string | null;
  heal: { formula: string; phrase: string; notUndead: boolean } | null;
  condition: { code: string; phrase: string } | null;
  repeat: { when: 'start' | 'end'; phrase: string } | null;
  area: { shape: string; size: number; width: number; height: number; fromSelf: boolean; phrase: string } | null;
  zone: string | null;
  projectiles: { count: number; phrase: string } | null;
  upTo: { count: number; phrase: string } | null;
  humanoid: string | null;
  riders: Array<{ rider: SpellRider; phrase: string }>;
  direct: Array<{ effect: Effect; phrase: string }>;
  scaling: Array<{ what: Scaling['what']; amount: string; from: number; per: Scaling['per']; phrase: string }>;
  pool: { formula: string; phrase: string } | null;
};

function parseEnglish(text: string, higher: string, input: SuggestInput): Parsed {
  const spell = { level: input.level ?? 1, duration: input.duration ?? '', desc: text, higherLevel: higher, range: input.range ?? '' };
  const m = deriveSpellMechanics(spell);
  const phrase = (pattern: RegExp, source = text) => pattern.exec(source)?.[0] ?? '';
  const area = spellArea(text, input.range ?? '');
  const height = spellCylinderFeet(text);
  const projectiles = projectileRule(spell);
  const limit = targetLimit(spell, spell.level);
  const pool = hitPointPool(spell);
  const scaling: Parsed['scaling'] = [];
  const upcast = /increases by (\d+d\d+) for each slot level above (\d)/i.exec(higher);
  if (upcast && m.damageFormula) scaling.push({ what: 'damage', amount: formula(upcast[1]!), from: Number(upcast[2]), per: 'slot', phrase: upcast[0] });
  else if (upcast && m.healingFormula) scaling.push({ what: 'healing', amount: formula(upcast[1]!), from: Number(upcast[2]), per: 'slot', phrase: upcast[0] });
  const cantrip = /damage increases by (\d+d\d+) when you reach 5th level/i.exec(text);
  if (cantrip) scaling.push({ what: 'damage', amount: formula(cantrip[1]!), from: 0, per: 'cantrip', phrase: cantrip[0] });
  if (projectiles?.perSlotFrom) scaling.push({ what: 'projectiles', amount: '1', from: projectiles.perSlotFrom, per: 'slot', phrase: phrase(/one (?:additional|more) (?:ray|dart|beam) for each slot level above \d/i, higher) });
  const moreTargets = /one additional (?:creature|target|humanoid|beast|undead|[a-z]+) for each slot level above (\d)/i.exec(higher);
  if (moreTargets) scaling.push({ what: 'targets', amount: '1', from: Number(moreTargets[1]), per: 'slot', phrase: moreTargets[0] });
  if (pool?.perSlot) scaling.push({ what: 'threshold', amount: formula(pool.perSlot), from: spell.level, per: 'slot', phrase: phrase(/roll an additional \d+d\d+ for each slot level above/i, higher) });
  return {
    attack: m.attack ? { range: m.attack, phrase: phrase(/make an? (?:ranged|melee) spell attack/i) } : null,
    save: m.save ? { ability: m.save, phrase: phrase(/(?:make|succeed on|fail)\w* (?:an? )?\w+ saving throws?/i) } : null,
    damage: m.damageFormula && m.damageType ? { formula: formula(m.damageFormula), type: m.damageType, phrase: phrase(/\d+d\d+(?:\s*\+\s*\d+)?\s+\w+\s+damage/i) } : null,
    half: m.halfOnSave ? phrase(/half as much damage[^.]*/i) : null,
    heal: m.healingFormula ? { formula: formula(m.healingFormula) + (m.healingAddsModifier ? ' + @mod' : ''), phrase: phrase(/regains? [^.]*hit points[^.]*/i), notUndead: /no effect on undead or constructs/i.test(text) } : null,
    condition: m.condition ? { code: m.condition, phrase: phrase(new RegExp(`[^.]*\\b${m.condition}\\b[^.]*`, 'i')) } : null,
    repeat: m.repeatSave ? { when: m.repeatSave, phrase: phrase(/at the end of each of its turns[^.]*/i) } : null,
    area: area ? {
      shape: area.shape === 'circle' ? (height ? 'cylinder' : 'sphere') : area.shape === 'square' ? 'cube' : area.shape,
      size: area.sizeFeet, width: area.widthFeet ?? 5, height: height ?? 0, fromSelf: area.fromSelf,
      phrase: phrase(/\d+-foot[- ](?:radius|cone|cube|line)[^,.;]*|line \d+ feet long and \d+ feet wide/i),
    } : null,
    zone: phrase(/enters the (?:spell's )?area for the first time on a turn or starts its turn there/i) || null,
    projectiles: projectiles && projectiles.base > 1 ? { count: projectiles.base, phrase: phrase(/create (?:one|two|three|four|five|six|\d+) [^.]*?(?:rays?|darts?|beams?)/i) } : null,
    upTo: limit ? { count: limit, phrase: phrase(/up to (?:one|two|three|four|five|six|\d+) creatures/i) } : null,
    humanoid: phrase(/\bhumanoid\b[^.]*/i) && /^[^.]*\bhumanoid\b/i.test(text) ? phrase(/^[^.]*\bhumanoid\b[^.]*/i) : null,
    riders: spellRiders(text).map(rider => ({ rider, phrase: '' })),
    direct: /speed increases by (\d+) feet/i.test(text)
      ? [{ effect: effect('speed', { mode: 'plus', feet: Number(/speed increases by (\d+) feet/i.exec(text)![1]) }), phrase: phrase(/[^.]*speed increases by \d+ feet[^.]*/i) }]
      : [],
    scaling,
    pool: pool ? { formula: formula(pool.dice), phrase: phrase(/Roll \d+d\d+; the total is how many hit points/i) } : null,
  };
}

function parseRussian(text: string, higher: string): Parsed {
  const scan = (pattern: RegExp, source = text) => pattern.exec(source);
  const attack = scan(/(рукопашн|дальнобойн)\S*\s+атак\S*\s+заклинанием/i);
  const save = scan(/(?:соверш|пройти|пройд|преуспе|провал)\S*\s+(?:в\s+)?(?:успешн\S*\s+)?спасброс\S*\s+(силы|ловкости|телосложения|интеллекта|мудрости|харизмы)/i);
  const damage = scan(/(\d+\s*[dк]\s*\d+(?:\s*\+\s*\d+)?)\s+урона\s+([а-яё]+(?:\s+[а-яё]+)?)/i);
  const damageType = damage ? damageTypeRu(damage[2]!) : null;
  const heal = scan(/восстанавлива\S*[^.]*?хит\S*,?\s*равн\S*\s+(\d+\s*[dк]\s*\d+)(\s*\+\s*(?:ваш\S*\s+)?модификатор[^.,]*)?/i)
    ?? scan(/восстанавлива\S*\s+(\d+\s*[dк]\s*\d+)(\s*\+\s*(?:ваш\S*\s+)?модификатор[^.,]*)?\s+хит/i)
    ?? scan(/восстанавлива\S*\s+хит\S*\s+в количестве\s+(\d+\s*[dк]\s*\d+)(\s*\+\s*(?:ваш\S*\s+)?модификатор[^.,]*)?/i);
  let condition: Parsed['condition'] = null;
  const failing = scan(/(?:иначе|при провале|провалив)[^.]*/i);
  for (const [pattern, code] of RU_CONDITIONS) {
    const where = failing && pattern.test(failing[0].toLowerCase()) ? failing[0] : null;
    if (where) { condition = { code, phrase: where }; break; }
  }
  if (!condition) {
    for (const [pattern, code] of RU_CONDITIONS) {
      const sentence = scan(new RegExp(`[^.]*(?:становится|станет|будет|окажется)\\s+${pattern.source}[^.]*`, 'i'));
      if (sentence) { condition = { code, phrase: sentence[0] }; break; }
    }
  }
  const repeatEnd = scan(/в конце каждого своего хода[^.]*повторн\S*[^.]*спасброс[^.]*/i);
  const repeatStart = scan(/в начале каждого своего хода[^.]*повторн\S*[^.]*спасброс[^.]*/i);
  let area: Parsed['area'] = null;
  const cylinder = scan(/цилиндр\S*\s+радиусом\s+(\d+)\s+фут\S*\s+и\s+высотой\s+(\d+)\s+фут/i);
  const line = scan(/лини\S*\s+длиной\s+(\d+)\s+фут\S*\s+и\s+шириной\s+(\d+)\s+фут/i);
  const cone = scan(/конус\S*\s+(?:длиной\s+)?(\d+)\s+фут/i) ?? scan(/(\d+)-футов\S*\s+конус/i);
  const cube = scan(/куб\S*\s+(?:с\s+длиной\s+ребра\s+|со\s+стороной\s+|с\s+ребром\s+)?(\d+)\s+фут/i) ?? scan(/(\d+)-футов\S*\s+куб/i);
  const sphere = scan(/(?:сфер\S*|радиус\S*|шар\S*)\s+(?:с\s+)?(?:радиусом\s+)?(\d+)\s+фут/i) ?? scan(/в пределах (\d+) фут\S* от (?:выбранной|этой) точки/i);
  const fromSelf = /^[^.]*(?:из вас|от вас|исходит из вас)/i.test(text);
  if (cylinder) area = { shape: 'cylinder', size: Number(cylinder[1]), width: 5, height: Number(cylinder[2]), fromSelf: false, phrase: cylinder[0] };
  else if (line) area = { shape: 'line', size: Number(line[1]), width: Number(line[2]), height: 0, fromSelf: true, phrase: line[0] };
  else if (cone) area = { shape: 'cone', size: Number(cone[1]), width: 5, height: 0, fromSelf: true, phrase: cone[0] };
  else if (cube) area = { shape: 'cube', size: Number(cube[1]), width: 5, height: 0, fromSelf, phrase: cube[0] };
  else if (sphere) area = { shape: 'sphere', size: Number(sphere[1]), width: 5, height: 0, fromSelf, phrase: sphere[0] };
  const projectiles = scan(/(?:создаёте|создаете|выпускаете|создаёт|создает)\s+(один|два|три|четыре|пять|шесть|\d+)\s+(?:\S+\s+){0,3}?(лучей|луча|луч|дротиков|дротика|дротик|снарядов|снаряда|снаряд)/i);
  const upTo = scan(/до\s+(одного|двух|трёх|трех|четырёх|четырех|пяти|шести|\d+)\s+(?:существ|целей|гуманоидов)/i);
  const riders: Parsed['riders'] = [];
  const direct: Parsed['direct'] = [];
  const slowed = scan(/скорость[^.]*(?:уменьшается|снижается)\s+на\s+(\d+)\s+фут[^.]*/i);
  if (slowed) riders.push({ rider: { kind: 'slowed', feet: Number(slowed[1]), expires: /начала вашего следующего хода/i.test(slowed[0]) ? 'caster-start' : 'caster-end' }, phrase: slowed[0] });
  const noReactions = scan(/не может (?:совершать|использовать) реакци[^.]*/i);
  if (noReactions) riders.push({ rider: { kind: 'no_reactions', expires: 'target-start' }, phrase: noReactions[0] });
  const pushAway = scan(/(?:отталкива|оттолкн|отбрасыва)\S*[^.]*?на\s+(\d+)\s+фут/i);
  if (pushAway) riders.push({ rider: { kind: 'push', feet: Number(pushAway[1]) }, phrase: pushAway[0] });
  const tempHp = scan(/получа\S*\s+(\d+\s*[dк]\s*\d+(?:\s*\+\s*\d+)?|\d+)\s+временн\S*\s+хит/i);
  if (tempHp) riders.push({ rider: { kind: 'temp_hp', dice: tempHp[1]!, perSlot: 0 }, phrase: tempHp[0] });
  const armor = scan(/КД[^.]*?(?:становится|равен|равным)\S*\s+(?:равен\s+)?(\d+)\s*\+\s*(?:е[её]\s+|его\s+)?модификатор\S*\s+Ловкости/i);
  if (armor) riders.push({ rider: { kind: 'mage_armor', base: Number(armor[1]) }, phrase: armor[0] });
  const acBonus = scan(/бонус\s*\+\s*(\d+)\s*к\s*КД/i);
  if (acBonus) riders.push({ rider: { kind: 'ac_bonus', bonus: Number(acBonus[1]) }, phrase: acBonus[0] });
  const aid = scan(/максимум хитов[^.]*?увеличива\S*\s+на\s+(\d+)/i);
  if (aid) riders.push({ rider: { kind: 'aid', bonus: Number(aid[1]) }, phrase: aid[0] });
  const mark = scan(/дополнительно\s+(\d+\s*[dк]\s*\d+)\s+урона[^.]*?попада\S*[^.]*?атак\S*\s+оружием/i);
  if (mark) riders.push({ rider: { kind: 'marked', dice: mark[1]! }, phrase: mark[0] });
  const bless = scan(/прибавить к результату броска\s+(?:\d*)\s*[dк](\d+)/i);
  if (bless) riders.push({ rider: { kind: 'blessed', die: Number(bless[1]) }, phrase: bless[0] });
  const bane = scan(/бросить\s+[dк](\d+)\s+и\s+вычесть/i);
  if (bane) riders.push({ rider: { kind: 'baned', die: Number(bane[1]) }, phrase: bane[0] });
  const heroism = scan(/невосприимчив\S*\s+к\s+испугу[^.]*временные хиты[^.]*/i);
  if (heroism) riders.push({ rider: { kind: 'heroism' }, phrase: heroism[0] });
  const faster = scan(/скорость[^.]*?увеличивается\s+на\s+(\d+)\s+фут/i);
  if (faster) direct.push({ effect: effect('speed', { mode: 'plus', feet: Number(faster[1]) }), phrase: faster[0] });
  const fly = scan(/скорость\s+пол[её]та\s+(\d+)\s+фут/i);
  if (fly) riders.push({ rider: { kind: 'flying', feet: Number(fly[1]) }, phrase: fly[0] });
  const light = scan(/яркий свет в радиусе (\d+) фут\S*[^.]*?тусклый свет[^.]*?(\d+) фут/i);
  if (light) riders.push({ rider: { kind: 'light', bright: Number(light[1]), dim: Number(light[2]), replaces: false }, phrase: light[0] });
  const scaling: Parsed['scaling'] = [];
  const ordinal = (word: string) => ORDINALS[word.toLowerCase()] ?? (/^\d(?:-?(?:го|ого|й))?$/i.test(word) ? Number(word[0]) : Number.NaN);
  const above = String.raw`за каждый (?:уровень|круг)(?:\s+ячейки)?\s+выше\s+(\S+?)[.,\s]`;
  const upDamage = scan(new RegExp(String.raw`урон увеличивается на (\d+\s*[dк]\s*\d+) ${above}`, 'i'), `${higher} `);
  if (upDamage && Number.isFinite(ordinal(upDamage[2]!))) scaling.push({ what: 'damage', amount: formula(upDamage[1]!), from: ordinal(upDamage[2]!), per: 'slot', phrase: upDamage[0] });
  const upHeal = scan(new RegExp(String.raw`лечение увеличивается на (\d+\s*[dк]\s*\d+) ${above}`, 'i'), `${higher} `);
  if (upHeal && Number.isFinite(ordinal(upHeal[2]!))) scaling.push({ what: 'healing', amount: formula(upHeal[1]!), from: ordinal(upHeal[2]!), per: 'slot', phrase: upHeal[0] });
  const upShots = scan(new RegExp(String.raw`(?:по одному дополнительному|один дополнительный)\s+(?:лучу|дротику|снаряду|луч|дротик|снаряд)[^.]*?${above}`, 'i'), `${higher} `);
  if (upShots && Number.isFinite(ordinal(upShots[1]!))) scaling.push({ what: 'projectiles', amount: '1', from: ordinal(upShots[1]!), per: 'slot', phrase: upShots[0] });
  const upTargets = scan(new RegExp(String.raw`(?:одного|одну|одно)\s+дополнительн\S*\s+\S+\s+${above}`, 'i'), `${higher} `);
  if (upTargets && !upShots && Number.isFinite(ordinal(upTargets[1]!))) scaling.push({ what: 'targets', amount: '1', from: ordinal(upTargets[1]!), per: 'slot', phrase: upTargets[0] });
  const cantrip = scan(/увеличивается на (\d+\s*[dк]\s*\d+),? когда вы достигаете 5 уровня/i);
  if (cantrip) scaling.push({ what: 'damage', amount: formula(cantrip[1]!), from: 0, per: 'cantrip', phrase: cantrip[0] });
  const pool = scan(/бросьте (\d+\s*[dк]\s*\d+)[:;,]?\s*(?:сумма|результат)[^.]*хит/i);
  return {
    attack: attack ? { range: attack[1]!.toLowerCase().startsWith('рукопаш') ? 'melee' : 'ranged', phrase: attack[0] } : null,
    save: save ? { ability: RU_ABILITY[save[1]!.toLowerCase()]!, phrase: save[0] } : null,
    damage: damage && damageType ? { formula: formula(damage[1]!), type: damageType, phrase: damage[0] } : null,
    half: scan(/половин\S*\s+(?:этого\s+)?урона/i)?.[0] ?? null,
    heal: heal ? { formula: formula(heal[1]!) + (heal[2] ? ' + @mod' : ''), phrase: heal[0], notUndead: /не действует на нежить/i.test(text) } : null,
    condition,
    repeat: repeatEnd ? { when: 'end', phrase: repeatEnd[0] } : repeatStart ? { when: 'start', phrase: repeatStart[0] } : null,
    area,
    zone: scan(/впервые за ход входит в (?:область|зону)[^.]*начинает в ней ход/i)?.[0] ?? null,
    projectiles: projectiles && wordNumber(projectiles[1]!) > 1 ? { count: wordNumber(projectiles[1]!), phrase: projectiles[0] } : null,
    upTo: upTo ? { count: wordNumber(upTo[1]!), phrase: upTo[0] } : null,
    humanoid: scan(/^[^.]*гуманоид[^.]*/i)?.[0] ?? null,
    riders,
    direct,
    scaling,
    pool: pool ? { formula: formula(pool[1]!), phrase: pool[0] } : null,
  };
}

export function suggestTemplate(input: SuggestInput): Suggestion[] {
  const text = flat(input.description);
  const higher = flat(input.higherLevel);
  const found: Found = { suggestions: [] };
  metaSuggestions(found, input);
  if (!text) return found.suggestions;
  const parsed = cyrillic(`${text} ${higher}`) ? parseRussian(text, higher) : parseEnglish(text, higher, input);

  if (parsed.area) {
    const a = parsed.area;
    push(found, 'targeting.kind', 'Способ выбора целей', 'area', 'область', a.phrase);
    push(found, 'targeting.shape', 'Форма', a.shape, optionLabel(AREA_SHAPES, a.shape), a.phrase);
    push(found, 'targeting.sizeFeet', a.shape === 'line' ? 'Длина, фт.' : a.shape === 'cylinder' || a.shape === 'sphere' ? 'Радиус, фт.' : 'Размер, фт.', a.size, `${a.size} фт.`, a.phrase);
    if (a.shape === 'line') push(found, 'targeting.widthFeet', 'Ширина, фт.', a.width, `${a.width} фт.`, a.phrase);
    if (a.shape === 'cylinder' && a.height) push(found, 'targeting.heightFeet', 'Высота, фт.', a.height, `${a.height} фт.`, a.phrase);
    push(found, 'targeting.origin', 'Откуда', a.fromSelf ? 'self' : 'point', a.fromSelf ? 'от себя' : 'точка в дальности', a.phrase, 'maybe');
  } else if (parsed.upTo) {
    push(found, 'targeting.kind', 'Способ выбора целей', 'creatures', 'существа', parsed.upTo.phrase);
    push(found, 'targeting.countMode', 'Сколько', 'up-to', 'до N', parsed.upTo.phrase);
    push(found, 'targeting.count', 'Число целей', parsed.upTo.count, String(parsed.upTo.count), parsed.upTo.phrase);
  }
  if (parsed.humanoid) {
    push(found, 'targeting.typeMode', 'Фильтр по типу', 'only', 'только', parsed.humanoid, 'maybe');
    push(found, 'targeting.types', 'Типы существ', ['humanoid'], 'гуманоид', parsed.humanoid, 'maybe');
  }

  const main = emptyAction(parsed.attack ? 'Атака' : parsed.save ? (parsed.area ? 'Волна' : 'Спасбросок') : parsed.heal ? 'Лечение' : 'Эффект');
  const phrases: string[] = [];
  if (parsed.projectiles) {
    main.check.attackCount = parsed.projectiles.count;
    phrases.push(parsed.projectiles.phrase);
  }
  if (parsed.attack) {
    main.check.kind = 'attack';
    main.check.attackRange = parsed.attack.range;
    phrases.push(parsed.attack.phrase);
  } else if (parsed.save) {
    main.check.kind = 'save';
    main.check.ability = parsed.save.ability;
    phrases.push(parsed.save.phrase);
  }
  const outcome: Outcome = main.check.kind === 'attack' ? 'hit' : main.check.kind === 'save' ? 'fail' : 'always';
  const effects: Effect[] = [];
  if (parsed.damage) {
    effects.push(effect('damage', { formula: parsed.damage.formula, damageType: parsed.damage.type }));
    phrases.push(parsed.damage.phrase);
  }
  if (parsed.heal) {
    effects.push(effect('heal', { formula: parsed.heal.formula, notUndead: parsed.heal.notUndead }));
    phrases.push(parsed.heal.phrase);
  }
  if (parsed.condition) {
    effects.push(effect('condition', { code: parsed.condition.code, duration: 'spell', repeatSave: parsed.repeat?.when ?? 'none' }));
    phrases.push(parsed.condition.phrase);
    if (parsed.repeat) phrases.push(parsed.repeat.phrase);
  }
  if (parsed.pool) {
    effects.push(effect('preset', { preset: 'sleep' }));
    phrases.push(parsed.pool.phrase);
  }
  for (const { rider, phrase } of parsed.riders) {
    effects.push(...riderEffects(rider));
    if (phrase) phrases.push(phrase);
  }
  for (const { effect: made, phrase } of parsed.direct) {
    effects.push(made);
    if (phrase) phrases.push(phrase);
  }
  if (effects.length) main.outcomes[outcome] = effects;
  if (parsed.half && main.check.kind === 'save' && parsed.damage) {
    main.successHalf = true;
    phrases.push(parsed.half);
  }
  main.who = parsed.area ? 'area' : /^(self|на себя)/i.test(flat(input.range)) ? 'caster' : 'targets';

  const actionPhrase = phrases.filter(Boolean).join(' … ');
  const scalingRef = effects.find(entry => entry.kind === 'damage' || entry.kind === 'heal')?.id ?? '';
  if (parsed.zone && (main.check.kind !== 'none' || effects.length)) {
    main.when = 'zone-enter-or-start';
    main.who = 'entering';
    main.times = 'turn';
    const zone = effect('zone', { shapeFrom: parsed.area ? 'targeting' : 'own' });
    zone.actions = [main];
    const holder = emptyAction('Зона');
    holder.who = parsed.area ? 'area' : 'targets';
    holder.outcomes.always = [zone];
    push(found, 'actions[+]', 'Действие', holder, `${describeAction(holder)} └ ${describeAction(main)}`, `${parsed.zone} … ${actionPhrase}`);
  } else if (main.check.kind !== 'none' || effects.length) {
    push(found, 'actions[+]', 'Действие', main, describeAction(main), actionPhrase || text.slice(0, 120), parsed.attack || parsed.save || parsed.damage || parsed.heal ? 'sure' : 'maybe');
  }

  for (const rule of parsed.scaling) {
    const value: Scaling = { id: newId('s'), what: rule.what, per: rule.per, ref: rule.what === 'damage' || rule.what === 'healing' ? scalingRef : '', amount: rule.amount, steps: [] };
    const display = rule.per === 'cantrip' ? `${rule.amount} на 5, 11 и 17 уровне` : `+${rule.amount} за каждый круг выше ${rule.from}`;
    push(found, 'scaling[+]', 'Усиление на кругах', value, `${optionLabel([['damage', 'урон'], ['healing', 'лечение'], ['projectiles', 'лучи и снаряды'], ['targets', 'число целей'], ['threshold', 'порог хитов']], rule.what)}: ${display}`, rule.phrase);
  }

  if (parsed.damage) push(found, 'passport.element', 'Стихия', parsed.damage.type, optionLabel(DAMAGE_TYPES, parsed.damage.type), parsed.damage.phrase, 'maybe');
  const purpose = parsed.heal ? 'healing' : parsed.damage ? (parsed.area ? 'damage-area' : 'damage-single') : parsed.condition ? 'control'
    : effects.some(entry => ['ac', 'speed', 'attack-rolls', 'checks', 'defense', 'temp-hp', 'max-hp', 'preset'].includes(entry.kind)) ? 'buff' : null;
  if (purpose) push(found, 'hints.purpose', 'Назначение', purpose, optionLabel(PURPOSES, purpose), actionPhrase || text.slice(0, 80), 'maybe');
  if (parsed.save && parsed.area) push(found, 'hints.avoidAllies', 'Не задевать своих', true, 'да', parsed.area.phrase, 'maybe');
  return found.suggestions;
}

export function suggestionText(suggestion: Suggestion): string {
  return `${suggestion.label}: ${suggestion.display}`;
}

export function describeSuggestedEffects(suggestions: Suggestion[]): string[] {
  return suggestions
    .filter(entry => entry.path === 'actions[+]')
    .flatMap(entry => Object.values((entry.value as Action).outcomes).flatMap(list => (list ?? []).map(describeEffect)));
}
