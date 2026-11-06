import { type ClassId, type ClassLevel, SUBCLASSES } from '../classes.ts';
import { CLASS_FEATURE_LIST, type ClassFeature } from './catalog.ts';

export function classFeatures(classId: ClassId | null, level: number | null | undefined, subclass?: string): ClassFeature[] {
  if (!classId) return [];
  const at = Math.max(1, Math.min(20, level ?? 1));
  const own = subclass ?? SUBCLASSES[classId]?.default;
  return CLASS_FEATURE_LIST.filter(feature => feature.classId === classId && feature.level <= at && (!feature.subclass || feature.subclass === own));
}

export function classFeaturesFor(classes: ClassLevel[]): ClassFeature[] {
  return classes.flatMap(entry => classFeatures(entry.id, entry.level, entry.subclass));
}

export function classLevelOf(classes: ClassLevel[], classId: ClassId, fallback: number | null | undefined): number {
  return classes.find(entry => entry.id === classId)?.level ?? Math.max(1, fallback ?? 1);
}
