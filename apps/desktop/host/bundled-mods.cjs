'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { app } = require('electron');

const MOD_ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const stateFile = () => path.join(app.getPath('userData'), 'mods-enabled.json');
const bundledModsDir = () => path.join(app.getAppPath(), 'mods');

async function enabledBundledMods() {
  try {
    const list = JSON.parse(await fs.readFile(stateFile(), 'utf8'));
    return Array.isArray(list) ? list.filter(id => typeof id === 'string' && MOD_ID.test(id)) : [];
  } catch {
    return [];
  }
}

async function setBundledMod(id, on) {
  if (typeof id !== 'string' || !MOD_ID.test(id)) throw new Error('Нужен id мода.');
  const list = new Set(await enabledBundledMods());
  if (on) list.add(id); else list.delete(id);
  await fs.writeFile(stateFile(), JSON.stringify([...list].sort()), 'utf8');
  return [...list].sort();
}

module.exports = { bundledModsDir, enabledBundledMods, setBundledMod };
