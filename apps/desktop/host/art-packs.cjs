'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { readTranslations } = require('./mod-translations.cjs');

const MOD_ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const SECTION_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ART_PATH = /^[a-z0-9][a-z0-9/_-]{0,200}$/;
const MANIFEST_LIMIT = 64 * 1024;
const LIBRARY_LIMIT = 4 * 1024 * 1024;
const FILE_LIMIT = 2 * 1024 * 1024;
const SECTION_LIMIT = 64 * 1024 * 1024;
const TYPES = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif' };

const text = (value, limit, fallback = '') => (typeof value === 'string' ? value.trim().slice(0, limit) : fallback);

async function listArt(folder) {
  const found = new Map();
  const walk = async (dir, depth) => {
    if (depth > 8) return;
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { await walk(full, depth + 1); continue; }
      const type = TYPES[path.extname(entry.name).toLowerCase()];
      if (!type) continue;
      const key = path.relative(folder, full).replace(/\\/g, '/').replace(/\.[^.]+$/, '');
      if (ART_PATH.test(key) && !found.has(key)) found.set(key, { file: full, type });
    }
  };
  await walk(folder, 0);
  return found;
}

function readSections(manifest) {
  const list = Array.isArray(manifest.sections) ? manifest.sections.slice(0, 50) : [];
  const sections = [];
  for (const section of list) {
    const id = text(section?.id, 64);
    const paths = Array.isArray(section?.paths) ? section.paths.filter(item => typeof item === 'string' && item.length > 0).slice(0, 20) : [];
    if (!SECTION_ID.test(id)) throw new Error(`раздел «${id}»: id — строчные латинские буквы, цифры и дефис`);
    if (!paths.length) throw new Error(`раздел «${id}»: paths — список папок внутри art/`);
    sections.push({ id, name: text(section.name, 200, id), description: text(section.description, 500), paths });
  }
  if (!sections.length) throw new Error('нет разделов: sections — список { id, name, paths }');
  return sections;
}

function readGroups(raw, files, packName) {
  const groups = [];
  const listed = new Set();
  for (const group of Array.isArray(raw?.groups) ? raw.groups : []) {
    const items = (Array.isArray(group?.items) ? group.items : [])
      .filter(item => typeof item?.path === 'string' && files.has(item.path))
      .map(item => {
        listed.add(item.path);
        const names = Array.isArray(item.names) ? item.names.filter(name => typeof name === 'string' && name.trim()).map(name => name.trim().slice(0, 100)).slice(0, 10) : [];
        return { path: item.path, label: text(item.label, 200, item.path), ...(names.length ? { names } : {}) };
      });
    if (items.length) groups.push({ id: text(group.id, 200, items[0].path), label: text(group.label, 200, packName), section: text(group.section, 100, packName), items });
  }
  const rest = [...files.keys()].filter(key => !listed.has(key)).sort();
  if (rest.length) groups.push({ id: 'other', label: packName, section: packName, items: rest.map(key => ({ path: key, label: key.split('/').pop() })) });
  return groups;
}

async function readPack(folder, folderName, bundled) {
  let manifest;
  try {
    const file = path.join(folder, 'mod.json');
    if ((await fs.stat(file)).size > MANIFEST_LIMIT) throw new Error('mod.json больше 64 КБ');
    manifest = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    return { id: folderName, name: folderName, version: '', description: '', author: '', bundled, off: false, error: `mod.json: ${String(error?.message ?? error).slice(0, 200)}`, sections: [], groups: [] };
  }
  if (manifest?.kind !== 'art') return null;
  const pack = {
    id: text(manifest.id, 64, folderName),
    name: text(manifest.name, 200, folderName),
    version: text(manifest.version, 40),
    description: text(manifest.description, 500),
    author: text(manifest.author, 200),
    bundled,
    off: manifest.enabled === false,
    error: null,
    translations: {},
    sections: [],
    groups: [],
  };
  if (!MOD_ID.test(pack.id)) { pack.error = 'id — строчные латинские буквы, цифры и дефис'; return pack; }
  try {
    const sections = readSections(manifest);
    const files = await listArt(path.join(folder, 'art'));
    let library = null;
    const libraryName = text(manifest.library, 200);
    if (libraryName) {
      const file = path.resolve(folder, libraryName);
      const relative = path.relative(folder, file);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('library — файл внутри папки мода');
      if ((await fs.stat(file)).size > LIBRARY_LIMIT) throw new Error('library больше 4 МБ');
      library = JSON.parse(await fs.readFile(file, 'utf8'));
    }
    pack.sections = sections.map(section => ({
      id: section.id, name: section.name, description: section.description, paths: section.paths,
      count: [...files.keys()].filter(key => section.paths.some(prefix => key.startsWith(prefix))).length,
    }));
    pack.groups = readGroups(library, files, pack.name);
    pack.translations = readTranslations(manifest.translations, sections.map(section => section.id));
  } catch (error) {
    pack.error = String(error?.message ?? error).slice(0, 300);
  }
  return pack;
}

async function packFolders(dirs) {
  const result = [];
  for (const { dir, bundled } of dirs) {
    let names = [];
    try {
      names = (await fs.readdir(dir, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    } catch {
      continue;
    }
    for (const name of names.slice(0, 100)) result.push({ folder: path.join(dir, name), name, bundled });
  }
  return result;
}

async function readArtPacks(dirs) {
  const packs = [];
  const seen = new Set();
  for (const { folder, name, bundled } of await packFolders(dirs)) {
    const pack = await readPack(folder, name, bundled);
    if (!pack) continue;
    if (seen.has(pack.id)) { pack.error = `набор с id «${pack.id}» уже есть`; pack.sections = []; pack.groups = []; }
    seen.add(pack.id);
    packs.push(pack);
  }
  return packs;
}

async function readArtPackSection(dirs, id, sectionId) {
  for (const { folder, name, bundled } of await packFolders(dirs)) {
    const pack = await readPack(folder, name, bundled);
    if (!pack || pack.id !== id) continue;
    if (pack.error) throw new Error(pack.error);
    const section = pack.sections.find(entry => entry.id === sectionId);
    if (!section) throw new Error(`в наборе «${id}» нет раздела «${sectionId}»`);
    const files = await listArt(path.join(folder, 'art'));
    const result = [];
    let total = 0;
    for (const [key, { file, type }] of files) {
      if (!section.paths.some(prefix => key.startsWith(prefix))) continue;
      const size = (await fs.stat(file)).size;
      if (size > FILE_LIMIT) continue;
      total += size;
      if (total > SECTION_LIMIT) throw new Error(`раздел «${sectionId}» больше 64 МБ`);
      result.push({ path: key, type, data: (await fs.readFile(file)).toString('base64') });
    }
    return result;
  }
  throw new Error(`набора «${id}» нет`);
}

module.exports = { readArtPacks, readArtPackSection };
