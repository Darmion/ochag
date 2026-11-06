import { attachExtras } from './extras.ts';
import {
  assertAsset, type CampaignParams, CHARACTER_COLUMNS, type Disposition, DISPOSITIONS, nullableUuid, OBJECT_KINDS, type ObjectKind,
  reject, type Size, SIZES, uuid,
} from './shared.ts';
import { isCharacterManager } from './access.ts';
import type { RouteContext } from '../../system/route-context.ts';

export function registerCreateRoute(ctx: RouteContext) {
  const { app, auth, db, membership } = ctx;

  app.post<{
    Params: CampaignParams;
    Body: {
      kind: ObjectKind;
      name: string;
      disposition?: Disposition;
      size?: Size;
      ownerUserId?: string | null;
      level?: number;
      strength?: number;
      dexterity?: number;
      constitution?: number;
      intelligence?: number;
      wisdom?: number;
      charisma?: number;
      hpMax?: number;
      hpCurrent?: number;
      armorClass?: number;
      speedFeet?: number;
      imageAssetId?: string;
      modelAssetId?: string;
      className?: string;
    };
  }>(
    '/campaigns/:campaignId/characters',
    {
      schema: {
        params: {
          type: 'object',
          required: ['campaignId'],
          additionalProperties: false,
          properties: { campaignId: uuid },
        },
        body: {
          type: 'object',
          required: ['kind', 'name'],
          additionalProperties: false,
          properties: {
            kind: { type: 'string', enum: [...OBJECT_KINDS] },
            name: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
            disposition: { type: 'string', enum: [...DISPOSITIONS] },
            size: { type: 'string', enum: [...SIZES] },
            ownerUserId: nullableUuid,
            level: { type: 'integer', minimum: 1, maximum: 20 },
            strength: { type: 'integer', minimum: 0 },
            dexterity: { type: 'integer', minimum: 0 },
            constitution: { type: 'integer', minimum: 0 },
            intelligence: { type: 'integer', minimum: 0 },
            wisdom: { type: 'integer', minimum: 0 },
            charisma: { type: 'integer', minimum: 0 },
            hpMax: { type: 'integer', minimum: 0 },
            hpCurrent: { type: 'integer', minimum: 0 },
            armorClass: { type: 'integer' },
            speedFeet: { type: 'number', minimum: 0 },
            imageAssetId: uuid,
            modelAssetId: uuid,
            className: { type: 'string', maxLength: 100 },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const body = request.body;

      const created = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const manager = await isCharacterManager(ctx, q, member, userId);

        if (body.kind === 'npc' && !manager) reject(403, 'Создавать НПС может мастер.');
        if (body.ownerUserId !== undefined && !manager) reject(403, 'Назначить владельца может мастер.');
        if (body.kind !== 'npc' && body.disposition) {
          reject(400, 'Отношение (враг, нейтрал, союзник) бывает только у НПС.');
        }

        let ownerUserId: string | null;

        if (body.ownerUserId !== undefined) {
          ownerUserId = body.ownerUserId;

          if (ownerUserId) {
            const isMember = (
              await q.query('SELECT 1 FROM campaign_members WHERE campaign_id=$1 AND user_id=$2', [campaignId, ownerUserId])
            ).rows[0];
            if (!isMember) reject(400, 'Этот пользователь не состоит в кампании.');
          }
        } else if (body.kind === 'npc') {
          ownerUserId = null;
        } else if (body.kind === 'object') {
          ownerUserId = manager ? null : userId;
        } else {
          ownerUserId = userId;
        }

        if (body.imageAssetId) await assertAsset(q, campaignId, body.imageAssetId, 'object_image');
        if (body.modelAssetId) await assertAsset(q, campaignId, body.modelAssetId, 'object_model');

        const hpMax = body.hpMax ?? 0;
        const inserted = await q.query(
          `INSERT INTO characters (
             campaign_id, owner_user_id, name, kind, disposition, size, level,
             strength, dexterity, constitution, intelligence, wisdom, charisma,
             hp_max, hp_current, armor_class, speed_feet,
             image_asset_id, model_asset_id, class_name
           )
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
           RETURNING id`,
          [
            campaignId, ownerUserId, body.name.trim(), body.kind,
            body.kind === 'npc' ? body.disposition ?? 'neutral' : null,
            body.size ?? 'medium', body.level ?? null,
            body.strength ?? 10, body.dexterity ?? 10, body.constitution ?? 10,
            body.intelligence ?? 10, body.wisdom ?? 10, body.charisma ?? 10,
            hpMax, Math.min(body.hpCurrent ?? hpMax, hpMax),
            body.armorClass ?? 10,
            body.speedFeet ?? (body.kind === 'object' ? 0 : 30),
            body.imageAssetId ?? null, body.modelAssetId ?? null,
            body.kind === 'object' ? null : body.className?.trim() || null,
          ],
        );

        const characterId = inserted.rows[0].id as string;
        const character = (
          await q.query(`SELECT ${CHARACTER_COLUMNS} FROM characters WHERE campaign_id=$1 AND id=$2`, [campaignId, characterId])
        ).rows[0];

        return attachExtras(q, campaignId, characterId, character);
      });

      return reply.code(201).send(created);
    },
  );
}
