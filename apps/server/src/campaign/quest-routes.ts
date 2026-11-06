import type { Queryable } from '../db.ts';
import { objectSchema, reject, uuid, type SceneFeatureContext } from '../tabletop/scene-feature.ts';
import { announceExperience, type Experience, type ExperienceAward } from '../characters/experience.ts';

type QuestContext = SceneFeatureContext & {
  experience: Experience;
  isCharacterManager: (q: Queryable, member: any, userId: string) => Promise<boolean>;
};

const STATUS_LABELS: Record<string, string> = { active: 'Новое задание', completed: 'Задание выполнено', failed: 'Задание провалено' };

export function registerQuestRoutes(ctx: QuestContext) {
  const { app, db, auth, membership, notifyCampaign, experience, isCharacterManager } = ctx;
  const campaignParams = objectSchema({ campaignId: uuid });
  const questParams = objectSchema({ campaignId: uuid, questId: uuid });
  const objectiveParams = objectSchema({ campaignId: uuid, questId: uuid, objectiveId: uuid });

  async function manager(q: Queryable, campaignId: string, userId: string, lock = false) {
    const member = await membership(q, campaignId, userId, lock);
    return isCharacterManager(q, member, userId);
  }

  async function assertManager(q: Queryable, campaignId: string, userId: string) {
    if (!(await manager(q, campaignId, userId, true))) reject(403, 'Журнал заданий ведёт мастер.');
  }

  async function loadQuests(q: Queryable, campaignId: string, includeHidden: boolean, questId?: string): Promise<any[]> {
    const quests = (
      await q.query(
        `SELECT id, title, description, status, xp_reward, hidden, rewarded_at, created_at, updated_at
         FROM campaign_quests
         WHERE campaign_id=$1 AND ($2 OR NOT hidden) AND ($3::uuid IS NULL OR id=$3)
         ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'completed' THEN 1 ELSE 2 END, created_at`,
        [campaignId, includeHidden, questId ?? null],
      )
    ).rows;
    if (!quests.length) return [];
    const objectives = (
      await q.query(
        `SELECT id, quest_id, text, done, position FROM campaign_quest_objectives
         WHERE campaign_id=$1 AND quest_id = ANY($2::uuid[]) ORDER BY position, created_at`,
        [campaignId, quests.map(quest => quest.id)],
      )
    ).rows;
    return quests.map(quest => ({
      ...quest,
      objectives: objectives.filter(objective => objective.quest_id === quest.id).map(({ quest_id: _quest, ...objective }) => objective),
    }));
  }

  async function questRow(q: Queryable, campaignId: string, questId: string) {
    const row = (await q.query('SELECT * FROM campaign_quests WHERE campaign_id=$1 AND id=$2 FOR UPDATE', [campaignId, questId])).rows[0];
    if (!row) reject(404, 'Задание не найдено.');
    return row;
  }

  function announce(campaignId: string, title: string, detail: string, visible: boolean, tone: 'info' | 'good' | null = 'info') {
    void notifyCampaign(campaignId, { type: 'quests' });
    if (visible) void notifyCampaign(campaignId, { type: 'notice', title, detail, ...(tone ? { tone } : {}) });
  }

  app.get<{ Params: { campaignId: string } }>(
    '/campaigns/:campaignId/quests',
    { schema: { params: campaignParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      return db.transaction(async q => {
        const canManage = await manager(q, campaignId, userId);
        return { quests: await loadQuests(q, campaignId, canManage), canManage };
      });
    },
  );

  const questFields = {
    title: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
    description: { type: 'string', maxLength: 5000 },
    xpReward: { type: 'integer', minimum: 0, maximum: 1000000 },
    hidden: { type: 'boolean' },
  };

  app.post<{ Params: { campaignId: string }; Body: { title: string; description?: string; xpReward?: number; hidden?: boolean; objectives?: string[] } }>(
    '/campaigns/:campaignId/quests',
    {
      schema: {
        params: campaignParams,
        body: objectSchema({
          ...questFields,
          objectives: { type: 'array', maxItems: 30, items: { type: 'string', minLength: 1, maxLength: 300, pattern: '\\S' } },
        }, ['title']),
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const { title, description, xpReward, hidden, objectives } = request.body;
      const quest = await db.transaction(async q => {
        await assertManager(q, campaignId, userId);
        const id = (
          await q.query(
            `INSERT INTO campaign_quests (campaign_id, title, description, xp_reward, hidden, created_by)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
            [campaignId, title.trim(), description ?? '', xpReward ?? 0, hidden ?? false, userId],
          )
        ).rows[0].id as string;
        for (const [position, text] of (objectives ?? []).entries()) {
          await q.query(
            'INSERT INTO campaign_quest_objectives (campaign_id, quest_id, text, position) VALUES ($1,$2,$3,$4)',
            [campaignId, id, text.trim(), position],
          );
        }
        return (await loadQuests(q, campaignId, true, id))[0];
      });
      announce(campaignId, STATUS_LABELS.active!, quest.title, !quest.hidden);
      return reply.code(201).send(quest);
    },
  );

  app.patch<{
    Params: { campaignId: string; questId: string };
    Body: { title?: string; description?: string; xpReward?: number; hidden?: boolean; status?: 'active' | 'completed' | 'failed'; sceneId?: string };
  }>(
    '/campaigns/:campaignId/quests/:questId',
    {
      schema: {
        params: questParams,
        body: {
          ...objectSchema({ ...questFields, status: { type: 'string', enum: ['active', 'completed', 'failed'] }, sceneId: uuid }, []),
          minProperties: 1,
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, questId } = request.params;
      const { title, description, xpReward, hidden, status, sceneId } = request.body;

      const outcome = await db.transaction(async q => {
        await assertManager(q, campaignId, userId);
        const before = await questRow(q, campaignId, questId);
        await q.query(
          `UPDATE campaign_quests SET
             title = COALESCE($3, title), description = COALESCE($4, description),
             xp_reward = COALESCE($5, xp_reward), hidden = COALESCE($6, hidden),
             status = COALESCE($7, status), updated_at = now()
           WHERE campaign_id=$1 AND id=$2`,
          [campaignId, questId, title?.trim() ?? null, description ?? null, xpReward ?? null, hidden ?? null, status ?? null],
        );
        const after = (await loadQuests(q, campaignId, true, questId))[0];

        let awards: ExperienceAward[] = [];
        if (status === 'completed' && before.status !== 'completed' && !before.rewarded_at && after.xp_reward > 0) {
          const party = (
            await q.query(
              `SELECT DISTINCT c.id FROM characters c
               WHERE c.campaign_id=$1 AND c.kind='character' AND c.owner_user_id IS NOT NULL
                 AND ($2::uuid IS NULL OR EXISTS (
                   SELECT 1 FROM scene_objects p WHERE p.campaign_id=c.campaign_id AND p.scene_id=$2 AND p.character_id=c.id))
                 AND NOT EXISTS (
                   SELECT 1 FROM character_effects e
                   WHERE e.campaign_id=c.campaign_id AND e.character_id=c.id AND e.active AND e.effect_code IN ('dead', 'exhaustion_6'))`,
              [campaignId, sceneId ?? null],
            )
          ).rows.map(row => row.id as string);
          for (const id of party) {
            const award = await experience.grant(q, campaignId, id, after.xp_reward);
            if (award) awards.push(award);
          }
          await q.query('UPDATE campaign_quests SET rewarded_at=now() WHERE campaign_id=$1 AND id=$2', [campaignId, questId]);
          after.rewarded_at = new Date().toISOString();
        }
        return { before, after, awards };
      });

      const { before, after, awards } = outcome;
      const visible = !after.hidden;
      if (status && status !== before.status) {
        announce(campaignId, STATUS_LABELS[status]!, after.title, visible, status === 'completed' ? 'good' : status === 'failed' ? null : 'info');
      }
      else if (before.hidden && !after.hidden) announce(campaignId, STATUS_LABELS.active!, after.title, true);
      else announce(campaignId, '', '', false);
      if (awards.length) announceExperience(notifyCampaign, campaignId, { reason: `Задание «${after.title}»`, awards });
      return { ...after, awards };
    },
  );

  app.delete<{ Params: { campaignId: string; questId: string } }>(
    '/campaigns/:campaignId/quests/:questId',
    { schema: { params: questParams } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, questId } = request.params;
      await db.transaction(async q => {
        await assertManager(q, campaignId, userId);
        const deleted = await q.query('DELETE FROM campaign_quests WHERE campaign_id=$1 AND id=$2 RETURNING id', [campaignId, questId]);
        if (!deleted.rows[0]) reject(404, 'Задание не найдено.');
      });
      announce(campaignId, '', '', false);
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { campaignId: string; questId: string }; Body: { text: string } }>(
    '/campaigns/:campaignId/quests/:questId/objectives',
    { schema: { params: questParams, body: objectSchema({ text: { type: 'string', minLength: 1, maxLength: 300, pattern: '\\S' } }) } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, questId } = request.params;
      const quest = await db.transaction(async q => {
        await assertManager(q, campaignId, userId);
        await questRow(q, campaignId, questId);
        await q.query(
          `INSERT INTO campaign_quest_objectives (campaign_id, quest_id, text, position)
           VALUES ($1,$2,$3,(SELECT COALESCE(max(position) + 1, 0) FROM campaign_quest_objectives WHERE campaign_id=$1 AND quest_id=$2))`,
          [campaignId, questId, request.body.text.trim()],
        );
        return (await loadQuests(q, campaignId, true, questId))[0];
      });
      announce(campaignId, '', '', false);
      return reply.code(201).send(quest);
    },
  );

  app.patch<{ Params: { campaignId: string; questId: string; objectiveId: string }; Body: { text?: string; done?: boolean } }>(
    '/campaigns/:campaignId/quests/:questId/objectives/:objectiveId',
    {
      schema: {
        params: objectiveParams,
        body: { ...objectSchema({ text: { type: 'string', minLength: 1, maxLength: 300, pattern: '\\S' }, done: { type: 'boolean' } }, []), minProperties: 1 },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, questId, objectiveId } = request.params;
      const { text, done } = request.body;
      const result = await db.transaction(async q => {
        await assertManager(q, campaignId, userId);
        const before = (
          await q.query('SELECT text, done FROM campaign_quest_objectives WHERE campaign_id=$1 AND quest_id=$2 AND id=$3 FOR UPDATE', [campaignId, questId, objectiveId])
        ).rows[0];
        if (!before) reject(404, 'Цель не найдена.');
        await q.query(
          'UPDATE campaign_quest_objectives SET text=COALESCE($4, text), done=COALESCE($5, done) WHERE campaign_id=$1 AND quest_id=$2 AND id=$3',
          [campaignId, questId, objectiveId, text?.trim() ?? null, done ?? null],
        );
        await q.query('UPDATE campaign_quests SET updated_at=now() WHERE campaign_id=$1 AND id=$2', [campaignId, questId]);
        return { before, quest: (await loadQuests(q, campaignId, true, questId))[0] };
      });
      const objective = result.quest.objectives.find((entry: any) => entry.id === objectiveId);
      if (done === true && !result.before.done) announce(campaignId, `Цель выполнена — ${result.quest.title}`, objective?.text ?? '', !result.quest.hidden, 'good');
      else announce(campaignId, '', '', false);
      return result.quest;
    },
  );

  app.delete<{ Params: { campaignId: string; questId: string; objectiveId: string } }>(
    '/campaigns/:campaignId/quests/:questId/objectives/:objectiveId',
    { schema: { params: objectiveParams } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, questId, objectiveId } = request.params;
      await db.transaction(async q => {
        await assertManager(q, campaignId, userId);
        const deleted = await q.query(
          'DELETE FROM campaign_quest_objectives WHERE campaign_id=$1 AND quest_id=$2 AND id=$3 RETURNING id',
          [campaignId, questId, objectiveId],
        );
        if (!deleted.rows[0]) reject(404, 'Цель не найдена.');
      });
      announce(campaignId, '', '', false);
      return reply.code(204).send();
    },
  );
}
