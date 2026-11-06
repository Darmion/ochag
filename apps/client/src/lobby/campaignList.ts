import { computed, ref } from 'vue';
import type { LobbyCampaign } from './campaignCards';

export type CampaignListDeps = {
  props: { campaigns: LobbyCampaign[]; currentUserId: string };
};

export function useCampaignList({ props }: CampaignListDeps) {
  const campaignQuery = ref('');
  const roleFilter = ref<'all' | 'master' | 'player'>('all');

  const masterCount = computed(() => props.campaigns.filter(campaign => campaign.owner_user_id === props.currentUserId).length);
  const playerCount = computed(() => props.campaigns.length - masterCount.value);
  const visibleCampaigns = computed(() => {
    const query = campaignQuery.value.trim().toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
    return props.campaigns
      .filter(campaign => {
        const owner = campaign.owner_user_id === props.currentUserId;
        const roleMatches = roleFilter.value === 'all' || (roleFilter.value === 'master' ? owner : !owner);
        return roleMatches && (!query || campaign.name.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').includes(query));
      })
      .sort((left, right) => {
        const roleDifference = Number(right.owner_user_id === props.currentUserId) - Number(left.owner_user_id === props.currentUserId);
        return roleDifference || left.name.localeCompare(right.name, 'ru', { sensitivity: 'base' });
      });
  });

  return { campaignQuery, roleFilter, masterCount, playerCount, visibleCampaigns };
}
