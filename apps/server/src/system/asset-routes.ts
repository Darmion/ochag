import type {
  FastifyPluginAsync,
  FastifyRequest,
} from 'fastify';

import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Database, Queryable } from '../db.ts';
import { canManageScenes } from '../tabletop/scene/scene-permissions.ts';

type Options = {
  db: Database;

  auth: (request: FastifyRequest) => Promise<string>;

  membership: (
    db: Queryable,
    campaignId: string,
    userId: string,
    lock?: boolean,
  ) => Promise<any>;
};

type CampaignParams = { campaignId: string };
type AssetParams = CampaignParams & { assetId: string };

const uuid = { type: 'string', format: 'uuid' };

function objectSchema(
  properties: Record<string, unknown>,
  required: string[] = Object.keys(properties),
) {
  return {
    type: 'object',
    required,
    additionalProperties: false,
    properties,
  };
}

function reject(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}

// Files live under server-generated names only, never at a client-supplied path.
export const ASSETS_DIR = process.env.ASSETS_DIR
  ? path.resolve(process.env.ASSETS_DIR)
  : fileURLToPath(new URL('../../../../data/assets/', import.meta.url));

const MAX_BACKGROUND_BYTES = 10 * 1024 * 1024;
const MAX_MODEL_BYTES = 25 * 1024 * 1024;
const MAX_OBJECT_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_ART_SPRITE_BYTES = 2 * 1024 * 1024;
const MAX_CAMPAIGN_AVATAR_BYTES = 5 * 1024 * 1024;
const MAX_CAMPAIGN_BANNER_BYTES = 10 * 1024 * 1024;

const PLAYER_UPLOAD_LIMIT = 200 * 1024 * 1024;

// Players' files fill the GM's own disk: past this total in one campaign only a GM uploads more.
export async function assertUploadRoom(
  q: Queryable,
  member: { owner_user_id: string; is_full_gm?: boolean },
  campaignId: string,
  userId: string,
  bytes: number,
) {
  if (member.owner_user_id === userId || member.is_full_gm) return;
  const used = Number((await q.query(
    'SELECT COALESCE(SUM(byte_size), 0) AS used FROM assets WHERE campaign_id=$1 AND uploaded_by=$2',
    [campaignId, userId],
  )).rows[0]?.used ?? 0);
  if (used + bytes > PLAYER_UPLOAD_LIMIT) {
    reject(413, `Ваши файлы в этой кампании заняли бы больше ${PLAYER_UPLOAD_LIMIT / 1024 / 1024} МБ — это предел для игрока. Попросите мастера загрузить этот файл.`);
  }
}

const ASSET_KINDS = [
  'scene_background', 'object_model', 'object_image', 'audio', 'art_sprite',
  'campaign_avatar', 'campaign_banner',
] as const;
type AssetKind = typeof ASSET_KINDS[number];

const MAX_BYTES: Record<AssetKind, number> = {
  scene_background: MAX_BACKGROUND_BYTES,
  object_model: MAX_MODEL_BYTES,
  object_image: MAX_OBJECT_IMAGE_BYTES,
  audio: MAX_MODEL_BYTES,
  art_sprite: MAX_ART_SPRITE_BYTES,
  campaign_avatar: MAX_CAMPAIGN_AVATAR_BYTES,
  campaign_banner: MAX_CAMPAIGN_BANNER_BYTES,
};

type FileSignature = { contentType: string; extension: string };

// The client's extension and Content-Type are never trusted: the file kind comes from its leading bytes.
export function detectImage(buffer: Buffer): FileSignature | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 &&
    buffer[2] === 0x4e && buffer[3] === 0x47
  ) {
    return { contentType: 'image/png', extension: '.png' };
  }

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  ) {
    return { contentType: 'image/jpeg', extension: '.jpg' };
  }

  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { contentType: 'image/webp', extension: '.webp' };
  }

  return null;
}

// Only self-contained .glb: a .gltf has external paths to validate.
export function detectGlb(buffer: Buffer): FileSignature | null {
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'glTF') {
    return { contentType: 'model/gltf-binary', extension: '.glb' };
  }

  return null;
}

export function detectAudio(buffer: Buffer): FileSignature | null {
  if (buffer.length < 12) return null;

  const ascii = (start: number, end: number) => buffer.toString('ascii', start, end);

  if (ascii(0, 3) === 'ID3' || (buffer[0] === 0xff && (buffer[1]! & 0xe0) === 0xe0)) {
    return { contentType: 'audio/mpeg', extension: '.mp3' };
  }
  if (ascii(0, 4) === 'OggS') return { contentType: 'audio/ogg', extension: '.ogg' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return { contentType: 'audio/wav', extension: '.wav' };
  if (ascii(0, 4) === 'fLaC') return { contentType: 'audio/flac', extension: '.flac' };
  if (ascii(4, 8) === 'ftyp') return { contentType: 'audio/mp4', extension: '.m4a' };

  return null;
}

function sanitizeFilename(name: string | undefined): string | null {
  if (!name) return null;

  const trimmed = name.trim().slice(0, 200);

  return trimmed.length > 0 ? trimmed : null;
}

export const assetRoutes: FastifyPluginAsync<Options> =
async (app, options) => {
  const { db, auth, membership } = options;

  await mkdir(ASSETS_DIR, { recursive: true });

  app.get<{
    Params: CampaignParams;
    Querystring: { kind?: string };
  }>(
    '/campaigns/:campaignId/assets',
    {
      schema: {
        params: objectSchema({ campaignId: uuid }),
        querystring: objectSchema({ kind: { type: 'string' } }, []),
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const kind = request.query.kind;

      const member = await membership(db, campaignId, userId);
      // Players see the shared model library and their own files, not the maps, music and handouts the GM is still keeping back.
      const everything = await canManageScenes(db, member, userId);

      const { rows } = await db.query(
        `SELECT id, kind, content_type, byte_size, original_filename, created_at
         FROM assets
         WHERE campaign_id=$1 ${kind ? 'AND kind=$3' : ''}
           AND ($2::uuid IS NULL OR kind='object_model' OR uploaded_by=$2)
         ORDER BY created_at DESC`,
        kind ? [campaignId, everything ? null : userId, kind] : [campaignId, everything ? null : userId],
      );

      return { assets: rows };
    },
  );

  app.post<{
    Params: CampaignParams;
    Querystring: { kind?: string };
  }>(
    '/campaigns/:campaignId/assets',
    {
      bodyLimit: MAX_MODEL_BYTES + 65536,
      schema: {
        params: objectSchema({ campaignId: uuid }),
        querystring: objectSchema({ kind: { type: 'string' } }, []),
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const kind = request.query.kind as AssetKind | undefined;

      if (!kind || !ASSET_KINDS.includes(kind)) {
        reject(
          400,
          'Неизвестный тип файла.',
        );
      }

      const member = await membership(db, campaignId, userId);

      if (
        kind === 'scene_background' &&
        !(await canManageScenes(db, member, userId))
      ) {
        reject(403, 'Загружать картинку карты может мастер.');
      }

      if (kind === 'audio' && !(await canManageScenes(db, member, userId))) {
        reject(403, 'Загружать музыку и звуки может мастер.');
      }

      if (kind === 'art_sprite' && !(await canManageScenes(db, member, userId))) {
        reject(403, 'Загружать спрайты для всех может мастер.');
      }

      if (
        (kind === 'campaign_avatar' || kind === 'campaign_banner') &&
        member.owner_user_id !== userId
      ) {
        reject(403, 'Менять оформление кампании может только главный мастер.');
      }

      const file = await request.file();

      if (!file) reject(400, 'Файл не передан.');

      const buffer = await file.toBuffer();
      const maxBytes = MAX_BYTES[kind];

      if (buffer.length > maxBytes) {
        reject(400, `Файл больше ${maxBytes / 1024 / 1024} МБ — выберите файл поменьше.`);
      }

      await assertUploadRoom(db, member, campaignId, userId, buffer.length);

      const signature = kind === 'object_model'
        ? detectGlb(buffer)
        : kind === 'audio'
          ? detectAudio(buffer)
          : detectImage(buffer);

      if (!signature) {
        reject(
          400,
          kind === 'object_model'
            ? 'Поддерживаются только файлы GLB (двоичный glTF).'
            : kind === 'audio'
              ? 'Поддерживаются только файлы MP3, OGG, WAV, FLAC и M4A.'
              : 'Поддерживаются только файлы PNG, JPEG и WebP.',
        );
      }

      const assetId = randomUUID();
      const storageKey = `${assetId}${signature.extension}`;
      const storagePath = path.join(ASSETS_DIR, storageKey);

      await writeFile(storagePath, buffer);

      try {
        await db.query(
          `INSERT INTO assets (
             id, campaign_id, kind, content_type,
             byte_size, storage_key, original_filename, uploaded_by
           )
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            assetId, campaignId, kind, signature.contentType,
            buffer.length, storageKey, sanitizeFilename(file.filename), userId,
          ],
        );
      } catch (error) {
        await unlink(storagePath).catch(() => {});
        throw error;
      }

      return reply.code(201).send({ id: assetId });
    },
  );

  app.get<{ Params: AssetParams }>(
    '/campaigns/:campaignId/assets/:assetId',
    {
      schema: {
        params: objectSchema({ campaignId: uuid, assetId: uuid }),
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, assetId } = request.params;

      await membership(db, campaignId, userId);

      const asset = (
        await db.query(
          `SELECT content_type, storage_key FROM assets
           WHERE campaign_id=$1 AND id=$2`,
          [campaignId, assetId],
        )
      ).rows[0];

      if (!asset) reject(404, 'Файл не найден.');

      reply.type(asset.content_type);

      return reply.send(
        createReadStream(path.join(ASSETS_DIR, asset.storage_key)),
      );
    },
  );
};
