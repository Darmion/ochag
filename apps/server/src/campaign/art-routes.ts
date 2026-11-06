import { unlink } from 'node:fs/promises';
import path from 'node:path';

import { ASSETS_DIR } from '../system/asset-routes.ts';
import type { Queryable } from '../db.ts';
import { objectSchema, reject, uuid, type SceneFeatureContext } from '../tabletop/scene-feature.ts';

const KEY = /^(?:item:[^\u0000-\u001f]{1,190}|school:[A-Za-z]{3,30}|rarity:[a-z_]{3,20})$/;
const LIBRARY_PATH = /^(?:items|scene|ui)\/[a-z0-9/-]{1,150}$/;
const ASSET_VALUE = /^asset:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const MAX_KEYS = 2000;

export function registerArtRoutes(ctx: SceneFeatureContext) {
  const { app, db, auth, membership, canManage, notifyCampaign } = ctx;
  const campaignParams = objectSchema({ campaignId: uuid });

  async function assertManager(q: Queryable, campaignId: string, userId: string) {
    const member = await membership(q, campaignId, userId, true);
    if (!(await canManage(q, member, userId))) reject(403, 'Вид для всех задаёт мастер.');
  }

  async function view(q: Queryable, campaignId: string) {
    const overrides = Object.fromEntries((await q.query(
      'SELECT key, value FROM campaign_art WHERE campaign_id=$1 ORDER BY key', [campaignId],
    )).rows.map(row => [row.key as string, row.value as string]));
    const sprites = (await q.query(
      `SELECT id, original_filename, created_at FROM assets
       WHERE campaign_id=$1 AND kind='art_sprite' ORDER BY created_at, id`, [campaignId],
    )).rows.map(row => ({ id: row.id as string, label: (row.original_filename as string | null)?.replace(/\.[^.]+$/, '') || 'Спрайт', createdAt: row.created_at }));
    return { overrides, sprites };
  }

  app.get<{ Params: { campaignId: string } }>(
    '/campaigns/:campaignId/art',
    { schema: { params: campaignParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const member = await membership(db, campaignId, userId);
      return { ...(await view(db, campaignId)), canManage: await canManage(db, member, userId) };
    },
  );

  app.put<{ Params: { campaignId: string }; Body: { key: string; value: string | null } }>(
    '/campaigns/:campaignId/art',
    {
      schema: {
        params: campaignParams,
        body: objectSchema({
          key: { type: 'string', minLength: 3, maxLength: 200 },
          value: { type: ['string', 'null'], maxLength: 300 },
        }),
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const { key, value } = request.body;
      if (!KEY.test(key)) reject(400, 'Неизвестный элемент.');
      const result = await db.transaction(async q => {
        await assertManager(q, campaignId, userId);
        if (value === null) {
          await q.query('DELETE FROM campaign_art WHERE campaign_id=$1 AND key=$2', [campaignId, key]);
        } else {
          if (value !== 'none' && !LIBRARY_PATH.test(value)) {
            const assetId = ASSET_VALUE.exec(value)?.[1];
            if (!assetId) reject(400, 'Картинка — из библиотеки, «без картинки» или свой спрайт кампании.');
            const sprite = (await q.query(
              `SELECT 1 FROM assets WHERE campaign_id=$1 AND id=$2 AND kind='art_sprite'`, [campaignId, assetId],
            )).rows[0];
            if (!sprite) reject(400, 'Такого спрайта в кампании нет.');
          }
          const count = Number((await q.query('SELECT count(*) AS n FROM campaign_art WHERE campaign_id=$1 AND key<>$2', [campaignId, key])).rows[0]?.n ?? 0);
          if (count >= MAX_KEYS) reject(400, `Картинок для всех уже ${MAX_KEYS}.`);
          await q.query(
            `INSERT INTO campaign_art (campaign_id, key, value, updated_by) VALUES ($1,$2,$3,$4)
             ON CONFLICT (campaign_id, key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()`,
            [campaignId, key, value, userId],
          );
        }
        return view(q, campaignId);
      });
      void notifyCampaign(campaignId, { type: 'art' });
      return result;
    },
  );

  app.delete<{ Params: { campaignId: string } }>(
    '/campaigns/:campaignId/art',
    { schema: { params: campaignParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const result = await db.transaction(async q => {
        await assertManager(q, campaignId, userId);
        await q.query('DELETE FROM campaign_art WHERE campaign_id=$1', [campaignId]);
        return view(q, campaignId);
      });
      void notifyCampaign(campaignId, { type: 'art' });
      return result;
    },
  );

  app.delete<{ Params: { campaignId: string; assetId: string } }>(
    '/campaigns/:campaignId/art/sprites/:assetId',
    { schema: { params: objectSchema({ campaignId: uuid, assetId: uuid }) } },
    async request => {
      const userId = await auth(request);
      const { campaignId, assetId } = request.params;
      let storageKey = '';
      const result = await db.transaction(async q => {
        await assertManager(q, campaignId, userId);
        const asset = (await q.query(
          `SELECT storage_key FROM assets WHERE campaign_id=$1 AND id=$2 AND kind='art_sprite'`, [campaignId, assetId],
        )).rows[0];
        if (!asset) reject(404, 'Спрайта нет.');
        storageKey = asset.storage_key;
        await q.query('DELETE FROM campaign_art WHERE campaign_id=$1 AND lower(value)=lower($2)', [campaignId, `asset:${assetId}`]);
        await q.query(`DELETE FROM assets WHERE campaign_id=$1 AND id=$2 AND kind='art_sprite'`, [campaignId, assetId]);
        return view(q, campaignId);
      });
      if (storageKey && !storageKey.includes('/') && !storageKey.includes('\\')) {
        await unlink(path.join(ASSETS_DIR, storageKey)).catch(() => {});
      }
      void notifyCampaign(campaignId, { type: 'art' });
      return result;
    },
  );
}
