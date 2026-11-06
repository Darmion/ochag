'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { readTranslations } = require('./mod-translations.cjs');

const MOD_ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const MANIFEST_LIMIT = 64 * 1024;
const CSS_LIMIT = 1024 * 1024;
const ASSET_LIMIT = 2 * 1024 * 1024;
const ASSET_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
};

function insideFolder(folder, file) {
  const relative = path.relative(folder, file);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function inlineUrls(css, folder, base) {
  const found = [...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)];
  let out = css;
  for (const match of found.reverse()) {
    const ref = match[2].trim();
    if (/^(data:|[a-z]+:|\/\/|#)/i.test(ref)) continue;
    const file = path.resolve(base, ref.split(/[?#]/)[0]);
    const type = ASSET_TYPES[path.extname(file).toLowerCase()];
    let replacement = 'none';
    if (type && insideFolder(folder, file)) {
      try {
        if ((await fs.stat(file)).size <= ASSET_LIMIT) replacement = `url("data:${type};base64,${(await fs.readFile(file)).toString('base64')}")`;
      } catch {
      }
    }
    out = out.slice(0, match.index) + replacement + out.slice(match.index + match[0].length);
  }
  return out;
}

const text = (value, limit, fallback = '') => (typeof value === 'string' ? value.trim().slice(0, limit) : fallback);

async function readVisualMods(dir) {
  let folders = [];
  try {
    folders = (await fs.readdir(dir, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  } catch {
    return [];
  }
  const result = [];
  for (const name of folders.slice(0, 100)) {
    const folder = path.join(dir, name);
    let manifest;
    try {
      const file = path.join(folder, 'mod.json');
      if ((await fs.stat(file)).size > MANIFEST_LIMIT) throw new Error('mod.json больше 64 КБ');
      manifest = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      result.push({ id: name, name, version: '', description: '', author: '', css: '', error: `mod.json: ${String(error?.message ?? error).slice(0, 200)}` });
      continue;
    }
    if (manifest?.kind !== 'visual') continue;
    const entry = {
      id: text(manifest.id, 64, name),
      name: text(manifest.name, 200, name),
      version: text(manifest.version, 40),
      description: text(manifest.description, 500),
      author: text(manifest.author, 200),
      css: '',
      error: null,
      off: manifest.enabled === false,
      translations: readTranslations(manifest.translations),
    };
    if (!MOD_ID.test(entry.id)) { entry.error = 'id — строчные латинские буквы, цифры и дефис'; result.push(entry); continue; }
    try {
      const styles = Array.isArray(manifest.styles) ? manifest.styles.filter(item => typeof item === 'string').slice(0, 10) : [];
      if (!styles.length) throw new Error('нет стилей: styles — список файлов .css');
      const parts = [];
      for (const style of styles) {
        const file = path.resolve(folder, style);
        if (!insideFolder(folder, file) || path.extname(file).toLowerCase() !== '.css') throw new Error(`${style}: стиль — файл .css внутри папки мода`);
        if ((await fs.stat(file)).size > CSS_LIMIT) throw new Error(`${style}: больше 1 МБ`);
        parts.push(await inlineUrls(await fs.readFile(file, 'utf8'), folder, path.dirname(file)));
      }
      entry.css = parts.join('\n');
    } catch (error) {
      entry.error = String(error?.message ?? error).slice(0, 300);
    }
    result.push(entry);
  }
  return result;
}

module.exports = { readVisualMods };
