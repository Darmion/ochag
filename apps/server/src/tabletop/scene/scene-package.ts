import type { Queryable } from '../../db.ts';
import { isLatticePoint } from '../../../../../packages/domain/map/los.ts';
import { SCENE_PRESETS, presetDifficultCells, presetElevationCells, presetWalls, presetWaterCells, type ScenePresetId } from '../../../../../packages/domain/map/scene-presets.ts';
import { copyNames, createFromSnapshot, snapshotObject, type ObjectSnapshot } from './object-copies.ts';

// backup: the same campaign gets the very scene back, objects by reference; copy: the same campaign, objects as new copies; file: another campaign, nothing by reference.
export type PackageMode = 'backup' | 'copy' | 'file';

const SCENE_COLUMNS = [
  'width_cells', 'height_cells', 'feet_per_unit', 'background_asset_id', 'background_rotation', 'default_vision_radius_feet',
  'lighting', 'sky', 'weather', 'grid', 'ambience', 'playlist', 'mood_playlists', 'difficult_cells', 'water_cells', 'elevation_cells',
] as const;
const WALL_COLUMNS = ['x1', 'z1', 'x2', 'z2', 'style', 'texture_asset_id', 'kind', 'open', 'locked', 'hp', 'hp_max', 'broken'] as const;
const DRAWING_COLUMNS = ['kind', 'layer', 'color', 'width', 'points', 'text'] as const;
const COUNTER_COLUMNS = ['name', 'kind', 'value', 'hidden'] as const;
const TRIGGER_COLUMNS = [
  'kind', 'shape', 'x', 'z', 'direction', 'size_feet', 'name', 'message', 'check_kind', 'check_key', 'dc', 'damage_formula', 'damage_type',
  'half_on_success', 'once', 'enabled', 'secret', 'fired_count', 'detect_dc', 'detected', 'on_turn', 'fall_feet', 'height_feet',
] as const;
const JSON_COLUMNS = new Set(['grid', 'ambience', 'playlist', 'mood_playlists', 'difficult_cells', 'water_cells', 'elevation_cells', 'points']);
const MAX_CONTENTS = 300;

type Row = Record<string, unknown>;
type Placement = {
  x: number; y: number; z: number; rotation_y: number; scale: number; snap_to_grid: boolean; animation_name: string | null; hidden: boolean; parent: number | null;
};
export type PackageItem = { snapshot: ObjectSnapshot; contents: PackageItem[] };
export type PackageObject = {
  kind: 'character' | 'npc' | 'object';
  ref?: string;
  snapshot?: ObjectSnapshot;
  contents?: PackageItem[];
  placement: Placement;
};
export type ScenePackage = {
  version: 1;
  name: string;
  scene: Row;
  walls: Row[];
  drawings: Row[];
  counters: Row[];
  notes: Array<{ ref?: string; title: string; body: string }>;
  pins: Array<{ note: number; x: number; z: number }>;
  triggers: Array<Row & { object: number | null }>;
  objects: PackageObject[];
  fog?: Array<{ user_id: string; explored_cells: unknown }>;
};

function forFile(snapshot: ObjectSnapshot): ObjectSnapshot {
  return {
    ...snapshot,
    character: { ...snapshot.character, owner_user_id: null },
    visibility: snapshot.visibility.map(setting => ({ ...setting, users: [] })),
    access: [],
    spells: snapshot.spells.filter(spell => spell.source === 'srd'),
    factions: null,
  };
}

async function itemsInside(q: Queryable, campaignId: string, containerId: string, mode: PackageMode, budget: { left: number }, depth = 0): Promise<PackageItem[]> {
  if (depth > 3 || budget.left <= 0) return [];
  const ids = (
    await q.query(
      `SELECT id FROM characters WHERE campaign_id=$1 AND container_id=$2 AND kind='object' AND equipped_slot IS NULL ORDER BY name, id LIMIT $3`,
      [campaignId, containerId, budget.left],
    )
  ).rows.map(row => String(row.id));
  const items: PackageItem[] = [];
  for (const id of ids) {
    const snapshot = await snapshotObject(q, campaignId, id);
    if (!snapshot || budget.left <= 0) continue;
    budget.left -= 1;
    items.push({ snapshot: mode === 'file' ? forFile(snapshot) : snapshot, contents: await itemsInside(q, campaignId, id, mode, budget, depth + 1) });
  }
  return items;
}

export async function snapshotScene(q: Queryable, campaignId: string, sceneId: string, mode: PackageMode, withCreatures: boolean): Promise<ScenePackage> {
  const params = [campaignId, sceneId];
  const scene = (
    await q.query(
      `SELECT name, ${SCENE_COLUMNS.map(column => (column === 'feet_per_unit' || column === 'default_vision_radius_feet' ? `${column}::float8 AS ${column}` : column)).join(', ')}
       FROM scenes WHERE campaign_id=$1 AND id=$2`,
      params,
    )
  ).rows[0] as Row;
  const rows = async (sql: string) => (await q.query(sql, params)).rows as Row[];

  const placements = await rows(
    `SELECT p.id, p.character_id, p.parent_object_id, p.x, p.y, p.z, p.rotation_y::float8 AS rotation_y, p.scale::float8 AS scale,
            p.snap_to_grid, p.animation_name, p.hidden, c.kind, (c.sheet_extra->'summon') IS NOT NULL AS summoned
     FROM scene_objects p JOIN characters c ON c.campaign_id=p.campaign_id AND c.id=p.character_id
     WHERE p.campaign_id=$1 AND p.scene_id=$2 ORDER BY p.created_at, p.id`,
  );
  const wanted = (row: Row) => mode === 'backup' || (!row.summoned && (row.kind === 'object' || (row.kind === 'npc' && withCreatures)));
  const byId = new Map(placements.map(row => [String(row.id), row]));
  const kept = (row: Row, guard = 0): boolean =>
    wanted(row) && (!row.parent_object_id || (guard < 50 && byId.has(String(row.parent_object_id)) && kept(byId.get(String(row.parent_object_id))!, guard + 1)));
  const included = placements.filter(row => kept(row));
  const indexOf = new Map(included.map((row, index) => [String(row.id), index]));
  const objectIndexByCharacter = new Map(included.map((row, index) => [String(row.character_id), index]));

  const budget = { left: MAX_CONTENTS };
  const objects: PackageObject[] = [];
  for (const row of included) {
    const placement: Placement = {
      x: Number(row.x), y: Number(row.y), z: Number(row.z), rotation_y: Number(row.rotation_y), scale: Number(row.scale),
      snap_to_grid: row.snap_to_grid === true, animation_name: (row.animation_name as string | null) ?? null, hidden: row.hidden === true,
      parent: row.parent_object_id ? indexOf.get(String(row.parent_object_id)) ?? null : null,
    };
    const kind = row.kind as PackageObject['kind'];
    if (mode === 'backup') {
      objects.push({ kind, ref: String(row.character_id), placement });
      continue;
    }
    const snapshot = await snapshotObject(q, campaignId, String(row.character_id));
    if (!snapshot) continue;
    objects.push({
      kind, placement,
      snapshot: mode === 'file' ? forFile(snapshot) : snapshot,
      contents: kind === 'object' ? await itemsInside(q, campaignId, String(row.character_id), mode, budget) : [],
    });
  }

  const pinRows = await rows(
    `SELECT p.note_id, p.x, p.z, n.title, n.body FROM scene_pins p JOIN campaign_notes n ON n.campaign_id=p.campaign_id AND n.id=p.note_id
     WHERE p.campaign_id=$1 AND p.scene_id=$2 ORDER BY p.created_at, p.id`,
  );
  const notes: ScenePackage['notes'] = [];
  const noteIndex = new Map<string, number>();
  for (const pin of pinRows) {
    const id = String(pin.note_id);
    if (!noteIndex.has(id)) {
      noteIndex.set(id, notes.length);
      notes.push({ ...(mode === 'file' ? {} : { ref: id }), title: String(pin.title), body: String(pin.body ?? '') });
    }
  }

  const triggers = (
    await rows(
      `SELECT object_id, ${TRIGGER_COLUMNS.map(column => (['size_feet', 'height_feet'].includes(column) ? `${column}::float8 AS ${column}` : column)).join(', ')}
       FROM scene_triggers WHERE campaign_id=$1 AND scene_id=$2 AND caster_id IS NULL AND spell IS NULL ORDER BY created_at, id`,
    )
  ).flatMap(row => {
    const { object_id: objectId, ...rest } = row;
    const object = objectId ? objectIndexByCharacter.get(String(objectId)) ?? null : null;
    if (objectId && object === null) return [];
    if (mode !== 'backup') {
      rest.enabled = rest.enabled === true || (rest.once === true && Number(rest.fired_count) > 0);
      rest.fired_count = 0;
      rest.detected = false;
    }
    return [{ ...rest, object }];
  });

  return {
    version: 1,
    name: String(scene.name),
    scene: Object.fromEntries(SCENE_COLUMNS.map(column => [column, scene[column] ?? null])),
    walls: await rows(`SELECT ${WALL_COLUMNS.join(', ')} FROM scene_walls WHERE campaign_id=$1 AND scene_id=$2 ORDER BY created_at, id`),
    drawings: await rows(`SELECT ${DRAWING_COLUMNS.map(column => (column === 'width' ? 'width::float8 AS width' : column)).join(', ')} FROM scene_drawings WHERE campaign_id=$1 AND scene_id=$2 ORDER BY created_at, id`),
    counters: await rows(`SELECT ${COUNTER_COLUMNS.join(', ')} FROM scene_counters WHERE campaign_id=$1 AND scene_id=$2 ORDER BY created_at, id`),
    notes,
    pins: pinRows.map(pin => ({ note: noteIndex.get(String(pin.note_id))!, x: Number(pin.x), z: Number(pin.z) })),
    triggers,
    objects,
    ...(mode === 'backup'
      ? { fog: (await rows('SELECT user_id, explored_cells FROM scene_fog_state WHERE campaign_id=$1 AND scene_id=$2')).map(row => ({ user_id: String(row.user_id), explored_cells: row.explored_cells })) }
      : {}),
  };
}

export function packageCounts(pkg: ScenePackage) {
  return {
    walls: pkg.walls.filter(wall => (wall.kind ?? 'wall') === 'wall').length,
    doors: pkg.walls.filter(wall => wall.kind === 'door').length,
    windows: pkg.walls.filter(wall => wall.kind === 'window').length,
    objects: pkg.objects.filter(object => object.kind === 'object').length,
    creatures: pkg.objects.filter(object => object.kind !== 'object').length,
    traps: pkg.triggers.length,
    pins: pkg.pins.length,
    drawings: pkg.drawings.length,
    counters: pkg.counters.length,
  };
}

// A file comes from someone else: a row the database refuses is skipped and counted instead of failing the whole scene.
async function guarded<T>(q: Queryable, untrusted: boolean, action: () => Promise<T>): Promise<T | null> {
  if (!untrusted) return action();
  await q.query('SAVEPOINT scene_row');
  try {
    const result = await action();
    await q.query('RELEASE SAVEPOINT scene_row');
    return result;
  } catch {
    await q.query('ROLLBACK TO SAVEPOINT scene_row');
    return null;
  }
}

// A missing value takes the column default: a file may leave out what this version fills in itself.
function insertSql(table: string, columns: readonly string[], extra: Record<string, unknown>, row: Row) {
  const present = columns.filter(column => row[column] !== null && row[column] !== undefined);
  const names = [...Object.keys(extra), ...present];
  const values = [...Object.values(extra), ...present.map(column => (JSON_COLUMNS.has(column) ? JSON.stringify(row[column]) : row[column]))];
  return { sql: `INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map((_, index) => `$${index + 1}`).join(', ')}) RETURNING id`, values };
}

const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);

export type CreatedScene = { id: string; name: string; skipped: number; missing: number };

// A file deleted everywhere leaves the bin's packages as they were: ids of files the campaign no longer has are left out,
// so a deleted scene still comes back, without that map, music, wall texture or picture.
async function withoutMissingAssets(q: Queryable, campaignId: string, pkg: ScenePackage): Promise<ScenePackage> {
  const present = new Set(((await q.query('SELECT id FROM assets WHERE campaign_id=$1', [campaignId])).rows as Row[]).map(row => String(row.id).toLowerCase()));
  const gone = (value: unknown) => typeof value === 'string' && !present.has(value.toLowerCase());
  const tracks = (value: unknown) => (Array.isArray(value) ? value.filter(entry => !gone(entry)) : value);
  const snapshot = (value: ObjectSnapshot | undefined): ObjectSnapshot | undefined => {
    if (!value?.character) return value;
    const character = { ...value.character } as Row;
    for (const key of ['model_asset_id', 'image_asset_id', 'image_open_asset_id']) {
      if (!gone(character[key])) continue;
      character[key] = null;
      if (key === 'image_asset_id') character.image_crop = null;
    }
    return { ...value, character } as ObjectSnapshot;
  };
  const items = (list: PackageItem[] | undefined): PackageItem[] =>
    (Array.isArray(list) ? list : []).map(item => ({ ...item, snapshot: snapshot(item.snapshot)!, contents: items(item.contents) }));
  const scene = pkg.scene ?? {};
  const moods = scene.mood_playlists && typeof scene.mood_playlists === 'object' ? scene.mood_playlists as Row : null;
  return {
    ...pkg,
    scene: {
      ...scene,
      background_asset_id: gone(scene.background_asset_id) ? null : scene.background_asset_id,
      playlist: tracks(scene.playlist),
      mood_playlists: moods ? Object.fromEntries(Object.entries(moods).map(([mood, list]) => [mood, tracks(list)])) : scene.mood_playlists,
    },
    walls: (Array.isArray(pkg.walls) ? pkg.walls : []).map(wall => (gone(wall.texture_asset_id) ? { ...wall, style: 'stone', texture_asset_id: null } : wall)),
    objects: (Array.isArray(pkg.objects) ? pkg.objects : []).map(object => ({
      ...object,
      ...(object.snapshot ? { snapshot: snapshot(object.snapshot) } : {}),
      ...(object.contents ? { contents: items(object.contents) } : {}),
    })),
  };
}

export async function createSceneFromPackage(
  q: Queryable, campaignId: string, original: ScenePackage, mode: PackageMode, name: string, userId: string,
): Promise<CreatedScene> {
  const pkg = await withoutMissingAssets(q, campaignId, original);
  const untrusted = mode === 'file';
  const source = pkg.scene ?? {};
  const width = Number(source.width_cells), height = Number(source.height_cells);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 200 || height > 200) {
    throw Object.assign(new Error('Файл сцены повреждён: у карты нет правильного размера.'), { statusCode: 400 });
  }

  const sceneRow = Object.fromEntries(SCENE_COLUMNS.map(column => [column, source[column] ?? null])) as Row;
  let skipped = 0, missing = 0;
  const sceneBase = { campaign_id: campaignId, name, scene_document: JSON.stringify({ kind: 'shared-grid-v1' }) };
  const sceneInsert = insertSql('scenes', SCENE_COLUMNS, sceneBase, sceneRow);
  let sceneId = await guarded(q, untrusted, async () => String((await q.query(sceneInsert.sql, sceneInsert.values)).rows[0].id));
  if (!sceneId) {
    skipped += 1;
    const plain = insertSql('scenes', ['width_cells', 'height_cells'], sceneBase, sceneRow);
    sceneId = String((await q.query(plain.sql, plain.values)).rows[0].id);
  }

  const insert = async (table: string, rowColumns: readonly string[], extra: Record<string, unknown>, row: Row) => {
    const { sql, values } = insertSql(table, rowColumns, extra, row);
    const id = await guarded(q, untrusted, async () => String((await q.query(sql, values)).rows[0].id));
    if (!id) skipped += 1;
    return id;
  };
  const halfW = width / 2, halfH = height / 2;
  const onBoard = (x: unknown, z: unknown) => finite(x) && finite(z) && Math.abs(Number(x)) <= halfW && Math.abs(Number(z)) <= halfH;
  const scoped = { campaign_id: campaignId, scene_id: sceneId, created_by: userId };

  for (const wall of Array.isArray(pkg.walls) ? pkg.walls : []) {
    const ends = [[wall.x1, wall.z1], [wall.x2, wall.z2]];
    if (!ends.every(([x, z]) => onBoard(x, z) && isLatticePoint(Number(x), width) && isLatticePoint(Number(z), height)) || (wall.x1 === wall.x2 && wall.z1 === wall.z2)) {
      skipped += 1;
      continue;
    }
    await insert('scene_walls', WALL_COLUMNS, scoped, wall);
  }
  for (const drawing of Array.isArray(pkg.drawings) ? pkg.drawings : []) await insert('scene_drawings', DRAWING_COLUMNS, scoped, drawing);
  for (const counter of Array.isArray(pkg.counters) ? pkg.counters : []) await insert('scene_counters', COUNTER_COLUMNS, scoped, counter);

  const noteIds: Array<string | null> = [];
  for (const note of Array.isArray(pkg.notes) ? pkg.notes : []) {
    const existing = mode !== 'file' && typeof note.ref === 'string'
      ? (await q.query('SELECT id FROM campaign_notes WHERE campaign_id=$1 AND id::text=$2', [campaignId, note.ref])).rows[0]?.id
      : undefined;
    noteIds.push(existing ? String(existing) : await guarded(q, untrusted, async () => String((await q.query(
      'INSERT INTO campaign_notes (campaign_id, created_by, title, body) VALUES ($1,$2,$3,$4) RETURNING id',
      [campaignId, userId, String(note.title ?? '').trim().slice(0, 200) || 'Заметка', String(note.body ?? '').slice(0, 20000)],
    )).rows[0].id)));
  }
  for (const pin of Array.isArray(pkg.pins) ? pkg.pins : []) {
    const noteId = noteIds[pin.note];
    if (!noteId || !onBoard(pin.x, pin.z)) {
      skipped += 1;
      continue;
    }
    await insert('scene_pins', ['note_id', 'x', 'z'], scoped, { note_id: noteId, x: pin.x, z: pin.z });
  }

  const objects = Array.isArray(pkg.objects) ? pkg.objects : [];
  const depth = (object: PackageObject, guard = 0): number =>
    typeof object.placement?.parent === 'number' && objects[object.placement.parent] && guard < 50 ? 1 + depth(objects[object.placement.parent]!, guard + 1) : 0;
  const order = objects.map((object, index) => ({ object, index })).sort((a, b) => depth(a.object) - depth(b.object));
  const characterIds = new Map<number, string>();
  const placementIds = new Map<number, string>();

  const restoreItems = async (items: PackageItem[], containerId: string) => {
    for (const item of Array.isArray(items) ? items : []) {
      const itemName = String(item.snapshot?.character?.name ?? '').trim().slice(0, 200) || 'Предмет';
      const id = await guarded(q, untrusted, async () => {
        if (item.snapshot?.character?.kind !== 'object') throw new Error('not an item');
        const created = await createFromSnapshot(q, campaignId, item.snapshot, itemName, userId);
        await q.query('UPDATE characters SET container_id=$3 WHERE campaign_id=$1 AND id=$2', [campaignId, created, containerId]);
        return created;
      });
      if (!id) skipped += 1;
      else await restoreItems(item.contents, id);
    }
  };

  for (const { object, index } of order) {
    const place = object.placement;
    const parentId = typeof place?.parent === 'number' ? placementIds.get(place.parent) : undefined;
    if (!place || (typeof place.parent === 'number' && !parentId) || (!parentId && !onBoard(place.x, place.z))) {
      skipped += 1;
      continue;
    }
    let characterId: string | null = null;
    if (mode === 'backup' && typeof object.ref === 'string') {
      characterId = (await q.query('SELECT id FROM characters WHERE campaign_id=$1 AND id::text=$2', [campaignId, object.ref])).rows[0]?.id ?? null;
      if (!characterId) {
        missing += 1;
        continue;
      }
    } else if (object.snapshot && typeof object.snapshot === 'object') {
      const snapshot = object.snapshot;
      const kind = snapshot.character?.kind;
      characterId = await guarded(q, untrusted, async () => {
        if (kind !== 'object' && kind !== 'npc') throw new Error('not a copyable object');
        const base = String(snapshot.character.name ?? '').trim().slice(0, 200) || (kind === 'npc' ? 'НПС' : 'Объект');
        const taken = kind === 'npc' && (await q.query('SELECT 1 FROM characters WHERE campaign_id=$1 AND name=$2', [campaignId, base])).rows.length > 0;
        const [copyName] = taken ? await copyNames(q, campaignId, base, 1) : [base];
        return createFromSnapshot(q, campaignId, snapshot, copyName!, userId);
      });
      if (!characterId) {
        skipped += 1;
        continue;
      }
      if (object.kind === 'object') await restoreItems(object.contents ?? [], characterId);
    } else {
      skipped += 1;
      continue;
    }
    characterIds.set(index, characterId);
    const placementId = await insert('scene_objects', ['character_id', 'parent_object_id', 'x', 'y', 'z', 'rotation_y', 'scale', 'snap_to_grid', 'animation_name', 'hidden'], scoped, {
      character_id: characterId, parent_object_id: parentId ?? null,
      x: place.x, y: finite(place.y) ? place.y : 0, z: place.z, rotation_y: finite(place.rotation_y) ? place.rotation_y : 0,
      scale: finite(place.scale) && place.scale > 0 ? place.scale : 1, snap_to_grid: place.snap_to_grid !== false,
      animation_name: typeof place.animation_name === 'string' ? place.animation_name.slice(0, 200) : null, hidden: place.hidden === true,
    });
    if (placementId) placementIds.set(index, placementId);
  }

  for (const trigger of Array.isArray(pkg.triggers) ? pkg.triggers : []) {
    const objectId = typeof trigger.object === 'number' ? characterIds.get(trigger.object) ?? null : null;
    if ((trigger.kind === 'open' && !objectId) || (trigger.kind === 'enter' && !onBoard(trigger.x, trigger.z))) {
      skipped += 1;
      continue;
    }
    await insert('scene_triggers', TRIGGER_COLUMNS, { ...scoped, object_id: objectId }, trigger);
  }

  if (mode === 'backup') {
    for (const fog of Array.isArray(pkg.fog) ? pkg.fog : []) {
      const member = (await q.query('SELECT 1 FROM campaign_members WHERE campaign_id=$1 AND user_id::text=$2', [campaignId, fog.user_id])).rows[0];
      if (!member) continue;
      await q.query(
        'INSERT INTO scene_fog_state (campaign_id, scene_id, user_id, explored_cells) VALUES ($1,$2,$3,$4::jsonb)',
        [campaignId, sceneId, fog.user_id, JSON.stringify(fog.explored_cells ?? [])],
      );
    }
  }

  return { id: sceneId, name, skipped, missing };
}

export function presetPackage(id: ScenePresetId): ScenePackage {
  const preset = SCENE_PRESETS[id];
  return {
    version: 1,
    name: '',
    scene: {
      width_cells: preset.widthCells, height_cells: preset.heightCells, lighting: preset.lighting, sky: preset.sky,
      ambience: preset.ambience, difficult_cells: presetDifficultCells(preset), water_cells: presetWaterCells(preset),
      elevation_cells: presetElevationCells(preset),
    },
    walls: presetWalls(preset).map(wall => ({ ...wall, texture_asset_id: null, open: false, locked: false, hp: null, hp_max: null, broken: false })),
    drawings: [], counters: [], notes: [], pins: [], triggers: [], objects: [],
  };
}
