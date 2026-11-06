import type { Queryable } from '../../db.ts';
import { playMood } from '../../campaign/audio-routes.ts';
import { THIEFS_REFLEXES_OFFSET } from '../../../../../packages/domain/character/class-features.ts';
import { beginTurn } from '../../rules/action-economy.ts';
import { nextGroup, groupFrom } from '../../../../../packages/domain/combat/turn-groups.ts';
import { relationsFor } from '../../campaign/factions.ts';
import type { Notice as ConditionNotice } from '../../rules/conditions.ts';

import { attacksPerActionOf } from './attack.ts';
import { hasClassFeature } from './auras.ts';
import { announceConditionNotices, initiativeRefill, withNotes } from './hp.ts';
import { clearOpportunities } from './opportunity.ts';
import type { TableContext } from '../context.ts';
import { notify, notifyCampaign } from '../live/notify.ts';
import { campaignFlag, insertRoll } from '../rolls/dice.ts';
import { initiativeRoll } from '../rolls/modifiers.ts';
import { getScene } from '../scene/board.ts';
import { classSpeedBonus } from '../scene/movement.ts';
import { loadPlacements } from '../scene/placements.ts';
import { canManage, initiativeParams, type InitiativeParams, objectSchema, reject, sceneParams, type SceneParams, uuid } from '../shared.ts';
import { restMeetsCombat } from './combat-rest.ts';

// One order for every query: rows started in one transaction share created_at, so dexterity and id break ties.
export const INITIATIVE_ORDER = 'ie.score DESC, ie.created_at ASC, c.dexterity DESC NULLS LAST, ie.id ASC';

export async function initiativeQueue(q: Queryable, campaignId: string, sceneId: string, lock = false) {
  const entries = (
    await q.query(
      `SELECT ie.id, ie.is_current, ie.character_id, ie.reflex_of, c.owner_user_id, c.kind, c.disposition
         FROM initiative_entries ie
         LEFT JOIN characters c ON c.campaign_id = ie.campaign_id AND c.id = COALESCE(ie.character_id, ie.reflex_of)
         WHERE ie.campaign_id=$1 AND ie.scene_id=$2
         ORDER BY ${INITIATIVE_ORDER}
         ${lock ? 'FOR UPDATE OF ie' : ''}`,
      [campaignId, sceneId],
    )
  ).rows as Array<{ id: string; is_current: boolean; character_id: string | null; reflex_of: string | null; owner_user_id: string | null; kind: string | null; disposition: string | null }>;
  const grouped = (await campaignFlag(q, campaignId, 'group_turns')) !== false;
  const relations = await relationsFor(q, campaignId, entries.map(entry => entry.character_id));
  const allied = (i: number, j: number) => {
    const a = entries[i]?.character_id;
    const b = entries[j]?.character_id;
    return Boolean(a && b) && relations.factionsOf(a).length > 0 && relations.allies(a, b);
  };
  return { entries, sides: entries.map(() => null), grouped, allied };
}

export async function markCombatStart(ctx: TableContext, q: Queryable, campaignId: string, sceneId: string, userId?: string) {
  const started = await q.query(
    `UPDATE scenes SET combat_started_at = now(),
         combat_xp_start = (
           SELECT COALESCE(jsonb_object_agg(c.id, c.experience), '{}'::jsonb)
           FROM characters c
           WHERE c.campaign_id=$1 AND c.kind='character'
             AND EXISTS (SELECT 1 FROM scene_objects p WHERE p.campaign_id=c.campaign_id AND p.scene_id=$2 AND p.character_id=c.id)
         )
       WHERE campaign_id=$1 AND id=$2 AND combat_started_at IS NULL
       RETURNING id`,
    [campaignId, sceneId],
  );
  if (started.rows.length && userId && await playMood(q, campaignId, sceneId, 'combat', userId, true)) {
    void notifyCampaign(ctx, campaignId, { type: 'audio' });
  }
  if (started.rows.length) await restMeetsCombat(ctx, q, campaignId, sceneId);
}

export async function syncReflexTurn(q: Queryable, campaignId: string, sceneId: string, characterId: string) {
  const main = (
    await q.query('SELECT id, name, score::float8 AS score, created_by FROM initiative_entries WHERE campaign_id=$1 AND scene_id=$2 AND character_id=$3', [campaignId, sceneId, characterId])
  ).rows[0] as { id: string; name: string; score: number; created_by: string } | undefined;
  const existing = (await q.query('SELECT id FROM initiative_entries WHERE campaign_id=$1 AND scene_id=$2 AND reflex_of=$3', [campaignId, sceneId, characterId])).rows[0];
  const round = Number((await q.query('SELECT combat_round FROM scenes WHERE campaign_id=$1 AND id=$2', [campaignId, sceneId])).rows[0]?.combat_round ?? 1);
  const thief = main ? await hasClassFeature(q, campaignId, characterId, 'thiefs-reflexes') : false;
  if (!main || !thief || round >= 2) {
    if (existing) await q.query('DELETE FROM initiative_entries WHERE id=$1', [existing.id]);
    return;
  }
  const score = Number(main.score) - THIEFS_REFLEXES_OFFSET;
  if (existing) {
    await q.query('UPDATE initiative_entries SET score=$2 WHERE id=$1', [existing.id, score]);
    return;
  }
  await q.query(
    `INSERT INTO initiative_entries (campaign_id, scene_id, character_id, name, score, created_by, reflex_of) VALUES ($1,$2,NULL,$3,$4,$5,$6)`,
    [campaignId, sceneId, `${main.name}: рефлексы вора`.slice(0, 100), score, main.created_by, characterId],
  );
}

export function registerInitiativeRoutes(ctx: TableContext) {
  const { app, auth, conditionEngine, db, membership } = ctx;

  app.get<{ Params: SceneParams }>(
    '/campaigns/:campaignId/scenes/:sceneId/initiative',
    { schema: { params: sceneParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId, sceneId } = request.params;

      await membership(db, campaignId, userId);
      const scene = await getScene(db, campaignId, sceneId, false);

      const { rows } = await db.query(
        `SELECT ie.id, ie.character_id, ie.name, ie.score::float8 AS score, ie.is_current, ie.created_at,
                ie.moved_feet::float8 AS moved_feet, ie.dashes,
                ie.action_used, ie.bonus_used, ie.reaction_used, ie.attacks_made, ie.disengaged,
                ie.legendary_used, ie.sneak_attack_used, ie.action_surged, COALESCE(c.legendary_actions, 0) AS legendary_actions,
                ('death-save' = ANY(ie.turn_flags)) AS death_saved,
                ('haste' = ANY(ie.turn_flags)) AS haste_used,
                EXISTS (SELECT 1 FROM character_effects e WHERE e.campaign_id = ie.campaign_id AND e.character_id = ie.character_id AND e.active AND e.effect_code = 'slow_spell') AS slowed,
                c.speed_feet::float8 AS speed_feet,
                c.attacks_per_action, c.class_name, c.level, c.sheet_extra->'info' AS info
         FROM initiative_entries ie
         LEFT JOIN characters c ON c.campaign_id = ie.campaign_id AND c.id = ie.character_id
         WHERE ie.campaign_id=$1 AND ie.scene_id=$2
         ORDER BY ${INITIATIVE_ORDER}`,
        [campaignId, sceneId],
      );

      const entries = [];
      for (const { attacks_per_action, class_name, level, info, slowed, ...entry } of rows) {
        const bonus = entry.character_id && entry.speed_feet !== null ? (await classSpeedBonus(db, campaignId, entry.character_id)).feet : 0;
        entries.push({
          ...entry,
          ...(bonus ? { speed_feet: Number(entry.speed_feet) + bonus } : {}),
          attacks_per_action: entry.character_id && !slowed ? attacksPerActionOf({ attacks_per_action, class_name, level, sheet_extra: { info } }) : 1,
        });
      }
      return { entries, combatRound: scene.combat_round };
    },
  );

  app.post<{
    Params: SceneParams;
    Body: { characterId: string };
  }>(
    '/campaigns/:campaignId/scenes/:sceneId/initiative/join',
    {
      schema: {
        params: sceneParams,
        body: objectSchema({ characterId: uuid }),
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, sceneId } = request.params;
      const { characterId } = request.body;

      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await getScene(q, campaignId, sceneId);

        const character = (
          await q.query(
            `SELECT id, name, dexterity, owner_user_id, level, class_name, sheet_extra, challenge_rating::float8 AS challenge_rating FROM characters
             WHERE campaign_id=$1 AND id=$2`,
            [campaignId, characterId],
          )
        ).rows[0];

        if (!character) reject(404, 'Персонаж не найден.');

        if (
          character.owner_user_id !== userId &&
          !(await canManage(q, member, userId))
        ) {
          reject(403, 'В инициативу можно добавить только своего персонажа.');
        }

        const existing = (
          await q.query(
            `SELECT id, score::float8 AS score FROM initiative_entries
             WHERE campaign_id=$1 AND scene_id=$2 AND character_id=$3`,
            [campaignId, sceneId, characterId],
          )
        ).rows[0];

        if (existing) return { ...existing, alreadyJoined: true };

        const { formula, results, modifier, total, outcome: rolled } = initiativeRoll(character);
        const outcome = withNotes(rolled, await initiativeRefill(q, campaignId, character));

        const inserted = await q.query(
          `INSERT INTO initiative_entries (campaign_id, scene_id, character_id, name, score, created_by)
           VALUES ($1,$2,$3,$4,$5,$6)
           RETURNING id, score::float8 AS score`,
          [campaignId, sceneId, characterId, character.name, total, userId],
        );
        await markCombatStart(ctx, q, campaignId, sceneId, userId);
        await syncReflexTurn(q, campaignId, sceneId, characterId);

        await insertRoll(
          q, campaignId, userId, characterId, `Инициатива: ${character.name}`,
          formula, results, modifier, total, false, null, outcome,
        );

        return { ...inserted.rows[0], alreadyJoined: false };
      });

      void notifyCampaign(ctx, campaignId, { type: 'initiative', sceneId });
      void notifyCampaign(ctx, campaignId, { type: 'rolls' });

      return reply.code(201).send(result);
    },
  );

  app.post<{ Params: SceneParams; Body: { includeHidden?: boolean } }>(
    '/campaigns/:campaignId/scenes/:sceneId/initiative/start',
    { schema: { params: sceneParams, body: { type: 'object', additionalProperties: false, properties: { includeHidden: { type: 'boolean' } } } } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, sceneId } = request.params;
      const includeHidden = request.body?.includeHidden !== false;
      const notices: ConditionNotice[] = [];

      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        if (!(await canManage(q, member, userId))) reject(403, 'Начинает бой мастер.');
        await getScene(q, campaignId, sceneId, true);

        const placements = (await loadPlacements(q, campaignId, sceneId))
          .filter(placement => placement.kind !== 'object' && (includeHidden || !placement.hidden));
        const ids = [...new Set(placements.map(placement => placement.character_id))];
        if (!ids.length) reject(400, 'На сцене нет существ — бой не с кем начинать.');

        const already = new Set(
          (await q.query(
            'SELECT character_id FROM initiative_entries WHERE campaign_id=$1 AND scene_id=$2 AND character_id IS NOT NULL',
            [campaignId, sceneId],
          )).rows.map(row => row.character_id as string),
        );
        const dead = new Set(
          (await q.query(
            `SELECT character_id FROM character_effects WHERE campaign_id=$1 AND character_id = ANY($2::uuid[]) AND active AND effect_code='dead'`,
            [campaignId, ids],
          )).rows.map(row => row.character_id as string),
        );
        const creatures = (
          await q.query(
            'SELECT id, name, dexterity, level, class_name, sheet_extra, challenge_rating::float8 AS challenge_rating FROM characters WHERE campaign_id=$1 AND id = ANY($2::uuid[]) ORDER BY name',
            [campaignId, ids],
          )
        ).rows as Array<{ id: string; name: string; dexterity: number }>;

        const joined: Array<{ characterId: string; name: string; score: number }> = [];
        for (const creature of creatures) {
          if (already.has(creature.id) || dead.has(creature.id)) continue;
          const hidden = placements.filter(placement => placement.character_id === creature.id).every(placement => placement.hidden);
          const { formula, results, modifier, total, outcome: rolled } = initiativeRoll(creature);
          const outcome = withNotes(rolled, await initiativeRefill(q, campaignId, creature));
          await q.query(
            `INSERT INTO initiative_entries (campaign_id, scene_id, character_id, name, score, created_by)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [campaignId, sceneId, creature.id, creature.name, total, userId],
          );
          await insertRoll(
            q, campaignId, userId, creature.id, `Инициатива: ${creature.name}`,
            formula, results, modifier, total, hidden, null, outcome,
          );
          joined.push({ characterId: creature.id, name: creature.name, score: total });
          await markCombatStart(ctx, q, campaignId, sceneId, userId);
          await syncReflexTurn(q, campaignId, sceneId, creature.id);
        }

        let started = false;
        const current = (
          await q.query('SELECT 1 FROM initiative_entries WHERE campaign_id=$1 AND scene_id=$2 AND is_current', [campaignId, sceneId])
        ).rows[0];
        if (!current) {
          const queue = await initiativeQueue(q, campaignId, sceneId, true);
          const first = nextGroup(queue.sides, [], queue.grouped, queue.allied).indices.map(index => queue.entries[index]!);
          for (const entry of first) await beginTurn(q, campaignId, entry.id);
          if (first.length) {
            await q.query('UPDATE scenes SET combat_round=1 WHERE id=$1', [sceneId]);
            started = true;
          }
          for (const entry of first) {
            if (entry.character_id) notices.push(...await conditionEngine.startOfTurn(q, campaignId, userId, entry.character_id, entry.id));
          }
        }

        return { joined, started };
      });

      void notifyCampaign(ctx, campaignId, { type: 'initiative', sceneId });
      void notifyCampaign(ctx, campaignId, { type: 'rolls' });
      announceConditionNotices(ctx, campaignId, notices);
      return reply.code(201).send(result);
    },
  );

  app.post<{
    Params: SceneParams;
    Body: { name: string; score: number };
  }>(
    '/campaigns/:campaignId/scenes/:sceneId/initiative/npc',
    {
      schema: {
        params: sceneParams,
        body: objectSchema({
          name: { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' },
          score: { type: 'number' },
        }),
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, sceneId } = request.params;
      const { name, score } = request.body;

      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);

        if (!(await canManage(q, member, userId))) {
          reject(403, 'Добавлять НПС в инициативу может только мастер.');
        }

        await getScene(q, campaignId, sceneId);

        const inserted = await q.query(
          `INSERT INTO initiative_entries (campaign_id, scene_id, name, score, created_by)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING id, score::float8 AS score`,
          [campaignId, sceneId, name.trim(), score, userId],
        );
        await markCombatStart(ctx, q, campaignId, sceneId, userId);

        return inserted.rows[0];
      });

      void notifyCampaign(ctx, campaignId, { type: 'initiative', sceneId });

      return reply.code(201).send(result);
    },
  );

  app.patch<{
    Params: InitiativeParams;
    Body: { name?: string; score?: number };
  }>(
    '/campaigns/:campaignId/scenes/:sceneId/initiative/:entryId',
    {
      schema: {
        params: initiativeParams,
        body: {
          type: 'object',
          minProperties: 1,
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' },
            score: { type: 'number' },
          },
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, sceneId, entryId } = request.params;
      const { name, score } = request.body;

      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);

        if (!(await canManage(q, member, userId))) {
          reject(403, 'Изменять инициативу может только мастер.');
        }

        await getScene(q, campaignId, sceneId);

        const updated = await q.query(
          `UPDATE initiative_entries SET
             name = COALESCE($1, name),
             score = COALESCE($2, score)
           WHERE campaign_id=$3 AND scene_id=$4 AND id=$5
           RETURNING id, character_id, name, score::float8 AS score, is_current`,
          [name?.trim() ?? null, score ?? null, campaignId, sceneId, entryId],
        );

        if (!updated.rows[0]) reject(404, 'Запись не найдена.');
        if (updated.rows[0].character_id) await syncReflexTurn(q, campaignId, sceneId, updated.rows[0].character_id);

        return updated.rows[0];
      });

      void notifyCampaign(ctx, campaignId, { type: 'initiative', sceneId });

      return result;
    },
  );

  app.delete<{ Params: InitiativeParams }>(
    '/campaigns/:campaignId/scenes/:sceneId/initiative/:entryId',
    { schema: { params: initiativeParams } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, sceneId, entryId } = request.params;

      const turnNotices: ConditionNotice[] = [];
      await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await getScene(q, campaignId, sceneId);
        const before = await initiativeQueue(q, campaignId, sceneId, true);
        const position = before.entries.findIndex(row => row.id === entryId);

        const entry = (
          await q.query(
            `SELECT ie.id, ie.is_current, ie.character_id, c.owner_user_id AS character_owner_user_id
             FROM initiative_entries ie
             LEFT JOIN characters c
               ON c.campaign_id=ie.campaign_id AND c.id=ie.character_id
             WHERE ie.campaign_id=$1 AND ie.scene_id=$2 AND ie.id=$3
             FOR UPDATE OF ie`,
            [campaignId, sceneId, entryId],
          )
        ).rows[0];

        if (!entry) reject(404, 'Запись не найдена.');

        if (
          entry.character_owner_user_id !== userId &&
          !(await canManage(q, member, userId))
        ) {
          reject(403, 'Недостаточно прав для удаления записи.');
        }

        await q.query('DELETE FROM initiative_entries WHERE id=$1', [entryId]);
        if (entry.character_id) await q.query('DELETE FROM initiative_entries WHERE campaign_id=$1 AND scene_id=$2 AND reflex_of=$3', [campaignId, sceneId, entry.character_id]);

        if (entry.is_current) {
          const after = await initiativeQueue(q, campaignId, sceneId, true);
          if (after.entries.length && !after.entries.some(row => row.is_current)) {
            const wrapped = position >= after.entries.length;
            const next = groupFrom(after.sides, wrapped ? 0 : position, after.grouped, after.allied);
            for (const index of next) await beginTurn(q, campaignId, after.entries[index]!.id);
            await clearOpportunities(q, campaignId, sceneId);
            if (wrapped) await q.query('UPDATE scenes SET combat_round=combat_round+1 WHERE id=$1', [sceneId]);
            for (const index of next) {
              const characterId = after.entries[index]!.character_id;
              if (characterId) turnNotices.push(...await conditionEngine.startOfTurn(q, campaignId, userId, characterId, after.entries[index]!.id));
            }
          }
        }
      });

      void notifyCampaign(ctx, campaignId, { type: 'initiative', sceneId });
      if (turnNotices.length) {
        void notifyCampaign(ctx, campaignId, { type: 'rolls' });
        void notify(ctx, campaignId, sceneId);
        announceConditionNotices(ctx, campaignId, turnNotices);
      }

      return reply.code(204).send();
    },
  );
}
