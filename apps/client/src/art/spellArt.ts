import { reactive } from 'vue';

import { artSource, schoolArt } from './itemArt';

type Request = (path: string, method?: string, body?: unknown) => Promise<any>;

const ASSET = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const urls = reactive(new Map<string, string | null>());
const loading = new Set<string>();

export const isOwnSpellArt = (art: string | null | undefined) => Boolean(art && ASSET.test(art));

export function spellArtUrl(art: string | null | undefined, campaignId: string, request: Request): string | null {
  if (!art) return null;
  if (!ASSET.test(art)) return artSource(art);
  const key = `${campaignId}:${art}`;
  if (urls.has(key)) return urls.get(key) ?? null;
  if (!loading.has(key)) {
    loading.add(key);
    request(`/campaigns/${campaignId}/assets/${art}`)
      .then(blob => urls.set(key, blob instanceof Blob ? URL.createObjectURL(blob) : null))
      .catch(() => urls.set(key, null))
      .finally(() => loading.delete(key));
  }
  return null;
}

export function rememberSpellArt(campaignId: string, assetId: string, file: Blob) {
  urls.set(`${campaignId}:${assetId}`, URL.createObjectURL(file));
}

export function spellOrSchoolArt(art: string | null | undefined, school: string | null | undefined, campaignId: string, request: Request): string | null {
  return spellArtUrl(art, campaignId, request) ?? schoolArt(school);
}

export function templateArt(spell: unknown): string {
  const art = (spell as { template?: { passport?: { art?: unknown } } } | null)?.template?.passport?.art;
  return typeof art === 'string' ? art : '';
}
