import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { tableProblems, type TableEntry } from '../../../../packages/domain/world/roll-tables.ts';
import { findMonster } from '../../../../packages/domain/world/bestiary.ts';
import { parseFormula } from '../../../../packages/domain/dice/dice.ts';
import { detectImage } from '../system/asset-routes.ts';
import { modFolders, text, translations, type LoadedMods, type ModStatus } from '../system/mods.ts';

// A ready-made adventure is a mod of kind "adventure": scene files saved by the app (.ochag-scene) plus adventure.json
// with the campaign's notes, quests, handouts, roll tables and creatures. The scene format is the portable one, so an
// adventure keeps working after the app's database changes.
export type AdventureQuest = { title: string; description: string; xp: number; hidden: boolean; objectives: string[] };
export type AdventureHandout = { title: string; text: string | null; image: string | null };
export type AdventureNpc = { monster: string; name: string | null; disposition: 'hostile' | 'neutral' | 'friendly'; count: number };
export type AdventureTable = { name: string; formula: string; entries: TableEntry[]; secret: boolean };

export type Adventure = {
  id: string; name: string; version: string; description: string; author: string;
  translations: ModStatus['translations']; bundled: boolean; folder: string;
  title: string; levels: string; players: string; duration: string; intro: string;
  cover: string | null; coverData: string | null;
  scenes: string[]; notes: Array<{ title: string; body: string }>; quests: AdventureQuest[];
  handouts: AdventureHandout[]; rollTables: AdventureTable[]; npcs: AdventureNpc[];
  problems: string[]; error: string | null;
};

const ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const MANIFEST_LIMIT = 64 * 1024;
const CONTENT_LIMIT = 2 * 1024 * 1024;
const COVER_LIMIT = 1536 * 1024;
export const SCENE_FILE_LIMIT = 300 * 1024 * 1024;
const LIMITS = { scenes: 30, notes: 200, quests: 100, objectives: 20, handouts: 100, rollTables: 50, npcs: 100 };

const line = (value: unknown, limit: number) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, limit) : '');
const block = (value: unknown, limit: number) => (typeof value === 'string' ? value.trim().slice(0, limit) : '');

export function insideFolder(folder: string, relative: unknown): string | null {
  if (typeof relative !== 'string' || !relative.trim()) return null;
  const full = path.resolve(folder, relative);
  const from = path.relative(folder, full);
  return from && !from.startsWith('..') && !path.isAbsolute(from) ? full : null;
}

function listOf(raw: unknown, key: string, limit: number, problems: string[]): unknown[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    problems.push(`${key}: нужен список`);
    return [];
  }
  if (raw.length > limit) problems.push(`${key}: больше ${limit} — лишние пропущены`);
  return raw.slice(0, limit);
}

async function readContent(adventure: Adventure, raw: Record<string, unknown>) {
  const { folder, problems } = adventure;
  adventure.title = line(raw.title, 200) || adventure.name;
  adventure.levels = line(raw.levels, 40);
  adventure.players = line(raw.players, 40);
  adventure.duration = line(raw.duration, 60);
  adventure.intro = block(raw.intro, 2000);

  for (const [index, entry] of listOf(raw.scenes, 'scenes', LIMITS.scenes, problems).entries()) {
    const full = insideFolder(folder, entry);
    if (!full || !full.toLowerCase().endsWith('.ochag-scene')) { problems.push(`scenes[${index}]: путь к файлу .ochag-scene внутри папки мода`); continue; }
    try {
      const size = (await stat(full)).size;
      if (size > SCENE_FILE_LIMIT) { problems.push(`${entry}: больше 300 МБ`); continue; }
      adventure.scenes.push(String(entry));
    } catch {
      problems.push(`${entry}: файла нет`);
    }
  }
  for (const [index, entry] of listOf(raw.notes, 'notes', LIMITS.notes, problems).entries()) {
    const item = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const title = line(item.title, 200);
    if (!title) { problems.push(`notes[${index}]: нужен title`); continue; }
    adventure.notes.push({ title, body: block(item.body, 20000) });
  }
  for (const [index, entry] of listOf(raw.quests, 'quests', LIMITS.quests, problems).entries()) {
    const item = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const title = line(item.title, 200);
    if (!title) { problems.push(`quests[${index}]: нужен title`); continue; }
    const xp = Number.isInteger(item.xp) && (item.xp as number) >= 0 && (item.xp as number) <= 1000000 ? item.xp as number : 0;
    const objectives = listOf(item.objectives, `quests[${index}].objectives`, LIMITS.objectives, problems).map(goal => line(goal, 300)).filter(Boolean);
    adventure.quests.push({ title, description: block(item.description, 5000), xp, hidden: item.hidden === true, objectives });
  }
  for (const [index, entry] of listOf(raw.handouts, 'handouts', LIMITS.handouts, problems).entries()) {
    const item = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const title = line(item.title, 120);
    const body = block(item.text, 20000) || null;
    const image = item.image === undefined ? null : insideFolder(folder, item.image) ? String(item.image) : null;
    if (item.image !== undefined && !image) problems.push(`handouts[${index}]: image — путь к картинке внутри папки мода`);
    if (!title || (!body && !image)) { problems.push(`handouts[${index}]: нужны title и text или image`); continue; }
    adventure.handouts.push({ title, text: body, image });
  }
  for (const [index, entry] of listOf(raw.rollTables, 'rollTables', LIMITS.rollTables, problems).entries()) {
    const item = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const name = line(item.name, 120);
    const formula = typeof item.formula === 'string' ? item.formula.trim() : '';
    const entries = Array.isArray(item.entries) ? item.entries as TableEntry[] : [];
    const wrong = !name ? ['нужно name'] : !parseFormula(formula) ? ['formula — кости вроде 1d20'] : tableProblems(formula, entries);
    if (wrong.length) { problems.push(`rollTables[${index}]: ${wrong[0]}`); continue; }
    adventure.rollTables.push({ name, formula, entries, secret: item.secret === true });
  }
  let creatures = 0;
  for (const [index, entry] of listOf(raw.npcs, 'npcs', LIMITS.npcs, problems).entries()) {
    const item = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const monster = typeof item.monster === 'string' ? item.monster : '';
    if (!findMonster(monster)) { problems.push(`npcs[${index}]: в бестиарии нет «${monster}»`); continue; }
    const count = Number.isInteger(item.count) && (item.count as number) >= 1 && (item.count as number) <= 20 ? item.count as number : 1;
    if (creatures + count > LIMITS.npcs) { problems.push(`npcs: больше ${LIMITS.npcs} существ — лишние пропущены`); break; }
    creatures += count;
    const disposition = item.disposition === 'neutral' || item.disposition === 'friendly' ? item.disposition : 'hostile';
    adventure.npcs.push({ monster, name: line(item.name, 100) || null, disposition, count });
  }
  if (raw.cover !== undefined) {
    const full = insideFolder(folder, raw.cover);
    if (!full) problems.push('cover — путь к картинке внутри папки мода');
    else {
      try {
        const size = (await stat(full)).size;
        const data = size <= COVER_LIMIT ? await readFile(full) : null;
        const signature = data ? detectImage(data) : null;
        if (!data || !signature) problems.push('cover: не картинка PNG, JPEG или WebP до 1,5 МБ');
        else {
          adventure.cover = String(raw.cover);
          adventure.coverData = `data:${signature.contentType};base64,${data.toString('base64')}`;
        }
      } catch {
        problems.push(`${String(raw.cover)}: файла нет`);
      }
    }
  }
  if (!adventure.scenes.length && !adventure.notes.length && !adventure.quests.length && !adventure.handouts.length) {
    adventure.error = 'в приключении нет ни сцен, ни заметок, ни заданий, ни раздаточных';
  }
}

export async function readAdventures(mods: LoadedMods | undefined): Promise<Adventure[]> {
  const folders = [...await modFolders(mods?.dirs?.bundled, true), ...await modFolders(mods?.dirs?.user, false)];
  const adventures: Adventure[] = [];
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
    if (manifest?.kind !== 'adventure') continue;
    const adventure: Adventure = {
      id: text(manifest.id, folderName), name: '', version: text(manifest.version, '0.0.0'), description: text(manifest.description),
      author: text(manifest.author), translations: translations(manifest.translations), bundled, folder,
      title: '', levels: '', players: '', duration: '', intro: '', cover: null, coverData: null,
      scenes: [], notes: [], quests: [], handouts: [], rollTables: [], npcs: [], problems: [], error: null,
    };
    adventure.name = text(manifest.name, adventure.id);
    adventure.title = adventure.name;
    adventures.push(adventure);
    if (!ID.test(adventure.id)) { adventure.error = 'id — строчные латинские буквы, цифры и дефис, от 2 до 64 знаков'; continue; }
    if (seen.has(adventure.id)) { adventure.error = `приключение с id «${adventure.id}» уже есть в другой папке`; continue; }
    seen.add(adventure.id);
    if (manifest.enabled === false) { adventure.error = 'выключено в mod.json'; continue; }
    const contentPath = insideFolder(folder, text(manifest.adventure, 'adventure.json'));
    if (!contentPath) { adventure.error = 'adventure — путь к adventure.json внутри папки мода'; continue; }
    let raw: any;
    try {
      if ((await stat(contentPath)).size > CONTENT_LIMIT) { adventure.error = 'adventure.json больше 2 МБ'; continue; }
      raw = JSON.parse(await readFile(contentPath, 'utf8'));
    } catch (error) {
      adventure.error = `adventure.json: ${(error as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'файла нет' : (error as Error).message}`.slice(0, 300);
      continue;
    }
    if (raw?.format !== 'ochag-adventure' || raw.formatVersion !== 1) { adventure.error = 'adventure.json: нужен format «ochag-adventure» и formatVersion 1'; continue; }
    await readContent(adventure, raw);
  }
  return adventures;
}

export function adventureView(adventure: Adventure) {
  return {
    id: adventure.id, name: adventure.name, version: adventure.version, description: adventure.description, author: adventure.author,
    translations: adventure.translations, bundled: adventure.bundled, title: adventure.title, levels: adventure.levels,
    players: adventure.players, duration: adventure.duration, intro: adventure.intro, cover: adventure.coverData,
    counts: {
      scenes: adventure.scenes.length, notes: adventure.notes.length, quests: adventure.quests.length, handouts: adventure.handouts.length,
      rollTables: adventure.rollTables.length, npcs: adventure.npcs.reduce((sum, npc) => sum + npc.count, 0),
    },
    problems: adventure.problems, error: adventure.error,
  };
}
