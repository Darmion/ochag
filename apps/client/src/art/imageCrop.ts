export type ImageCrop = { x: number; y: number; zoom: number };

export const DEFAULT_CROP: ImageCrop = { x: 50, y: 50, zoom: 1 };
export const MAX_ZOOM = 4;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function normalizeCrop(value: unknown): ImageCrop | null {
  if (!value || typeof value !== 'object') return null;
  const { x, y, zoom } = value as Record<string, unknown>;
  if (![x, y, zoom].every(item => typeof item === 'number' && Number.isFinite(item))) return null;
  return {
    x: Math.round(clamp(x as number, 0, 100) * 10) / 10,
    y: Math.round(clamp(y as number, 0, 100) * 10) / 10,
    zoom: Math.round(clamp(zoom as number, 1, MAX_ZOOM) * 100) / 100,
  };
}

export function cropStyle(value: unknown): Record<string, string> {
  const crop = normalizeCrop(value);
  if (!crop) return {};
  const origin = `${crop.x}% ${crop.y}%`;
  return {
    objectFit: 'cover',
    objectPosition: origin,
    transformOrigin: origin,
    ...(crop.zoom !== 1 ? { transform: `scale(${crop.zoom})` } : {}),
  };
}

export function dragCrop(crop: ImageCrop, dx: number, dy: number, frame: { width: number; height: number }): ImageCrop {
  return {
    x: clamp(crop.x - (dx / Math.max(1, frame.width)) * 100 / crop.zoom, 0, 100),
    y: clamp(crop.y - (dy / Math.max(1, frame.height)) * 100 / crop.zoom, 0, 100),
    zoom: crop.zoom,
  };
}

export function zoomCrop(crop: ImageCrop, zoom: number): ImageCrop {
  return { ...crop, zoom: clamp(zoom, 1, MAX_ZOOM) };
}
