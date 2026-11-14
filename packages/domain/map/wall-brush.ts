// A freehand stroke becomes a chain of wall segments between grid nodes, the same nodes the click tools use.
// The chain grows as the hand moves: a corner, once fixed, never moves again; only the last wall follows the pointer.

export type BrushPoint = { x: number; z: number };
export type BrushSegment = { x1: number; z1: number; x2: number; z2: number };
export type BrushDetail = 'fine' | 'normal' | 'rough';

export const BRUSH_DETAILS: readonly BrushDetail[] = ['fine', 'normal', 'rough'];
export const MAX_BRUSH_SEGMENTS = 400;

const TOLERANCE: Record<BrushDetail, number> = { fine: 0.3, normal: 0.7, rough: 1.2 };
const SAMPLE_STEP = 0.4;
const CLOSE_GAP = 1.5;
const CLOSE_MIN_LENGTH = 6;

function node(value: number, cells: number) {
  const half = cells / 2;
  return Math.max(-half, Math.min(half, Math.round(value + half) - half));
}

const same = (a: BrushPoint, b: BrushPoint) => a.x === b.x && a.z === b.z;
const gap = (a: BrushPoint, b: BrushPoint) => Math.hypot(b.x - a.x, b.z - a.z);
const key = (a: BrushPoint, b: BrushPoint) => [`${a.x},${a.z}`, `${b.x},${b.z}`].sort().join('|');

function offLine(point: BrushPoint, a: BrushPoint, b: BrushPoint) {
  const length = gap(a, b);
  if (length === 0) return gap(point, a);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * (b.x - a.x) + (point.z - a.z) * (b.z - a.z)) / (length * length)));
  return gap(point, { x: a.x + t * (b.x - a.x), z: a.z + t * (b.z - a.z) });
}

export function strokeLength(stroke: readonly BrushPoint[]) {
  let total = 0;
  for (let at = 1; at < stroke.length; at++) total += gap(stroke[at - 1]!, stroke[at]!);
  return total;
}

// A stroke that ends near where it began (and is long enough to be a shape, not a scribble) closes into a loop.
export function strokeCloses(stroke: readonly BrushPoint[]) {
  return stroke.length > 2 && gap(stroke[0]!, stroke[stroke.length - 1]!) <= CLOSE_GAP && strokeLength(stroke) >= CLOSE_MIN_LENGTH;
}

function chain(points: readonly BrushPoint[]): BrushSegment[] {
  const seen = new Set<string>();
  const segments: BrushSegment[] = [];
  for (let at = 1; at < points.length && segments.length < MAX_BRUSH_SEGMENTS; at++) {
    const a = points[at - 1]!;
    const b = points[at]!;
    if (same(a, b) || seen.has(key(a, b))) continue;
    seen.add(key(a, b));
    segments.push({ x1: a.x, z1: a.z, x2: b.x, z2: b.z });
  }
  return segments;
}

// The «sleeve» rule: the open wall runs from the last fixed corner to the newest node while every node passed on the way
// stays within the tolerance of it; when one falls out, the node before the newest becomes a fixed corner.
export function createBrushPath(widthCells: number, heightCells: number, detail: BrushDetail = 'normal') {
  const tolerance = TOLERANCE[detail];
  const snap = (point: BrushPoint): BrushPoint => ({ x: node(point.x, widthCells), z: node(point.z, heightCells) });
  const corners: BrushPoint[] = [];
  let tail: BrushPoint[] = [];
  let first: BrushPoint | null = null;
  let last: BrushPoint | null = null;
  let length = 0;

  function keep(next: BrushPoint) {
    const anchor = corners[corners.length - 1]!;
    if (same(next, tail[tail.length - 1] ?? anchor)) return;
    // A wobble back to the node before is not a wall; fixed corners are never taken back.
    const before = tail.length >= 2 ? tail[tail.length - 2]! : tail.length === 1 ? anchor : null;
    if (before && same(next, before)) {
      tail.pop();
      return;
    }
    if (corners.length > MAX_BRUSH_SEGMENTS) return;
    tail.push(next);
    if (tail.every(point => offLine(point, anchor, next) <= tolerance)) return;
    corners.push(tail[tail.length - 2]!);
    tail = [next];
  }

  function add(point: BrushPoint) {
    if (!last) {
      first = point;
      last = point;
      corners.push(snap(point));
      return;
    }
    const steps = Math.max(1, Math.ceil(gap(last, point) / SAMPLE_STEP));
    for (let step = 1; step <= steps; step++) {
      keep(snap({ x: last.x + ((point.x - last.x) * step) / steps, z: last.z + ((point.z - last.z) * step) / steps }));
    }
    length += gap(last, point);
    last = point;
  }

  const end = () => tail[tail.length - 1] ?? corners[corners.length - 1];
  const closes = () => Boolean(first && last) && gap(first!, last!) <= CLOSE_GAP && length >= CLOSE_MIN_LENGTH && corners.length + tail.length >= 3;

  // What the preview shows: walls that will not change, and the one that still follows the hand.
  function walls(): { fixed: BrushSegment[]; open: BrushSegment | null } {
    const fixed = chain(corners);
    const tip = end();
    const anchor = corners[corners.length - 1];
    const open = tip && anchor && !same(tip, anchor) && !fixed.some(segment => key({ x: segment.x1, z: segment.z1 }, { x: segment.x2, z: segment.z2 }) === key(anchor, tip))
      ? { x1: anchor.x, z1: anchor.z, x2: tip.x, z2: tip.z }
      : null;
    return { fixed, open };
  }

  function finish(): { segments: BrushSegment[]; closed: boolean } {
    const tip = end();
    if (!tip) return { segments: [], closed: false };
    const points = same(tip, corners[corners.length - 1]!) ? [...corners] : [...corners, tip];
    const closed = closes();
    if (closed && !same(points[0]!, points[points.length - 1]!)) points.push(points[0]!);
    const segments = chain(points);
    return { segments, closed: closed && segments.length >= 3 };
  }

  return { add, walls, finish, closes };
}

export type BrushPath = ReturnType<typeof createBrushPath>;

export function strokeToWalls(
  stroke: readonly BrushPoint[], widthCells: number, heightCells: number, detail: BrushDetail = 'normal',
): { segments: BrushSegment[]; closed: boolean } {
  if (stroke.length < 2) return { segments: [], closed: false };
  const path = createBrushPath(widthCells, heightCells, detail);
  for (const point of stroke) path.add(point);
  return path.finish();
}
