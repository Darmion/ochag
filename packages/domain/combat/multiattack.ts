export type MultiattackWeapon = { id: string; name: string; kind: 'melee' | 'ranged' };

export type MultiattackStep = {
  weaponId: string | null;
  mode: 'melee' | 'ranged' | 'any';
  count: number;
};

export type MultiattackRoutine = {
  steps: MultiattackStep[];
  distinct: boolean;
  disadvantageAfterFirst: boolean;
};

const NUMERALS: Array<[RegExp, number]> = [
  [/^(?:одн[уаоы]|один|одним|одной)$/, 1],
  [/^(?:две|два|двумя|дважды)$/, 2],
  [/^(?:три|тремя|трижды)$/, 3],
  [/^(?:четыре|четырьмя)$/, 4],
  [/^(?:пять|пятью)$/, 5],
  [/^(?:шесть|шестью)$/, 6],
];

const LETTERS = /[а-яёa-z]+/gi;

function words(text: string) {
  return (text.toLowerCase().match(LETTERS) ?? []).map(word => word.replace(/ё/g, 'е'));
}

function numeral(word: string): number | null {
  for (const [pattern, value] of NUMERALS) if (pattern.test(word)) return value;
  return null;
}

function prefixLength(a: string, b: string) {
  let length = 0;
  while (length < a.length && length < b.length && a[length] === b[length]) length += 1;
  return length;
}

function mentionScore(clause: string[], weapon: MultiattackWeapon): number | null {
  const parts = words(weapon.name);
  if (!parts.length) return null;
  let score = 0;
  for (const part of parts) {
    const best = Math.max(0, ...clause.map(word => prefixLength(word, part)));
    if (best < Math.min(3, part.length)) return null;
    score += best;
  }
  return score;
}

function namedWeapon(clause: string[], weapons: MultiattackWeapon[]) {
  let found: { weapon: MultiattackWeapon; score: number } | null = null;
  for (const weapon of weapons) {
    const score = mentionScore(clause, weapon);
    if (score !== null && (!found || score > found.score)) found = { weapon, score };
  }
  return found?.weapon ?? null;
}

function modeOf(clause: string[]): MultiattackStep['mode'] {
  if (clause.some(word => word.startsWith('рукопашн') || word.startsWith('melee'))) return 'melee';
  if (clause.some(word => word.startsWith('дальнобойн') || word.startsWith('ranged'))) return 'ranged';
  return 'any';
}

function parseAlternative(text: string, weapons: MultiattackWeapon[]): MultiattackRoutine | null {
  const colon = text.indexOf(':');
  const head = colon >= 0 ? text.slice(0, colon) : '';
  const body = colon >= 0 ? text.slice(colon + 1) : text;
  const mode = modeOf(words(head));
  const steps: MultiattackStep[] = [];
  for (const piece of body.split(/,|;|\s+и\s+/)) {
    const clause = words(piece);
    if (!clause.length) continue;
    const count = clause.map(numeral).find((value): value is number => value !== null) ?? null;
    const weapon = namedWeapon(clause, weapons);
    const clauseMode = modeOf(clause);
    if (weapon) {
      steps.push({ weaponId: weapon.id, mode: clauseMode !== 'any' ? clauseMode : mode, count: count ?? 1 });
    } else if (count !== null && (clause.some(word => word.startsWith('атак')) || clauseMode !== 'any')) {
      steps.push({ weaponId: null, mode: clauseMode !== 'any' ? clauseMode : mode, count });
    }
  }
  if (!steps.length) return null;
  return {
    steps,
    distinct: /кажд\S*\s*[—-]?\s*други/i.test(text),
    disadvantageAfterFirst: /втор\S*\s*[—-]?\s*с\s+помех/i.test(text),
  };
}

export function multiattackRoutines(text: string | null | undefined, weapons: MultiattackWeapon[]): MultiattackRoutine[] {
  const source = String(text ?? '').replace(/^\s*Мультиатака\.\s*/i, '').trim();
  if (!source) return [];
  const routines: MultiattackRoutine[] = [];
  const sentences = source.split(/(?<=\.)\s+/);
  let started = false;
  for (const sentence of sentences) {
    const clean = sentence.replace(/\.$/, '').trim();
    const lead = /^(?:совершает|совершают|делает|makes)(?![а-яёa-z])/i.test(clean);
    const alternative = /^или(?![а-яё])/i.test(clean);
    if (!lead && !(alternative && started)) continue;
    started = true;
    for (const part of clean.replace(/^или\s+/i, '').split(/,?\s+или\s+/i)) {
      const routine = parseAlternative(part, weapons);
      if (routine) routines.push(routine);
    }
  }
  return routines;
}

export function multiattackText(actions: string | null | undefined): string | null {
  for (const paragraph of String(actions ?? '').split(/\n+/)) {
    const match = /^\s*Мультиатака\.\s*(.+)$/i.exec(paragraph);
    if (match) return match[1]!.trim();
  }
  return null;
}

export function routineCount(routine: MultiattackRoutine) {
  return routine.steps.reduce((sum, step) => sum + step.count, 0);
}

export function legendaryAttack(
  option: { name: string; text?: string | null }, weapons: MultiattackWeapon[],
): MultiattackStep | null {
  const text = `${option.name}. ${option.text ?? ''}`
    .replace(/(?:не\s+)?провоциру\S*\s+атак\S*(?:\s+при\s+уходе)?/gi, '')
    .replace(/атак\S*\s+при\s+уходе/gi, '');
  if (/спасброс|saving throw/i.test(text)) return null;
  const all = words(text);
  if (!all.some(word => word.startsWith('атак') || word.startsWith('attack') || word.startsWith('удар'))) return null;
  const weapon = namedWeapon(all, weapons);
  const count = words(option.text ?? '').map(numeral).find((value): value is number => value !== null)
    ?? all.map(numeral).find((value): value is number => value !== null) ?? 1;
  return { weaponId: weapon?.id ?? null, mode: modeOf(all), count: Math.min(3, count) };
}

export type LegendaryArea = {
  radiusFeet: number; ability: Ability; dc: number; damage: string | null; damageType: string | null; half: boolean; prone: boolean;
};
type Ability = 'strength' | 'dexterity' | 'constitution' | 'intelligence' | 'wisdom' | 'charisma';

const ABILITY_WORDS: Array<[RegExp, Ability]> = [
  [/сил[аыуе]|strength/i, 'strength'], [/ловкост|dexterity/i, 'dexterity'], [/телосложени|constitution/i, 'constitution'],
  [/интеллект|intelligence/i, 'intelligence'], [/мудрост|wisdom/i, 'wisdom'], [/харизм|charisma/i, 'charisma'],
];
const DAMAGE_WORDS: Array<[RegExp, string]> = [
  [/дробящ|bludgeoning/i, 'bludgeoning'], [/колющ|piercing/i, 'piercing'], [/рубящ|slashing/i, 'slashing'], [/огн|fire/i, 'fire'],
  [/холод|cold/i, 'cold'], [/электри|молни|lightning/i, 'lightning'], [/кислот|acid/i, 'acid'], [/ядом|ядов|poison/i, 'poison'],
  [/некрот|necrotic/i, 'necrotic'], [/излучени|radiant/i, 'radiant'], [/звук|гром|thunder/i, 'thunder'], [/психич|psychic/i, 'psychic'], [/силов|force/i, 'force'],
];

export function legendaryArea(option: { name: string; text?: string | null }): LegendaryArea | null {
  const text = `${option.name}. ${option.text ?? ''}`.replace(/\s+/g, ' ');
  if (!/спасброс|saving throw/i.test(text)) return null;
  const radius = /(\d+)\s*(?:фт|фут|feet|foot|ft)/i.exec(text);
  const dc = /(?:СЛ|DC)\s*(\d+)/i.exec(text);
  const ability = ABILITY_WORDS.find(([pattern]) => pattern.test(text.replace(/\(.*?\)/g, '')))?.[1] ?? null;
  if (!radius || !dc || !ability) return null;
  // Prefer the formula in brackets («15 (2d6 + 8)»), else the first dice formula.
  const formula = /\((\d+\s*[dкД]\s*\d+(?:\s*[+-]\s*\d+)?)\)/.exec(text) ?? /(\d+\s*[dкД]\s*\d+(?:\s*[+-]\s*\d+)?)/.exec(text);
  return {
    radiusFeet: Number(radius[1]), ability, dc: Number(dc[1]),
    damage: formula ? formula[1]!.replace(/\s+/g, '').replace(/[кД]/g, 'd') : null,
    damageType: DAMAGE_WORDS.find(([pattern]) => pattern.test(text))?.[1] ?? null,
    half: /половин|half as much/i.test(text),
    prone: /сбит\S*\s+с\s+ног|ничком|knocked prone|prone/i.test(text),
  };
}

export function legendaryMove(option: { name: string; text?: string | null }): { fraction: number } | null {
  const text = `${option.name}. ${option.text ?? ''}`;
  if (/спасброс|saving throw/i.test(text)) return null;
  if (!/перемещ|двигает|подлет|летит|move|fly/i.test(text)) return null;
  return { fraction: /половин|half/i.test(text) ? 0.5 : 1 };
}
