import type { FastifyInstance } from 'fastify';
import { purgeGoneSummons } from '../rules/summons.ts';
import { canManageScenes } from '../tabletop/scene/scene-permissions.ts';
import { inventoryVisibility } from './inventory-routes.ts';
import { type Options, paramsSchema, type CampaignParams } from './import/shared.ts';

export function registerCharacterListRoute(app: FastifyInstance, { db, auth, membership, requirePermission }: Options) {
  app.get<{ Params: CampaignParams }>(
    '/campaigns/:campaignId/characters',
    { schema: { params: paramsSchema } },
    async request => {
      const userId = await auth(request);
      const campaignId = request.params.campaignId;
      const member = await membership(db, campaignId, userId);
      await db.transaction(q => purgeGoneSummons(q, campaignId));

      let privileged = true;
      try {
        await requirePermission(db, member, userId, 'characters.manage');
      } catch {
        privileged = false;
      }

      // Only id/name/owner here: hp/ac/speed may be hidden per field, and characters denied to the viewer are excluded, not redacted.
      const sceneManager = await canManageScenes(db, member, userId);

      const { rows } = await db.query(
        `SELECT c.id, c.name, c.owner_user_id, u.display_name AS owner_display_name,
                c.kind, c.disposition, c.size, c.image_asset_id, c.image_crop, c.model_asset_id, c.shared, c.container_id,
                ($3 OR c.owner_user_id = $2) IS TRUE AS can_delete,
                (
                  $3 OR $4::boolean OR c.owner_user_id = $2 OR EXISTS (
                    SELECT 1 FROM character_access_grants g
                    WHERE g.campaign_id = c.campaign_id AND g.character_id = c.id
                      AND g.user_id = $2 AND g.level = 'edit'
                  )
                ) IS TRUE AS can_control
         FROM characters c
         LEFT JOIN users u ON u.id = c.owner_user_id
         WHERE c.campaign_id = $1
           AND ($3 OR c.owner_user_id = $2 OR NOT EXISTS (
             SELECT 1 FROM character_access_grants g
             WHERE g.campaign_id = c.campaign_id AND g.character_id = c.id
               AND g.user_id = $2 AND g.level = 'denied'
           ))
         ORDER BY c.kind, c.name, c.id`,
        [campaignId, userId, privileged, sceneManager],
      );

      return { characters: inventoryVisibility(rows as Parameters<typeof inventoryVisibility>[0], privileged || sceneManager), canManage: privileged };
    },
  );
}
