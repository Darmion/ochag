const BASE = `${(import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'}art/`;

export type ArtSource = {
  has: (path: string) => boolean;
  url: (path: string) => string;
  names: () => ReadonlyArray<readonly [string, string]>;
};

export const vanillaArtUrl = (path: string) => `${BASE}${path}.webp`;

let source: ArtSource = { has: () => true, url: vanillaArtUrl, names: () => [] };

export function setArtSource(next: ArtSource) {
  source = next;
}

export const artHas = (path: string) => source.has(path);
export const artUrl = (path: string) => source.url(path);
export const artNames = () => source.names();
