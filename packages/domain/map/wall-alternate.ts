import { wallSteps } from './walls.ts';

export type WallLine = { id: string; x1: number; z1: number; x2: number; z2: number };
export type AlternateMode = 'cycle' | 'mix';
export type WallSection<T> = { from: number; to: number; style: T };
export type OrderedWall<W> = { wall: W; reversed: boolean; chain: number };

const point = (x: number, z: number) => `${Math.round(x * 1000)}:${Math.round(z * 1000)}`;

export function orderWallsAlong<W extends WallLine>(walls: W[]): Array<OrderedWall<W>> {
  const byPoint = new Map<string, W[]>();
  for (const wall of walls) {
    for (const key of [point(wall.x1, wall.z1), point(wall.x2, wall.z2)]) byPoint.set(key, [...(byPoint.get(key) ?? []), wall]);
  }
  const degree = (wall: W) => [point(wall.x1, wall.z1), point(wall.x2, wall.z2)].filter(key => (byPoint.get(key)?.length ?? 0) > 1).length;
  const left = new Set(walls.map(wall => wall.id));
  const order: Array<OrderedWall<W>> = [];
  const sorted = [...walls].sort((a, b) => degree(a) - degree(b) || Math.min(a.x1, a.x2) - Math.min(b.x1, b.x2) || Math.min(a.z1, a.z2) - Math.min(b.z1, b.z2));
  let chain = 0;
  for (const start of sorted) {
    if (!left.has(start.id)) continue;
    const head = point(start.x1, start.z1);
    let from = (byPoint.get(head) ?? []).filter(entry => left.has(entry.id)).length <= 1 ? head : point(start.x2, start.z2);
    let current: W | undefined = start;
    while (current) {
      left.delete(current.id);
      const near = point(current.x1, current.z1), far = point(current.x2, current.z2);
      const reversed = from !== near;
      order.push({ wall: current, reversed, chain });
      from = reversed ? near : far;
      current = (byPoint.get(from) ?? []).find(wall => left.has(wall.id));
    }
    chain += 1;
  }
  return order;
}

// Sections run on across the walls of one chain and restart with the first style on the next chain.
export function alternateSections<W extends WallLine, T extends string>(
  walls: W[], styles: T[], mode: AlternateMode, length = 1, random: () => number = Math.random,
): Map<string, Array<WallSection<T>>> {
  const result = new Map<string, Array<WallSection<T>>>();
  if (!styles.length) return result;
  const size = Math.max(1, Math.floor(length));
  let chain = -1, tile = 0, section = -1;
  let previous: T | null = null, current: T = styles[0]!;
  const styleFor = (index: number) => {
    if (mode === 'cycle' || styles.length === 1) return styles[index % styles.length]!;
    const choices = styles.filter(entry => entry !== previous);
    return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))]!;
  };
  for (const { wall, reversed, chain: chainOf } of orderWallsAlong(walls)) {
    if (chainOf !== chain) { chain = chainOf; tile = 0; section = -1; previous = null; }
    const steps = wallSteps(wall);
    const tiles: T[] = new Array(steps);
    for (let step = 0; step < steps; step += 1, tile += 1) {
      const index = Math.floor(tile / size);
      if (index !== section) { section = index; current = styleFor(index); previous = current; }
      tiles[reversed ? steps - 1 - step : step] = current;
    }
    const sections: Array<WallSection<T>> = [];
    tiles.forEach((style, index) => {
      const last = sections[sections.length - 1];
      if (last && last.style === style) last.to = index + 1;
      else sections.push({ from: index, to: index + 1, style });
    });
    result.set(wall.id, sections);
  }
  return result;
}
