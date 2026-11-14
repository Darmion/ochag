import { reactive } from 'vue';

type Request = (path: string, method?: string, body?: unknown) => Promise<any>;

// Campaign pictures need the session token, so they become object URLs; each one is fetched once per session.
const urls = reactive(new Map<string, string | null>());
const loading = new Set<string>();

export function assetImageUrl(campaignId: string, assetId: string, request: Request): string | null {
  const key = `${campaignId}:${assetId}`;
  if (urls.has(key)) return urls.get(key) ?? null;
  if (!loading.has(key)) {
    loading.add(key);
    request(`/campaigns/${campaignId}/assets/${assetId}`)
      .then(blob => urls.set(key, blob instanceof Blob ? URL.createObjectURL(blob) : null))
      .catch(() => urls.set(key, null))
      .finally(() => loading.delete(key));
  }
  return null;
}

export function rememberAssetImage(campaignId: string, assetId: string, file: Blob) {
  urls.set(`${campaignId}:${assetId}`, URL.createObjectURL(file));
}

export function forgetAssetImage(campaignId: string, assetId: string) {
  const key = `${campaignId}:${assetId}`;
  const url = urls.get(key);
  if (url) URL.revokeObjectURL(url);
  urls.delete(key);
}
