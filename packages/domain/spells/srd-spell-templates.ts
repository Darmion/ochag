import data from '../srd/spell-templates.json' with { type: 'json' };
import spells from '../srd/spells.json' with { type: 'json' };
import ru from '../srd/spells.ru.json' with { type: 'json' };
import { normalizeTemplate, type SpellTemplate } from './spell-template.ts';

const TEMPLATES = data as Record<string, Record<string, unknown>>;
type SrdText = { index: string; name: string; desc: string; higherLevel?: string | null };
const SPELLS = new Map(((Array.isArray(spells) ? spells : (spells as { spells: SrdText[] }).spells) as SrdText[]).map(spell => [spell.index, spell]));
const RUSSIAN = ru as Record<string, { name?: string; desc?: string; higherLevel?: string }>;

export function srdTemplateOf(index: string): SpellTemplate | null {
  const raw = TEMPLATES[index];
  const spell = SPELLS.get(index);
  if (!raw || !spell) return null;
  const text = RUSSIAN[index];
  return normalizeTemplate({
    ...raw,
    passport: {
      ...(raw.passport as Record<string, unknown> | undefined),
      name: text?.name || spell.name, nameEn: spell.name,
      description: text?.desc || spell.desc, higherLevel: text?.higherLevel || spell.higherLevel || '',
    },
  });
}

export const SRD_TEMPLATE_INDEXES: readonly string[] = Object.keys(TEMPLATES);
