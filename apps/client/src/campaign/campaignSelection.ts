import { computed, ref, type Ref } from 'vue';
import { parseInvite, sameServer } from '../connection/connection';

export type Campaign = {
  id: string;
  name: string;
  owner_user_id: string;
  avatar_asset_id: string | null;
  banner_asset_id: string | null;
};

export function useCampaignSelection({ api, run, campaigns, campaignId, serverUrl, currentUserId, canCreateCampaigns, message, showLobby }: {
  api: (path: string, method?: string, body?: unknown, file?: File) => Promise<any>;
  run: (action: () => Promise<void>) => Promise<void>;
  campaigns: Ref<Campaign[]>;
  campaignId: Ref<string>;
  serverUrl: Ref<string>;
  currentUserId: Ref<string>;
  canCreateCampaigns: Ref<boolean>;
  message: Ref<string>;
  showLobby: () => void;
}) {
  const invitationCode = ref('');
  const campaignName = ref('');

  const isMaster = computed(() =>
    canCreateCampaigns.value ||
    campaigns.value.some(campaign => campaign.owner_user_id === currentUserId.value),
  );

  const currentCampaignName = computed(() =>
    campaigns.value.find(campaign => campaign.id === campaignId.value)?.name ?? '',
  );

  async function refreshCampaigns(preferredId?: string) {
    const result = await api('/campaigns');

    campaigns.value = result.campaigns;

    const wantedId = preferredId ?? campaignId.value;

    campaignId.value = campaigns.value.some(
      campaign => campaign.id === wantedId,
    )
      ? wantedId
      : campaigns.value[0]?.id ?? '';
  }

  const inviteServerMismatch = computed(() => {
    const address = parseInvite(invitationCode.value).address;
    return address && serverUrl.value && !sameServer(address, serverUrl.value) ? address : null;
  });

  function joinCampaign() {
    return run(async () => {
      const { code } = parseInvite(invitationCode.value);

      if (!code) {
        throw new Error('В тексте не найден код приглашения. Скопируйте приглашение мастера целиком.');
      }

      if (inviteServerMismatch.value) {
        throw new Error(`Приглашение создано на другом сервере (${inviteServerMismatch.value}). Нажмите «Перейти на сервер из приглашения».`);
      }

      const result = await api('/campaigns/join', 'POST', {
        code,
      });

      await refreshCampaigns(result.campaignId);

      invitationCode.value = '';
      showLobby();

      message.value = result.alreadyMember
        ? `Вы уже в кампании «${currentCampaignName.value}» — она выбрана в списке.`
        : `Вы присоединились к кампании «${currentCampaignName.value}».`;
    });
  }

  function onCampaignImported(report: CampaignImportReport) {
    return run(async () => {
      await refreshCampaigns(report.campaignId);
    });
  }

  function createCampaign() {
    return run(async () => {
      const name = campaignName.value.trim();

      if (!name) {
        throw new Error('Введите название кампании.');
      }

      const result = await api('/campaigns', 'POST', {
        name,
      });

      await refreshCampaigns(result.id);

      campaignName.value = '';
      showLobby();

      message.value =
        'Кампания создана. Теперь можно пригласить игроков.';
    });
  }

  return { invitationCode, campaignName, isMaster, currentCampaignName, inviteServerMismatch, refreshCampaigns, joinCampaign, onCampaignImported, createCampaign };
}
