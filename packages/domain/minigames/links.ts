// What a finished mini-game changes outside its window (roadmap 4.3): a lock on a chest or a door, a secret on a scene,
// a potion in a hero's bag. The game keeps the link in its own state; the server applies it when the game ends well.
export type ObjectLink = { kind: 'object'; id: string; name: string };
export type DoorLink = { kind: 'door'; sceneId: string; sceneName: string; x1: number; z1: number; x2: number; z2: number };
export type LockTarget = ObjectLink | DoorLink;
export type HeroLink = { id: string; name: string };

type Segment = { x1: number; z1: number; x2: number; z2: number };

const EPSILON = 1e-3;

function nearSegment(segment: Segment, x: number, z: number) {
  const dx = segment.x2 - segment.x1, dz = segment.z2 - segment.z1;
  const length = dx * dx + dz * dz;
  const t = length ? Math.max(0, Math.min(1, ((x - segment.x1) * dx + (z - segment.z1) * dz) / length)) : 0;
  return Math.hypot(segment.x1 + t * dx - x, segment.z1 + t * dz - z) <= EPSILON;
}

// A door may be cut into 5-foot pieces after the lock was hung on it: every piece lying on the remembered segment is the door.
export function onSegment(segment: Segment, piece: Segment) {
  return nearSegment(segment, piece.x1, piece.z1) && nearSegment(segment, piece.x2, piece.z2);
}
