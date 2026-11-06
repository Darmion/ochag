import { inArea, type Area, type AreaShape } from './areas.ts';
import { footprintCells, occupiedCells } from './footprint.ts';

export type SpellArea = { shape: AreaShape; sizeFeet: number; widthFeet: number | null; fromSelf: boolean };

export const AREA_SPELL = /\b\d+-foot[- ](?:radius|cube|cone|line|sphere|cylinder|square)|\bradius\b|\bcone\b|\bcube\b|\bsphere\b|\bcylinder\b|радиус|конус|куб[ае ]|сфер|цилиндр/i;

export function spellArea(desc: string | null | undefined, range: string | null | undefined): SpellArea | null {
  const text = (desc ?? '').replace(/\s+/g, ' ');
  const fromSelf = /^(self|на себя)/i.test((range ?? '').trim());
  let match = /line (\d+) feet long and (\d+) feet wide/i.exec(text);
  if (match) return { shape: 'line', sizeFeet: Number(match[1]), widthFeet: Number(match[2]), fromSelf: true };
  match = /(\d+)-foot[- ]cone/i.exec(text);
  if (match) return { shape: 'cone', sizeFeet: Number(match[1]), widthFeet: null, fromSelf: true };
  match = /(\d+)-foot[- ]cube/i.exec(text);
  if (match) return { shape: 'square', sizeFeet: Number(match[1]), widthFeet: null, fromSelf };
  match = /(\d+)-foot[- ]radius/i.exec(text);
  if (match) return { shape: 'circle', sizeFeet: Number(match[1]), widthFeet: null, fromSelf };
  return null;
}

export function aimedSpellArea(
  spell: { desc?: string | null; range?: string | null },
  options: { attack: boolean; single: boolean; riders: string[] },
): SpellArea | null {
  const desc = spell.desc ?? '';
  if (options.attack || options.single || options.riders.some(kind => kind === 'light' || kind === 'darkness')) return null;
  return AREA_SPELL.test(desc) ? spellArea(desc, spell.range) : null;
}

export type AreaBody = { id: string; x: number; z: number; size: string; side: 'enemy' | 'ally' | 'neutral' };
export type AreaPlacement = {
  shape: AreaShape; x: number; z: number; direction: number; sizeFeet: number; widthFeet: number | null;
  enemies: string[]; neutrals: string[];
};

type Point = { x: number; z: number };

export function bestAreaPlacement(input: {
  dims: { widthCells: number; heightCells: number };
  feetPerUnit: number;
  caster: { id: string; x: number; z: number; size: string };
  area: SpellArea;
  rangeFeet: number | null;
  bodies: AreaBody[];
  blocked?: (from: Point, to: Point) => boolean;
}): AreaPlacement | null {
  const { dims, feetPerUnit, caster, area, bodies } = input;
  const scene = { width_cells: dims.widthCells, height_cells: dims.heightCells };
  const size = area.sizeFeet / feetPerUnit;
  const width = (area.widthFeet ?? 5) / feetPerUnit;
  const touched = (shape: Area, body: AreaBody) => occupiedCells(scene, body.x, body.z, footprintCells(body.size))
    .some(cell => inArea(shape, cell.col - dims.widthCells / 2 + 0.5, cell.row - dims.heightCells / 2 + 0.5));

  const enemies = bodies.filter(body => body.side === 'enemy');
  if (!enemies.length) return null;
  const candidates: Array<{ x: number; z: number; direction: number }> = [];
  if (area.fromSelf) {
    const directions = new Set<number>();
    for (let step = 0; step < 16; step += 1) directions.add(step * 22.5);
    for (const enemy of enemies) {
      directions.add(((Math.atan2(enemy.z - caster.z, enemy.x - caster.x) * 180) / Math.PI + 360) % 360);
    }
    const half = footprintCells(caster.size) / 2;
    for (const direction of directions) {
      const angle = (direction * Math.PI) / 180;
      const offset = area.shape === 'square' ? half : 0;
      const origin = area.shape === 'circle' ? { x: caster.x, z: caster.z } : { x: caster.x + Math.cos(angle) * offset, z: caster.z + Math.sin(angle) * offset };
      candidates.push({ ...origin, direction });
      if (area.shape === 'circle') break;
    }
  } else {
    const points: Point[] = [];
    for (const enemy of enemies) {
      points.push({ x: enemy.x, z: enemy.z });
      for (const [dx, dz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]] as const) points.push({ x: enemy.x + dx, z: enemy.z + dz });
    }
    for (let i = 0; i < enemies.length; i += 1) {
      for (let j = i + 1; j < enemies.length; j += 1) {
        points.push({ x: Math.round(enemies[i]!.x + enemies[j]!.x) / 2, z: Math.round(enemies[i]!.z + enemies[j]!.z) / 2 });
      }
    }
    for (const point of points) {
      const feet = Math.hypot(point.x - caster.x, point.z - caster.z) * feetPerUnit;
      if (input.rangeFeet !== null && feet > input.rangeFeet + 1e-9) continue;
      if (input.blocked?.({ x: caster.x, z: caster.z }, point)) continue;
      candidates.push({ ...point, direction: 0 });
    }
  }

  let best: AreaPlacement | null = null;
  for (const candidate of candidates) {
    const shape: Area = { shape: area.shape, x: candidate.x, z: candidate.z, direction: candidate.direction, size, width };
    const hit = bodies.filter(body => (body.id !== caster.id || !area.fromSelf) && touched(shape, body));
    const casterHit = !area.fromSelf && touched(shape, { id: caster.id, x: caster.x, z: caster.z, size: caster.size, side: 'ally' });
    if (casterHit || hit.some(body => body.side === 'ally')) continue;
    const enemyIds = hit.filter(body => body.side === 'enemy').map(body => body.id);
    if (!enemyIds.length) continue;
    const neutralIds = hit.filter(body => body.side === 'neutral').map(body => body.id);
    if (!best || enemyIds.length > best.enemies.length || (enemyIds.length === best.enemies.length && neutralIds.length < best.neutrals.length)) {
      best = {
        shape: area.shape, x: candidate.x, z: candidate.z, direction: Math.round(candidate.direction * 10) / 10,
        sizeFeet: area.sizeFeet, widthFeet: area.shape === 'line' ? area.widthFeet ?? 5 : null, enemies: enemyIds, neutrals: neutralIds,
      };
    }
  }
  return best;
}
