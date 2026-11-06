import { ref, watch } from 'vue';
import type { CampaignImages, LobbyCampaign } from './campaignCards';

export type CampaignImagesDeps = {
  props: { campaigns: LobbyCampaign[]; request: (path: string, method?: string, body?: unknown, file?: File) => Promise<any> };
};

export function useCampaignImages({ props }: CampaignImagesDeps) {
  const imageUrls = ref<CampaignImages>({});
  let imageLoadGeneration = 0;

  function revokeImages(images: CampaignImages) {
    for (const entry of Object.values(images)) {
      if (entry.avatar) URL.revokeObjectURL(entry.avatar);
      if (entry.banner) URL.revokeObjectURL(entry.banner);
    }
  }

  watch(
    () => props.campaigns.map(campaign => `${campaign.id}:${campaign.avatar_asset_id ?? ''}:${campaign.banner_asset_id ?? ''}`).join('|'),
    async () => {
      const generation = ++imageLoadGeneration;
      const next: CampaignImages = {};
      await Promise.all(props.campaigns.map(async campaign => {
        const entry: { avatar?: string; banner?: string } = {};
        const load = async (assetId: string | null) => {
          if (!assetId) return undefined;
          const blob = await props.request(`/campaigns/${campaign.id}/assets/${assetId}`);
          return blob instanceof Blob ? URL.createObjectURL(blob) : undefined;
        };
        try { entry.avatar = await load(campaign.avatar_asset_id); } catch {  }
        try { entry.banner = await load(campaign.banner_asset_id); } catch {  }
        next[campaign.id] = entry;
      }));
      if (generation !== imageLoadGeneration) {
        revokeImages(next);
        return;
      }
      revokeImages(imageUrls.value);
      imageUrls.value = next;
    },
    { immediate: true },
  );

  function disposeImages() {
    imageLoadGeneration++;
    revokeImages(imageUrls.value);
  }

  return { imageUrls, disposeImages };
}
