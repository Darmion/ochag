import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { CLASS_FEATURE_LIST, type ClassFeature } from '../../../../packages/domain/character/class-features.ts';
import { FEATURE_ACTIONS, FEATURE_VIEWS } from '../rules/class-features/classes/index.ts';
import type { FeatureAction, FeatureViewFn } from '../rules/class-features/classes/types.ts';
import { SPELL_EFFECTS } from '../tabletop/spells/rules.ts';
import { type TableContext, withTable } from '../tabletop/context.ts';
import { notify, notifyCampaign } from '../tabletop/live/notify.ts';
import { getScene } from '../tabletop/scene/board.ts';
import { loadPlacements } from '../tabletop/scene/placements.ts';
import { insertRoll, rollDie } from '../tabletop/rolls/dice.ts';
import { applyHpChange } from '../tabletop/combat/hp.ts';
import { objectSchema, reject, uuid } from '../tabletop/shared.ts';
import { IMPORTERS, type SheetImporter } from '../characters/import/importers.ts';

export type ModKind = 'mechanics' | 'visual' | 'art';
export type ModStatus = {
  id: string;
  name: string;
  version: string;
  kind: ModKind;
  description: string;
  author: string;
  folder: string;
  bundled: boolean;
  status: 'loaded' | 'disabled' | 'error';
  error: string | null;
  changes: string[];
  translations: Record<string, { name?: string; description?: string; author?: string }>;
};

type SpellEffect = (typeof SPELL_EFFECTS)[string];

export type ModKit = {
  getScene: typeof getScene;
  loadPlacements: typeof loadPlacements;
  notify: (campaignId: string, sceneId: string) => Promise<void>;
  notifyCampaign: (campaignId: string, message: Record<string, unknown>) => Promise<void>;
  rollDie: typeof rollDie;
  insertRoll: typeof insertRoll;
  applyHpChange: (...args: Parameters<typeof applyHpChange> extends [any, ...infer A] ? A : never) => ReturnType<typeof applyHpChange>;
  reject: typeof reject;
  uuid: typeof uuid;
  objectSchema: typeof objectSchema;
};

export type ModApi = {
  mod: { id: string; name: string; version: string; folder: string };
  log: (message: string) => void;
  features: {
    action: (id: string, fn: FeatureAction) => void;
    view: (id: string, fn: FeatureViewFn) => void;
    define: (feature: Pick<ClassFeature, 'id' | 'classId' | 'name'> & Partial<ClassFeature>) => void;
    actionOf: (id: string) => FeatureAction | undefined;
    viewOf: (id: string) => FeatureViewFn | undefined;
  };
  spellEffect: (index: string, effect: SpellEffect) => void;
  importers: {
    define: (importer: Pick<SheetImporter, 'id' | 'name' | 'parse'> & Partial<SheetImporter>) => void;
  };
  routes: (register: (ctx: TableContext, kit: ModKit) => void) => void;
};

export type LoadedMods = {
  list: ModStatus[];
  routes: Array<{ status: ModStatus; register: (ctx: TableContext, kit: ModKit) => void }>;
};

const ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const MANIFEST_LIMIT = 64 * 1024;

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim().slice(0, 500) : fallback;
}

function translations(raw: unknown): ModStatus['translations'] {
  const out: ModStatus['translations'] = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [code, value] of Object.entries(raw).slice(0, 20)) {
    if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(code) || !value || typeof value !== 'object') continue;
    const entry: ModStatus['translations'][string] = {};
    for (const field of ['name', 'description', 'author'] as const) {
      const found = text((value as Record<string, unknown>)[field]);
      if (found) entry[field] = found;
    }
    if (Object.keys(entry).length) out[code.toLowerCase()] = entry;
  }
  return out;
}

export type ModSources = { bundledDir?: string | null; enabled?: string[] };

async function modFolders(dir: string | null | undefined, bundled: boolean) {
  if (!dir) return [];
  try {
    return (await readdir(dir, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => ({ folderName: entry.name, folder: path.join(dir, entry.name), bundled })).sort((a, b) => a.folderName.localeCompare(b.folderName));
  } catch {
    return [];
  }
}

export async function loadMods(dir: string | null | undefined, log: (message: string) => void = () => {}, sources: ModSources = {}): Promise<LoadedMods> {
  const loaded: LoadedMods = { list: [], routes: [] };
  const folders = [...await modFolders(sources.bundledDir, true), ...await modFolders(dir, false)];
  const enabled = new Set(sources.enabled ?? []);
  const seen = new Set<string>();
  const ownerOf = new Map<string, string>();
  for (const { folderName, folder, bundled } of folders) {
    const status: ModStatus = { id: folderName, name: folderName, version: '', kind: 'mechanics', description: '', author: '', folder, bundled, status: 'error', error: null, changes: [], translations: {} };
    let manifest: any;
    try {
      const file = path.join(folder, 'mod.json');
      if ((await stat(file)).size > MANIFEST_LIMIT) throw new Error('mod.json больше 64 КБ');
      manifest = JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') continue;
      status.error = `mod.json: ${(error as Error).message}`.slice(0, 300);
      loaded.list.push(status);
      continue;
    }
    status.id = text(manifest?.id, folderName);
    status.name = text(manifest?.name, status.id);
    status.version = text(manifest?.version, '0.0.0');
    status.kind = manifest?.kind === 'visual' || manifest?.kind === 'art' ? manifest.kind : 'mechanics';
    status.description = text(manifest?.description);
    status.author = text(manifest?.author);
    status.translations = translations(manifest?.translations);
    if (status.kind !== 'mechanics') continue;
    if (!ID.test(status.id)) { status.error = 'id — строчные латинские буквы, цифры и дефис, от 2 до 64 знаков'; loaded.list.push(status); continue; }
    if (seen.has(status.id)) { status.error = `мод с id «${status.id}» уже подключён из другой папки`; loaded.list.push(status); continue; }
    seen.add(status.id);
    if (manifest.enabled === false || (bundled && !enabled.has(status.id))) { status.status = 'disabled'; loaded.list.push(status); continue; }
    const entryName = text(manifest.entry, 'index.js');
    const entry = path.resolve(folder, entryName);
    if (path.relative(folder, entry).startsWith('..') || path.isAbsolute(path.relative(folder, entry))) { status.error = 'entry — файл внутри папки мода'; loaded.list.push(status); continue; }
    const staged: Array<() => void> = [];
    const routes: Array<(ctx: TableContext, kit: ModKit) => void> = [];
    const note = (key: string, what: string) => {
      const before = ownerOf.get(key);
      status.changes.push(before && before !== status.id ? `${what} (заменяет мод «${before}»)` : what);
      ownerOf.set(key, status.id);
    };
    const api: ModApi = {
      mod: { id: status.id, name: status.name, version: status.version, folder },
      log: message => log(`[мод ${status.id}] ${String(message).slice(0, 500)}`),
      features: {
        action: (id, fn) => {
          if (typeof fn !== 'function') throw new Error(`features.action('${id}'): нужна функция`);
          staged.push(() => { note(`action:${id}`, `умение «${id}»: ${FEATURE_ACTIONS[id] ? 'применить — своя версия' : 'применить — новое'}`); FEATURE_ACTIONS[id] = fn; });
        },
        view: (id, fn) => {
          if (typeof fn !== 'function') throw new Error(`features.view('${id}'): нужна функция`);
          staged.push(() => { note(`view:${id}`, `умение «${id}»: ${FEATURE_VIEWS[id] ? 'вид кнопки — свой' : 'вид кнопки — новый'}`); FEATURE_VIEWS[id] = fn; });
        },
        define: feature => {
          if (!feature || typeof feature.id !== 'string' || typeof feature.classId !== 'string' || typeof feature.name !== 'string') throw new Error('features.define: нужны id, classId и name');
          const copy = { resource: null, use: 'free', text: '', level: 1, ...feature } as ClassFeature;
          staged.push(() => {
            const index = CLASS_FEATURE_LIST.findIndex(entry => entry.id === copy.id && entry.classId === copy.classId);
            note(`define:${copy.classId}:${copy.id}`, `умение класса «${copy.name}» (${copy.classId}, с ${copy.level}-го уровня): ${index >= 0 ? 'описание заменено' : 'новое'}`);
            if (index >= 0) CLASS_FEATURE_LIST[index] = copy; else CLASS_FEATURE_LIST.push(copy);
          });
        },
        actionOf: id => FEATURE_ACTIONS[id],
        viewOf: id => FEATURE_VIEWS[id],
      },
      spellEffect: (index, effect) => {
        if (!effect || typeof effect.code !== 'string' || typeof effect.rounds !== 'number') throw new Error(`spellEffect('${index}'): нужны code и rounds`);
        staged.push(() => { note(`spell:${index}`, `заклинание «${index}»: эффект ${SPELL_EFFECTS[index] ? 'заменён' : 'добавлен'}`); SPELL_EFFECTS[index] = effect; });
      },
      importers: {
        define: importer => {
          if (!importer || typeof importer.id !== 'string' || !ID.test(importer.id) || typeof importer.name !== 'string' || typeof importer.parse !== 'function') {
            throw new Error('importers.define: нужны id (строчные латинские буквы, цифры, дефис), name и функция parse');
          }
          const copy: SheetImporter = {
            id: importer.id, name: text(importer.name, importer.id), description: text(importer.description),
            extensions: Array.isArray(importer.extensions) ? importer.extensions.filter(item => typeof item === 'string').slice(0, 10) : ['.json'],
            translations: translations(importer.translations), parse: importer.parse,
          };
          staged.push(() => { note(`importer:${copy.id}`, `импорт листов «${copy.name}»: ${IMPORTERS.has(copy.id) ? 'своя версия' : 'новый'}`); IMPORTERS.set(copy.id, copy); });
        },
      },
      routes: register => {
        if (typeof register !== 'function') throw new Error('routes: нужна функция');
        routes.push(register);
      },
    };
    try {
      const module = await import(pathToFileURL(entry).href);
      const run = typeof module.default === 'function' ? module.default : typeof module.register === 'function' ? module.register : null;
      if (!run) throw new Error(`${entryName}: нет export default function (api) или export function register(api)`);
      await run(api);
      for (const apply of staged) apply();
      for (const register of routes) loaded.routes.push({ status, register });
      if (routes.length) status.changes.push('свои маршруты стола');
      status.status = 'loaded';
      log(`мод «${status.name}» ${status.version} подключён${status.changes.length ? `: ${status.changes.join('; ')}` : ''}`);
    } catch (error) {
      status.status = 'error';
      status.changes = [];
      status.error = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      log(`мод «${status.name}» не подключён: ${status.error}`);
    }
    loaded.list.push(status);
  }
  return loaded;
}

export function registerModRoutes(ctx: TableContext, mods: LoadedMods | undefined) {
  if (!mods) return;
  const kit: ModKit = {
    getScene, loadPlacements, rollDie, insertRoll, reject, uuid, objectSchema,
    notify: withTable(ctx, notify),
    notifyCampaign: withTable(ctx, notifyCampaign),
    applyHpChange: withTable(ctx, applyHpChange),
  };
  for (const { status, register } of mods.routes) {
    try {
      register(ctx, kit);
    } catch (error) {
      status.status = 'error';
      status.error = `маршруты: ${(error instanceof Error ? error.message : String(error)).slice(0, 400)}`;
    }
  }
}
