import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import type { Database, Queryable } from '../db.ts';
import type { LoadedMods } from '../system/mods.ts';
import { readSpellPacks } from './spell-packs.ts';
import { flatColumns } from './spell-template-routes.ts';

type Options = {
  db: Database;
  auth: (request: FastifyRequest) => Promise<string>;
  membership: (db: Queryable, campaignId: string, userId: string, lock?: boolean) => Promise<any>;
  requirePermission: (db: Queryable, membership: any, userId: string, permission: string) => Promise<void>;
  mods?: LoadedMods;
};

const uuid = { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' };
const campaignParams = { type: 'object', required: ['campaignId'], additionalProperties: false, properties: { campaignId: uuid } };
const packParams = {
  type: 'object', required: ['campaignId', 'packId'], additionalProperties: false,
  properties: { campaignId: uuid, packId: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{1,63}$' } },
};

function reject(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}

// A spell some hero knows, or an import maps a sheet's spell to, stays when its pack is taken out of the campaign.
const IN_USE = `EXISTS (SELECT 1 FROM character_spells c WHERE c.campaign_id = s.campaign_id AND c.custom_spell_id = s.id)
  OR EXISTS (SELECT 1 FROM campaign_spell_refs r WHERE r.campaign_id = s.campaign_id AND r.custom_spell_id = s.id)`;

export const spellPackRoutes: FastifyPluginAsync<Options> = async (app, { db, auth, membership, requirePermission, mods }) => {
  async function isManager(q: Queryable, member: any, userId: string) {
    try {
      await requirePermission(q, member, userId, 'characters.manage');
      return true;
    } catch {
      return false;
    }
  }

  app.get<{ Params: { campaignId: string } }>(
    '/campaigns/:campaignId/spell-packs',
    { schema: { params: campaignParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const member = await membership(db, campaignId, userId);
      const canManage = await isManager(db, member, userId);
      const added = new Map(((await db.query(
        'SELECT pack_id, count(*)::int AS n FROM campaign_spells WHERE campaign_id=$1 AND pack_id IS NOT NULL GROUP BY pack_id',
        [campaignId],
      )).rows as Array<{ pack_id: string; n: number }>).map(row => [row.pack_id, row.n]));
      const packs = await readSpellPacks(mods);
      return {
        canManage,
        packs: packs.map(pack => ({
          id: pack.id, name: pack.name, version: pack.version, description: pack.description, author: pack.author,
          translations: pack.translations, bundled: pack.bundled, error: pack.error,
          count: pack.spells.length, names: pack.spells.slice(0, 12).map(spell => spell.template.passport.name),
          skipped: pack.skipped.slice(0, 20), added: added.get(pack.id) ?? 0,
        })),
      };
    },
  );

  app.post<{ Params: { campaignId: string; packId: string } }>(
    '/campaigns/:campaignId/spell-packs/:packId',
    { schema: { params: packParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId, packId } = request.params;
      const pack = (await readSpellPacks(mods)).find(entry => entry.id === packId);
      if (!pack) reject(404, 'Такого набора нет в папке модов. Обновите список в окне «Моды».');
      if (pack.error) reject(400, `Набор «${pack.name}» не прочитан: ${pack.error}.`);
      if (!pack.spells.length) reject(400, `В наборе «${pack.name}» нет заклинаний, которые можно добавить.`);
      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        if (!(await isManager(q, member, userId))) reject(403, 'Добавить набор заклинаний в кампанию может мастер.');
        const present = new Set(((await q.query(
          'SELECT pack_spell FROM campaign_spells WHERE campaign_id=$1 AND pack_id=$2',
          [campaignId, packId],
        )).rows as Array<{ pack_spell: string }>).map(row => row.pack_spell));
        let added = 0;
        for (const { key, template } of pack.spells) {
          if (present.has(key)) continue;
          const flat = flatColumns(template);
          const row = (await q.query(
            `INSERT INTO campaign_spells
               (campaign_id, created_by, name, level, school, casting_time, range, components, material, duration, concentration, ritual,
                classes, description, higher_level, status, reviewed_by, reviewed_at, template, pack_id, pack_spell)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'approved',$2,now(),$16::jsonb,$17,$18)
             RETURNING id`,
            [
              campaignId, userId, flat.name, flat.level, flat.school, flat.casting_time, flat.range, flat.components, flat.material, flat.duration,
              flat.concentration, flat.ritual, flat.classes, flat.description, flat.higher_level, JSON.stringify(template), packId, key,
            ],
          )).rows[0] as { id: string };
          await q.query(
            `INSERT INTO campaign_spell_revisions (campaign_id, spell_id, version, template, status, submitted_by, reviewed_by, reviewed_at)
             VALUES ($1,$2,1,$3::jsonb,'applied',$4,$4,now())`,
            [campaignId, row.id, JSON.stringify(template), userId],
          );
          added++;
        }
        return { added, already: present.size };
      });
    },
  );

  app.delete<{ Params: { campaignId: string; packId: string } }>(
    '/campaigns/:campaignId/spell-packs/:packId',
    { schema: { params: packParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId, packId } = request.params;
      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        if (!(await isManager(q, member, userId))) reject(403, 'Убрать набор заклинаний из кампании может мастер.');
        const removed = (await q.query(
          `DELETE FROM campaign_spells s WHERE s.campaign_id=$1 AND s.pack_id=$2 AND NOT (${IN_USE}) RETURNING s.id`,
          [campaignId, packId],
        )).rows.length;
        const kept = ((await q.query(
          'SELECT count(*)::int AS n FROM campaign_spells WHERE campaign_id=$1 AND pack_id=$2',
          [campaignId, packId],
        )).rows[0] as { n: number }).n;
        return { removed, kept };
      });
    },
  );
};
