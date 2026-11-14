import type { WallKind } from './walls.ts';

export const SCENE_PRESET_IDS = ['tavern', 'cave', 'glade', 'road'] as const;
export type ScenePresetId = typeof SCENE_PRESET_IDS[number];

type Corner = readonly [col: number, row: number];
type Water = readonly [col: number, row: number, depth: 1 | 2];
type Rise = readonly [col: number, row: number, feet: number];
type PresetStyle = 'stone' | 'brick' | 'wood' | 'hedge' | 'rock';
type PresetLine = { path: readonly Corner[]; kind?: WallKind; style: PresetStyle; closed?: boolean };

export type ScenePreset = {
  id: ScenePresetId;
  widthCells: number;
  heightCells: number;
  lighting: 'bright' | 'dim' | 'dark';
  sky: 'fixed' | 'clock';
  ambience: { place: 'none' | 'forest' | 'cave' | 'beach' | 'sea' | 'inside'; water: 'none' | 'river' | 'stream' | 'waterfall'; steps: 'auto' | 'dirt' | 'stone' | 'water' | 'wood' };
  lines: readonly PresetLine[];
  difficult: readonly Corner[];
  water: readonly Water[];
  elevation: readonly Rise[];
};

const pool = (cols: readonly number[], rows: readonly number[], depth: 1 | 2): Water[] =>
  cols.flatMap(col => rows.map(row => [col, row, depth] as const));
const rise = (cols: readonly number[], rows: readonly number[], feet: number): Rise[] =>
  cols.flatMap(col => rows.map(row => [col, row, feet] as const));

const doorAt = (from: Corner, to: Corner): PresetLine => ({ path: [from, to], kind: 'door', style: 'wood' });
const windowAt = (from: Corner, to: Corner): PresetLine => ({ path: [from, to], kind: 'window', style: 'stone' });

const TAVERN: ScenePreset = {
  id: 'tavern', widthCells: 16, heightCells: 12, lighting: 'bright', sky: 'fixed',
  ambience: { place: 'inside', water: 'none', steps: 'wood' },
  lines: [
    { path: [[0, 0], [3, 0]], style: 'stone' }, windowAt([3, 0], [4, 0]),
    { path: [[4, 0], [7, 0]], style: 'stone' }, windowAt([7, 0], [8, 0]),
    { path: [[8, 0], [16, 0], [16, 2]], style: 'stone' }, doorAt([16, 2], [16, 3]),
    { path: [[16, 3], [16, 12], [8, 12]], style: 'stone' }, doorAt([8, 12], [7, 12]),
    { path: [[7, 12], [0, 12], [0, 6]], style: 'stone' }, windowAt([0, 6], [0, 5]),
    { path: [[0, 5], [0, 0]], style: 'stone' },
    { path: [[16, 5], [12, 5], [12, 4]], style: 'wood' }, doorAt([12, 4], [12, 3]),
    { path: [[12, 3], [12, 0]], style: 'wood' },
    { path: [[0, 9], [3, 9]], style: 'wood' }, doorAt([3, 9], [4, 9]),
    { path: [[4, 9], [4, 12]], style: 'wood' },
  ],
  difficult: [
    [3, 3], [4, 3], [7, 3], [8, 3], [3, 6], [4, 6], [7, 6], [8, 6],
    [10, 7], [11, 7], [12, 7], [13, 7], [14, 7],
  ],
  water: [],
  elevation: [],
};

const CAVE: ScenePreset = {
  id: 'cave', widthCells: 24, heightCells: 20, lighting: 'dim', sky: 'fixed',
  ambience: { place: 'cave', water: 'stream', steps: 'stone' },
  lines: [
    { path: [[14, 19], [19, 18], [22, 15], [21, 11], [22, 7], [20, 3], [15, 1], [12, 2], [7, 1], [3, 4], [1, 8], [2, 11], [3, 15], [6, 18], [10, 19]], style: 'rock' },
    { path: [[8, 7], [11, 6], [12, 9], [9, 10]], style: 'rock', closed: true },
    { path: [[15, 12], [18, 10], [18, 14]], style: 'rock', closed: true },
    { path: [[22, 7], [17, 8]], style: 'rock' },
  ],
  difficult: [
    [5, 12], [6, 12], [5, 13], [13, 14], [14, 14], [14, 15], [19, 5], [20, 5], [11, 16], [12, 16],
  ],
  water: [...pool([5, 6], [6, 7], 2), ...pool([4, 7], [6, 7], 1), ...pool([5, 6], [5, 8], 1)],
  elevation: rise([16, 17, 18, 19], [3, 4, 5, 6], 10),
};

const GLADE: ScenePreset = {
  id: 'glade', widthCells: 20, heightCells: 20, lighting: 'bright', sky: 'clock',
  ambience: { place: 'forest', water: 'stream', steps: 'dirt' },
  lines: [
    { path: [[8, 2], [4, 3], [2, 6], [2, 10], [3, 14], [6, 17]], style: 'hedge' },
    { path: [[10, 18], [14, 18], [17, 15], [18, 12]], style: 'hedge' },
    { path: [[18, 9], [17, 5], [15, 2], [11, 2]], style: 'hedge' },
    { path: [[6, 6], [8, 7], [7, 9]], style: 'rock', closed: true },
    { path: [[12, 12], [14, 11], [14, 13]], style: 'rock', closed: true },
  ],
  difficult: [
    [3, 8], [3, 9], [4, 9], [3, 10], [4, 12], [5, 14], [12, 3], [13, 3], [15, 4], [16, 6], [16, 7], [15, 15], [14, 16],
  ],
  water: [...pool([12, 13], [7, 8], 2), ...pool([11, 14], [7, 8], 1), ...pool([12, 13], [6, 9], 1)],
  elevation: [...rise([5, 6, 7], [11, 12, 13], 5).filter(([col, row]) => col !== 6 || row !== 12), [6, 12, 10]],
};

const ROAD: ScenePreset = {
  id: 'road', widthCells: 30, heightCells: 12, lighting: 'bright', sky: 'clock',
  ambience: { place: 'forest', water: 'stream', steps: 'dirt' },
  lines: [
    { path: [[0, 3], [6, 3], [9, 2]], style: 'hedge' },
    { path: [[12, 2], [18, 3], [22, 3]], style: 'hedge' },
    { path: [[25, 3], [30, 3]], style: 'hedge' },
    { path: [[0, 9], [5, 9]], style: 'hedge' },
    { path: [[8, 9], [14, 10], [20, 9], [24, 9]], style: 'hedge' },
    { path: [[27, 9], [30, 9]], style: 'hedge' },
    { path: [[4, 0], [6, 1], [4, 2]], style: 'rock', closed: true },
    { path: [[22, 10], [24, 11], [22, 12]], style: 'rock', closed: true },
  ],
  difficult: [
    [2, 8], [3, 8], [4, 8], [5, 8], [14, 3], [15, 3], [16, 3], [17, 3], [10, 5], [11, 5], [10, 6], [11, 6], [26, 8], [27, 8],
  ],
  water: [...pool([19, 20], [0, 1, 2], 2), ...pool([19, 20], [3, 4, 5, 6, 7, 8], 1), ...pool([19, 20], [9, 10, 11], 2)],
  elevation: [],
};

export const SCENE_PRESETS: Readonly<Record<ScenePresetId, ScenePreset>> = { tavern: TAVERN, cave: CAVE, glade: GLADE, road: ROAD };

export type PresetWall = { x1: number; z1: number; x2: number; z2: number; kind: WallKind; style: PresetStyle };

export function presetWalls(preset: ScenePreset): PresetWall[] {
  const halfW = preset.widthCells / 2, halfH = preset.heightCells / 2;
  const walls: PresetWall[] = [];
  for (const line of preset.lines) {
    const points = line.closed ? [...line.path, line.path[0]!] : line.path;
    for (let index = 1; index < points.length; index += 1) {
      const [c1, r1] = points[index - 1]!, [c2, r2] = points[index]!;
      walls.push({ x1: c1 - halfW, z1: r1 - halfH, x2: c2 - halfW, z2: r2 - halfH, kind: line.kind ?? 'wall', style: line.style });
    }
  }
  return walls;
}

export function presetDifficultCells(preset: ScenePreset): number[][] {
  return preset.difficult.map(([col, row]) => [col, row]);
}

export function presetWaterCells(preset: ScenePreset): number[][] {
  return preset.water.map(([col, row, depth]) => [col, row, depth]);
}

export function presetElevationCells(preset: ScenePreset): number[][] {
  return preset.elevation.map(([col, row, feet]) => [col, row, feet]);
}
