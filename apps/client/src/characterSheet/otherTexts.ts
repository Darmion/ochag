export type SheetText = { key: string; label: string; body: string };

const OTHER_KEYS = new Set(['prof', 'features', 'levels']);
export const USE_LABELS: Record<string, string> = { action: 'действие', bonus: 'бонусное', reaction: 'реакция', free: 'свободно', passive: 'само' };

export const textOf = (texts: SheetText[], key: string) => texts.find(entry => entry.key === key)?.body ?? '';

export function factLines(text: string) {
  return text.split(/\n+/).map(line => line.trim()).filter(Boolean).map(line => {
    const match = /^([^:]{2,40}):\s*(.+)$/.exec(line);
    return match ? { label: match[1]!, value: match[2]!.replace(/\.$/, '') } : { label: '', value: line };
  });
}

export function titledCards(text: string) {
  let parts = text.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean);
  if (parts.length <= 1) parts = text.split(/\n/).map(part => part.trim()).filter(Boolean);
  return parts.map(part => {
    const match = /^([^.\n]{2,80})\.\s+([\s\S]+)$/.exec(part);
    return match ? { title: match[1]!, body: match[2]! } : { title: '', body: part };
  });
}

export const storyEntries = (texts: SheetText[]) => texts.filter(entry => !OTHER_KEYS.has(entry.key));
