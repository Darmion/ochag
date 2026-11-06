import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRD = join(ROOT, 'packages', 'domain', 'srd');
export const SRD_ENGLISH_FILE = join(ROOT, 'apps', 'client', 'src', 'locales', 'srd-en.json');

const paragraphs = text => String(text ?? '').split(/\n\s*\n/).map(part => part.trim()).filter(Boolean);

export async function srdEnglish() {
  const pairs = {};
  const add = (ru, en) => {
    if (!ru || !en || typeof ru !== 'string' || typeof en !== 'string') return;
    const key = ru.trim();
    if (key && !(key in pairs)) pairs[key] = en.trim();
  };
  const addText = (ru, en) => {
    add(ru, en);
    const ruParts = paragraphs(ru);
    const enParts = paragraphs(en);
    if (ruParts.length > 1 && ruParts.length === enParts.length) ruParts.forEach((part, index) => add(part, enParts[index]));
  };

  const english = JSON.parse(readFileSync(join(SRD, 'spells.json'), 'utf8'));
  const russian = JSON.parse(readFileSync(join(SRD, 'spells.ru.json'), 'utf8'));
  const list = Array.isArray(english) ? english : english.spells;
  for (const spell of list) {
    const ru = russian[spell.index];
    if (!ru) continue;
    add(ru.name, spell.name);
    addText(ru.desc, [].concat(spell.desc ?? []).join('\n\n'));
    if (ru.higherLevel) addText(ru.higherLevel, [].concat(spell.higherLevel ?? []).join('\n\n'));
  }

  const load = file => import(pathToFileURL(join(ROOT, 'packages', 'domain', ...file.split('/'))).href);
  const { SRD_MONSTERS } = await load('srd/monsters.ts');
  for (const monster of SRD_MONSTERS) add(monster.nameRu, monster.name);
  const { SRD_WEAPONS } = await load('srd/weapons.ts');
  for (const weapon of SRD_WEAPONS) add(weapon.nameRu, weapon.name);
  const { SRD_MAGIC_ITEMS } = await load('character/magic-items.ts');
  for (const item of SRD_MAGIC_ITEMS) add(item.nameRu, item.name);
  const { FEATS } = await load('character/feats.ts');
  for (const feat of FEATS) add(feat.nameRu, feat.en);
  return Object.fromEntries(Object.entries(pairs).sort(([a], [b]) => a.localeCompare(b, 'ru')));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pairs = await srdEnglish();
  const text = `${JSON.stringify(pairs, null, 1)}\n`;
  let previous = '';
  try {
    previous = readFileSync(SRD_ENGLISH_FILE, 'utf8');
  } catch {
  }
  if (text !== previous) writeFileSync(SRD_ENGLISH_FILE, text, 'utf8');
  console.log(`srd-en.json: ${Object.keys(pairs).length} пар${text !== previous ? ' — файл обновлён' : ''}.`);
}
