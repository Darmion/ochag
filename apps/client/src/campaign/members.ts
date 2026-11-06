export type CampaignMember = { userId: string; displayName: string };

type RequestFn = (path: string, method?: string, body?: unknown) => Promise<any>;

const cache = new Map<string, CampaignMember[]>();
const pending = new Map<string, Promise<CampaignMember[]>>();

export async function ensureCampaignMembers(request: RequestFn, campaignId: string): Promise<CampaignMember[]> {
  const cached = cache.get(campaignId);
  if (cached) return cached;

  let inFlight = pending.get(campaignId);
  if (!inFlight) {
    inFlight = request(`/campaigns/${campaignId}/members/roster`).then(data => {
      const members: CampaignMember[] = data.members;
      cache.set(campaignId, members);
      return members;
    });
    pending.set(campaignId, inFlight);
  }

  return inFlight;
}
