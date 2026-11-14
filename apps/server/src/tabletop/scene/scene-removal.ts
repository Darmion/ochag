import type { Queryable } from '../../db.ts';
import { packageCounts, snapshotScene, type ScenePackage } from './scene-package.ts';

// Every table that points at a scene, in the order a removal clears it; scene-removal.test.ts compares this list with the schema.
export const SCENE_ROWS_REMOVED = [
  'scene_opportunities', 'combat_events', 'initiative_entries', 'scene_fog_state', 'scene_pins', 'scene_drawings',
  'scene_counters', 'scene_triggers', 'scene_templates', 'scene_walls', 'scene_objects',
] as const;
export const SCENE_ROWS_KEPT = { combat_records: 'scene_id', campaign_audio: 'scene_id', object_states: 'passage_scene_id' } as const;

const BACKUPS_KEPT = 10;

export async function sceneContents(q: Queryable, campaignId: string, sceneId: string) {
  const count = async (sql: string) => Number((await q.query(sql, [campaignId, sceneId])).rows[0]?.n ?? 0);
  const objects = (
    await q.query(
      `SELECT c.kind, count(*)::int AS n FROM scene_objects p JOIN characters c ON c.campaign_id=p.campaign_id AND c.id=p.character_id
       WHERE p.campaign_id=$1 AND p.scene_id=$2 GROUP BY c.kind`,
      [campaignId, sceneId],
    )
  ).rows;
  const ofKind = (kind: string) => Number(objects.find(row => row.kind === kind)?.n ?? 0);
  const walls = (await q.query('SELECT kind, count(*)::int AS n FROM scene_walls WHERE campaign_id=$1 AND scene_id=$2 GROUP BY kind', [campaignId, sceneId])).rows;
  const wallsOf = (kind: string) => Number(walls.find(row => row.kind === kind)?.n ?? 0);
  return {
    walls: wallsOf('wall'), doors: wallsOf('door'), windows: wallsOf('window'),
    objects: ofKind('object'), npcs: ofKind('npc'), characters: ofKind('character'),
    traps: await count('SELECT count(*)::int AS n FROM scene_triggers WHERE campaign_id=$1 AND scene_id=$2 AND caster_id IS NULL AND spell IS NULL'),
    pins: await count('SELECT count(*)::int AS n FROM scene_pins WHERE campaign_id=$1 AND scene_id=$2'),
    drawings: await count('SELECT count(*)::int AS n FROM scene_drawings WHERE campaign_id=$1 AND scene_id=$2'),
    counters: await count('SELECT count(*)::int AS n FROM scene_counters WHERE campaign_id=$1 AND scene_id=$2'),
    combat: (await count('SELECT count(*)::int AS n FROM initiative_entries WHERE campaign_id=$1 AND scene_id=$2')) > 0,
  };
}

export async function removeScene(q: Queryable, campaignId: string, sceneId: string, name: string, userId: string) {
  const backup = await snapshotScene(q, campaignId, sceneId, 'backup', true);
  const backupId = String((
    await q.query(
      'INSERT INTO scene_backups (campaign_id, name, package, deleted_by) VALUES ($1,$2,$3::jsonb,$4) RETURNING id',
      [campaignId, name, JSON.stringify(backup), userId],
    )
  ).rows[0].id);
  await q.query(
    `DELETE FROM scene_backups WHERE campaign_id=$1 AND id NOT IN (
       SELECT id FROM scene_backups WHERE campaign_id=$1 ORDER BY deleted_at DESC, id DESC LIMIT ${BACKUPS_KEPT})`,
    [campaignId],
  );

  for (const table of SCENE_ROWS_REMOVED) {
    await q.query(`DELETE FROM ${table} WHERE campaign_id=$1 AND scene_id=$2`, [campaignId, sceneId]);
  }
  await q.query('UPDATE combat_records SET scene_id=NULL, scene_name=$3 WHERE campaign_id=$1 AND scene_id=$2', [campaignId, sceneId, name]);
  await q.query('UPDATE object_states SET passage_scene_id=NULL, passage_target_id=NULL WHERE campaign_id=$1 AND passage_scene_id=$2', [campaignId, sceneId]);
  await q.query('DELETE FROM scenes WHERE campaign_id=$1 AND id=$2', [campaignId, sceneId]);
  return backupId;
}

export async function listBackups(q: Queryable, campaignId: string) {
  return (
    await q.query(
      `SELECT b.id, b.name, b.deleted_at, b.package, u.display_name FROM scene_backups b LEFT JOIN users u ON u.id=b.deleted_by
       WHERE b.campaign_id=$1 ORDER BY b.deleted_at DESC, b.id DESC`,
      [campaignId],
    )
  ).rows.map(row => ({
    id: String(row.id), name: String(row.name), deletedAt: row.deleted_at, deletedBy: row.display_name ?? null,
    counts: packageCounts(row.package as ScenePackage),
  }));
}
