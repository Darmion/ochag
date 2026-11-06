import { releaseMagic } from '../../../characters/magic-items.ts';
import type { TableContext } from '../../context.ts';
import { notifyCampaign } from '../../live/notify.ts';
import { canManageCharacter, detachChildren } from '../placements.ts';
import { type CampaignParams, objectSchema, reject, uuid } from '../../shared.ts';

export function registerRemoveObjectRoute(ctx: TableContext) {
  const { app, auth, db, membership } = ctx;

  app.delete<{ Params: CampaignParams & { characterId: string } }>(
    '/campaigns/:campaignId/characters/:characterId',
    { schema: { params: objectSchema({ campaignId: uuid, characterId: uuid }) } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;

      await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const character = (
          await q.query(
            'SELECT owner_user_id FROM characters WHERE campaign_id=$1 AND id=$2 FOR UPDATE',
            [campaignId, characterId],
          )
        ).rows[0];

        if (!character) reject(404, 'Объект не найден.');

        if (!(await canManageCharacter(q, member, userId, character.owner_user_id))) {
          reject(403, 'Удалить объект может его владелец или мастер.');
        }

        const params = [campaignId, characterId];

        const placed = (
          await q.query('SELECT id, scene_id FROM scene_objects WHERE campaign_id=$1 AND character_id=$2', params)
        ).rows as Array<{ id: string; scene_id: string }>;
        await detachChildren(q, campaignId, placed);

        await releaseMagic(q, campaignId, characterId);
        await q.query('UPDATE characters SET container_id=NULL WHERE campaign_id=$1 AND container_id=$2', params);

        for (const table of [
          'scene_objects', 'initiative_entries', 'character_effects', 'character_vision_overrides',
          'character_resources', 'character_skills', 'character_saves', 'character_spells',
          'character_spell_slots', 'character_weapons',
          'character_field_visibility_grants', 'character_field_visibility', 'character_access_grants',
          'object_states', 'roll_applications', 'faction_members',
        ]) {
          await q.query(`DELETE FROM ${table} WHERE campaign_id=$1 AND character_id=$2`, params);
        }
        await q.query('DELETE FROM scene_opportunities WHERE campaign_id=$1 AND (reactor_id=$2 OR mover_id=$2)', params);
        await q.query('DELETE FROM initiative_entries WHERE campaign_id=$1 AND reflex_of=$2', params);
        await q.query('DELETE FROM combat_events WHERE campaign_id=$1 AND (target_id=$2 OR actor_id=$2)', params);

        await q.query(
          'DELETE FROM import_drafts WHERE campaign_id=$1 AND (target_character_id=$2 OR result_character_id=$2)',
          params,
        );
        await q.query('UPDATE roll_log SET character_id=NULL WHERE campaign_id=$1 AND character_id=$2', params);
        await q.query('DELETE FROM characters WHERE campaign_id=$1 AND id=$2', params);
        await q.query('UPDATE scenes SET revision=revision+1 WHERE campaign_id=$1', [campaignId]);
      });

      void notifyCampaign(ctx, campaignId, { type: 'changed' });
      return reply.code(204).send();
    },
  );
}
