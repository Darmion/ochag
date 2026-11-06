import { isObject } from './internal.ts';
import type { SpellTemplate } from './types.ts';
import { normalizeTemplate } from './normalize.ts';

export type Suggestion = { id: string; path: string; label: string; value: unknown; display: string; phrase: string; confidence: 'sure' | 'maybe' };

export function getPath(t: SpellTemplate, path: string): unknown {
  let node: unknown = t;
  for (const key of path.replace(/\[\+\]$/, '').split('.')) {
    if (!isObject(node)) return undefined;
    node = node[key];
  }
  return node;
}

export function applySuggestion(t: SpellTemplate, suggestion: Pick<Suggestion, 'path' | 'value'>): SpellTemplate {
  const copy = JSON.parse(JSON.stringify(t)) as Record<string, unknown>;
  const append = suggestion.path.endsWith('[+]');
  const keys = suggestion.path.replace(/\[\+\]$/, '').split('.');
  let node: Record<string, unknown> = copy;
  for (const key of keys.slice(0, -1)) {
    if (!isObject(node[key])) node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  const last = keys[keys.length - 1]!;
  if (append) node[last] = [...(Array.isArray(node[last]) ? (node[last] as unknown[]) : []), JSON.parse(JSON.stringify(suggestion.value))];
  else node[last] = JSON.parse(JSON.stringify(suggestion.value));
  return normalizeTemplate(copy);
}
