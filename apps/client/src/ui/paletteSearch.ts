export type SearchableItem = { group: string; label: string; sub?: string; keywords?: string };

const words = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

export function searchPalette<T extends SearchableItem>(items: T[], query: string, shown: (text: string) => string = text => text, limit = 60): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items.slice(0, limit);
  const parts = needle.split(/\s+/);
  const both = (text: string | undefined) => (text ? `${text} ${shown(text)}` : '');
  return items.filter(item => {
    const haystack = words(`${both(item.group)} ${both(item.label)} ${both(item.sub)} ${both(item.keywords)}`);
    return parts.every(part => haystack.some(word => word.startsWith(part)));
  }).slice(0, limit);
}
