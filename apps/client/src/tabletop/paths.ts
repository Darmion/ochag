import type { Position } from './grid.ts';

export function simplifyPath(points: Position[], epsilon = 0.03): Position[] {
  if (points.length < 3) return points;

  const first = points[0]!;
  const last = points[points.length - 1]!;
  let farthest = 0;
  let index = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const distance = distanceToSegment(points[i]!, first, last);
    if (distance > farthest) {
      farthest = distance;
      index = i;
    }
  }

  if (farthest <= epsilon) return [first, last];

  const left = simplifyPath(points.slice(0, index + 1), epsilon);
  const right = simplifyPath(points.slice(index), epsilon);
  return [...left.slice(0, -1), ...right];
}

export function distanceToSegment(point: Position, a: Position, b: Position) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = dx * dx + dz * dz;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / length));
  return Math.hypot(point.x - (a.x + t * dx), point.z - (a.z + t * dz));
}

export function distanceToDrawing(point: Position, drawing: { points: number[][] }) {
  const points = drawing.points.map(([x, z]) => ({ x: x!, z: z! }));
  if (points.length === 1) return Math.hypot(point.x - points[0]!.x, point.z - points[0]!.z);

  let best = Infinity;
  for (let i = 1; i < points.length; i++) best = Math.min(best, distanceToSegment(point, points[i - 1]!, points[i]!));
  return best;
}
