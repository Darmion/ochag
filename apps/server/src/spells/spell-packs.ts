import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { isArtAsset, normalizeTemplate, validateTemplate, type SpellTemplate } from '../../../../packages/domain/spells/spell-template.ts';
import { modFolders, text, translations, type LoadedMods, type ModStatus } from '../system/mods.ts';

// A spell pack is a mod of kind "spells": a folder of *.spell.json files in the format the spell builder saves.
export type SpellPack = {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  translations: ModStatus['translations'];
  bundled: boolean;
  spells: Array<{ key: string; template: SpellTemplate }>;
  skipped: Array<{ file: string; reason: string }>;
  error: string | null;
};

const ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const MANIFEST_LIMIT = 64 * 1024;
const FILE_LIMIT = 256 * 1024;
const MAX_SPELLS = 300;

async function readPackSpells(folder: string, dirName: string, pack: SpellPack) {
  const dir = path.resolve(folder, dirName);
  const inside = path.relative(folder, dir);
  if (inside.startsWith('..') || path.isAbsolute(inside)) { pack.error = 'spells — папка внутри папки мода'; return; }
  let files: string[];
  try {
    files = (await readdir(dir)).filter(name => name.toLowerCase().endsWith('.spell.json')).sort((a, b) => a.localeCompare(b));
  } catch {
    pack.error = `нет папки «${dirName}» с файлами .spell.json`;
    return;
  }
  for (const file of files.slice(0, MAX_SPELLS)) {
    const skip = (reason: string) => pack.skipped.push({ file, reason });
    try {
      const full = path.join(dir, file);
      if ((await stat(full)).size > FILE_LIMIT) { skip('файл больше 256 КБ'); continue; }
      const data = JSON.parse(await readFile(full, 'utf8'));
      if (data?.format !== 'ochag-spell-template' || !data.template || typeof data.template !== 'object') { skip('не файл заклинания «Очага»'); continue; }
      const template = normalizeTemplate(data.template);
      // A picture saved with the spell lives in another campaign's files; the spell takes its school's picture.
      if (isArtAsset(template.passport.art)) template.passport.art = '';
      const { errors } = validateTemplate(template);
      if (errors.length) { skip(`${errors[0]!.path}: ${errors[0]!.message}`); continue; }
      pack.spells.push({ key: file.slice(0, 200), template });
    } catch (error) {
      skip((error instanceof Error ? error.message : String(error)).slice(0, 200));
    }
  }
  if (files.length > MAX_SPELLS) pack.skipped.push({ file: '…', reason: `в наборе больше ${MAX_SPELLS} файлов — остальные не прочитаны` });
}

export async function readSpellPacks(mods: LoadedMods | undefined): Promise<SpellPack[]> {
  const folders = [...await modFolders(mods?.dirs?.bundled, true), ...await modFolders(mods?.dirs?.user, false)];
  const packs: SpellPack[] = [];
  const seen = new Set<string>();
  for (const { folderName, folder, bundled } of folders) {
    let manifest: any;
    try {
      const file = path.join(folder, 'mod.json');
      if ((await stat(file)).size > MANIFEST_LIMIT) continue;
      manifest = JSON.parse(await readFile(file, 'utf8'));
    } catch {
      continue;
    }
    if (manifest?.kind !== 'spells') continue;
    const pack: SpellPack = {
      id: text(manifest.id, folderName), name: '', version: text(manifest.version, '0.0.0'), description: text(manifest.description),
      author: text(manifest.author), translations: translations(manifest.translations), bundled, spells: [], skipped: [], error: null,
    };
    pack.name = text(manifest.name, pack.id);
    if (!ID.test(pack.id)) pack.error = 'id — строчные латинские буквы, цифры и дефис, от 2 до 64 знаков';
    else if (seen.has(pack.id)) pack.error = `набор с id «${pack.id}» уже есть в другой папке`;
    else if (manifest.enabled === false) pack.error = 'выключен в mod.json';
    else await readPackSpells(folder, text(manifest.spells, 'spells'), pack);
    seen.add(pack.id);
    packs.push(pack);
  }
  return packs;
}
