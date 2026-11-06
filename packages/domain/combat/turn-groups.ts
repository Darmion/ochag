export type TurnSide = 'party' | 'enemy' | null;

export function turnSide(kind: string | null | undefined, disposition: string | null | undefined): TurnSide {
  if (kind === 'character' || (kind === 'npc' && disposition === 'friendly')) return 'party';
  if (kind === 'npc' && disposition === 'hostile') return 'enemy';
  return null;
}

export type Allied = (i: number, j: number) => boolean;
const sameSide = (sides: TurnSide[]): Allied => (i, j) => sides[i] !== null && sides[i] === sides[j];

export function groupFrom(sides: TurnSide[], start: number, grouped = true, allied: Allied = sameSide(sides)): number[] {
  if (start < 0 || start >= sides.length) return [];
  const group = [start];
  if (!grouped) return group;
  for (let index = start + 1; index < sides.length; index += 1) {
    if (!group.every(member => allied(member, index))) break;
    group.push(index);
  }
  return group;
}

export function groupEnd(sides: TurnSide[], index: number, grouped = true, allied: Allied = sameSide(sides)): number {
  const group = groupFrom(sides, index, grouped, allied);
  return group[group.length - 1] ?? index;
}

export function nextGroup(sides: TurnSide[], current: number[], grouped = true, allied: Allied = sameSide(sides)): { indices: number[]; wrapped: boolean } {
  if (!sides.length) return { indices: [], wrapped: false };
  if (!current.length) return { indices: groupFrom(sides, 0, grouped, allied), wrapped: false };
  let end = Math.max(...current);
  while (grouped && end + 1 < sides.length && current.every(member => allied(member, end + 1))) end += 1;
  const start = (end + 1) % sides.length;
  return { indices: groupFrom(sides, start, grouped, allied), wrapped: start <= end };
}
