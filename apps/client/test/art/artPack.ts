import { existsSync, readFileSync } from 'node:fs';

import { setArtSource, vanillaArtUrl } from '../../src/art/artSource.ts';

type Library = { groups: Array<{ id: string; label: string; section: string; items: Array<{ path: string; label: string; names?: string[] }> }> };

export const inVanilla = (path: string) => existsSync(new URL(`../../public/art/${path}.webp`, import.meta.url));
export const inPack = (path: string) => existsSync(new URL(`../../../../mods/ai-art/art/${path}.webp`, import.meta.url));
export const builtWithPack = (path: string) => inVanilla(path) || inPack(path);
export const pathOfUrl = (url: string) => url.replace(/^\/art\//, '').replace(/\.webp$/, '');

export const vanillaLibrary = JSON.parse(readFileSync(new URL('../../src/art/artLibrary.json', import.meta.url), 'utf8')) as Library;
export const packLibrary = JSON.parse(readFileSync(new URL('../../../../mods/ai-art/library.json', import.meta.url), 'utf8')) as Library;
const packNames = packLibrary.groups.flatMap(group => group.items).flatMap(item => (item.names ?? []).map(name => [name, item.path] as const));

export function useArtPack(on: boolean) {
  setArtSource({ has: path => inVanilla(path) || (on && inPack(path)), url: vanillaArtUrl, names: () => (on ? packNames : []) });
}
