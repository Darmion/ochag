export type CampaignEvent = Record<string, unknown> & { type: string };
type Listener = (campaignId: string, event: CampaignEvent) => void;

export function createCampaignEvents() {
  const listeners = new Set<Listener>();

  return {
    listen(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(campaignId: string, event: CampaignEvent) {
      for (const listener of listeners) listener(campaignId, event);
    },
  };
}

export type CampaignEvents = ReturnType<typeof createCampaignEvents>;

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const NOTES = new RegExp(`^/campaigns/(${UUID})/notes(?:/|$|[?])`);
const CHARACTER = new RegExp(`^/campaigns/(${UUID})/characters/(${UUID})(?:/|$|[?])`);
const CHARACTERS = new RegExp(`^/campaigns/(${UUID})/characters(?:$|[?])`);
const SPELLS = new RegExp(`^/campaigns/(${UUID})/spells(?:/|$|[?])`);
const MINIGAME = new RegExp(`^/campaigns/(${UUID})/minigames/(dragon-dice|rune-lock|seal-ritual|alchemy|chase|duel|map-fragments)(?:$|[?])`);
// A file deleted where it was used empties scenes, figures and the player: every table reloads.
const ASSET_EVERYWHERE = new RegExp(`^/campaigns/(${UUID})/assets/${UUID}\\?everywhere=1$`);

export function eventForRequest(method: string, url: string): { campaignId: string; event: CampaignEvent } | null {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;

  let match = NOTES.exec(url);
  if (match) return { campaignId: match[1]!, event: { type: 'notes' } };

  match = CHARACTER.exec(url);
  if (match) return { campaignId: match[1]!, event: { type: 'character', characterId: match[2]!.toLowerCase() } };

  match = CHARACTERS.exec(url);
  if (match) return { campaignId: match[1]!, event: { type: 'characters' } };

  match = SPELLS.exec(url);
  if (match) return { campaignId: match[1]!, event: { type: 'characters' } };

  // Each player reads the game back through its own view (the duel hides the other's move), so the event names only the kind.
  match = MINIGAME.exec(url);
  if (match) return { campaignId: match[1]!, event: { type: 'minigame', kind: match[2]! } };

  match = ASSET_EVERYWHERE.exec(url);
  if (match) return { campaignId: match[1]!, event: { type: 'changed' } };

  return null;
}
