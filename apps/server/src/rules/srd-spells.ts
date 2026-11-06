import { readFileSync } from 'node:fs';

export type SrdSpellInfo = { index: string; level: number; classes: string[] };

let cache: SrdSpellInfo[] | null = null;

export function srdSpellList(): SrdSpellInfo[] {
  if (!cache) {
    const raw = JSON.parse(readFileSync(new URL('../../../../packages/domain/srd/spells.json', import.meta.url), 'utf8'));
    cache = (Array.isArray(raw) ? raw : raw.spells).map((spell: any) => ({ index: spell.index, level: spell.level, classes: spell.classes }));
  }
  return cache!;
}
