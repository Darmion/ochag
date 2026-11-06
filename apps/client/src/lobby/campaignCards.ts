export type LobbyCampaign = {
  id: string;
  name: string;
  owner_user_id: string;
  avatar_asset_id: string | null;
  banner_asset_id: string | null;
  avatar_crop?: unknown;
  banner_crop?: unknown;
};
export type CampaignOverview = {
  members: number;
  heroes: number;
  npcs: number;
  objects: number;
  scenes: number;
  rules: number;
  activeQuests: number;
  worldMinutes: number;
};
export type CampaignImages = Record<string, { avatar?: string; banner?: string }>;

export function campaignMonogram(campaign: LobbyCampaign) {
  const words = campaign.name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? `${words[0]![0] ?? ''}${words[1]![0] ?? ''}` : campaign.name.slice(0, 2)).toLocaleUpperCase('ru-RU');
}

export function campaignVariant(campaign: LobbyCampaign) {
  return [...campaign.id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 4;
}

export function campaignNumber(campaigns: LobbyCampaign[], campaign: LobbyCampaign) {
  return String(campaigns.findIndex(entry => entry.id === campaign.id) + 1).padStart(2, '0');
}

export function worldTime(minutes: number) {
  const safe = Math.max(0, Math.floor(minutes));
  const day = Math.floor(safe / 1440) + 1;
  const hours = Math.floor((safe % 1440) / 60);
  const rest = safe % 60;
  return `День ${day}, ${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}
