const CHESTS = 'scene/containers/chests';

const OPEN_PAIRS: Readonly<Record<string, string>> = {
  [`${CHESTS}/chest-arcane-closed`]: `${CHESTS}/chest-arcane-open`,
  [`${CHESTS}/chest-dark-closed`]: `${CHESTS}/chest-dark-coins`,
  [`${CHESTS}/chest-gold-closed`]: `${CHESTS}/chest-gold-treasure`,
  [`${CHESTS}/chest-ironbound-closed`]: `${CHESTS}/chest-ironbound-empty`,
  [`${CHESTS}/chest-mossy-closed`]: `${CHESTS}/chest-mossy-open`,
  [`${CHESTS}/chest-royal-closed`]: `${CHESTS}/chest-royal-gems`,
  [`${CHESTS}/chest-small-closed`]: `${CHESTS}/chest-small-open`,
  [`${CHESTS}/chest-wooden-closed`]: `${CHESTS}/chest-wooden-open`,
  [`${CHESTS}/mimic-closed`]: `${CHESTS}/mimic-open`,
};

export const openArtFor = (path: string): string | null => OPEN_PAIRS[path] ?? null;

export const openArtChoices = (path: string | null): string[] => {
  const pair = path ? openArtFor(path) : null;
  return [...new Set([...(pair ? [pair] : []), ...Object.values(OPEN_PAIRS), `${CHESTS}/chest-ironbound-gold`])];
};

export function boardImageId<T extends { image_open_asset_id?: string | null; state?: { open?: boolean } | null }>(object: T, closed: string | null): string | null {
  return object.state?.open && object.image_open_asset_id ? object.image_open_asset_id : closed;
}
