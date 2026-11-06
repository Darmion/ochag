import { loadConditionState } from '../../rules/conditions.ts';
import { incapacitatedReason } from '../../../../../packages/domain/combat/conditions.ts';

import type { TableContext } from '../context.ts';
import { notify, notifyCampaign } from '../live/notify.ts';
import { getScene } from '../scene/board.ts';
import { canManageCharacter } from '../scene/placements.ts';
import { canManage, type InitiativeParams, objectSchema, reject, uuid } from '../shared.ts';

export function registerTurnActionRoutes(ctx: TableContext) {
  const { actionEconomy, app, auth, db, membership } = ctx;

  app.post<{ Params: InitiativeParams; Body: { using?: 'action' | 'bonus' } | undefined }>(
    '/campaigns/:campaignId/scenes/:sceneId/initiative/:entryId/dash',
    { schema: { params: objectSchema({ campaignId: uuid, sceneId: uuid, entryId: uuid }) } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, sceneId, entryId } = request.params;
      const using = request.body?.using ?? 'action';
      if (using !== 'action' && using !== 'bonus') reject(400, 'Рывок — действием или бонусным действием.');

      const entry = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await getScene(q, campaignId, sceneId);

        const row = (
          await q.query(
            `SELECT ie.id, ie.is_current, ie.dashes, ie.character_id, c.owner_user_id
             FROM initiative_entries ie
             LEFT JOIN characters c ON c.campaign_id = ie.campaign_id AND c.id = ie.character_id
             WHERE ie.campaign_id=$1 AND ie.scene_id=$2 AND ie.id=$3
             FOR UPDATE OF ie`,
            [campaignId, sceneId, entryId],
          )
        ).rows[0];
        if (!row) reject(404, 'Записи инициативы нет.');
        if (!(await canManage(q, member, userId)) && !(await canManageCharacter(q, member, userId, row.owner_user_id, row.character_id))) {
          reject(403, 'Рывок делает тот, чей это персонаж, или мастер.');
        }
        if (!row.is_current) reject(400, 'Рывок — только в свой ход.');
        if (row.character_id) {
          const unable = incapacitatedReason(await loadConditionState(q, campaignId, row.character_id));
          if (unable) reject(400, `Рывок — это действие, а существо ${unable}.`);
        }
        if (row.dashes >= 3) reject(400, 'Хватит рывков на этот ход.');
        if (row.character_id) {
          await actionEconomy.spend(q, campaignId, row.character_id, using, { kind: 'other', haste: true }, { enforce: await actionEconomy.enforceFor(q, campaignId, await canManage(q, member, userId)), sceneId });
        }

        return (
          await q.query(
            'UPDATE initiative_entries SET dashes=dashes+1 WHERE id=$1 RETURNING id, dashes, moved_feet::float8 AS moved_feet',
            [entryId],
          )
        ).rows[0];
      });

      void notifyCampaign(ctx, campaignId, { type: 'initiative', sceneId });
      return reply.send(entry);
    },
  );

  app.post<{ Params: { campaignId: string; sceneId: string; entryId: string }; Body: { action: 'disengage' | 'dodge'; using?: 'action' | 'bonus' } }>(
    '/campaigns/:campaignId/scenes/:sceneId/initiative/:entryId/act',
    {
      schema: {
        params: objectSchema({ campaignId: uuid, sceneId: uuid, entryId: uuid }),
        body: {
          type: 'object', additionalProperties: false, required: ['action'],
          properties: { action: { type: 'string', enum: ['disengage', 'dodge'] }, using: { type: 'string', enum: ['action', 'bonus'] } },
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, sceneId, entryId } = request.params;
      const { action, using } = request.body;

      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await getScene(q, campaignId, sceneId);
        const row = (
          await q.query(
            `SELECT ie.id, ie.name, ie.is_current, ie.character_id, c.owner_user_id
             FROM initiative_entries ie
             LEFT JOIN characters c ON c.campaign_id = ie.campaign_id AND c.id = ie.character_id
             WHERE ie.campaign_id=$1 AND ie.scene_id=$2 AND ie.id=$3 FOR UPDATE OF ie`,
            [campaignId, sceneId, entryId],
          )
        ).rows[0];
        if (!row || !row.character_id) reject(404, 'Записи существа в инициативе нет.');
        const manager = await canManage(q, member, userId);
        if (!manager && !(await canManageCharacter(q, member, userId, row.owner_user_id, row.character_id))) reject(403, 'Действует тот, чьё это существо, или мастер.');
        if (!row.is_current) reject(400, 'Это действие — только в свой ход.');
        const unable = incapacitatedReason(await loadConditionState(q, campaignId, row.character_id));
        if (unable) reject(400, `${row.name} не может действовать: ${unable}.`);
        await actionEconomy.spend(q, campaignId, row.character_id, using ?? 'action', { kind: 'other', haste: action === 'disengage' }, { enforce: await actionEconomy.enforceFor(q, campaignId, manager), sceneId });
        if (action === 'disengage') {
          await q.query('UPDATE initiative_entries SET disengaged=true WHERE id=$1', [entryId]);
        } else {
          await q.query(`DELETE FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='dodging'`, [campaignId, row.character_id]);
          await q.query(`INSERT INTO character_effects (campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,'dodging','{"source":"dodge"}'::jsonb)`, [campaignId, row.character_id]);
        }
        return { characterId: row.character_id as string, name: row.name as string };
      });

      void notifyCampaign(ctx, campaignId, { type: 'initiative', sceneId });
      void notify(ctx, campaignId, sceneId);
      void notifyCampaign(ctx, campaignId, { type: 'character', characterId: result.characterId });
      void notifyCampaign(ctx, campaignId, {
        type: 'float', characterId: result.characterId, text: action === 'dodge' ? 'уклонение' : 'отход', tone: 'info',
      });
      return { action, ...result };
    },
  );

  app.post<{ Params: { campaignId: string; sceneId: string; entryId: string }; Body: { action?: boolean; bonus?: boolean; reaction?: boolean } }>(
    '/campaigns/:campaignId/scenes/:sceneId/initiative/:entryId/economy',
    {
      schema: {
        params: objectSchema({ campaignId: uuid, sceneId: uuid, entryId: uuid }),
        body: {
          type: 'object', additionalProperties: false, minProperties: 1,
          properties: { action: { type: 'boolean' }, bonus: { type: 'boolean' }, reaction: { type: 'boolean' } },
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, sceneId, entryId } = request.params;
      const { action, bonus, reaction } = request.body;

      const entry = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await getScene(q, campaignId, sceneId);
        const row = (
          await q.query(
            `SELECT ie.id, ie.character_id, c.owner_user_id FROM initiative_entries ie
             LEFT JOIN characters c ON c.campaign_id = ie.campaign_id AND c.id = ie.character_id
             WHERE ie.campaign_id=$1 AND ie.scene_id=$2 AND ie.id=$3 FOR UPDATE OF ie`,
            [campaignId, sceneId, entryId],
          )
        ).rows[0];
        if (!row) reject(404, 'Записи инициативы нет.');
        const manager = await canManage(q, member, userId);
        if (!manager) {
          if (!(await canManageCharacter(q, member, userId, row.owner_user_id, row.character_id))) reject(403, 'Отмечает тот, чьё это существо, или мастер.');
          if ([action, bonus, reaction].includes(false)) reject(403, 'Вернуть потраченное может мастер.');
        }
        return (
          await q.query(
            `UPDATE initiative_entries SET
               action_used = COALESCE($2, action_used),
               attacks_made = CASE WHEN $2 = false THEN 0 ELSE attacks_made END,
               bonus_used = COALESCE($3, bonus_used),
               reaction_used = COALESCE($4, reaction_used)
             WHERE id=$1
             RETURNING id, action_used, bonus_used, reaction_used, attacks_made`,
            [entryId, action ?? null, bonus ?? null, reaction ?? null],
          )
        ).rows[0];
      });

      void notifyCampaign(ctx, campaignId, { type: 'initiative', sceneId });
      return entry;
    },
  );
}
