export type CampaignEventMap = {
  notes: undefined;
  character: string;
  characters: undefined;
  rolls: undefined;
  initiative: string | null;
  changed: undefined;
  handout: { id: string; title: string; body: string | null; assetId: string | null };
  dialogue: undefined;
  art: undefined;
  audio: undefined;
};

type Handler<T> = (payload: T) => void;

const handlers = new Map<keyof CampaignEventMap, Set<Handler<any>>>();

export function onCampaignEvent<K extends keyof CampaignEventMap>(type: K, handler: Handler<CampaignEventMap[K]>) {
  let set = handlers.get(type);
  if (!set) {
    set = new Set();
    handlers.set(type, set);
  }
  set.add(handler);
  return () => set!.delete(handler);
}

export function emitCampaignEvent<K extends keyof CampaignEventMap>(type: K, payload: CampaignEventMap[K]) {
  for (const handler of handlers.get(type) ?? []) {
    try {
      handler(payload);
    } catch {
    }
  }
}
