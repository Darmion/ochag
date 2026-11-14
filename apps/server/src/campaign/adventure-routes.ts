import { randomUUID } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import type { Database, Queryable } from '../db.ts';
import type { LoadedMods } from '../system/mods.ts';
import { ASSET_MAX_BYTES, ASSETS_DIR, assertUploadRoom, detectImage } from '../system/asset-routes.ts';
import { importSceneFile } from '../tabletop/scene/routes/file.ts';
import { createFromSnapshot } from '../tabletop/scene/object-copies.ts';
import { findMonster } from '../../../../packages/domain/world/bestiary.ts';
import { monsterSnapshot } from './bestiary-routes.ts';
import { adventureView, insideFolder, readAdventures, type Adventure } from './adventures.ts';

type Options = {
  db: Database;
  auth: (request: FastifyRequest) => Promise<string>;
  membership: (db: Queryable, campaignId: string, userId: string, lock?: boolean) => Promise<any>;
  requireCampaignCreator: (request: FastifyRequest, userId: string) => Promise<void>;
  mods?: LoadedMods;
};

function reject(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 200);

async function storeImage(
  q: Queryable, member: any, campaignId: string, userId: string, adventure: Adventure, relative: string,
  kind: 'object_image' | 'campaign_banner', written: string[], problems: string[],
): Promise<string | null> {
  const full = insideFolder(adventure.folder, relative);
  let data: Buffer;
  try {
    data = await readFile(full!);
  } catch {
    problems.push(`${relative}: файла нет`);
    return null;
  }
  const signature = detectImage(data);
  if (!signature || data.length > ASSET_MAX_BYTES[kind]) {
    problems.push(`${relative}: не картинка PNG, JPEG или WebP нужного размера`);
    return null;
  }
  await assertUploadRoom(q, member, campaignId, userId, data.length);
  const assetId = randomUUID();
  const storageKey = `${assetId}${signature.extension}`;
  await writeFile(path.join(ASSETS_DIR, storageKey), data);
  written.push(storageKey);
  await q.query(
    `INSERT INTO assets (id, campaign_id, kind, content_type, byte_size, storage_key, original_filename, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [assetId, campaignId, kind, signature.contentType, data.length, storageKey, path.basename(relative).slice(0, 200), userId],
  );
  return assetId;
}

export const adventureRoutes: FastifyPluginAsync<Options> = async (app, { db, auth, membership, requireCampaignCreator, mods }) => {
  async function canCreate(request: FastifyRequest, userId: string) {
    try {
      await requireCampaignCreator(request, userId);
      return true;
    } catch {
      return false;
    }
  }

  app.get('/adventures', async request => {
    const userId = await auth(request);
    return { canCreate: await canCreate(request, userId), adventures: (await readAdventures(mods)).map(adventureView) };
  });

  app.post<{ Params: { adventureId: string }; Body: { name?: string } }>(
    '/adventures/:adventureId/campaign',
    {
      schema: {
        params: { type: 'object', required: ['adventureId'], additionalProperties: false, properties: { adventureId: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{1,63}$' } } },
        body: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', maxLength: 200 } } },
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      await requireCampaignCreator(request, userId);
      const adventure = (await readAdventures(mods)).find(entry => entry.id === request.params.adventureId);
      if (!adventure) reject(404, 'Такого приключения нет в папке модов.');
      if (adventure.error) reject(400, `Приключение «${adventure.name}» не готово: ${adventure.error}.`);
      const name = (request.body?.name ?? '').trim() || adventure.title;

      const written: string[] = [];
      try {
        const result = await db.transaction(async q => {
          const campaign = (await q.query('INSERT INTO campaigns(name, owner_user_id) VALUES ($1,$2) RETURNING id, name', [name.slice(0, 200), userId])).rows[0] as { id: string; name: string };
          const campaignId = campaign.id;
          await q.query('INSERT INTO campaign_members(campaign_id, user_id) VALUES ($1,$2)', [campaignId, userId]);
          const member = await membership(q, campaignId, userId, true);
          const problems = [...adventure.problems];
          const counts = { scenes: 0, notes: 0, quests: 0, handouts: 0, rollTables: 0, npcs: 0 };

          if (adventure.cover) {
            const banner = await storeImage(q, member, campaignId, userId, adventure, adventure.cover, 'campaign_banner', written, problems);
            if (banner) await q.query('UPDATE campaigns SET banner_asset_id=$2 WHERE id=$1', [campaignId, banner]);
          }

          // A broken scene file is skipped with a note; the rest of the adventure still arrives.
          for (const relative of adventure.scenes) {
            const sceneWritten: string[] = [];
            await q.query('SAVEPOINT adventure_scene');
            try {
              const compressed = await readFile(insideFolder(adventure.folder, relative)!);
              const scene = await importSceneFile(q, campaignId, userId, member, compressed, sceneWritten);
              await q.query('RELEASE SAVEPOINT adventure_scene');
              written.push(...sceneWritten);
              counts.scenes += 1;
              if (scene.skipped) problems.push(`${relative}: пропущено строк — ${scene.skipped}`);
            } catch (error) {
              await q.query('ROLLBACK TO SAVEPOINT adventure_scene');
              await Promise.all(sceneWritten.map(key => unlink(path.join(ASSETS_DIR, key)).catch(() => {})));
              problems.push(`${relative}: ${errorText(error)}`);
            }
          }

          for (const note of adventure.notes) {
            await q.query('INSERT INTO campaign_notes (campaign_id, created_by, title, body) VALUES ($1,$2,$3,$4)', [campaignId, userId, note.title, note.body]);
            counts.notes += 1;
          }
          for (const quest of adventure.quests) {
            const questId = (await q.query(
              'INSERT INTO campaign_quests (campaign_id, title, description, xp_reward, hidden, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
              [campaignId, quest.title, quest.description, quest.xp, quest.hidden, userId],
            )).rows[0].id as string;
            for (const [position, text] of quest.objectives.entries()) {
              await q.query('INSERT INTO campaign_quest_objectives (campaign_id, quest_id, text, position) VALUES ($1,$2,$3,$4)', [campaignId, questId, text, position]);
            }
            counts.quests += 1;
          }
          for (const handout of adventure.handouts) {
            const assetId = handout.image ? await storeImage(q, member, campaignId, userId, adventure, handout.image, 'object_image', written, problems) : null;
            if (!handout.text && !assetId) continue;
            await q.query('INSERT INTO handouts (campaign_id, title, body, asset_id, created_by) VALUES ($1,$2,$3,$4,$5)', [campaignId, handout.title, handout.text, assetId, userId]);
            counts.handouts += 1;
          }
          for (const table of adventure.rollTables) {
            await q.query(
              'INSERT INTO roll_tables (campaign_id, name, formula, entries, secret, created_by) VALUES ($1,$2,$3,$4,$5,$6)',
              [campaignId, table.name, table.formula, JSON.stringify(table.entries), table.secret, userId],
            );
            counts.rollTables += 1;
          }
          for (const npc of adventure.npcs) {
            const monster = findMonster(npc.monster)!;
            const base = npc.name ?? monster.nameRu;
            for (let copy = 1; copy <= npc.count; copy += 1) {
              await createFromSnapshot(q, campaignId, monsterSnapshot(monster, monster.hp, npc.disposition), npc.count > 1 ? `${base} ${copy}` : base, userId);
              counts.npcs += 1;
            }
          }
          return { campaignId, name: campaign.name, counts, problems };
        });
        return reply.code(201).send(result);
      } catch (error) {
        await Promise.all(written.map(key => unlink(path.join(ASSETS_DIR, key)).catch(() => {})));
        throw error;
      }
    },
  );
};
