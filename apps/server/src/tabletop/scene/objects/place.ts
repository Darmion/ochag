import { footprintCells, snapFootprint } from '../../../../../../packages/domain/map/footprint.ts';
import type { TableContext } from '../../context.ts';
import { notify } from '../../live/notify.ts';
import { assertCellsClear, assertOnBoard, assertOnCells, getScene, sceneWalls } from '../board.ts';
import { nearestFreeSpot } from '../movement.ts';
import { assertValidParent, controls, rightsOf } from '../placements.ts';
import { reject, sceneParams, type SceneParams, uuid } from '../../shared.ts';

export function registerPlaceObjectRoute(ctx: TableContext) {
  const { app, auth, db, membership } = ctx;

  app.post<{
    Params: SceneParams;
    Body: {
      characterId: string;
      x?: number;
      y?: number;
      z?: number;
      rotationY?: number;
      scale?: number;
      snapToGrid?: boolean;
      parentObjectId?: string;
      hidden?: boolean;
    };
  }>(
    '/campaigns/:campaignId/scenes/:sceneId/objects',
    {
      schema: {
        params: sceneParams,
        body: {
          type: 'object',
          required: ['characterId'],
          additionalProperties: false,
          properties: {
            characterId: uuid,
            x: { type: 'number', minimum: -1000, maximum: 1000 },
            y: { type: 'number', minimum: -1000, maximum: 1000 },
            z: { type: 'number', minimum: -1000, maximum: 1000 },
            rotationY: { type: 'number', minimum: 0, exclusiveMaximum: 360 },
            scale: { type: 'number', exclusiveMinimum: 0, maximum: 50 },
            snapToGrid: { type: 'boolean' },
            parentObjectId: uuid,
            hidden: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, sceneId } = request.params;
      const body = request.body;

      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const scene = await getScene(q, campaignId, sceneId);

        const entity = (
          await q.query(
            `SELECT c.id, c.owner_user_id, c.size, c.kind, holder.name AS container_name
             FROM characters c
             LEFT JOIN characters holder ON holder.campaign_id = c.campaign_id AND holder.id = c.container_id
             WHERE c.campaign_id=$1 AND c.id=$2`,
            [campaignId, body.characterId],
          )
        ).rows[0];

        if (!entity) reject(404, 'Объект не найден в этой кампании.');
        if (entity.container_name) reject(400, `Сначала достаньте его из «${entity.container_name}».`);

        if (!controls(await rightsOf(q, member, userId), userId, entity.id, entity.owner_user_id)) {
          reject(403, 'Поставить на сцену можно свой объект или тот, к которому вам выдано «Редактирование»; любой — мастер.');
        }

        const existing = (
          await q.query(
            `SELECT id FROM scene_objects WHERE campaign_id=$1 AND scene_id=$2 AND character_id=$3`,
            [campaignId, sceneId, body.characterId],
          )
        ).rows[0];

        if (existing) return { id: existing.id as string, alreadyPlaced: true };

        const snapToGrid = body.snapToGrid ?? true;
        const footprint = footprintCells(entity.size);
        let x = body.x ?? snapFootprint(0, scene.width_cells, footprint);
        let z = body.z ?? snapFootprint(0, scene.height_cells, footprint);

        if (snapToGrid) {
          assertOnBoard(scene, x, z);
          assertOnCells(scene, x, z, footprint);
          const walls = await sceneWalls(q, campaignId, sceneId);
          if (entity.kind !== 'object' && !body.parentObjectId) {
            ({ x, z } = await nearestFreeSpot(q, campaignId, scene, { x, z }, footprint, walls));
          } else {
            assertCellsClear(scene, x, z, footprint, walls);
          }
        }

        if (body.parentObjectId) {
          await assertValidParent(q, campaignId, sceneId, body.parentObjectId, member, userId);
        }

        const inserted = await q.query(
          `INSERT INTO scene_objects (
             campaign_id, scene_id, character_id, parent_object_id,
             x, y, z, rotation_y, scale, snap_to_grid, hidden, created_by
           )
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           RETURNING id`,
          [
            campaignId, sceneId, body.characterId, body.parentObjectId ?? null,
            x, body.y ?? 0, z, body.rotationY ?? 0, body.scale ?? 1, snapToGrid,
            body.hidden ?? false, userId,
          ],
        );

        await q.query('UPDATE scenes SET revision=revision+1 WHERE id=$1', [sceneId]);

        return { id: inserted.rows[0].id as string, alreadyPlaced: false };
      });

      void notify(ctx, campaignId, sceneId);

      return reply.code(201).send(result);
    },
  );
}
