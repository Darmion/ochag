import type { Notice } from '../scene-triggers.ts';
import { footprintCells } from '../../../../../../packages/domain/map/footprint.ts';
import { detectOpportunities, type Opportunity, settleOpportunities } from '../../combat/opportunity.ts';
import { announceFound, detectAround } from '../../combat/stealth.ts';
import type { TableContext } from '../../context.ts';
import { notify } from '../../live/notify.ts';
import { breakCamouflage } from '../../rolls/modifiers.ts';
import { assertCellsClear, assertOnBoard, assertOnCells, getScene, sceneWalls } from '../board.ts';
import { assertFreeCell, assertNotTowardFear, assertPassable, dragAlong, gmFreeMove, releaseDistantGrapples, spendMovement } from '../movement.ts';
import { assertValidParent, controls, rightsOf, wouldCreateCycle } from '../placements.ts';
import { objectParams, type ObjectParams, reject, uuid } from '../../shared.ts';

export function registerMoveObjectRoute(ctx: TableContext) {
  const { app, auth, db, membership, triggers } = ctx;

  app.put<{
    Params: ObjectParams;
    Body: {
      x: number;
      y: number;
      z: number;
      rotationY: number;
      scale: number;
      snapToGrid: boolean;
      parentObjectId: string | null;
      animationName: string | null;
      hidden?: boolean;
      revision: number;
      formation?: string[];
    };
  }>(
    '/campaigns/:campaignId/scenes/:sceneId/objects/:objectId',
    {
      schema: {
        params: objectParams,
        body: {
          type: 'object',
          required: [
            'x', 'y', 'z', 'rotationY', 'scale',
            'snapToGrid', 'parentObjectId', 'animationName', 'revision',
          ],
          additionalProperties: false,
          properties: {
            x: { type: 'number', minimum: -1000, maximum: 1000 },
            y: { type: 'number', minimum: -1000, maximum: 1000 },
            z: { type: 'number', minimum: -1000, maximum: 1000 },
            rotationY: { type: 'number', minimum: 0, exclusiveMaximum: 360 },
            scale: { type: 'number', exclusiveMinimum: 0, maximum: 50 },
            snapToGrid: { type: 'boolean' },
            parentObjectId: { oneOf: [uuid, { type: 'null' }] },
            animationName: {
              oneOf: [
                { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' },
                { type: 'null' },
              ],
            },
            hidden: { type: 'boolean' },
            revision: { type: 'integer', minimum: 1 },
            formation: { type: 'array', maxItems: 60, items: uuid },
          },
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, sceneId, objectId } = request.params;
      const {
        x, y, z, rotationY, scale,
        snapToGrid, parentObjectId, animationName, revision,
      } = request.body;

      let notices: Notice[] = [];
      let provoked: Opportunity[] = [];
      let found: string[] = [];
      let sceneObjectName = '';
      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const scene = await getScene(q, campaignId, sceneId);

        const sceneObject = (
          await q.query(
            `SELECT p.*, c.owner_user_id, c.shared, c.size, c.kind, c.name
             FROM scene_objects p
             JOIN characters c ON c.campaign_id=p.campaign_id AND c.id=p.character_id
             WHERE p.campaign_id=$1 AND p.scene_id=$2 AND p.id=$3
             FOR UPDATE OF p`,
            [campaignId, sceneId, objectId],
          )
        ).rows[0];

        if (!sceneObject) reject(404, 'Объект не найден на этой сцене.');

        const hidden = request.body.hidden ?? sceneObject.hidden;
        const rights = await rightsOf(q, member, userId);

        if (!controls(rights, userId, sceneObject.character_id, sceneObject.owner_user_id)) {
          const onlyMoves =
            (parentObjectId ?? null) === (sceneObject.parent_object_id ?? null) &&
            (animationName ?? null) === (sceneObject.animation_name ?? null) &&
            snapToGrid === sceneObject.snap_to_grid &&
            hidden === sceneObject.hidden;

          if (!sceneObject.shared || !onlyMoves) {
            reject(403, 'Недостаточно прав для изменения объекта.');
          }
        }

        if (sceneObject.revision !== revision) {
          reject(409, 'Объект уже изменён другим участником.');
        }

        if (snapToGrid) {
          assertOnBoard(scene, x, z);
          assertOnCells(scene, x, z, footprintCells(sceneObject.size));
          assertCellsClear(scene, x, z, footprintCells(sceneObject.size), await sceneWalls(q, campaignId, sceneId));
        }

        if (sceneObject.kind !== 'object' && (!rights.sceneManager || !(await gmFreeMove(q, campaignId))) && !sceneObject.parent_object_id && !parentObjectId) {
          await assertPassable(q, campaignId, scene, sceneObject.id, { x: sceneObject.x, z: sceneObject.z }, { x, z }, sceneObject.size, rights.sceneManager);
        }
        if (sceneObject.kind !== 'object' && !sceneObject.parent_object_id && !parentObjectId) {
          const requested = (request.body.formation ?? []).filter(id => id !== sceneObject.id);
          const formation = requested.length
            ? (
              await q.query(
                `SELECT p.id, p.character_id, c.owner_user_id, c.shared FROM scene_objects p
                 JOIN characters c ON c.campaign_id=p.campaign_id AND c.id=p.character_id
                 WHERE p.campaign_id=$1 AND p.scene_id=$2 AND p.id = ANY($3::uuid[])`,
                [campaignId, sceneId, requested],
              )
            ).rows.filter(row => row.shared === true || controls(rights, userId, row.character_id, row.owner_user_id)).map(row => row.id as string)
            : [];
          await assertFreeCell(q, campaignId, scene, sceneObject.id, { x: sceneObject.x, z: sceneObject.z }, { x, z }, sceneObject.size, formation);
        }
        const willing = sceneObject.kind !== 'object' && !sceneObject.parent_object_id && !parentObjectId && (!rights.sceneManager || !(await gmFreeMove(q, campaignId)));
        if (willing) {
          await assertNotTowardFear(q, campaignId, scene, { ...(sceneObject as any), world_x: sceneObject.x, world_z: sceneObject.z }, { x, z });
          await spendMovement(ctx, q, campaignId, scene, sceneObject.character_id, { x: sceneObject.x, z: sceneObject.z }, { x, z });
        }

        if (parentObjectId) {
          if (parentObjectId === objectId) {
            reject(400, 'Объект нельзя прикрепить к самому себе.');
          }

          await assertValidParent(q, campaignId, sceneId, parentObjectId, member, userId);

          if (await wouldCreateCycle(q, campaignId, objectId, parentObjectId)) {
            reject(400, 'Такое прикрепление создало бы цикл.');
          }
        }

        const updated = await q.query(
          `UPDATE scene_objects SET
             x=$1, y=$2, z=$3, rotation_y=$4, scale=$5,
             snap_to_grid=$6, parent_object_id=$7, animation_name=$8, hidden=$9,
             revision=revision+1
           WHERE id=$10
           RETURNING id, x, y, z, rotation_y::float8 AS rotation_y,
                     scale::float8 AS scale, snap_to_grid,
                     parent_object_id, animation_name, hidden, revision`,
          [x, y, z, rotationY, scale, snapToGrid, parentObjectId ?? null, animationName ?? null, hidden, objectId],
        );

        await q.query(
          'UPDATE scenes SET revision=revision+1 WHERE id=$1',
          [sceneId],
        );

        if (sceneObject.kind !== 'object' && !sceneObject.parent_object_id && !parentObjectId) {
          notices = await triggers.fireEnter(
            q, campaignId, scene, userId,
            { characterId: sceneObject.character_id, name: sceneObject.name, size: sceneObject.size },
            { x: sceneObject.x, z: sceneObject.z }, { x, z },
          );
          provoked = await detectOpportunities(q, campaignId, scene, sceneObject.character_id, { x: sceneObject.x, z: sceneObject.z }, { x, z });
          sceneObjectName = sceneObject.name;
          if (willing) notices.push(...await dragAlong(q, campaignId, scene, sceneObject as any, { x: sceneObject.x, z: sceneObject.z }, { x, z }));
          if (x !== sceneObject.x || z !== sceneObject.z) {
            await breakCamouflage(ctx, q, campaignId, sceneObject.character_id);
            found = await detectAround(q, campaignId, scene, sceneObject.character_id);
            notices.push(...await releaseDistantGrapples(q, campaignId, scene, sceneObject.character_id));
          }
        }

        return updated.rows[0];
      });

      triggers.send(campaignId, notices);
      void notify(ctx, campaignId, sceneId);
      await settleOpportunities(ctx, campaignId, provoked);
      announceFound(ctx, campaignId, sceneObjectName, found);

      return result;
    },
  );
}
