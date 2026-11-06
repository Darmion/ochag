export function wildShapeLimit(druidLevel: number | null | undefined): { cr: number; swim: boolean; fly: boolean } {
  const at = druidLevel ?? 2;
  return at >= 8 ? { cr: 1, swim: true, fly: true } : at >= 4 ? { cr: 0.5, swim: true, fly: false } : { cr: 0.25, swim: false, fly: false };
}

export const NATURES_WARD_TYPES = ['elemental', 'fey'] as const;

export const NATURES_SANCTUARY_TYPES = ['beast', 'plant'] as const;
