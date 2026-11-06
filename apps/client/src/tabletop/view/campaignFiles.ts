import { cachedAsset, storeAsset } from '../assetCache';
import { isArtImageId, artImageUrl } from '../../art/portraitArt';
import type { TabletopProps } from './types';

export type CampaignFilesDeps = {
  props: TabletopProps;
};

export function useCampaignFiles({ props }: CampaignFilesDeps) {
  const imageUrls = new Map<string, Promise<string>>();

  async function assetBlob(assetId: string): Promise<Blob> {
    const key = `${props.campaignId}:${assetId}`;
    const cached = await cachedAsset(key);
    if (cached) return cached;
    const blob = await props.request(`/campaigns/${props.campaignId}/assets/${assetId}`) as Blob;
    void storeAsset(key, blob);
    return blob;
  }

  function loadImageUrl(assetId: string): Promise<string> {
    if (isArtImageId(assetId)) {
      const art = artImageUrl(assetId);
      return art ? Promise.resolve(art) : Promise.reject(new Error(assetId));
    }
    let url = imageUrls.get(assetId);

    if (!url) {
      url = (async () => {
        const blob = await assetBlob(assetId);
        return URL.createObjectURL(blob);
      })();
      url.catch(() => imageUrls.delete(assetId));
      imageUrls.set(assetId, url);
    }

    return url;
  }

  async function loadModelFile(assetId: string): Promise<File> {
    const blob = await assetBlob(assetId);

    return new File([blob], `${assetId}.glb`, {
      type: blob.type || 'model/gltf-binary',
    });
  }

  return { imageUrls, assetBlob, loadImageUrl, loadModelFile };
}
