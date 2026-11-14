import { assetImageUrl, rememberAssetImage } from './assetImages';
import { artSource, schoolArt } from './itemArt';

type Request = (path: string, method?: string, body?: unknown) => Promise<any>;

const ASSET = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isOwnSpellArt = (art: string | null | undefined) => Boolean(art && ASSET.test(art));

export function spellArtUrl(art: string | null | undefined, campaignId: string, request: Request): string | null {
  if (!art) return null;
  return ASSET.test(art) ? assetImageUrl(campaignId, art, request) : artSource(art);
}

export const rememberSpellArt = rememberAssetImage;

export function spellOrSchoolArt(art: string | null | undefined, school: string | null | undefined, campaignId: string, request: Request): string | null {
  return spellArtUrl(art, campaignId, request) ?? schoolArt(school);
}

export function templateArt(spell: unknown): string {
  const art = (spell as { template?: { passport?: { art?: unknown } } } | null)?.template?.passport?.art;
  return typeof art === 'string' ? art : '';
}
