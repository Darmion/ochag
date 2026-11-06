import { reactive } from 'vue';

import { onCampaignEvent } from '../campaign/campaignEvents';

type RequestFn = (path: string, method?: string, body?: unknown, file?: File) => Promise<any>;
export type CampaignSprite = { id: string; label: string; url: string | null };

export const campaignArt = reactive({
  campaignId: '',
  overrides: {} as Record<string, string>,
  sprites: [] as CampaignSprite[],
  canManage: false,
  loaded: false,
});

let request: RequestFn | null = null;
let generation = 0;

function revoke(sprites: CampaignSprite[]) {
  for (const sprite of sprites) if (sprite.url) URL.revokeObjectURL(sprite.url);
}

async function apply(campaignId: string, data: { overrides?: Record<string, string>; sprites?: Array<{ id: string; label: string }>; canManage?: boolean }, mine: number) {
  if (mine !== generation) return;
  const known = new Map(campaignArt.campaignId === campaignId ? campaignArt.sprites.map(sprite => [sprite.id, sprite.url]) : []);
  if (campaignArt.campaignId !== campaignId) revoke(campaignArt.sprites);
  const sprites = (data.sprites ?? []).map(sprite => ({ id: sprite.id, label: sprite.label, url: known.get(sprite.id) ?? null }));
  const kept = new Set(sprites.map(sprite => sprite.id));
  revoke(campaignArt.sprites.filter(sprite => campaignArt.campaignId === campaignId && !kept.has(sprite.id)));
  campaignArt.campaignId = campaignId;
  campaignArt.overrides = data.overrides ?? {};
  campaignArt.sprites = sprites;
  if (typeof data.canManage === 'boolean') campaignArt.canManage = data.canManage;
  campaignArt.loaded = true;
  for (const sprite of sprites.filter(entry => !entry.url)) {
    try {
      const blob = await request!(`/campaigns/${campaignId}/assets/${sprite.id}`) as Blob;
      if (mine !== generation) return;
      const target = campaignArt.sprites.find(entry => entry.id === sprite.id);
      if (target && !target.url) target.url = URL.createObjectURL(blob);
    } catch {
    }
  }
}

export async function loadCampaignArt(requestFn: RequestFn, campaignId: string) {
  request = requestFn;
  const mine = ++generation;
  if (!campaignId) {
    revoke(campaignArt.sprites);
    Object.assign(campaignArt, { campaignId: '', overrides: {}, sprites: [], canManage: false, loaded: false });
    return;
  }
  try {
    await apply(campaignId, await requestFn(`/campaigns/${campaignId}/art`), mine);
  } catch {
    if (mine !== generation) return;
    revoke(campaignArt.sprites);
    Object.assign(campaignArt, { campaignId, overrides: {}, sprites: [], canManage: false, loaded: true });
  }
}

onCampaignEvent('art', () => {
  if (request && campaignArt.campaignId) void loadCampaignArt(request, campaignArt.campaignId);
});

export function campaignArtValue(key: string): string | undefined {
  const value = campaignArt.overrides[key];
  if (value === undefined) return undefined;
  const asset = /^asset:(.+)$/.exec(value);
  if (!asset) return value;
  return campaignArt.sprites.find(sprite => sprite.id.toLowerCase() === asset[1]!.toLowerCase())?.url ?? undefined;
}

function requireRequest() {
  if (!request || !campaignArt.campaignId) throw new Error('Кампания не выбрана.');
  return { requestFn: request, campaignId: campaignArt.campaignId };
}

export async function setCampaignArt(key: string, value: string | null) {
  const { requestFn, campaignId } = requireRequest();
  await apply(campaignId, await requestFn(`/campaigns/${campaignId}/art`, 'PUT', { key, value }), generation);
}

export async function resetCampaignArt() {
  const { requestFn, campaignId } = requireRequest();
  await apply(campaignId, await requestFn(`/campaigns/${campaignId}/art`, 'DELETE'), generation);
}

export async function uploadCampaignSprite(blob: Blob, label: string): Promise<string> {
  const { requestFn, campaignId } = requireRequest();
  const extension = blob.type === 'image/png' ? 'png' : 'webp';
  const file = new File([blob], `${label.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Спрайт'}.${extension}`, { type: blob.type || 'image/webp' });
  const { id } = await requestFn(`/campaigns/${campaignId}/assets?kind=art_sprite`, 'POST', undefined, file);
  return id as string;
}

export async function refreshCampaignArt() {
  const { requestFn, campaignId } = requireRequest();
  await loadCampaignArt(requestFn, campaignId);
}

export async function deleteCampaignSprite(id: string) {
  const { requestFn, campaignId } = requireRequest();
  await apply(campaignId, await requestFn(`/campaigns/${campaignId}/art/sprites/${id}`, 'DELETE'), generation);
}
