import { artHas, artNames, artUrl } from './artSource.ts';

export const libraryUrl = (path: string) => artUrl(path);
const shown = (path: string) => (artHas(path) ? artUrl(path) : null);

const normalize = (name: string) => name.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

let namesFrom: ReadonlyArray<readonly [string, string]> | null = null;
let byName: Array<[string, string]> = [];
function nameTable() {
  const names = artNames();
  if (names !== namesFrom) {
    namesFrom = names;
    byName = names.map(([name, path]) => [normalize(name), path] as [string, string]).sort((a, b) => b[0].length - a[0].length);
  }
  return byName;
}

const TOWNSFOLK: Array<[RegExp, string]> = [
  [/^(торговк|купчих|лавочниц)/, 'portraits/npc/merchant-female'],
  [/^(торговец|торговц|купец|купц|лавочник|merchant|trader|shopkeeper)/, 'portraits/npc/merchant-male'],
  [/^(горожанк|жительниц|крестьянк|селянк)/, 'portraits/npc/townsperson-female'],
  [/^(горожан|житель|крестьян|селянин|townsperson|villager|peasant)/, 'portraits/npc/townsperson-male'],
  [/^(стражниц|guardswoman)/, 'portraits/npc/guard-female'],
];

export const bestiaryPortrait = (index: string | null | undefined) => (index ? shown(`portraits/bestiary/${index}`) : null);

export function npcPortraitPath(name: string | null | undefined): string | null {
  if (!name) return null;
  const text = normalize(name);
  for (const [prefix, path] of nameTable()) {
    if (text.startsWith(prefix) && !/[a-zа-я]/.test(text.charAt(prefix.length)) && artHas(path)) return path;
  }
  return TOWNSFOLK.find(([pattern, path]) => pattern.test(text) && artHas(path))?.[1] ?? null;
}

const ART_IMAGE_PREFIX = 'art:';
export const artImageId = (path: string) => `${ART_IMAGE_PREFIX}${path}`;
export const isArtImageId = (id: string) => id.startsWith(ART_IMAGE_PREFIX);
export const artImageUrl = (id: string) => shown(id.slice(ART_IMAGE_PREFIX.length));

export function objectImageId(object: { kind: string; name: string; image_asset_id?: string | null }): string | null {
  if (object.image_asset_id) return object.image_asset_id;
  if (object.kind !== 'npc') return null;
  const path = npcPortraitPath(object.name);
  return path ? artImageId(path) : null;
}

const HERO_RACES = ['dwarf', 'elf', 'halfling', 'human', 'dragonborn', 'gnome', 'half-elf', 'half-orc', 'tiefling'];

const RACE_WORDS: Array<[RegExp, string]> = [
  [/полуэльф|half-?elf/, 'half-elf'], [/полуорк|half-?orc/, 'half-orc'], [/драконорожд|dragonborn/, 'dragonborn'],
  [/дварф|дворф|dwarf/, 'dwarf'], [/гном|gnome/, 'gnome'], [/эльф|elf/, 'elf'], [/полурослик|хоббит|halfling/, 'halfling'],
  [/человек|human/, 'human'], [/тифлинг|tiefling/, 'tiefling'],
];
export function raceIdOf(text: string | null | undefined): string | null {
  if (!text) return null;
  const value = normalize(text);
  if (HERO_RACES.includes(value)) return value;
  return RACE_WORDS.find(([pattern]) => pattern.test(value))?.[1] ?? null;
}
export function heroPortraitPaths(race: string | null | undefined): string[] {
  const races = race && HERO_RACES.includes(race) ? [race] : HERO_RACES;
  return races.flatMap(id => [`portraits/heroes/${id}-male`, `portraits/heroes/${id}-female`]).filter(artHas);
}

const CLASSES = ['barbarian', 'bard', 'cleric', 'druid', 'fighter', 'monk', 'paladin', 'ranger', 'rogue', 'sorcerer', 'warlock', 'wizard'];
export const classCrest = (classId: string | null | undefined) =>
  classId && CLASSES.includes(classId) ? shown(`ui/classes/${classId}`) : null;

export async function artFile(path: string): Promise<File> {
  const response = await fetch(libraryUrl(path));
  if (!response.ok) throw new Error('Картинка библиотеки не загрузилась.');
  const blob = await response.blob();
  return new File([blob], `${path.split('/').pop()}.webp`, { type: blob.type || 'image/webp' });
}
