import { writeFileSync } from 'node:fs';
import spells from '../packages/domain/srd/spells.json' with { type: 'json' };
import ru from '../packages/domain/srd/spells.ru.json' with { type: 'json' };
import { compactTemplate, srdSpellTemplate, type SrdSpellSource } from '../packages/domain/spells/spell-template-convert.ts';

function withoutText(compact: Record<string, unknown>): Record<string, unknown> {
  const passport = { ...(compact.passport as Record<string, unknown> | undefined) };
  for (const key of ['name', 'nameEn', 'description', 'higherLevel']) delete passport[key];
  const { passport: _passport, ...rest } = compact;
  return Object.keys(passport).length ? { passport, ...rest } : rest;
}

const list = (Array.isArray(spells) ? spells : (spells as { spells: SrdSpellSource[] }).spells) as SrdSpellSource[];
const russian = ru as Record<string, { name?: string; desc?: string; higherLevel?: string }>;
const lines = list
  .slice()
  .sort((a, b) => a.index.localeCompare(b.index))
  .map(spell => `  ${JSON.stringify(spell.index)}: ${JSON.stringify(withoutText(compactTemplate(srdSpellTemplate(spell, russian[spell.index]))))}`);
const target = new URL('../packages/domain/srd/spell-templates.json', import.meta.url);
writeFileSync(target, `{\n${lines.join(',\n')}\n}\n`, 'utf8');
console.log(`spell templates: ${lines.length} → packages/domain/srd/spell-templates.json`);
