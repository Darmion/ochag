import { ref, type ComputedRef, type Ref } from 'vue';
import type { ImageCrop } from '../art/imageCrop';
import type { CampaignImages, LobbyCampaign } from './campaignCards';

export type CampaignAppearanceDeps = {
  props: { request: (path: string, method?: string, body?: unknown, file?: File) => Promise<any> };
  emit: (event: 'appearanceChanged', campaignId: string) => void;
  selected: ComputedRef<LobbyCampaign | null>;
  imageUrls: Ref<CampaignImages>;
};

export function useCampaignAppearance({ props, emit, selected, imageUrls }: CampaignAppearanceDeps) {
  const appearanceBusy = ref<'avatar' | 'banner' | 'remove-avatar' | 'remove-banner' | null>(null);
  const appearanceError = ref('');

  async function uploadAppearance(target: 'avatar' | 'banner', input: HTMLInputElement) {
    const campaign = selected.value;
    const file = input.files?.[0];
    input.value = '';
    if (!campaign || !file) return;
    appearanceBusy.value = target;
    appearanceError.value = '';
    try {
      const kind = target === 'avatar' ? 'campaign_avatar' : 'campaign_banner';
      const uploaded = await props.request(`/campaigns/${campaign.id}/assets?kind=${kind}`, 'POST', undefined, file);
      await props.request(`/campaigns/${campaign.id}/appearance`, 'PUT', {
        [target === 'avatar' ? 'avatarAssetId' : 'bannerAssetId']: uploaded.id,
      });
      emit('appearanceChanged', campaign.id);
      openCrop(target, URL.createObjectURL(file), true);
    } catch (cause) {
      appearanceError.value = cause instanceof Error ? cause.message : 'Не удалось сохранить изображение. Попробуйте ещё раз.';
    } finally {
      appearanceBusy.value = null;
    }
  }

  const cropping = ref<{ target: 'avatar' | 'banner'; src: string; revoke: boolean } | null>(null);
  function openCrop(target: 'avatar' | 'banner', src?: string, revoke = false) {
    const campaign = selected.value;
    const url = src ?? (campaign ? imageUrls.value[campaign.id]?.[target] : undefined);
    if (!url) return;
    closeCrop();
    cropping.value = { target, src: url, revoke };
  }
  function closeCrop() {
    if (cropping.value?.revoke) URL.revokeObjectURL(cropping.value.src);
    cropping.value = null;
  }
  async function saveCrop(crop: ImageCrop | null) {
    const campaign = selected.value;
    const target = cropping.value?.target;
    if (!campaign || !target) return;
    appearanceBusy.value = target;
    appearanceError.value = '';
    try {
      await props.request(`/campaigns/${campaign.id}/appearance`, 'PUT', { [target === 'avatar' ? 'avatarCrop' : 'bannerCrop']: crop });
      emit('appearanceChanged', campaign.id);
      closeCrop();
    } catch (cause) {
      appearanceError.value = cause instanceof Error ? cause.message : 'Не удалось сохранить кадр. Попробуйте ещё раз.';
    } finally {
      appearanceBusy.value = null;
    }
  }

  async function removeAppearance(target: 'avatar' | 'banner') {
    const campaign = selected.value;
    if (!campaign) return;
    appearanceBusy.value = target === 'avatar' ? 'remove-avatar' : 'remove-banner';
    appearanceError.value = '';
    try {
      await props.request(`/campaigns/${campaign.id}/appearance`, 'PUT', {
        [target === 'avatar' ? 'avatarAssetId' : 'bannerAssetId']: null,
      });
      emit('appearanceChanged', campaign.id);
    } catch (cause) {
      appearanceError.value = cause instanceof Error ? cause.message : 'Не удалось убрать изображение. Попробуйте ещё раз.';
    } finally {
      appearanceBusy.value = null;
    }
  }

  return { appearanceBusy, appearanceError, cropping, uploadAppearance, openCrop, closeCrop, saveCrop, removeAppearance };
}
