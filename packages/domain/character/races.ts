import { DRAGON_ANCESTRIES, SRD_RACES } from '../srd/heroes.ts';

export type RaceId = 'dwarf' | 'elf' | 'halfling' | 'human' | 'dragonborn' | 'gnome' | 'half-elf' | 'half-orc' | 'tiefling';

// Order matters: «полуэльф» before «эльф», «полурослик» first.
const RACE_PATTERNS: Array<[RaceId, RegExp]> = [
  ['half-elf', /полуэльф|half[- ]?elf/iu],
  ['half-orc', /полуорк|half[- ]?orc/iu],
  ['halfling', /полурослик|хафлинг|halfling/iu],
  ['dragonborn', /драконорожд|dragonborn/iu],
  ['tiefling', /тифлинг|tiefling/iu],
  ['dwarf', /дварф|dwarf/iu],
  ['gnome', /гном|gnome/iu],
  ['elf', /эльф|elf/iu],
  ['human', /человек|human/iu],
];

export function raceOfText(text: string | null | undefined): RaceId | null {
  if (!text) return null;
  return RACE_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

export function characterRace(character: { sheet_extra?: unknown }): RaceId | null {
  const extra = character.sheet_extra as any;
  const built = extra?.builder?.race;
  if (typeof built === 'string' && SRD_RACES.some(race => race.id === built)) return built as RaceId;
  const info = extra?.info?.race;
  const text = typeof info === 'string' ? info : typeof info?.value === 'string' ? info.value : typeof extra?.race === 'string' ? extra.race : null;
  return raceOfText(text);
}

export type RaceTraitId = 'lucky' | 'brave' | 'fey-ancestry' | 'dwarven-resilience' | 'gnome-cunning' | 'relentless-endurance' | 'savage-attacks'
  | 'breath-weapon' | 'draconic-resistance' | 'hellish-resistance' | 'infernal-legacy';

export const RACE_TRAITS: Array<{ id: RaceTraitId; races: RaceId[]; name: string; text: string }> = [
  { id: 'lucky', races: ['halfling'], name: 'Везучий', text: 'Натуральная 1 на к20 атаки, проверки или спасброска перебрасывается — берётся новый бросок. Само.' },
  { id: 'brave', races: ['halfling'], name: 'Храбрый', text: 'Спасброски против испуга — с преимуществом. Само.' },
  { id: 'fey-ancestry', races: ['elf', 'half-elf'], name: 'Наследие фей', text: 'Спасброски против очарования — с преимуществом; магия не усыпляет («Усыпление» не действует). Само.' },
  { id: 'dwarven-resilience', races: ['dwarf'], name: 'Дварфийская устойчивость', text: 'Спасброски против яда — с преимуществом; сопротивление урону ядом. Само.' },
  { id: 'gnome-cunning', races: ['gnome'], name: 'Гномья хитрость', text: 'Спасброски Интеллекта, Мудрости и Харизмы против магии — с преимуществом. Само.' },
  { id: 'relentless-endurance', races: ['half-orc'], name: 'Непоколебимость', text: 'Хиты упали до 0, но не убит сразу — вместо этого 1 хит. Раз до долгого отдыха. Само.' },
  { id: 'savage-attacks', races: ['half-orc'], name: 'Свирепые атаки', text: 'Критическое попадание рукопашным оружием — ещё одна кость урона оружия. Само.' },
  { id: 'breath-weapon', races: ['dragonborn'], name: 'Оружие дыхания', text: 'Действием — линия или конус по дракону-предку в сторону цели: спасбросок против СЛ 8 + ТЕЛ + мастерство, 2d6 (3d6 с 6-го, 4d6 с 11-го, 5d6 с 16-го), успех — половина. Раз до короткого отдыха.' },
  { id: 'draconic-resistance', races: ['dragonborn'], name: 'Сопротивление урону', text: 'Сопротивление урону вида своего дракона-предка. Само.' },
  { id: 'hellish-resistance', races: ['tiefling'], name: 'Адское сопротивление', text: 'Сопротивление урону огнём. Само.' },
  {
    id: 'infernal-legacy', races: ['tiefling'], name: 'Дьявольское наследие',
    text: 'Заклинания без ячеек, Харизмой: «Чудотворство»; с 3-го уровня «Адское возмездие» (как 2-го уровня), с 5-го — «Тьма», каждое раз до долгого отдыха.',
  },
];

const ANCESTRY_PATTERNS: Array<[string, RegExp]> = [
  ['black', /чёрн|черн|black/iu], ['blue', /син|blue/iu], ['brass', /латун|brass/iu], ['bronze', /бронз|bronze/iu],
  ['copper', /медн|copper/iu], ['gold', /золот|gold/iu], ['green', /зелён|зелен|green/iu], ['red', /красн|red\b/iu],
  ['silver', /серебр|silver/iu], ['white', /бел|white/iu],
];
export function dragonAncestry(character: { sheet_extra?: unknown }): (typeof DRAGON_ANCESTRIES)[number] | null {
  const extra = character.sheet_extra as any;
  const chosen = DRAGON_ANCESTRIES.find(entry => entry.id === extra?.dragonAncestry);
  if (chosen) return chosen;
  const built = DRAGON_ANCESTRIES.find(entry => entry.id === extra?.builder?.ancestry);
  if (built) return built;
  const texts = [extra?.info?.race, extra?.info?.race?.value, extra?.race, extra?.info?.subrace, extra?.info?.subrace?.value, extra?.ancestry]
    .filter((value): value is string => typeof value === 'string');
  for (const text of texts) {
    const found = ANCESTRY_PATTERNS.find(([, pattern]) => pattern.test(text));
    if (found) return DRAGON_ANCESTRIES.find(entry => entry.id === found[0]) ?? null;
  }
  return null;
}

export function raceResistances(character: { sheet_extra?: unknown }): string[] {
  const race = characterRace(character);
  if (race === 'dwarf') return ['poison'];
  if (race === 'tiefling') return ['fire'];
  if (race === 'dragonborn') {
    const ancestry = dragonAncestry(character);
    return ancestry ? [ancestry.damage] : [];
  }
  return [];
}

export const INFERNAL_LEGACY = [
  { index: 'thaumaturgy', nameRu: 'Чудотворство', minLevel: 1, castAt: 0, resource: null },
  { index: 'hellish-rebuke', nameRu: 'Адское возмездие', minLevel: 3, castAt: 2, resource: 'Наследие: Адское возмездие' },
  { index: 'darkness', nameRu: 'Тьма', minLevel: 5, castAt: 2, resource: 'Наследие: Тьма' },
] as const;
export type LegacySpell = (typeof INFERNAL_LEGACY)[number];
export function infernalLegacySpell(character: { sheet_extra?: unknown; level?: number | null }, srdIndex: string | null | undefined): LegacySpell | null {
  if (!srdIndex || !hasRaceTrait(characterRace(character), 'infernal-legacy')) return null;
  const spell = INFERNAL_LEGACY.find(entry => entry.index === srdIndex);
  return spell && (character.level ?? 1) >= spell.minLevel ? spell : null;
}

export function breathWeaponDice(level: number | null | undefined): number {
  const at = level ?? 1;
  return at >= 16 ? 5 : at >= 11 ? 4 : at >= 6 ? 3 : 2;
}

export function raceTraits(race: RaceId | null): typeof RACE_TRAITS {
  return race ? RACE_TRAITS.filter(trait => trait.races.includes(race)) : [];
}

export function hasRaceTrait(race: RaceId | null, id: RaceTraitId): boolean {
  return raceTraits(race).some(trait => trait.id === id);
}

export type SaveAgainst = { condition?: string | null; magic?: boolean; damageType?: string | null; concentration?: boolean; nearCaster?: boolean; casterId?: string | null };

export function raceSaveAdvantages(race: RaceId | null, ability: string, against: SaveAgainst | null | undefined): string[] {
  if (!race || !against) return [];
  const reasons: string[] = [];
  if (hasRaceTrait(race, 'brave') && against.condition === 'frightened') reasons.push('храбрый');
  if (hasRaceTrait(race, 'fey-ancestry') && against.condition === 'charmed') reasons.push('наследие фей');
  if (hasRaceTrait(race, 'dwarven-resilience') && (against.condition === 'poisoned' || against.damageType === 'poison')) reasons.push('дварфийская устойчивость');
  if (hasRaceTrait(race, 'gnome-cunning') && against.magic && ['intelligence', 'wisdom', 'charisma'].includes(ability)) reasons.push('гномья хитрость');
  return reasons;
}

export function adjustD20(
  results: number[], advantage: 'none' | 'adv' | 'disadv',
  options: { lucky?: boolean; floor10?: boolean }, rollDie: (sides: number) => number,
): { results: number[]; kept: number; notes: string[] } {
  const next = [...results];
  const keep = () => (advantage === 'disadv' ? Math.min(...next) : Math.max(...next));
  const notes: string[] = [];
  if (options.lucky && keep() === 1) {
    const at = next.indexOf(1);
    next[at] = rollDie(20);
    notes.push(`везучий: 1 → ${next[at]}`);
  }
  if (options.floor10 && next.some(value => value < 10)) {
    const before = keep();
    for (let i = 0; i < next.length; i += 1) next[i] = Math.max(10, next[i]!);
    if (keep() !== before) notes.push(`надёжный талант: ${before} → 10`);
  }
  return { results: next, kept: keep(), notes };
}
