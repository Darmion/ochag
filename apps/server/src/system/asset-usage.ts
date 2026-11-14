import type { Queryable } from '../db.ts';

// Where a campaign file is still needed. The client words each place (apps/client/src/campaign/campaignFiles.ts).
export type AssetPlace =
  | 'sceneBackground' | 'sceneMusic' | 'sceneWalls' | 'objectModel' | 'objectImage' | 'objectOpenImage'
  | 'player' | 'campaignLook' | 'conditionIcon' | 'handout' | 'artReplacement' | 'spell' | 'spellRevision'
  | 'deletedScene' | 'runeSymbols';

export type AssetUse = { place: AssetPlace; name: string | null };

// Every column that holds a file id; asset-usage.test.ts checks the schema for any it misses. Files also hide in JSON:
// scene playlists, the player's queue and resume, spell templates, picture replacements and deleted scenes, read below.
export const ASSET_COLUMNS = [
  'scenes.background_asset_id',
  'characters.model_asset_id', 'characters.image_asset_id', 'characters.image_open_asset_id',
  'scene_walls.texture_asset_id',
  'campaign_audio.asset_id',
  'campaigns.avatar_asset_id', 'campaigns.banner_asset_id',
  'campaign_conditions.icon_asset_id',
  'handouts.asset_id',
];

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const ids = (value: unknown): string[] => (Array.isArray(value) ? value.filter(entry => typeof entry === 'string') : []);

export async function assetUsage(q: Queryable, campaignId: string): Promise<Map<string, AssetUse[]>> {
  const uses = new Map<string, AssetUse[]>();
  const add = (id: unknown, place: AssetPlace, name: unknown = null) => {
    if (typeof id !== 'string' || !id) return;
    const key = id.toLowerCase();
    const list = uses.get(key) ?? [];
    const use = { place, name: typeof name === 'string' ? name : null };
    if (!list.some(entry => entry.place === use.place && entry.name === use.name)) list.push(use);
    uses.set(key, list);
  };
  const rows = async (sql: string) => (await q.query(sql, [campaignId])).rows as any[];

  for (const scene of await rows('SELECT name, background_asset_id, playlist, mood_playlists FROM scenes WHERE campaign_id=$1')) {
    add(scene.background_asset_id, 'sceneBackground', scene.name);
    for (const id of ids(scene.playlist)) add(id, 'sceneMusic', scene.name);
    for (const list of Object.values(scene.mood_playlists ?? {})) for (const id of ids(list)) add(id, 'sceneMusic', scene.name);
  }

  for (const wall of await rows(
    `SELECT DISTINCT s.name, w.texture_asset_id FROM scene_walls w
     JOIN scenes s ON s.campaign_id=w.campaign_id AND s.id=w.scene_id
     WHERE w.campaign_id=$1 AND w.texture_asset_id IS NOT NULL`,
  )) add(wall.texture_asset_id, 'sceneWalls', wall.name);

  for (const object of await rows(
    `SELECT name, model_asset_id, image_asset_id, image_open_asset_id FROM characters
     WHERE campaign_id=$1 AND (model_asset_id IS NOT NULL OR image_asset_id IS NOT NULL OR image_open_asset_id IS NOT NULL)`,
  )) {
    add(object.model_asset_id, 'objectModel', object.name);
    add(object.image_asset_id, 'objectImage', object.name);
    add(object.image_open_asset_id, 'objectOpenImage', object.name);
  }

  for (const audio of await rows('SELECT asset_id, queue, resume FROM campaign_audio WHERE campaign_id=$1')) {
    add(audio.asset_id, 'player');
    for (const id of ids(audio.queue)) add(id, 'player');
    add(audio.resume?.asset_id, 'player');
    for (const id of ids(audio.resume?.queue)) add(id, 'player');
  }

  for (const campaign of await rows('SELECT avatar_asset_id, banner_asset_id FROM campaigns WHERE id=$1')) {
    add(campaign.avatar_asset_id, 'campaignLook');
    add(campaign.banner_asset_id, 'campaignLook');
  }

  for (const condition of await rows('SELECT name, icon_asset_id FROM campaign_conditions WHERE campaign_id=$1 AND icon_asset_id IS NOT NULL')) {
    add(condition.icon_asset_id, 'conditionIcon', condition.name);
  }

  for (const handout of await rows('SELECT title, asset_id FROM handouts WHERE campaign_id=$1 AND asset_id IS NOT NULL')) {
    add(handout.asset_id, 'handout', handout.title);
  }

  for (const art of await rows(`SELECT key, value FROM campaign_art WHERE campaign_id=$1 AND value LIKE 'asset:%'`)) {
    add(String(art.value).slice('asset:'.length), 'artReplacement', art.key);
  }

  for (const spell of await rows(`SELECT name, template->'passport'->>'art' AS art FROM campaign_spells WHERE campaign_id=$1 AND template IS NOT NULL`)) {
    add(spell.art, 'spell', spell.name);
  }
  for (const revision of await rows(
    `SELECT s.name, r.template->'passport'->>'art' AS art FROM campaign_spell_revisions r
     JOIN campaign_spells s ON s.campaign_id=r.campaign_id AND s.id=r.spell_id
     WHERE r.campaign_id=$1`,
  )) add(revision.art, 'spellRevision', revision.name);

  for (const game of await rows(`SELECT state FROM campaign_minigames WHERE campaign_id=$1 AND kind='rune-lock' AND state IS NOT NULL`)) {
    for (const symbol of Array.isArray(game.state?.symbols) ? game.state.symbols : []) add(symbol?.assetId, 'runeSymbols', symbol?.name);
  }

  // A deleted scene comes back with its pictures, models and music: every id in its package counts.
  for (const backup of await rows('SELECT name, package FROM scene_backups WHERE campaign_id=$1')) {
    for (const id of new Set(JSON.stringify(backup.package).match(UUID) ?? [])) add(id, 'deletedScene', backup.name);
  }

  return uses;
}

// Takes a file out of every place assetUsage finds it, leaving the place empty: a scene without its map, a figure
// without its picture, a stone wall instead of the picture texture, a spell with its school's art. Deleted scenes in the
// bin keep their packages: restoring one drops the ids of files that are gone (scene-package.ts).
export async function detachAsset(q: Queryable, campaignId: string, assetId: string): Promise<void> {
  const id = assetId.toLowerCase();
  const same = (value: unknown) => typeof value === 'string' && value.toLowerCase() === id;
  const without = (list: unknown) => ids(list).filter(entry => !same(entry));
  const scenes = new Set<string>();

  for (const scene of (await q.query('SELECT id, background_asset_id, playlist, mood_playlists FROM scenes WHERE campaign_id=$1', [campaignId])).rows as any[]) {
    const moods = (scene.mood_playlists ?? {}) as Record<string, unknown>;
    if (!same(scene.background_asset_id) && !ids(scene.playlist).some(same) && !Object.values(moods).some(list => ids(list).some(same))) continue;
    await q.query(
      `UPDATE scenes SET background_asset_id = CASE WHEN background_asset_id=$3 THEN NULL ELSE background_asset_id END,
              playlist=$4::jsonb, mood_playlists=$5::jsonb
       WHERE campaign_id=$1 AND id=$2`,
      [campaignId, scene.id, assetId, JSON.stringify(without(scene.playlist)),
        JSON.stringify(Object.fromEntries(Object.entries(moods).map(([mood, list]) => [mood, without(list)])))],
    );
    scenes.add(String(scene.id));
  }

  const walls = await q.query(
    `UPDATE scene_walls SET style='stone', texture_asset_id=NULL WHERE campaign_id=$1 AND texture_asset_id=$2 RETURNING scene_id`,
    [campaignId, assetId],
  );
  for (const wall of walls.rows as any[]) scenes.add(String(wall.scene_id));
  for (const sceneId of scenes) await q.query('UPDATE scenes SET revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, sceneId]);

  await q.query(
    `UPDATE characters SET
       image_crop = CASE WHEN image_asset_id=$2 THEN NULL ELSE image_crop END,
       image_asset_id = CASE WHEN image_asset_id=$2 THEN NULL ELSE image_asset_id END,
       image_open_asset_id = CASE WHEN image_open_asset_id=$2 THEN NULL ELSE image_open_asset_id END,
       model_asset_id = CASE WHEN model_asset_id=$2 THEN NULL ELSE model_asset_id END,
       revision = revision + 1
     WHERE campaign_id=$1 AND $2 IN (image_asset_id, image_open_asset_id, model_asset_id)`,
    [campaignId, assetId],
  );

  const audio = (await q.query('SELECT asset_id, queue, resume FROM campaign_audio WHERE campaign_id=$1', [campaignId])).rows[0] as any;
  const resumeUses = audio?.resume && (same(audio.resume.asset_id) || ids(audio.resume.queue).some(same));
  if (audio && (same(audio.asset_id) || ids(audio.queue).some(same) || resumeUses)) {
    await q.query(
      `UPDATE campaign_audio SET
         asset_id = CASE WHEN $2::boolean THEN NULL ELSE asset_id END,
         playing = CASE WHEN $2::boolean THEN false ELSE playing END,
         started_at = CASE WHEN $2::boolean THEN NULL ELSE started_at END,
         paused_at_seconds = CASE WHEN $2::boolean THEN 0 ELSE paused_at_seconds END,
         queue = $3::jsonb, resume = $4::jsonb, revision = revision + 1
       WHERE campaign_id=$1`,
      [campaignId, same(audio.asset_id), JSON.stringify(without(audio.queue)), resumeUses || !audio.resume ? null : JSON.stringify(audio.resume)],
    );
  }

  await q.query(
    `UPDATE campaigns SET
       avatar_crop = CASE WHEN avatar_asset_id=$2 THEN NULL ELSE avatar_crop END,
       avatar_asset_id = CASE WHEN avatar_asset_id=$2 THEN NULL ELSE avatar_asset_id END,
       banner_crop = CASE WHEN banner_asset_id=$2 THEN NULL ELSE banner_crop END,
       banner_asset_id = CASE WHEN banner_asset_id=$2 THEN NULL ELSE banner_asset_id END
     WHERE id=$1 AND $2 IN (avatar_asset_id, banner_asset_id)`,
    [campaignId, assetId],
  );
  await q.query('UPDATE campaign_conditions SET icon_asset_id=NULL WHERE campaign_id=$1 AND icon_asset_id=$2', [campaignId, assetId]);
  // A handout needs a text or a picture: one left with neither keeps its title and an empty text.
  await q.query(`UPDATE handouts SET asset_id=NULL, body=COALESCE(body, '') WHERE campaign_id=$1 AND asset_id=$2`, [campaignId, assetId]);
  await q.query('DELETE FROM campaign_art WHERE campaign_id=$1 AND lower(value)=$2', [campaignId, `asset:${id}`]);
  const lock = (await q.query(`SELECT state FROM campaign_minigames WHERE campaign_id=$1 AND kind='rune-lock' AND state IS NOT NULL`, [campaignId])).rows[0] as any;
  if (Array.isArray(lock?.state?.symbols) && lock.state.symbols.some((symbol: any) => same(symbol?.assetId))) {
    const symbols = lock.state.symbols.map((symbol: any) => (same(symbol?.assetId) ? { ...symbol, assetId: null } : symbol));
    await q.query(`UPDATE campaign_minigames SET state=$2::jsonb WHERE campaign_id=$1 AND kind='rune-lock'`, [campaignId, JSON.stringify({ ...lock.state, symbols })]);
  }
  for (const table of ['campaign_spells', 'campaign_spell_revisions']) {
    await q.query(
      `UPDATE ${table} SET template=jsonb_set(template, '{passport,art}', '""'::jsonb)
       WHERE campaign_id=$1 AND lower(template->'passport'->>'art')=$2`,
      [campaignId, id],
    );
  }
}
