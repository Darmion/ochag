import { ref, watch, type ComputedRef } from 'vue';
import type { CampaignOverview, LobbyCampaign } from './campaignCards';

export type CampaignOverviewDeps = {
  props: { request: (path: string, method?: string, body?: unknown, file?: File) => Promise<any> };
  selected: ComputedRef<LobbyCampaign | null>;
};

export function useCampaignOverview({ props, selected }: CampaignOverviewDeps) {
  const overview = ref<CampaignOverview | null>(null);
  const overviewLoading = ref(false);
  const overviewError = ref('');
  let overviewLoadGeneration = 0;

  watch(
    () => selected.value?.id,
    async campaignId => {
      const generation = ++overviewLoadGeneration;
      overview.value = null;
      overviewError.value = '';
      if (!campaignId) return;
      overviewLoading.value = true;
      try {
        const result = await props.request(`/campaigns/${campaignId}/overview`);
        if (generation === overviewLoadGeneration) overview.value = result.overview;
      } catch (cause) {
        if (generation === overviewLoadGeneration) overviewError.value = cause instanceof Error ? cause.message : 'Не удалось загрузить сводку. Попробуйте ещё раз.';
      } finally {
        if (generation === overviewLoadGeneration) overviewLoading.value = false;
      }
    },
    { immediate: true },
  );

  function cancelOverviewLoad() {
    overviewLoadGeneration++;
  }

  return { overview, overviewLoading, overviewError, cancelOverviewLoad };
}
