import type { WallSegment } from './scene';
import type { WallCoords } from './view/types';

export function wallCoords(wall: WallSegment): WallCoords {
  const style = wall.style ?? 'stone';
  return { x1: wall.x1, z1: wall.z1, x2: wall.x2, z2: wall.z2, style, ...(style === 'image' && wall.texture_asset_id ? { textureAssetId: wall.texture_asset_id } : {}) };
}
