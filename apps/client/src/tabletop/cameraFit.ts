export type ScreenRect = { left: number; top: number; right: number; bottom: number };
type V3 = { x: number; y: number; z: number };

export type FitInput = {
  points: V3[];
  alpha: number;
  beta: number;
  // Vertical field of view in radians (Babylon FOVMODE_VERTICAL_FIXED).
  fov: number;
  size: { width: number; height: number };
  rect: ScreenRect;
  minRadius: number;
  maxRadius: number;
};

export type FitResult = {
  target: { x: number; z: number };
  radius: number;
  fits: boolean;
  coverage: number;
};

const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const normalize = (a: V3): V3 => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };

// Camera axes as in Babylon's LookAtLH: forward from eye to target, right = up × forward, up = forward × right.
export function cameraBasis(alpha: number, beta: number) {
  const sinBeta = Math.sin(beta) || 1e-4;
  const look = normalize({ x: -Math.cos(alpha) * sinBeta, y: -Math.cos(beta), z: -Math.sin(alpha) * sinBeta });
  const side = normalize(cross({ x: 0, y: 1, z: 0 }, look));
  const up = cross(look, side);
  return { look, side, up };
}

export function projectPoint(point: V3, eye: V3, basis: ReturnType<typeof cameraBasis>, focal: number, size: { width: number; height: number }) {
  const d = { x: point.x - eye.x, y: point.y - eye.y, z: point.z - eye.z };
  const depth = dot(d, basis.look);
  return { x: size.width / 2 + focal * dot(d, basis.side) / depth, y: size.height / 2 - focal * dot(d, basis.up) / depth, depth };
}

export function fitCamera(input: FitInput): FitResult {
  const { points, size, rect } = input;
  const basis = cameraBasis(input.alpha, input.beta);
  const focal = size.height / 2 / Math.tan(input.fov / 2);
  const cx = size.width / 2, cy = size.height / 2;
  const L = rect.left - cx, R = rect.right - cx;
  const T = cy - rect.top, B = cy - rect.bottom;
  const local = points.map(point => ({ s: dot(point, basis.side), u: dot(point, basis.up), l: dot(point, basis.look) }));
  const minOf = (f: (p: typeof local[number]) => number) => Math.min(...local.map(f));
  const maxOf = (f: (p: typeof local[number]) => number) => Math.max(...local.map(f));
  const aS = minOf(p => focal * p.s - L * p.l), bS = maxOf(p => focal * p.s - R * p.l);
  const aU = minOf(p => T * p.l - focal * p.u), bU = maxOf(p => B * p.l - focal * p.u);
  const widthBinds = (aS - bS) / (R - L) <= (aU - bU) / (T - B);
  const el = Math.min((aS - bS) / (R - L), (aU - bU) / (T - B));
  const sRange = [(bS + R * el) / focal, (aS + L * el) / focal] as const;
  const uRange = [-(aU - T * el) / focal, -(bU - B * el) / focal] as const;
  let es = (sRange[0] + sRange[1]) / 2;
  let eu = (uRange[0] + uRange[1]) / 2;
  for (let step = 0; step < 2; step++) {
    const shown = local.map(p => ({ x: cx + focal * (p.s - es) / (p.l - el), y: cy - focal * (p.u - eu) / (p.l - el), d: p.l - el }));
    const depth = shown.reduce((sum, p) => sum + p.d, 0) / shown.length;
    if (widthBinds) {
      const off = (Math.min(...shown.map(p => p.y)) + Math.max(...shown.map(p => p.y))) / 2 - (rect.top + rect.bottom) / 2;
      eu = Math.min(uRange[1], Math.max(uRange[0], eu - off * depth / focal));
    } else {
      const off = (Math.min(...shown.map(p => p.x)) + Math.max(...shown.map(p => p.x))) / 2 - (rect.left + rect.right) / 2;
      es = Math.min(sRange[1], Math.max(sRange[0], es + off * depth / focal));
    }
  }
  const eye = {
    x: basis.side.x * es + basis.up.x * eu + basis.look.x * el,
    y: basis.side.y * es + basis.up.y * eu + basis.look.y * el,
    z: basis.side.z * es + basis.up.z * eu + basis.look.z * el,
  };
  const down = -basis.look.y;
  const exact = down > 1e-6 ? eye.y / down : NaN;
  let target: { x: number; z: number };
  let radius: number;
  if (Number.isFinite(exact) && exact > 0) {
    radius = Math.min(input.maxRadius, Math.max(input.minRadius, exact));
    target = { x: eye.x + basis.look.x * exact, z: eye.z + basis.look.z * exact };
  } else {
    const mid = { x: (Math.min(...points.map(p => p.x)) + Math.max(...points.map(p => p.x))) / 2, y: 0, z: (Math.min(...points.map(p => p.z)) + Math.max(...points.map(p => p.z))) / 2 };
    const reach = Math.max(...points.map(p => Math.hypot(p.x - mid.x, p.y, p.z - mid.z)));
    target = { x: mid.x, z: mid.z };
    radius = Math.min(input.maxRadius, Math.max(input.minRadius, (reach / Math.sin(input.fov / 2)) * 1.1));
  }
  const finalEye = { x: target.x - basis.look.x * radius, y: -basis.look.y * radius, z: target.z - basis.look.z * radius };
  const projected = points.map(point => projectPoint(point, finalEye, basis, focal, size));
  const xs = projected.map(p => p.x), ys = projected.map(p => p.y);
  const inside = projected.every(p => p.depth > 0) &&
    Math.min(...xs) >= rect.left - 2 && Math.max(...xs) <= rect.right + 2 &&
    Math.min(...ys) >= rect.top - 2 && Math.max(...ys) <= rect.bottom + 2;
  const coverage = inside
    ? ((Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))) / Math.max(1, (rect.right - rect.left) * (rect.bottom - rect.top))
    : 0;
  return { target, radius, fits: inside, coverage };
}

export function freeRect(size: { width: number; height: number }, insets: { left: number; top: number; right: number; bottom: number }, margin = 16): ScreenRect {
  const rect = {
    left: Math.max(0, insets.left) + margin,
    top: Math.max(0, insets.top) + margin,
    right: size.width - Math.max(0, insets.right) - margin,
    bottom: size.height - Math.max(0, insets.bottom) - margin,
  };
  const width = rect.right - rect.left, height = rect.bottom - rect.top;
  if (width < 160 || height < 120 || width * height < size.width * size.height * 0.25) {
    return { left: margin, top: margin, right: size.width - margin, bottom: size.height - margin };
  }
  return rect;
}

export function insetsFromPanels(size: { width: number; height: number }, panels: ScreenRect[]) {
  const insets = { left: 0, top: 0, right: 0, bottom: 0 };
  const visible = panels
    .map(panel => ({ left: Math.max(0, panel.left), top: Math.max(0, panel.top), right: Math.min(size.width, panel.right), bottom: Math.min(size.height, panel.bottom) }))
    .filter(panel => panel.right - panel.left > 0 && panel.bottom - panel.top > 0)
    .sort((a, b) => (b.right - b.left) * (b.bottom - b.top) - (a.right - a.left) * (a.bottom - a.top));
  const area = (next: typeof insets) => Math.max(0, size.width - next.left - next.right) * Math.max(0, size.height - next.top - next.bottom);
  for (const panel of visible) {
    const options = [
      { ...insets, left: Math.max(insets.left, panel.right) },
      { ...insets, right: Math.max(insets.right, size.width - panel.left) },
      { ...insets, top: Math.max(insets.top, panel.bottom) },
      { ...insets, bottom: Math.max(insets.bottom, size.height - panel.top) },
    ];
    const free = { left: insets.left, top: insets.top, right: size.width - insets.right, bottom: size.height - insets.bottom };
    if (panel.right <= free.left || panel.left >= free.right || panel.bottom <= free.top || panel.top >= free.bottom) continue;
    const best = options.reduce((a, b) => (area(b) > area(a) ? b : a));
    Object.assign(insets, best);
  }
  return insets;
}
