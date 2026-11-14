import { randomUUID } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ASSET_MAX_BYTES, ASSETS_DIR, assertUploadRoom, detectAudio, detectGlb, detectImage } from '../../../system/asset-routes.ts';
import { packContainer, unpackContainer } from '../../../system/gzip-container.ts';
import type { Queryable } from '../../../db.ts';
import type { TableContext } from '../../context.ts';
import { notifyCampaign } from '../../live/notify.ts';
import { getScene } from '../board.ts';
import { createSceneFromPackage, packageCounts, snapshotScene, type PackageItem, type ScenePackage } from '../scene-package.ts';
import { campaignParams, type CampaignParams, canManage, reject, sceneParams, type SceneParams } from '../../shared.ts';

const SIGNATURE = Buffer.from('OCHAG-SCENE\n', 'utf8');
const FORMAT = 'ochag-scene';
const MAX_FILE_BYTES = 300 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 400 * 1024 * 1024;
const SCENE_ASSET_KINDS = ['scene_background', 'object_image', 'object_model', 'audio'] as const;
type SceneAssetKind = typeof SCENE_ASSET_KINDS[number];

type FileAsset = { id: string; kind: SceneAssetKind; contentType: string; filename: string | null; offset: number; length: number };
type SceneFile = { format: typeof FORMAT; formatVersion: 1; exportedAt: string; name: string; package: ScenePackage; assets: FileAsset[] };

const isId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);

function snapshotAssets(items: Array<{ snapshot?: PackageItem['snapshot']; contents?: PackageItem[] }>, into: Set<string>) {
  for (const item of items) {
    const character = (item.snapshot?.character ?? {}) as Record<string, unknown>;
    for (const key of ['model_asset_id', 'image_asset_id', 'image_open_asset_id']) if (isId(character[key])) into.add(character[key]);
    snapshotAssets(item.contents ?? [], into);
  }
}

function packageAssetIds(pkg: ScenePackage) {
  const ids = new Set<string>();
  if (isId(pkg.scene.background_asset_id)) ids.add(pkg.scene.background_asset_id);
  for (const track of Array.isArray(pkg.scene.playlist) ? pkg.scene.playlist : []) if (isId(track)) ids.add(track);
  for (const list of Object.values((pkg.scene.mood_playlists ?? {}) as Record<string, unknown>)) {
    for (const track of Array.isArray(list) ? list : []) if (isId(track)) ids.add(track);
  }
  for (const wall of pkg.walls) if (isId(wall.texture_asset_id)) ids.add(wall.texture_asset_id);
  snapshotAssets(pkg.objects, ids);
  return [...ids];
}

// Ids the file did not bring (or brought broken) are dropped, so nothing points at a picture of the other campaign.
function remapAssets<T>(value: T, ids: Map<string, string>): T {
  if (typeof value === 'string') return (isId(value) ? ids.get(value.toLowerCase()) ?? value : value) as T;
  if (Array.isArray(value)) return value.map(entry => remapAssets(entry, ids)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, remapAssets(inner, ids)])) as T;
  return value;
}

function keepKnownAssets(pkg: ScenePackage, known: Set<string>) {
  const scene = pkg.scene;
  if (!known.has(String(scene.background_asset_id))) scene.background_asset_id = null;
  scene.playlist = (Array.isArray(scene.playlist) ? scene.playlist : []).filter(track => known.has(String(track)));
  scene.mood_playlists = Object.fromEntries(
    Object.entries((scene.mood_playlists && typeof scene.mood_playlists === 'object' ? scene.mood_playlists : {}) as Record<string, unknown>)
      .map(([mood, list]) => [mood, (Array.isArray(list) ? list : []).filter(track => known.has(String(track)))]),
  );
  for (const wall of pkg.walls) {
    if (known.has(String(wall.texture_asset_id))) continue;
    wall.texture_asset_id = null;
    if (wall.style === 'image') wall.style = 'stone';
  }
}

export async function importSceneFile(q: Queryable, campaignId: string, userId: string, member: { owner_user_id: string; is_full_gm?: boolean }, compressed: Buffer, written: string[]) {
  const unpacked = unpackContainer<SceneFile>(SIGNATURE, compressed, MAX_UNPACKED_BYTES);
  if (typeof unpacked === 'string') reject(400, 'Это не файл сцены «Очага» (.ochag-scene) или он повреждён.');
  const file = unpacked.header;
  if (file?.format !== FORMAT || file.formatVersion !== 1) reject(400, 'Неизвестный формат файла сцены — обновите приложение.');
  if (!file.package || typeof file.package !== 'object' || file.package.version !== 1 || !file.package.scene) {
    reject(400, 'Файл сцены повреждён: в нём нет карты.');
  }
  const name = String(file.name ?? file.package.name ?? '').trim().slice(0, 200) || 'Сцена из файла';
  const ids = new Map<string, string>();
  let brokenAssets = 0;
  for (const asset of Array.isArray(file.assets) ? file.assets : []) {
    const start = Number(asset?.offset), length = Number(asset?.length);
    if (!isId(asset?.id) || !(SCENE_ASSET_KINDS as readonly string[]).includes(asset.kind)
      || !Number.isInteger(start) || !Number.isInteger(length) || start < 0 || length < 1 || start + length > unpacked.body.length) {
      brokenAssets += 1;
      continue;
    }
    const data = unpacked.body.subarray(start, start + length);
    const signature = asset.kind === 'object_model' ? detectGlb(data) : asset.kind === 'audio' ? detectAudio(data) : detectImage(data);
    if (!signature || data.length > ASSET_MAX_BYTES[asset.kind]) {
      brokenAssets += 1;
      continue;
    }
    await assertUploadRoom(q, member, campaignId, userId, data.length);
    const assetId = randomUUID();
    const storageKey = `${assetId}${signature.extension}`;
    await writeFile(path.join(ASSETS_DIR, storageKey), data);
    written.push(storageKey);
    await q.query(
      `INSERT INTO assets (id, campaign_id, kind, content_type, byte_size, storage_key, original_filename, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [assetId, campaignId, asset.kind, signature.contentType, data.length, storageKey, typeof asset.filename === 'string' ? asset.filename.slice(0, 200) : null, userId],
    );
    ids.set(asset.id.toLowerCase(), assetId);
  }

  const pkg = remapAssets(file.package, ids);
  for (const list of ['walls', 'drawings', 'counters', 'notes', 'pins', 'triggers', 'objects'] as const) {
    if (!Array.isArray(pkg[list])) (pkg as Record<string, unknown>)[list] = [];
  }
  keepKnownAssets(pkg, new Set(ids.values()));
  const scene = await createSceneFromPackage(q, campaignId, pkg, 'file', name, userId);
  return { ...scene, skipped: scene.skipped + brokenAssets, counts: packageCounts(pkg), assets: ids.size };
}

export function registerSceneFileRoutes(ctx: TableContext) {
  const { app, auth, db, membership } = ctx;

  app.get<{ Params: SceneParams; Querystring: { creatures?: 'yes' | 'no' } }>(
    '/campaigns/:campaignId/scenes/:sceneId/export',
    { schema: { params: sceneParams, querystring: { type: 'object', additionalProperties: false, properties: { creatures: { type: 'string', enum: ['yes', 'no'] } } } } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, sceneId } = request.params;
      const { pkg, assets } = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId);
        if (!(await canManage(q, member, userId))) reject(403, 'Сохранить сцену в файл может мастер.');
        await getScene(q, campaignId, sceneId, false);
        const pkg = await snapshotScene(q, campaignId, sceneId, 'file', request.query.creatures === 'yes');
        const ids = packageAssetIds(pkg);
        const assets = ids.length
          ? (await q.query(
              'SELECT id, kind, content_type, storage_key, original_filename FROM assets WHERE campaign_id=$1 AND id = ANY($2::uuid[]) ORDER BY id',
              [campaignId, ids],
            )).rows
          : [];
        return { pkg, assets };
      });

      const blobs: Buffer[] = [];
      const files: FileAsset[] = [];
      let offset = 0;
      for (const asset of assets) {
        if (!(SCENE_ASSET_KINDS as readonly string[]).includes(asset.kind)) continue;
        let data: Buffer;
        try {
          data = await readFile(path.join(ASSETS_DIR, path.basename(String(asset.storage_key))));
        } catch {
          continue;
        }
        files.push({ id: String(asset.id), kind: asset.kind, contentType: asset.content_type, filename: asset.original_filename ?? null, offset, length: data.length });
        blobs.push(data);
        offset += data.length;
        if (offset > MAX_FILE_BYTES) reject(413, 'Картинки, модели и музыка этой сцены занимают больше 300 МБ — такую сцену в файл не сохранить.');
      }

      const file: SceneFile = { format: FORMAT, formatVersion: 1, exportedAt: new Date().toISOString(), name: pkg.name, package: pkg, assets: files };
      const safe = pkg.name.replace(/[^\p{L}\p{N} _-]+/gu, '_').slice(0, 80) || 'scene';
      reply.type('application/gzip').header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${safe}.ochag-scene`)}`);
      return reply.send(packContainer(SIGNATURE, file, blobs));
    },
  );

  app.post<{ Params: CampaignParams }>(
    '/campaigns/:campaignId/scenes/import',
    { bodyLimit: MAX_FILE_BYTES + 65536, schema: { params: campaignParams } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const member = await membership(db, campaignId, userId);
      if (!(await canManage(db, member, userId))) reject(403, 'Загрузить сцену из файла может мастер.');

      let compressed: Buffer;
      try {
        const upload = await request.file({ limits: { fileSize: MAX_FILE_BYTES } });
        if (!upload) return reject(400, 'Файл сцены не передан.');
        compressed = await upload.toBuffer();
      } catch (error) {
        if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') reject(413, 'Файл сцены больше 300 МБ.');
        throw error;
      }

      const written: string[] = [];
      try {
        const created = await db.transaction(async q => importSceneFile(q, campaignId, userId, await membership(q, campaignId, userId, true), compressed, written));
        void notifyCampaign(ctx, campaignId, { type: 'changed' });
        return reply.code(201).send(created);
      } catch (error) {
        await Promise.all(written.map(key => unlink(path.join(ASSETS_DIR, key)).catch(() => {})));
        throw error;
      }
    },
  );
}
