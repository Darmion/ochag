import { SIZES } from '../map/footprint.ts';

export function dragSlows(grapplerSize: string | null | undefined, draggedSize: string | null | undefined): boolean {
  const rank = (size: string | null | undefined) => {
    const index = SIZES.indexOf((size ?? 'medium') as (typeof SIZES)[number]);
    return index < 0 ? SIZES.indexOf('medium') : index;
  };
  return rank(grapplerSize) - rank(draggedSize) < 2;
}

export function movesTowardFear(feetBefore: number, feetAfter: number): boolean {
  return feetAfter < feetBefore - 1e-9;
}
