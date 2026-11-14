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
import { SRD_CONDITION_RULES, defineModRule, modOfRule, normalizeModRule } from '../../../../packages/domain/combat/condition-rules.ts';
import { defineModCampaignRule, modCampaignRule, modRuleValue, normalizeModCampaignRule } from '../campaign/mod-rules.ts';
import type { Queryable } from '../db.ts';
import { normalizeModFeat, normalizeModRace, normalizeModSubrace } from '../../../../packages/domain/character/mod-heroes.ts';
import { defineModRace, defineModSubrace, modRaceOf } from '../../../../packages/domain/character/races.ts';
import { defineModFeat, featCatalog } from '../../../../packages/domain/character/feats.ts';
import { SRD_RACES } from '../../../../packages/domain/srd/heroes.ts';
import { srdSpellList } from '../rules/srd-spells.ts';
import { normalizeModMonster } from '../../../../packages/domain/world/mod-monsters.ts';
import { challengeText, defineModMonster, findMonster } from '../../../../packages/domain/world/bestiary.ts';
import { normalizeModForm, registerModFormRoutes, type ModForm } from './mod-forms.ts';

export type ModKind = 'mechanics' | 'visual' | 'art' | 'spells' | 'adventure';
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
  conditions: {
    define: (rule: Record<string, unknown>) => void;
  };
  rules: {
    define: (rule: Record<string, unknown>) => void;
    value: (q: Queryable, campaignId: string, key: string) => Promise<boolean | string | null>;
  };
  races: {
    define: (race: Record<string, unknown>) => void;
    subrace: (raceId: string, subrace: Record<string, unknown>) => void;
  };
  feats: {
    define: (feat: Record<string, unknown>) => void;
  };
  bestiary: {
    define: (monster: Record<string, unknown>) => void;
  };
  ui: {
    form: (form: Record<string, unknown>) => void;
  };
  routes: (register: (ctx: TableContext, kit: ModKit) => void) => void;
};

export type LoadedMods = {
  list: ModStatus[];
  routes: Array<{ status: ModStatus; register: (ctx: TableContext, kit: ModKit) => void }>;
  forms?: ModForm[];
  dirs?: { user: string | null; bundled: string | null };
};

const ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const MANIFEST_LIMIT = 64 * 1024;

export function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim().slice(0, 500) : fallback;
}

export function translations(raw: unknown): ModStatus['translations'] {
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

export async function modFolders(dir: string | null | undefined, bundled: boolean) {
  if (!dir) return [];
  try {
    return (await readdir(dir, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => ({ folderName: entry.name, folder: path.join(dir, entry.name), bundled })).sort((a, b) => a.folderName.localeCompare(b.folderName));
  } catch {
    return [];
  }
}

export async function loadMods(dir: string | null | undefined, log: (message: string) => void = () => {}, sources: ModSources = {}): Promise<LoadedMods> {
  const loaded: LoadedMods = { list: [], routes: [], forms: [], dirs: { user: dir ?? null, bundled: sources.bundledDir ?? null } };
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
    status.kind = ['visual', 'art', 'spells', 'adventure'].includes(manifest?.kind) ? manifest.kind : 'mechanics';
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
    const stagedRaces = new Map<string, string>();
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
        staged.push(() => { note(`spell:${index}`, `заклинание «${index}»: ${SPELL_EFFECTS[index] ? 'эффект другого мода заменён' : 'эффект заменяет готовый эффект таблицы'}`); SPELL_EFFECTS[index] = effect; });
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
      conditions: {
        define: input => {
          const rule = normalizeModRule(input);
          if (typeof rule === 'string') throw new Error(`conditions.define: ${rule}`);
          staged.push(() => {
            const before = modOfRule(rule.code);
            note(`condition:${rule.code}`, `состояние «${rule.name}»: ${SRD_CONDITION_RULES.has(rule.code) && !before ? 'правила SRD заменены' : before ? 'правила заменены' : 'новое'}`);
            defineModRule(rule, status.name);
          });
        },
      },
      rules: {
        define: input => {
          const rule = normalizeModCampaignRule(input, status.name);
          if (typeof rule === 'string') throw new Error(`rules.define: ${rule}`);
          staged.push(() => {
            note(`rule:${rule.key}`, `правило кампании «${rule.label}»: ${modCampaignRule(rule.key) ? 'своя версия' : 'новое'}`);
            defineModCampaignRule(rule);
          });
        },
        value: (q, campaignId, key) => modRuleValue(q, campaignId, key),
      },
      races: {
        define: input => {
          const { race, traits } = withPrefix('races.define', () => normalizeModRace(input, status.name));
          if (race.racialCantrip && srdSpellList().find(spell => spell.index === race.racialCantrip!.index)?.level !== 0) {
            throw new Error(`races.define: «${race.nameRu}» — cantrip.index не заговор SRD (light, mage-hand…)`);
          }
          stagedRaces.set(race.id, race.nameRu);
          staged.push(() => {
            note(`race:${race.id}`, `раса «${race.nameRu}»: ${modRaceOf(race.id) ? 'своя версия' : 'новая'}${race.subraces.length ? `, подрас: ${race.subraces.length}` : ''}`);
            defineModRace(race, traits);
          });
        },
        subrace: (raceId, input) => {
          const srd = SRD_RACES.find(race => race.id === raceId && !race.custom);
          const raceName = srd?.nameRu ?? modRaceOf(raceId)?.nameRu ?? stagedRaces.get(raceId);
          if (!raceName) throw new Error(`races.subrace: расы «${raceId}» нет — раса SRD (dwarf, elf…) или раса мода, подключённого раньше`);
          const { subrace, traits } = withPrefix('races.subrace', () => normalizeModSubrace(raceId, input, status.name));
          staged.push(() => {
            note(`subrace:${raceId}:${subrace.id}`, `подраса «${subrace.nameRu}» для «${raceName}»`);
            defineModSubrace(raceId, subrace, traits);
          });
        },
      },
      feats: {
        define: input => {
          const feat = withPrefix('feats.define', () => normalizeModFeat(input, status.name));
          staged.push(() => {
            note(`feat:${feat.id}`, `черта «${feat.nameRu}»: ${featCatalog().some(entry => entry.id === feat.id) ? 'своя версия' : 'новая'}`);
            defineModFeat(feat);
          });
        },
      },
      bestiary: {
        define: input => {
          const monster = withPrefix('bestiary.define', () => normalizeModMonster(input, status.name));
          const known = new Set(srdSpellList().map(spell => spell.index));
          const unknown = (monster.spellcasting?.spells ?? []).filter(index => !known.has(index));
          if (unknown.length) throw new Error(`bestiary.define: «${monster.nameRu}» — заклинаний ${unknown.join(', ')} нет в SRD`);
          staged.push(() => {
            note(`monster:${monster.index}`, `существо «${monster.nameRu}» (опасность ${challengeText(monster.cr)}): ${findMonster(monster.index) ? 'своя версия' : 'новое'}`);
            defineModMonster(monster);
          });
        },
      },
      ui: {
        form: input => {
          const form = withPrefix('ui.form', () => normalizeModForm(input, status.id, status.name));
          staged.push(() => {
            note(`form:${form.id}`, `окно «${form.title}» (${form.who === 'gm' ? 'мастеру' : 'всем'})`);
            const at = loaded.forms!.findIndex(entry => entry.modId === form.modId && entry.id === form.id);
            if (at >= 0) loaded.forms![at] = form; else loaded.forms!.push(form);
          });
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

function withPrefix<T>(prefix: string, make: () => T): T {
  try {
    return make();
  } catch (error) {
    throw new Error(`${prefix}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function registerModRoutes(ctx: TableContext, mods: LoadedMods | undefined) {
  const kit: ModKit = {
    getScene, loadPlacements, rollDie, insertRoll, reject, uuid, objectSchema,
    notify: withTable(ctx, notify),
    notifyCampaign: withTable(ctx, notifyCampaign),
    applyHpChange: withTable(ctx, applyHpChange),
  };
  registerModFormRoutes(ctx, kit, mods?.forms ?? []);
  for (const { status, register } of mods?.routes ?? []) {
    try {
      register(ctx, kit);
    } catch (error) {
      status.status = 'error';
      status.error = `маршруты: ${(error instanceof Error ? error.message : String(error)).slice(0, 400)}`;
    }
  }
}
