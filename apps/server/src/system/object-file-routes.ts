import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Database, Queryable } from '../db.ts';
import { ASSETS_DIR, assertUploadRoom, detectGlb, detectImage } from './asset-routes.ts';
import { createFromSnapshot, snapshotObject, type ObjectSnapshot } from '../tabletop/scene/object-copies.ts';

type Options = {
  db: Database;
  auth: (request: FastifyRequest) => Promise<string>;
  membership: (db: Queryable, campaignId: string, userId: string, lock?: boolean) => Promise<any>;
};

// The format id inside the file keeps the old product name: older .ttrpg-object files must still open.
export const OBJECT_FILE_FORMAT = 'ttrpg-object';
const MAX_IMPORT_BYTES = 40 * 1024 * 1024;
const uuid = { type: 'string', format: 'uuid' };

function reject(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}

async function characterManager(q: Queryable, member: any, userId: string) {
  if (member.owner_user_id === userId || member.is_full_gm === true) return true;
  return (
    await q.query(`SELECT 1 FROM member_permissions WHERE campaign_id=$1 AND user_id=$2 AND permission='characters.manage'`, [member.campaign_id, userId])
  ).rows.length > 0;
}

type FileAsset = { kind: 'object_image' | 'object_model'; contentType: string; filename: string | null; data: string };

export const objectFileRoutes: FastifyPluginAsync<Options> = async (app, options) => {
  const { db, auth, membership } = options;

  app.get<{ Params: { campaignId: string; characterId: string } }>(
    '/campaigns/:campaignId/characters/:characterId/export',
    { schema: { params: { type: 'object', required: ['campaignId', 'characterId'], additionalProperties: false, properties: { campaignId: uuid, characterId: uuid } } } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const member = await membership(db, campaignId, userId);
      const row = (
        await db.query('SELECT name, owner_user_id, model_asset_id, image_asset_id FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])
      ).rows[0];
      if (!row) reject(404, 'Объект не найден.');
      if (row.owner_user_id !== userId && !(await characterManager(db, member, userId))) {
        reject(403, 'Скачать можно своего персонажа или, мастеру, любой объект.');
      }

      const snapshot = await snapshotObject(db, campaignId, characterId);
      if (!snapshot) reject(404, 'Объект не найден.');
      (snapshot.character as Record<string, unknown>).owner_user_id = null;
      snapshot.visibility = snapshot.visibility.map(setting => ({ ...setting, users: [] }));
      snapshot.access = [];
      snapshot.spells = snapshot.spells.filter(spell => spell.source === 'srd');

      const assets: FileAsset[] = [];
      for (const [kind, assetId] of [['object_image', row.image_asset_id], ['object_model', row.model_asset_id]] as const) {
        if (!assetId) continue;
        const asset = (await db.query('SELECT content_type, storage_key, original_filename FROM assets WHERE campaign_id=$1 AND id=$2', [campaignId, assetId])).rows[0];
        if (!asset) continue;
        try {
          const bytes = await readFile(path.join(ASSETS_DIR, asset.storage_key));
          assets.push({ kind, contentType: asset.content_type, filename: asset.original_filename ?? null, data: bytes.toString('base64') });
        } catch {
        }
      }

      const file = {
        format: OBJECT_FILE_FORMAT,
        formatVersion: 1,
        exportedAt: new Date().toISOString(),
        name: row.name,
        snapshot,
        assets,
      };
      const safe = String(row.name).replace(/[^\p{L}\p{N} _-]+/gu, '_').slice(0, 80) || 'object';
      reply.header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${safe}.ochag-object`)}`);
      return file;
    },
  );

  app.post<{ Params: { campaignId: string }; Body: { file: Record<string, any> } }>(
    '/campaigns/:campaignId/objects/import',
    {
      bodyLimit: MAX_IMPORT_BYTES,
      schema: {
        params: { type: 'object', required: ['campaignId'], additionalProperties: false, properties: { campaignId: uuid } },
        body: { type: 'object', required: ['file'], additionalProperties: false, properties: { file: { type: 'object' } } },
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const file = request.body.file;
      if (file.format !== OBJECT_FILE_FORMAT || file.formatVersion !== 1) reject(400, 'Это не файл объекта «Очага» (.ochag-object).');
      const snapshot = file.snapshot as ObjectSnapshot;
      if (!snapshot || snapshot.version !== 1 || typeof snapshot.character !== 'object' || snapshot.character === null) {
        reject(400, 'Файл объекта повреждён: нет листа.');
      }
      for (const list of ['effects', 'resources', 'skills', 'saves', 'spells', 'spellSlots', 'weapons', 'visibility', 'access'] as const) {
        if (!Array.isArray((snapshot as any)[list])) (snapshot as any)[list] = [];
      }
      const character = snapshot.character as Record<string, any>;
      if (!['character', 'npc', 'object'].includes(character.kind)) reject(400, 'Файл объекта повреждён: неизвестный вид.');
      const name = typeof character.name === 'string' && character.name.trim() ? character.name.trim().slice(0, 200) : 'Объект из файла';

      const written: string[] = [];
      try {
        const result = await db.transaction(async q => {
          const member = await membership(q, campaignId, userId, true);
          const manager = await characterManager(q, member, userId);
          if (!manager && character.kind !== 'character') reject(403, 'Загрузить НПС или предмет может мастер; игрок — своего персонажа.');
          character.owner_user_id = character.kind === 'character' ? userId : null;
          snapshot.access = [];
          snapshot.visibility = snapshot.visibility.map(setting => ({ ...setting, users: [] }));
          snapshot.spells = snapshot.spells.filter(spell => spell.source === 'srd');

          character.image_asset_id = null;
          character.model_asset_id = null;
          for (const asset of Array.isArray(file.assets) ? file.assets as FileAsset[] : []) {
            if (asset?.kind !== 'object_image' && asset?.kind !== 'object_model') continue;
            if (typeof asset.data !== 'string') continue;
            const bytes = Buffer.from(asset.data, 'base64');
            const signature = asset.kind === 'object_model' ? detectGlb(bytes) : detectImage(bytes);
            if (!signature || bytes.length > (asset.kind === 'object_model' ? 25 : 5) * 1024 * 1024) continue;
            await assertUploadRoom(q, member, campaignId, userId, bytes.length);
            const assetId = randomUUID();
            const storageKey = `${assetId}${signature.extension}`;
            await writeFile(path.join(ASSETS_DIR, storageKey), bytes);
            written.push(storageKey);
            await q.query(
              `INSERT INTO assets (id, campaign_id, kind, content_type, byte_size, storage_key, original_filename, uploaded_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
              [assetId, campaignId, asset.kind, signature.contentType, bytes.length, storageKey, typeof asset.filename === 'string' ? asset.filename.slice(0, 200) : null, userId],
            );
            if (asset.kind === 'object_image') character.image_asset_id = assetId;
            else character.model_asset_id = assetId;
          }

          const id = await createFromSnapshot(q, campaignId, snapshot, name, userId);
          return { characterId: id, name, kind: character.kind as string };
        });
        return reply.code(201).send(result);
      } catch (error) {
        for (const key of written) await unlink(path.join(ASSETS_DIR, key)).catch(() => {});
        throw error;
      }
    },
  );
};
