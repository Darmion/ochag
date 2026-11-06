import type { Queryable } from '../../db.ts';

import { CHARACTER_COLUMNS, characterParams, type CharacterParams, reject, uuid } from './shared.ts';
import type { RouteContext } from '../../system/route-context.ts';

export async function accessGrantLevel(
  q: Queryable, campaignId: string, characterId: string, userId: string,
): Promise<'denied' | 'edit' | null> {
  const { rows } = await q.query(
    'SELECT level FROM character_access_grants WHERE campaign_id=$1 AND character_id=$2 AND user_id=$3',
    [campaignId, characterId, userId],
  );
  return rows[0]?.level ?? null;
}

export async function isCharacterManager(ctx: RouteContext, q: Queryable, member: any, userId: string): Promise<boolean> {
  try {
    await ctx.requirePermission(q, member, userId, 'characters.manage');
    return true;
  } catch {
    return false;
  }
}

async function assertEditAccess(
  ctx: RouteContext, q: Queryable, campaignId: string, characterId: string, userId: string, member: any, ownerUserId: string | null,
) {
  if (ownerUserId === userId) return;
  const grant = await accessGrantLevel(q, campaignId, characterId, userId);
  if (grant !== 'edit') await ctx.requirePermission(q, member, userId, 'characters.manage');
}

async function viewAccess(
  ctx: RouteContext, q: Queryable, campaignId: string, characterId: string, userId: string, member: any, ownerUserId: string | null,
): Promise<boolean> {
  if (ownerUserId === userId) return true;
  if (await isCharacterManager(ctx, q, member, userId)) return true;
  const grant = await accessGrantLevel(q, campaignId, characterId, userId);
  if (grant === 'edit') return true;
  if (grant === 'denied') reject(404, 'Персонаж не найден.');
  return false;
}

export async function characterForEditing(
  ctx: RouteContext, q: Queryable, campaignId: string, characterId: string, userId: string, member: any, lock = false,
) {
  const { rows } = await q.query(
    `SELECT ${CHARACTER_COLUMNS}
     FROM characters
     WHERE campaign_id=$1 AND id=$2
     ${lock ? 'FOR UPDATE' : ''}`,
    [campaignId, characterId],
  );
  const character = rows[0];
  if (!character) reject(404, 'Персонаж не найден.');
  await assertEditAccess(ctx, q, campaignId, characterId, userId, member, character.owner_user_id);
  return character;
}

export async function characterForViewing(
  ctx: RouteContext, q: Queryable, campaignId: string, characterId: string, userId: string, member: any,
) {
  const { rows } = await q.query(
    `SELECT ${CHARACTER_COLUMNS}
     FROM characters
     WHERE campaign_id=$1 AND id=$2`,
    [campaignId, characterId],
  );
  const character = rows[0];
  if (!character) reject(404, 'Персонаж не найден.');
  const privileged = await viewAccess(ctx, q, campaignId, characterId, userId, member, character.owner_user_id);
  return { character, privileged };
}

export async function requireCharacterAccess(
  ctx: RouteContext, q: Queryable, campaignId: string, characterId: string, userId: string, member: any,
) {
  await assertEditAccess(ctx, q, campaignId, characterId, userId, member, await ownerOf(q, campaignId, characterId));
}

export async function characterAccessLevel(
  ctx: RouteContext, q: Queryable, campaignId: string, characterId: string, userId: string, member: any,
): Promise<boolean> {
  return viewAccess(ctx, q, campaignId, characterId, userId, member, await ownerOf(q, campaignId, characterId));
}

async function ownerOf(q: Queryable, campaignId: string, characterId: string): Promise<string | null> {
  const character = (await q.query('SELECT owner_user_id FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0];
  if (!character) reject(404, 'Персонаж не найден.');
  return character.owner_user_id;
}

export function registerAccessRoutes(ctx: RouteContext) {
  const { app, auth, db, membership } = ctx;

  app.get<{ Params: CharacterParams }>(
    '/campaigns/:campaignId/characters/:characterId/access',
    { schema: { params: characterParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;

      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const { privileged } = await characterForViewing(ctx, q, campaignId, characterId, userId, member);
        if (!privileged) reject(403, 'Недостаточно прав.');

        const { rows } = await q.query(
          `SELECT g.user_id, g.level, u.display_name
           FROM character_access_grants g JOIN users u ON u.id = g.user_id
           WHERE g.campaign_id=$1 AND g.character_id=$2
           ORDER BY u.display_name`,
          [campaignId, characterId],
        );

        return { grants: rows };
      });
    },
  );

  app.put<{
    Params: CharacterParams & { userId: string };
    Body: { level: 'view' | 'denied' | 'edit' };
  }>(
    '/campaigns/:campaignId/characters/:characterId/access/:userId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['campaignId', 'characterId', 'userId'],
          additionalProperties: false,
          properties: { campaignId: uuid, characterId: uuid, userId: uuid },
        },
        body: {
          type: 'object',
          required: ['level'],
          additionalProperties: false,
          properties: { level: { type: 'string', enum: ['view', 'denied', 'edit'] } },
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId, userId: targetUserId } = request.params;
      const { level } = request.body;

      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const { character, privileged } = await characterForViewing(ctx, q, campaignId, characterId, userId, member);
        if (!privileged) reject(403, 'Недостаточно прав.');

        if (targetUserId === character.owner_user_id) {
          reject(400, 'У владельца персонажа уже есть полный доступ.');
        }

        const targetIsMember = (
          await q.query('SELECT 1 FROM campaign_members WHERE campaign_id=$1 AND user_id=$2', [campaignId, targetUserId])
        ).rows[0];
        if (!targetIsMember) reject(400, 'Этот пользователь не состоит в кампании.');

        if (level === 'view') {
          await q.query(
            'DELETE FROM character_access_grants WHERE campaign_id=$1 AND character_id=$2 AND user_id=$3',
            [campaignId, characterId, targetUserId],
          );
          return { userId: targetUserId, level: 'view' };
        }

        await q.query(
          `INSERT INTO character_access_grants (campaign_id, character_id, user_id, level, granted_by)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (campaign_id, character_id, user_id) DO UPDATE SET level=$4`,
          [campaignId, characterId, targetUserId, level, userId],
        );

        return { userId: targetUserId, level };
      });
    },
  );
}
