export type RefTarget = { ref: string; label: string | null; level: number | null };
type RefSrdSpell = { index: string; name: string; nameRu: string | null; level: number; classes: string[] };
type RefCustomSpell = { id: string; name: string; level: number; classes: string; status: string };

export const LIST_LABELS: Record<string, string> = { prepared: 'подготовлено', book: 'в книге', granted: 'дарованное', slotless: 'без ячейки' };

export function refTitle(ref: { ref: string; label: string | null }) {
  return ref.label ?? `Заклинание №${ref.ref.slice(-6)}`;
}

export function matchRefs(ref: RefTarget, query: string | undefined, srdLibrary: RefSrdSpell[], customLibrary: RefCustomSpell[], casterClasses: Set<string>) {
  const text = (query ?? ref.label ?? '').trim().toLowerCase();
  const items = [
    ...srdLibrary.map(spell => ({ key: `srd:${spell.index}`, name: spell.nameRu ?? spell.name, alt: spell.name, level: spell.level, classes: spell.classes ?? [] })),
    ...customLibrary.filter(spell => spell.status === 'approved')
      .map(spell => ({ key: `custom:${spell.id}`, name: spell.name, alt: '', level: spell.level, classes: spell.classes.split(/[\s,;]+/) })),
  ].map(item => ({ ...item, own: !casterClasses.size || item.classes.some(entry => casterClasses.has(entry.toLowerCase())) }));
  return items
    .filter(item => (text ? item.name.toLowerCase().includes(text) || item.alt.toLowerCase().includes(text) : item.own) && (ref.level === null || item.level === ref.level || !text))
    .sort((a, b) => Number(b.own) - Number(a.own) || a.level - b.level || a.name.localeCompare(b.name, 'ru'))
    .slice(0, 80);
}
