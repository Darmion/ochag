import { DRAGON_ANCESTRIES, SRD_RACES, type Race, type Subrace } from '../srd/heroes.ts';
import { sourced, traitResistances, traitSaveAdvantages, type SourcedEffect, type TraitEffect } from './traits.ts';

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

export type RaceTrait = { id: string; races: string[]; subraces?: string[]; name: string; text: string; effects?: TraitEffect[]; modName?: string };

export const RACE_TRAITS: RaceTrait[] = [
  {
    id: 'lucky', races: ['halfling'], name: 'Везучий', text: 'Натуральная 1 на к20 атаки, проверки или спасброска перебрасывается — берётся новый бросок. Само.',
    effects: [{ kind: 'reroll-ones' }],
  },
  { id: 'brave', races: ['halfling'], name: 'Храбрый', text: 'Спасброски против испуга — с преимуществом. Само.', effects: [{ kind: 'save-advantage', condition: 'frightened' }] },
  {
    id: 'fey-ancestry', races: ['elf', 'half-elf'], name: 'Наследие фей', text: 'Спасброски против очарования — с преимуществом; магия не усыпляет («Усыпление» не действует). Само.',
    effects: [{ kind: 'save-advantage', condition: 'charmed' }],
  },
  {
    id: 'dwarven-resilience', races: ['dwarf'], name: 'Дварфийская устойчивость', text: 'Спасброски против яда — с преимуществом; сопротивление урону ядом. Само.',
    effects: [{ kind: 'save-advantage', condition: 'poisoned' }, { kind: 'save-advantage', damage: 'poison' }, { kind: 'resistance', damage: 'poison' }],
  },
  {
    id: 'gnome-cunning', races: ['gnome'], name: 'Гномья хитрость', text: 'Спасброски Интеллекта, Мудрости и Харизмы против магии — с преимуществом. Само.',
    effects: [{ kind: 'save-advantage', magic: true, abilities: ['intelligence', 'wisdom', 'charisma'] }],
  },
  { id: 'relentless-endurance', races: ['half-orc'], name: 'Непоколебимость', text: 'Хиты упали до 0, но не убит сразу — вместо этого 1 хит. Раз до долгого отдыха. Само.' },
  { id: 'savage-attacks', races: ['half-orc'], name: 'Свирепые атаки', text: 'Критическое попадание рукопашным оружием — ещё одна кость урона оружия. Само.' },
  { id: 'breath-weapon', races: ['dragonborn'], name: 'Оружие дыхания', text: 'Действием — линия или конус по дракону-предку в сторону цели: спасбросок против СЛ 8 + ТЕЛ + мастерство, 2d6 (3d6 с 6-го, 4d6 с 11-го, 5d6 с 16-го), успех — половина. Раз до короткого отдыха.' },
  { id: 'draconic-resistance', races: ['dragonborn'], name: 'Сопротивление урону', text: 'Сопротивление урону вида своего дракона-предка. Само.' },
  { id: 'hellish-resistance', races: ['tiefling'], name: 'Адское сопротивление', text: 'Сопротивление урону огнём. Само.', effects: [{ kind: 'resistance', damage: 'fire' }] },
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
  const race = characterRaceId(character);
  const own = traitResistances(raceEffects(raceTraits(race, characterSubraceId(character))));
  const ancestry = race === 'dragonborn' ? dragonAncestry(character) : null;
  return ancestry ? [...new Set([...own, ancestry.damage])] : own;
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

export function raceTraits(race: string | null, subrace: string | null = null): RaceTrait[] {
  if (!race) return [];
  return [...RACE_TRAITS, ...MOD_TRAITS].filter(trait => trait.races.includes(race) && (!trait.subraces || (subrace !== null && trait.subraces.includes(subrace))));
}

export function hasRaceTrait(race: string | null, id: RaceTraitId): boolean {
  return raceTraits(race).some(trait => trait.id === id);
}

export function raceEffects(traits: readonly RaceTrait[]): SourcedEffect[] {
  return traits.flatMap(trait => sourced(trait.name, trait.effects));
}

export type ModRace = Race & { modName: string };
const MOD_RACES = new Map<string, ModRace>();
const MOD_SUBRACES = new Map<string, Subrace[]>();
const MOD_TRAITS: RaceTrait[] = [];

function replaceTraits(owner: string, traits: RaceTrait[]) {
  for (let i = MOD_TRAITS.length - 1; i >= 0; i -= 1) if (MOD_TRAITS[i]!.id.startsWith(`${owner}-t`)) MOD_TRAITS.splice(i, 1);
  MOD_TRAITS.push(...traits);
}

export function defineModRace(race: ModRace, traits: RaceTrait[]) {
  MOD_RACES.set(race.id, race);
  replaceTraits(race.id, traits);
}

export function defineModSubrace(raceId: string, subrace: Subrace, traits: RaceTrait[]) {
  const list = (MOD_SUBRACES.get(raceId) ?? []).filter(entry => entry.id !== subrace.id);
  MOD_SUBRACES.set(raceId, [...list, subrace]);
  replaceTraits(subrace.id, traits);
}

export function modRaceOf(id: string): ModRace | undefined {
  return MOD_RACES.get(id);
}

export function heroRaces(): Race[] {
  const withSubraces = (race: Race): Race => {
    const extra = MOD_SUBRACES.get(race.id);
    return extra?.length ? { ...race, subraces: [...race.subraces, ...extra] } : race;
  };
  const own = SRD_RACES.filter(race => !race.custom);
  return [...own, ...MOD_RACES.values(), ...SRD_RACES.filter(race => race.custom)].map(withSubraces);
}

export function heroRace(id: string | null | undefined): Race | undefined {
  if (!id) return undefined;
  return heroRaces().find(race => race.id === id);
}

export function characterRaceId(character: { sheet_extra?: unknown }): string | null {
  const built = (character.sheet_extra as any)?.builder?.race;
  return typeof built === 'string' && MOD_RACES.has(built) ? built : characterRace(character);
}

export function characterSubraceId(character: { sheet_extra?: unknown }): string | null {
  const built = (character.sheet_extra as any)?.builder?.subrace;
  return typeof built === 'string' ? built : null;
}

export function characterRaceTraits(character: { sheet_extra?: unknown }): RaceTrait[] {
  return raceTraits(characterRaceId(character), characterSubraceId(character));
}

export type SaveAgainst = { condition?: string | null; magic?: boolean; damageType?: string | null; concentration?: boolean; nearCaster?: boolean; casterId?: string | null };

export function raceSaveAdvantages(race: string | null, ability: string, against: SaveAgainst | null | undefined): string[] {
  return traitSaveAdvantages(raceEffects(raceTraits(race)), ability, against);
}

export function adjustD20(
  results: number[], advantage: 'none' | 'adv' | 'disadv',
  options: { lucky?: boolean | string | null; floor10?: boolean }, rollDie: (sides: number) => number,
): { results: number[]; kept: number; notes: string[] } {
  const next = [...results];
  const keep = () => (advantage === 'disadv' ? Math.min(...next) : Math.max(...next));
  const notes: string[] = [];
  if (options.lucky && keep() === 1) {
    const at = next.indexOf(1);
    next[at] = rollDie(20);
    notes.push(`${typeof options.lucky === 'string' ? options.lucky : 'везучий'}: 1 → ${next[at]}`);
  }
  if (options.floor10 && next.some(value => value < 10)) {
    const before = keep();
    for (let i = 0; i < next.length; i += 1) next[i] = Math.max(10, next[i]!);
    if (keep() !== before) notes.push(`надёжный талант: ${before} → 10`);
  }
  return { results: next, kept: keep(), notes };
}
