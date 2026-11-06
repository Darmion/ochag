import type {
  FastifyPluginAsync,
  FastifyRequest,
} from 'fastify';

import { randomUUID } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

import type { Database, Queryable } from '../db.ts';
import { ASSETS_DIR, detectAudio, detectGlb, detectImage } from './asset-routes.ts';

type Options = {
  db: Database;
  auth: (request: FastifyRequest) => Promise<string>;
  membership: (db: Queryable, campaignId: string, userId: string, lock?: boolean) => Promise<any>;
  identity: () => Promise<{ serverId: string | undefined; hostName: string }>;
  requireCampaignCreator: (request: FastifyRequest, userId: string) => Promise<void>;
};

type Row = Record<string, unknown>;

type PackageJson = {
  format: 'ttrpg-campaign';
  formatVersion: 1;
  schemaVersion: number;
  exportedAt: string;
  source: { serverId: string | undefined; hostName: string };
  campaign: Row;
  members: { userId: string; username: string; displayName: string }[];
  tables: Record<string, Row[]>;
  files: { storageKey: string; offset: number; length: number }[];
};

// The signature keeps the old product name: older .ttrpg-campaign files must still open.
const MAGIC = Buffer.from('TTRPG-CAMPAIGN\n', 'utf8');
const MAX_PACKAGE_BYTES = 1024 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 1536 * 1024 * 1024;

// FK-safe insert order; character_vision_overrides is not transferred (the app role cannot write it).
const TABLES = [
  'campaign_members', 'member_permissions',
  'assets',
  'characters', 'factions', 'faction_members', 'faction_relations', 'character_effects', 'character_resources', 'character_skills', 'character_saves',
  'campaign_spells', 'campaign_spell_refs', 'campaign_spell_revisions', 'campaign_srd_templates', 'character_spells', 'character_spell_slots', 'character_weapons',
  'character_field_visibility', 'character_field_visibility_grants', 'character_access_grants', 'object_states', 'magic_items',
  'scenes', 'scene_objects', 'scene_walls', 'scene_fog_state', 'scene_drawings', 'scene_counters', 'scene_templates', 'scene_triggers',
  'initiative_entries', 'roll_log',
  'campaign_notes', 'campaign_note_grants', 'scene_pins',
  'campaign_rules', 'campaign_audio', 'campaign_encounters', 'campaign_quests', 'campaign_quest_objectives',
  'handouts', 'handout_recipients', 'dialogues', 'chat_messages', 'combat_records', 'chronicle_entries', 'roll_tables',
  'campaign_art',
] as const;

export const NOT_TRANSFERRED = [
  'character_vision_overrides', 'import_drafts', 'campaign_invites',
  'dialogue_sessions', 'scene_opportunities', 'roll_applications', 'combat_events',
] as const;
export { TABLES as TRANSFER_TABLES };

const USER_COLUMNS = new Set(['user_id', 'owner_user_id', 'created_by', 'uploaded_by', 'granted_by', 'reviewed_by', 'updated_by', 'submitted_by']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const ALLOWED_ASSET_EXTENSIONS = new Set(['.png', '.jpg', '.webp', '.glb', '.mp3', '.ogg', '.wav', '.flac', '.m4a']);

function reject(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}

function packContainer(json: PackageJson, blobs: Buffer[]): Buffer {
  const header = Buffer.from(JSON.stringify(json), 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);
  return gzipSync(Buffer.concat([MAGIC, length, header, ...blobs]));
}

function unpackContainer(compressed: Buffer): { json: PackageJson; body: Buffer } {
  let raw: Buffer;

  try {
    raw = gunzipSync(compressed, { maxOutputLength: MAX_UNPACKED_BYTES });
  } catch {
    return reject(400, 'Файл не похож на сохранённую кампанию (или повреждён).');
  }

  if (raw.length < MAGIC.length + 4 || !raw.subarray(0, MAGIC.length).equals(MAGIC)) {
    reject(400, 'Файл не похож на сохранённую кампанию.');
  }

  const jsonLength = raw.readUInt32BE(MAGIC.length);
  const jsonStart = MAGIC.length + 4;

  if (jsonStart + jsonLength > raw.length) reject(400, 'Файл кампании обрезан или повреждён.');

  let json: PackageJson;

  try {
    json = JSON.parse(raw.subarray(jsonStart, jsonStart + jsonLength).toString('utf8'));
  } catch {
    return reject(400, 'Файл кампании повреждён.');
  }

  if (json?.format !== 'ttrpg-campaign' || json.formatVersion !== 1) {
    reject(400, 'Неизвестный формат файла кампании — обновите приложение.');
  }

  return { json, body: raw.subarray(jsonStart + jsonLength) };
}

async function schemaVersion(db: Queryable): Promise<number> {
  return Number((await db.query('SELECT max(version) AS version FROM schema_migrations')).rows[0]?.version);
}

export const transferRoutes: FastifyPluginAsync<Options> = async (app, options) => {
  const { db, auth, membership, identity, requireCampaignCreator } = options;

  app.get<{ Params: { campaignId: string } }>(
    '/campaigns/:campaignId/export',
    {
      schema: {
        params: {
          type: 'object',
          required: ['campaignId'],
          additionalProperties: false,
          properties: { campaignId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const member = await membership(db, campaignId, userId);

      if (member.owner_user_id !== userId) {
        reject(403, 'Сохранить кампанию в файл может только её главный мастер.');
      }

      const campaign = (await db.query('SELECT * FROM campaigns WHERE id=$1', [campaignId])).rows[0]!;
      const tables: Record<string, Row[]> = {};

      for (const table of TABLES) {
        tables[table] = (await db.query(`SELECT * FROM ${table} WHERE campaign_id=$1`, [campaignId])).rows;
      }

      const members = (await db.query(
        `SELECT m.user_id AS "userId", a.username, u.display_name AS "displayName"
         FROM campaign_members m
         JOIN users u ON u.id=m.user_id
         JOIN accounts a ON a.user_id=m.user_id
         WHERE m.campaign_id=$1`,
        [campaignId],
      )).rows as PackageJson['members'];

      const blobs: Buffer[] = [];
      const files: PackageJson['files'] = [];
      let offset = 0;

      for (const asset of tables.assets ?? []) {
        const storageKey = String(asset.storage_key);

        try {
          const data = await readFile(path.join(ASSETS_DIR, path.basename(storageKey)));
          files.push({ storageKey, offset, length: data.length });
          blobs.push(data);
          offset += data.length;
        } catch {
        }

        if (offset > MAX_PACKAGE_BYTES) {
          reject(413, 'Файлы кампании (карты и модели) занимают больше 1 ГБ — такой перенос не поддерживается.');
        }
      }

      const json: PackageJson = {
        format: 'ttrpg-campaign',
        formatVersion: 1,
        schemaVersion: await schemaVersion(db),
        exportedAt: new Date().toISOString(),
        source: await identity(),
        campaign,
        members,
        tables,
        files,
      };

      const packed = packContainer(json, blobs);
      const fileName = encodeURIComponent(`${String(campaign.name).slice(0, 80)}.ochag-campaign`);

      reply
        .type('application/gzip')
        .header('Content-Disposition', `attachment; filename*=UTF-8''${fileName}`);

      return reply.send(packed);
    },
  );

  app.post(
    '/campaigns/import',
    { bodyLimit: MAX_PACKAGE_BYTES + 65536 },
    async (request, reply) => {
      const userId = await auth(request);
      await requireCampaignCreator(request, userId);

      let compressed: Buffer;

      try {
        const file = await request.file({ limits: { fileSize: MAX_PACKAGE_BYTES } });
        if (!file) return reject(400, 'Файл кампании не передан.');
        compressed = await file.toBuffer();
      } catch (error) {
        if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') reject(413, 'Файл кампании больше 1 ГБ.');
        throw error;
      }

      const { json, body } = unpackContainer(compressed);
      const currentSchema = await schemaVersion(db);

      if (json.schemaVersion !== currentSchema) {
        reject(
          400,
          `Файл сохранён другой версией приложения (схема базы ${json.schemaVersion}, здесь ${currentSchema}). ` +
          'Установите одну и ту же версию приложения на оба компьютера.',
        );
      }

      const oldCampaignId = String(json.campaign?.id ?? '');
      if (!UUID.test(oldCampaignId)) reject(400, 'В файле нет кампании.');

      // Columns come from the database itself: their names go into SQL, so only existing ones are accepted from the file. data_type marks real jsonb columns — pg does not serialize a bare boolean/number/string to JSON.
      const columnRows = (await db.query(
        `SELECT table_name, column_name, data_type FROM information_schema.columns
         WHERE table_schema='public' AND table_name = ANY($1::text[])`,
        [[...TABLES, 'campaigns']],
      )).rows;
      const columns = new Map<string, Set<string>>();
      const jsonColumns = new Map<string, Set<string>>();
      const arrayColumns = new Map<string, Set<string>>();
      for (const row of columnRows) {
        if (!columns.has(row.table_name)) columns.set(row.table_name, new Set());
        columns.get(row.table_name)!.add(row.column_name);

        if (row.data_type === 'jsonb' || row.data_type === 'json') {
          if (!jsonColumns.has(row.table_name)) jsonColumns.set(row.table_name, new Set());
          jsonColumns.get(row.table_name)!.add(row.column_name);
        }
        if (row.data_type === 'ARRAY') {
          if (!arrayColumns.has(row.table_name)) arrayColumns.set(row.table_name, new Set());
          arrayColumns.get(row.table_name)!.add(row.column_name);
        }
      }

      const oldOwnerId = String(json.campaign.owner_user_id);
      const members = Array.isArray(json.members) ? json.members : [];
      const usernames = members.map(m => String(m.username ?? '').toLowerCase()).filter(Boolean);
      const localAccounts = new Map(
        (usernames.length
          ? (await db.query('SELECT user_id, username FROM accounts WHERE username = ANY($1::text[])', [usernames])).rows
          : []
        ).map(row => [row.username as string, row.user_id as string]),
      );

      const userMap = new Map<string, string>([[oldOwnerId, userId]]);
      const matched: string[] = [];
      const missing: { username: string; displayName: string; characters: string[] }[] = [];

      for (const member of members) {
        if (member.userId === oldOwnerId) continue;
        const local = localAccounts.get(String(member.username).toLowerCase());

        if (local) {
          userMap.set(member.userId, local);
          if (local !== userId) matched.push(member.username);
        } else {
          missing.push({ username: member.username, displayName: member.displayName, characters: [] });
        }
      }

      const tables = json.tables && typeof json.tables === 'object' ? json.tables : {};
      const idMap = new Map<string, string>();
      const newCampaignId = randomUUID();
      idMap.set(oldCampaignId.toLowerCase(), newCampaignId);

      for (const table of TABLES) {
        for (const row of Array.isArray(tables[table]) ? tables[table] : []) {
          if (typeof row?.id === 'string' && UUID.test(row.id)) idMap.set(row.id.toLowerCase(), randomUUID());
        }
      }

      const remap = (value: unknown): unknown => {
        if (typeof value === 'string') return UUID.test(value) ? idMap.get(value.toLowerCase()) ?? value : value;
        if (Array.isArray(value)) return value.map(remap);
        if (value && typeof value === 'object') {
          return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, remap(inner)]));
        }
        return value;
      };

      const fileByKey = new Map<string, Buffer>();
      for (const entry of Array.isArray(json.files) ? json.files : []) {
        const start = Number(entry.offset), length = Number(entry.length);
        if (!Number.isInteger(start) || !Number.isInteger(length) || start < 0 || length < 0 || start + length > body.length) {
          reject(400, 'Файл кампании повреждён (файлы ассетов).');
        }
        fileByKey.set(String(entry.storageKey), body.subarray(start, start + length));
      }

      const written: string[] = [];
      const warnings: string[] = [];
      const counts: Record<string, number> = {};

      const baseName = String(json.campaign.name ?? 'Кампания').trim().slice(0, 180) || 'Кампания';
      const sameName = (await db.query(
        `SELECT 1 FROM campaigns c JOIN campaign_members m ON m.campaign_id=c.id
         WHERE m.user_id=$1 AND c.name=$2`,
        [userId, baseName],
      )).rows[0];
      const name = sameName ? `${baseName} (перенесена)` : baseName;

      try {
        await db.transaction(async q => {
          await q.query(
            `INSERT INTO campaigns(id, name, owner_user_id, rules_base, rules_revision, house_rules, fog_enabled)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [
              newCampaignId, name, userId,
              json.campaign.rules_base ?? 'dnd5e-2014',
              json.campaign.rules_revision ?? 1,
              JSON.stringify(json.campaign.house_rules ?? {}),
              json.campaign.fog_enabled ?? true,
            ],
          );
          await q.query('INSERT INTO campaign_members(campaign_id, user_id) VALUES ($1,$2)', [newCampaignId, userId]);

          const orphanCharacters = new Map<string, string>();

          for (const table of TABLES) {
            let rows = (Array.isArray(tables[table]) ? tables[table] : [])
              .filter(row => row && typeof row === 'object' && String(row.campaign_id).toLowerCase() === oldCampaignId.toLowerCase());

            if (table === 'scene_objects') {
              const byId = new Map(rows.map(row => [String(row.id), row]));
              const depth = (row: Row, guard = 0): number =>
                row.parent_object_id && byId.has(String(row.parent_object_id)) && guard < 100
                  ? 1 + depth(byId.get(String(row.parent_object_id))!, guard + 1)
                  : 0;
              rows = [...rows].sort((a, b) => depth(a) - depth(b));
            }

            const allowed = columns.get(table) ?? new Set<string>();
            let inserted = 0;

            for (const original of rows) {
              const row: Row = {};
              let skip = false;

              for (const [column, value] of Object.entries(original)) {
                if (!allowed.has(column)) continue;

                if (USER_COLUMNS.has(column) && value !== null && value !== undefined) {
                  const mapped = userMap.get(String(value));

                  if (mapped) row[column] = mapped;
                  else if (column === 'user_id') skip = true;
                  else if (column === 'reviewed_by' || (column === 'owner_user_id' && table === 'characters')) row[column] = null;
                  else row[column] = userId;
                  continue;
                }

                if ((column === 'field_key' || (table === 'campaign_art' && column === 'value')) && typeof value === 'string') {
                  row[column] = value.replace(UUID_ANYWHERE, match => idMap.get(match.toLowerCase()) ?? match);
                  continue;
                }

                row[column] = remap(value);
              }

              if (skip) continue;

              if (table === 'faction_relations' && String(row.faction_a) > String(row.faction_b)) {
                [row.faction_a, row.faction_b] = [row.faction_b, row.faction_a];
              }

              if ((table === 'campaign_members' || table === 'member_permissions') && row.user_id === userId) continue;

              if (table === 'characters' && original.owner_user_id && row.owner_user_id === null) {
                orphanCharacters.set(String(original.owner_user_id), [orphanCharacters.get(String(original.owner_user_id)), String(row.name)].filter(Boolean).join(', '));
              }

              if (table === 'assets') {
                const oldKey = String(original.storage_key ?? '');
                const extension = path.extname(oldKey).toLowerCase();
                if (!ALLOWED_ASSET_EXTENSIONS.has(extension)) reject(400, 'В файле кампании недопустимый тип ассета.');
                // The new file name is built from the row id: anything but a remapped UUID could point outside the assets folder.
                if (typeof row.id !== 'string' || !UUID.test(row.id)) reject(400, 'Файл кампании повреждён: у файла ассета нет правильного идентификатора.');

                const data = fileByKey.get(oldKey);
                const signature = data ? (row.kind === 'object_model' ? detectGlb(data) : row.kind === 'audio' ? detectAudio(data) : detectImage(data)) : null;

                if (data && !signature) reject(400, 'Файл ассета в кампании повреждён или подменён.');

                const storageKey = `${row.id}${signature?.extension ?? extension}`;
                row.storage_key = storageKey;

                if (data && signature) {
                  row.content_type = signature.contentType;
                  row.byte_size = data.length;
                  const target = path.join(ASSETS_DIR, storageKey);
                  await writeFile(target, data);
                  written.push(target);
                } else {
                  warnings.push(`Файл «${String(original.original_filename ?? oldKey)}» отсутствовал и на исходном сервере.`);
                }
              }

              const rowJsonColumns = jsonColumns.get(table);
              const rowArrayColumns = arrayColumns.get(table);
              const keys = Object.keys(row);
              const values = keys.map(key => {
                const value = row[key];
                if (value === null) return null;
                if (rowArrayColumns?.has(key)) return Array.isArray(value) ? value : null;
                return rowJsonColumns?.has(key) || typeof value === 'object' ? JSON.stringify(value) : value;
              });

              await q.query(
                `INSERT INTO ${table} (${keys.map(key => `"${key}"`).join(', ')})
                 VALUES (${keys.map((_, index) => `$${index + 1}`).join(', ')})
                 ON CONFLICT DO NOTHING`,
                values,
              );
              inserted++;
            }

            counts[table] = inserted;
          }

          const appearanceId = (value: unknown): string | null => {
            if (typeof value !== 'string' || !UUID.test(value)) return null;
            return idMap.get(value.toLowerCase()) ?? null;
          };
          await q.query(
            `UPDATE campaigns SET avatar_asset_id=$2,banner_asset_id=$3,
               avatar_crop=CASE WHEN $2::uuid IS NULL THEN NULL ELSE $4::jsonb END,
               banner_crop=CASE WHEN $3::uuid IS NULL THEN NULL ELSE $5::jsonb END WHERE id=$1`,
            [
              newCampaignId, appearanceId(json.campaign.avatar_asset_id), appearanceId(json.campaign.banner_asset_id),
              json.campaign.avatar_crop ? JSON.stringify(json.campaign.avatar_crop) : null,
              json.campaign.banner_crop ? JSON.stringify(json.campaign.banner_crop) : null,
            ],
          );

          for (const entry of missing) {
            const member = members.find(m => m.username === entry.username);
            const names = member ? orphanCharacters.get(member.userId) : undefined;
            if (names) entry.characters = names.split(', ');
          }
        });
      } catch (error) {
        await Promise.all(written.map(file => unlink(file).catch(() => {})));
        throw error;
      }

      return reply.code(201).send({
        campaignId: newCampaignId,
        name,
        source: json.source,
        exportedAt: json.exportedAt,
        counts: {
          characters: counts.characters ?? 0,
          scenes: counts.scenes ?? 0,
          objects: counts.scene_objects ?? 0,
          notes: counts.campaign_notes ?? 0,
          assets: counts.assets ?? 0,
          spells: counts.campaign_spells ?? 0,
          rules: counts.campaign_rules ?? 0,
        },
        matchedPlayers: matched,
        missingPlayers: missing,
        warnings,
      });
    },
  );
};
