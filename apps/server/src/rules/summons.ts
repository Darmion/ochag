import type { Queryable } from '../db.ts';

export async function vanishSummon(q: Queryable, campaignId: string, characterId: string) {
  const row = (await q.query(
    `UPDATE characters SET sheet_extra = jsonb_set(sheet_extra, '{summon,gone}', 'true'::jsonb), revision=revision+1
     WHERE campaign_id=$1 AND id=$2 AND sheet_extra ? 'summon' RETURNING id`,
    [campaignId, characterId],
  )).rows[0];
  if (!row) return false;
  await q.query('DELETE FROM initiative_entries WHERE campaign_id=$1 AND (character_id=$2 OR reflex_of=$2)', [campaignId, characterId]);
  await q.query('DELETE FROM scene_opportunities WHERE campaign_id=$1 AND (reactor_id=$2 OR mover_id=$2)', [campaignId, characterId]);
  await q.query('UPDATE scenes SET revision=revision+1 WHERE campaign_id=$1', [campaignId]);
  return true;
}

export async function vanishSummonsOf(q: Queryable, campaignId: string, casterId: string, kind: string) {
  const rows = (await q.query(
    `SELECT id FROM characters WHERE campaign_id=$1 AND sheet_extra->'summon'->>'casterId' = $2 AND sheet_extra->'summon'->>'kind' = $3
       AND NOT COALESCE((sheet_extra->'summon'->>'gone')::boolean, false)`,
    [campaignId, casterId, kind],
  )).rows as Array<{ id: string }>;
  for (const row of rows) await vanishSummon(q, campaignId, row.id);
  return rows.length;
}

const OWN_TABLES = [
  'scene_objects', 'initiative_entries', 'character_effects', 'character_vision_overrides',
  'character_resources', 'character_skills', 'character_saves', 'character_spells',
  'character_spell_slots', 'character_weapons',
  'character_field_visibility_grants', 'character_field_visibility', 'character_access_grants',
  'object_states', 'roll_applications', 'faction_members',
];

export async function purgeGoneSummons(q: Queryable, campaignId: string) {
  const gone = (await q.query(
    `SELECT id FROM characters WHERE campaign_id=$1 AND COALESCE((sheet_extra->'summon'->>'gone')::boolean, false) FOR UPDATE SKIP LOCKED`,
    [campaignId],
  )).rows as Array<{ id: string }>;
  for (const { id } of gone) {
    const params = [campaignId, id];
    await q.query('UPDATE characters SET container_id=NULL WHERE campaign_id=$1 AND container_id=$2', params);
    for (const table of OWN_TABLES) await q.query(`DELETE FROM ${table} WHERE campaign_id=$1 AND character_id=$2`, params);
    await q.query('DELETE FROM scene_opportunities WHERE campaign_id=$1 AND (reactor_id=$2 OR mover_id=$2)', params);
    await q.query('DELETE FROM initiative_entries WHERE campaign_id=$1 AND reflex_of=$2', params);
    await q.query('DELETE FROM combat_events WHERE campaign_id=$1 AND (target_id=$2 OR actor_id=$2)', params);
    await q.query('DELETE FROM import_drafts WHERE campaign_id=$1 AND (target_character_id=$2 OR result_character_id=$2)', params);
    await q.query('UPDATE roll_log SET character_id=NULL WHERE campaign_id=$1 AND character_id=$2', params);
    await q.query('DELETE FROM characters WHERE campaign_id=$1 AND id=$2', params);
  }
  return gone.length;
}
