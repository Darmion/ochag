export const TERRAIN_KINDS = ['difficult', 'shallow', 'deep'] as const;
export type TerrainKind = typeof TERRAIN_KINDS[number];

// difficult: [[col, row]]; water: [[col, row, depth]], depth 1 — shallow water, 2 — deep water. A cell has one kind at most.
export type TerrainState = { difficult: number[][]; water: number[][] };
export type TerrainCell = { col: number; row: number };

const key = (col: number, row: number) => `${col}:${row}`;

export function terrainMap(state: TerrainState): Map<string, TerrainKind> {
  const map = new Map<string, TerrainKind>();
  for (const [col, row] of state.difficult) map.set(key(col!, row!), 'difficult');
  for (const [col, row, depth] of state.water) map.set(key(col!, row!), depth === 2 ? 'deep' : 'shallow');
  return map;
}

export function terrainState(map: Map<string, TerrainKind>): TerrainState {
  const difficult: number[][] = [];
  const water: number[][] = [];
  for (const [id, kind] of map) {
    const [col, row] = id.split(':').map(Number) as [number, number];
    if (kind === 'difficult') difficult.push([col, row]);
    else water.push([col, row, kind === 'deep' ? 2 : 1]);
  }
  return { difficult, water };
}

// Dragging from a cell that already has the chosen kind clears that kind in the rectangle; otherwise the rectangle gets it.
export function paintTerrainRect(state: TerrainState, from: TerrainCell, to: TerrainCell, kind: TerrainKind): TerrainState {
  const map = terrainMap(state);
  const erase = map.get(key(from.col, from.row)) === kind;
  for (let col = Math.min(from.col, to.col); col <= Math.max(from.col, to.col); col += 1) {
    for (let row = Math.min(from.row, to.row); row <= Math.max(from.row, to.row); row += 1) {
      const id = key(col, row);
      if (!erase) map.set(id, kind);
      else if (map.get(id) === kind) map.delete(id);
    }
  }
  return terrainState(map);
}

export function terrainCounts(state: TerrainState): Record<TerrainKind, number> {
  const counts: Record<TerrainKind, number> = { difficult: 0, shallow: 0, deep: 0 };
  for (const kind of terrainMap(state).values()) counts[kind] += 1;
  return counts;
}
