// Fails when apps/client/src/locales/en.json has a string without English, and lists them.
import { readFileSync } from 'node:fs';

const GONE = 'Больше нет в коде — перевод сохранён, чтобы не пропал';
const english = JSON.parse(readFileSync(new URL('../apps/client/src/locales/en.json', import.meta.url), 'utf8'));
const empty = value => value === '' || (value !== null && typeof value === 'object' && Object.values(value).some(form => form === ''));
const missing = [];
for (const [section, strings] of Object.entries(english)) {
  if (section.startsWith('$') || section === GONE || !strings || typeof strings !== 'object' || Array.isArray(strings)) continue;
  for (const [key, value] of Object.entries(strings)) if (empty(value)) missing.push(`${section}: ${key}`);
}
if (missing.length) {
  console.error(`${missing.length} interface strings have no English in apps/client/src/locales/en.json:\n${missing.join('\n')}`);
  process.exit(1);
}
console.log('Every interface string has English.');
