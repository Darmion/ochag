export type LightLevel = 0 | 1 | 2;
export type SceneLighting = 'bright' | 'dim' | 'dark';
export type SeenLight = 'bright' | 'dim' | 'dark';

export const BASE_LIGHT: Record<SceneLighting, LightLevel> = { bright: 2, dim: 1, dark: 0 };

const EPSILON = 1e-9;

export function lightFrom(distanceFeet: number, light: { bright: number; dim: number }): LightLevel | null {
  if (distanceFeet <= light.bright + EPSILON) return 2;
  if (distanceFeet <= light.bright + light.dim + EPSILON) return 1;
  return null;
}

const CONE_HALF_ANGLE = Math.atan(0.5);
export function inLightCone(dx: number, dz: number, directionDegrees: number): boolean {
  if (Math.hypot(dx, dz) < 0.5) return true;
  const angle = (directionDegrees * Math.PI) / 180;
  const fx = Math.sin(angle);
  const fz = Math.cos(angle);
  const along = dx * fx + dz * fz;
  const across = dx * fz - dz * fx;
  return along > 0 && Math.abs(Math.atan2(across, along)) <= CONE_HALF_ANGLE + 1e-9;
}

export function seenLight(level: LightLevel, distanceFeet: number, darkvisionFeet: number): SeenLight | null {
  const darkvision = darkvisionFeet > 0 && distanceFeet <= darkvisionFeet + EPSILON;
  if (level === 2) return 'bright';
  if (level === 1) return darkvision ? 'bright' : 'dim';
  return darkvision ? 'dark' : null;
}

export function seenThrough(
  level: LightLevel, distanceFeet: number, darkvisionFeet: number,
  options: { magicalDarkness?: boolean; devilsSightFeet?: number } = {},
): SeenLight | null {
  const devil = (options.devilsSightFeet ?? 0) > 0 && distanceFeet <= (options.devilsSightFeet ?? 0) + EPSILON;
  if (options.magicalDarkness) return devil ? 'bright' : null;
  if (level === 0 && devil) return 'bright';
  return seenLight(level, distanceFeet, darkvisionFeet);
}

export const DEVILS_SIGHT_FEET = 120;

const RANK: Record<SeenLight, number> = { dark: 0, dim: 1, bright: 2 };

export function betterSeen(a: SeenLight | undefined, b: SeenLight): SeenLight {
  return a !== undefined && RANK[a] >= RANK[b] ? a : b;
}
