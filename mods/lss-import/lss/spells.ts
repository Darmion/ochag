import type { ImportedSpell } from '../../../packages/importer/proposal/structure.ts';

const SPELL_LINK = /href=["']?https?:\/\/dnd\.su\/spells\/\d+-([a-z0-9_]+)\/?["']?[^>]*>([^<]*)<\/a>/gi;

const SPELL_HREF = /dnd\.su\/spells\/\d+-([a-z0-9_]+)/i;

function linkedSpell(slug: string, rawLabel: string, level: number | null): ImportedSpell {
  const label = rawLabel.trim();
  const bracket = /^(.*?)\s*\[([^\]]+)\]\s*$/.exec(label);
  return {
    slug: slug.toLowerCase(),
    nameRu: (bracket ? bracket[1]! : label).trim().slice(0, 100) || null,
    nameEn: bracket ? bracket[2]!.trim().slice(0, 100) : null,
    level,
  };
}

export function spellLinks(content: unknown, level: number | null): ImportedSpell[] {
  if (typeof content === 'string') return [...content.matchAll(SPELL_LINK)].map(match => linkedSpell(match[1]!, match[2]!, level));
  const found: ImportedSpell[] = [];
  const walk = (node: unknown, depth: number) => {
    if (depth > 40 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1);
      return;
    }
    const entry = node as Record<string, any>;
    const href = Array.isArray(entry.marks) ? entry.marks.find((mark: any) => mark?.type === 'link')?.attrs?.href : null;
    const match = typeof href === 'string' ? SPELL_HREF.exec(href) : null;
    if (match && typeof entry.text === 'string') found.push(linkedSpell(match[1]!, entry.text, level));
    walk(entry.content, depth + 1);
  };
  walk(content, 0);
  return found;
}
