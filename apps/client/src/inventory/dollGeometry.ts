export type Size = { width: number; height: number };
export type Crop = { x: number; y: number; zoom: number };

const NO_CROP: Crop = { x: 50, y: 50, zoom: 1 };

// Mirrors cropStyle: object-fit cover at object-position x%/y%, then scale(zoom) about the same point of the frame.
function layout(image: Size | null, frame: Size, crop: Crop | null) {
  const c = crop ?? NO_CROP;
  if (!image || image.width <= 0 || image.height <= 0) return { scale: 1, width: frame.width, height: frame.height, ox: 0, oy: 0, zoom: 1, cx: 0, cy: 0 };
  const scale = Math.max(frame.width / image.width, frame.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return {
    scale, width, height,
    ox: (frame.width - width) * c.x / 100, oy: (frame.height - height) * c.y / 100,
    zoom: c.zoom, cx: frame.width * c.x / 100, cy: frame.height * c.y / 100,
  };
}

export function toFrame(point: { x: number; y: number }, image: Size | null, frame: Size, crop: Crop | null) {
  const l = layout(image, frame, crop);
  const px = l.ox + point.x * l.width;
  const py = l.oy + point.y * l.height;
  return { x: l.cx + (px - l.cx) * l.zoom, y: l.cy + (py - l.cy) * l.zoom };
}

export function fromFrame(at: { x: number; y: number }, image: Size | null, frame: Size, crop: Crop | null) {
  const l = layout(image, frame, crop);
  const px = l.cx + (at.x - l.cx) / l.zoom;
  const py = l.cy + (at.y - l.cy) / l.zoom;
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  return { x: clamp((px - l.ox) / l.width), y: clamp((py - l.oy) / l.height) };
}

export function clampToFrame(at: { x: number; y: number }, frame: Size, radius: number) {
  return {
    x: Math.min(frame.width - radius, Math.max(radius, at.x)),
    y: Math.min(frame.height - radius, Math.max(radius, at.y)),
  };
}
