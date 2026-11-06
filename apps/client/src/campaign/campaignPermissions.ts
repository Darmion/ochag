export const PERMISSION_CODES = [
  'scenes.manage',
  'characters.manage',
  'notes.manage',
  'vision.manage',
  'rules.manage',
] as const;

export type PermissionCode = typeof PERMISSION_CODES[number];

export const PERMISSION_LABELS: Record<PermissionCode, string> = {
  'scenes.manage': 'Сцены — создавать и настраивать',
  'characters.manage': 'Персонажи — править чужие листы',
  'notes.manage': 'Заметки мастера — создавать и выдавать доступ',
  'vision.manage': 'Зрение и туман — настраивать для других',
  'rules.manage': 'Правила кампании (задел на будущее)',
};

export type CampaignMember = {
  campaign_id: string;
  user_id: string;
  display_name: string;
  is_full_gm: boolean;
  may_choose_allied_vision: boolean;
  selected_vision: 'own' | 'allies';
  fog_disabled_by_gm: boolean;
  permissions: PermissionCode[];
};

type RequestFn = (path: string, method?: string, body?: unknown) => Promise<any>;

export async function loadCampaignMembers(request: RequestFn, campaignId: string): Promise<CampaignMember[]> {
  return (await request(`/campaigns/${campaignId}/members`)).members;
}

export function saveMemberPermissions(
  request: RequestFn,
  campaignId: string,
  userId: string,
  isFullGm: boolean,
  permissions: PermissionCode[],
) {
  return request(`/campaigns/${campaignId}/members/${userId}/permissions`, 'PUT', { isFullGm, permissions });
}

export function saveMemberVision(
  request: RequestFn,
  campaignId: string,
  userId: string,
  mayChooseAlliedVision: boolean,
  fogDisabledByGm: boolean,
) {
  return request(`/campaigns/${campaignId}/members/${userId}/vision`, 'PATCH', {
    mayChooseAlliedVision,
    fogDisabledByGm,
  });
}
