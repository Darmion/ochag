import type { Queryable } from '../db.ts';
import { objectSchema, reject, uuid, type SceneFeatureContext } from '../tabletop/scene-feature.ts';
import { findSrdSkill } from '../rules/srd-data.ts';
import { dialogueProblems, nextNode, type DialogueNode } from '../../../../packages/domain/world/dialogue.ts';

export type DialogueContext = SceneFeatureContext & {
  rollSkillCheck: (q: Queryable, campaignId: string, userId: string, characterId: string, skill: string, label: string, dc: number) =>
    Promise<{ total: number; success: boolean; roll: any }>;
  canActAs: (q: Queryable, member: any, userId: string, characterId: string) => Promise<boolean>;
};

const nodeSchema = {
  type: 'object', additionalProperties: false, required: ['id', 'text', 'options'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 40 },
    speaker: { oneOf: [{ type: 'string', maxLength: 80 }, { type: 'null' }] },
    text: { type: 'string', maxLength: 2000 },
    options: {
      type: 'array', maxItems: 8,
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'label', 'next'],
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 40 },
          label: { type: 'string', maxLength: 200 },
          next: { oneOf: [{ type: 'string', maxLength: 40 }, { type: 'null' }] },
          check: {
            oneOf: [
              {
                type: 'object', additionalProperties: false, required: ['skill', 'dc', 'success', 'failure'],
                properties: {
                  skill: { type: 'string', maxLength: 64 },
                  dc: { type: 'integer', minimum: 1, maximum: 40 },
                  success: { oneOf: [{ type: 'string', maxLength: 40 }, { type: 'null' }] },
                  failure: { oneOf: [{ type: 'string', maxLength: 40 }, { type: 'null' }] },
                },
              },
              { type: 'null' },
            ],
          },
        },
      },
    },
  },
};

export function registerDialogueRoutes(ctx: DialogueContext) {
  const { app, db, auth, membership, canManage, notifyCampaign, rollSkillCheck, canActAs } = ctx;
  const campaignParams = objectSchema({ campaignId: uuid });
  const dialogueParams = objectSchema({ campaignId: uuid, dialogueId: uuid });

  async function assertManager(q: Queryable, campaignId: string, userId: string) {
    const member = await membership(q, campaignId, userId, true);
    if (!(await canManage(q, member, userId))) reject(403, 'Разговоры ведёт мастер.');
    return member;
  }

  function validate(nodes: DialogueNode[], startNode: string) {
    const problems = dialogueProblems(nodes, startNode, skill => Boolean(findSrdSkill(skill)));
    if (problems.length) reject(400, problems.slice(0, 3).join(' '));
  }

  async function assertNpc(q: Queryable, campaignId: string, npcId: string | null | undefined) {
    if (!npcId) return;
    const npc = (await q.query('SELECT 1 FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, npcId])).rows[0];
    if (!npc) reject(400, 'Собеседника нет в этой кампании.');
  }

  async function sessionView(q: Queryable, campaignId: string, full: boolean) {
    const session = (
      await q.query(
        `SELECT s.dialogue_id, s.node_id, s.history, d.title, d.nodes, d.npc_id, c.name AS npc_name, c.image_asset_id AS npc_image, c.image_crop AS npc_image_crop
         FROM dialogue_sessions s JOIN dialogues d ON d.campaign_id = s.campaign_id AND d.id = s.dialogue_id
         LEFT JOIN characters c ON c.campaign_id = d.campaign_id AND c.id = d.npc_id
         WHERE s.campaign_id=$1`,
        [campaignId],
      )
    ).rows[0];
    if (!session) return { active: false };
    const node = (session.nodes as DialogueNode[]).find(entry => entry.id === session.node_id);
    if (!node) return { active: false };
    return {
      active: true,
      dialogueId: session.dialogue_id,
      title: session.title,
      npc: session.npc_id ? { id: session.npc_id, name: session.npc_name, imageAssetId: session.npc_image, imageCrop: session.npc_image_crop ?? null } : null,
      node: {
        id: node.id,
        speaker: node.speaker || session.npc_name || null,
        text: node.text,
        options: node.options.map(option => ({
          id: option.id, label: option.label,
          check: option.check ? { skill: option.check.skill, label: findSrdSkill(option.check.skill)?.nameRu ?? option.check.skill, ...(full ? { dc: option.check.dc } : {}) } : null,
        })),
      },
      history: session.history,
    };
  }

  app.get<{ Params: { campaignId: string } }>(
    '/campaigns/:campaignId/dialogues',
    { schema: { params: campaignParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const member = await membership(db, campaignId, userId);
      if (!(await canManage(db, member, userId))) reject(403, 'Разговоры готовит мастер.');
      const dialogues = (
        await db.query(
          `SELECT d.id, d.title, d.npc_id, c.name AS npc_name, d.nodes, d.start_node, d.revision, d.updated_at
           FROM dialogues d LEFT JOIN characters c ON c.campaign_id = d.campaign_id AND c.id = d.npc_id
           WHERE d.campaign_id=$1 ORDER BY d.updated_at DESC`,
          [campaignId],
        )
      ).rows;
      return { dialogues };
    },
  );

  app.post<{ Params: { campaignId: string }; Body: { title: string; npcId?: string | null; nodes: DialogueNode[]; startNode: string } }>(
    '/campaigns/:campaignId/dialogues',
    {
      schema: {
        params: campaignParams,
        body: {
          type: 'object', additionalProperties: false, required: ['title', 'nodes', 'startNode'],
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 120, pattern: '\\S' },
            npcId: { oneOf: [uuid, { type: 'null' }] },
            nodes: { type: 'array', maxItems: 100, items: nodeSchema },
            startNode: { type: 'string', minLength: 1, maxLength: 40 },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const { title, npcId, nodes, startNode } = request.body;
      const created = await db.transaction(async q => {
        await assertManager(q, campaignId, userId);
        await assertNpc(q, campaignId, npcId);
        validate(nodes, startNode);
        return (
          await q.query(
            `INSERT INTO dialogues (campaign_id, npc_id, title, nodes, start_node, created_by) VALUES ($1,$2,$3,$4::jsonb,$5,$6)
             RETURNING id, title, npc_id, nodes, start_node, revision`,
            [campaignId, npcId ?? null, title.trim(), JSON.stringify(nodes), startNode, userId],
          )
        ).rows[0];
      });
      return reply.code(201).send({ dialogue: created });
    },
  );

  app.put<{ Params: { campaignId: string; dialogueId: string }; Body: { title?: string; npcId?: string | null; nodes?: DialogueNode[]; startNode?: string; revision: number } }>(
    '/campaigns/:campaignId/dialogues/:dialogueId',
    {
      schema: {
        params: dialogueParams,
        body: {
          type: 'object', additionalProperties: false, required: ['revision'],
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 120, pattern: '\\S' },
            npcId: { oneOf: [uuid, { type: 'null' }] },
            nodes: { type: 'array', maxItems: 100, items: nodeSchema },
            startNode: { type: 'string', minLength: 1, maxLength: 40 },
            revision: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, dialogueId } = request.params;
      const body = request.body;
      const updated = await db.transaction(async q => {
        await assertManager(q, campaignId, userId);
        const current = (await q.query('SELECT * FROM dialogues WHERE campaign_id=$1 AND id=$2 FOR UPDATE', [campaignId, dialogueId])).rows[0];
        if (!current) reject(404, 'Разговора нет.');
        if (current.revision !== body.revision) reject(409, 'Разговор уже изменён — перечитайте его.');
        if (body.npcId !== undefined) await assertNpc(q, campaignId, body.npcId);
        const nodes = body.nodes ?? current.nodes;
        const startNode = body.startNode ?? current.start_node;
        validate(nodes, startNode);
        return (
          await q.query(
            `UPDATE dialogues SET title=$3, npc_id=$4, nodes=$5::jsonb, start_node=$6, revision=revision+1, updated_at=now()
             WHERE campaign_id=$1 AND id=$2 RETURNING id, title, npc_id, nodes, start_node, revision`,
            [campaignId, dialogueId, body.title?.trim() ?? current.title, body.npcId !== undefined ? body.npcId : current.npc_id, JSON.stringify(nodes), startNode],
          )
        ).rows[0];
      });
      return { dialogue: updated };
    },
  );

  app.delete<{ Params: { campaignId: string; dialogueId: string } }>(
    '/campaigns/:campaignId/dialogues/:dialogueId',
    { schema: { params: dialogueParams } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, dialogueId } = request.params;
      const wasRunning = await db.transaction(async q => {
        await assertManager(q, campaignId, userId);
        const running = (await q.query('SELECT 1 FROM dialogue_sessions WHERE campaign_id=$1 AND dialogue_id=$2', [campaignId, dialogueId])).rows[0];
        const deleted = await q.query('DELETE FROM dialogues WHERE campaign_id=$1 AND id=$2 RETURNING id', [campaignId, dialogueId]);
        if (!deleted.rows[0]) reject(404, 'Разговора нет.');
        return Boolean(running);
      });
      if (wasRunning) void notifyCampaign(campaignId, { type: 'dialogue' });
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { campaignId: string; dialogueId: string } }>(
    '/campaigns/:campaignId/dialogues/:dialogueId/start',
    { schema: { params: dialogueParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId, dialogueId } = request.params;
      const view = await db.transaction(async q => {
        await assertManager(q, campaignId, userId);
        const dialogue = (await q.query('SELECT start_node FROM dialogues WHERE campaign_id=$1 AND id=$2', [campaignId, dialogueId])).rows[0];
        if (!dialogue) reject(404, 'Разговора нет.');
        await q.query(
          `INSERT INTO dialogue_sessions (campaign_id, dialogue_id, node_id, history, started_by) VALUES ($1,$2,$3,'[]'::jsonb,$4)
           ON CONFLICT (campaign_id) DO UPDATE SET dialogue_id=EXCLUDED.dialogue_id, node_id=EXCLUDED.node_id, history='[]'::jsonb,
             started_by=EXCLUDED.started_by, started_at=now()`,
          [campaignId, dialogueId, dialogue.start_node, userId],
        );
        return sessionView(q, campaignId, true);
      });
      void notifyCampaign(campaignId, { type: 'dialogue' });
      return view;
    },
  );

  app.get<{ Params: { campaignId: string } }>(
    '/campaigns/:campaignId/dialogue',
    { schema: { params: campaignParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const member = await membership(db, campaignId, userId);
      return sessionView(db, campaignId, await canManage(db, member, userId));
    },
  );

  app.post<{ Params: { campaignId: string }; Body: { nodeId: string; optionId: string; characterId?: string } }>(
    '/campaigns/:campaignId/dialogue/choose',
    {
      schema: {
        params: campaignParams,
        body: {
          type: 'object', additionalProperties: false, required: ['nodeId', 'optionId'],
          properties: { nodeId: { type: 'string', maxLength: 40 }, optionId: { type: 'string', maxLength: 40 }, characterId: uuid },
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const { nodeId, optionId, characterId } = request.body;
      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const session = (
          await q.query(
            `SELECT s.node_id, s.history, d.nodes, d.title, c.name AS npc_name FROM dialogue_sessions s
             JOIN dialogues d ON d.campaign_id = s.campaign_id AND d.id = s.dialogue_id
             LEFT JOIN characters c ON c.campaign_id = d.campaign_id AND c.id = d.npc_id
             WHERE s.campaign_id=$1 FOR UPDATE OF s`,
            [campaignId],
          )
        ).rows[0];
        if (!session) reject(400, 'Разговор уже закончился.');
        if (session.node_id !== nodeId) reject(409, 'Разговор уже ушёл дальше.');
        const node = (session.nodes as DialogueNode[]).find(entry => entry.id === nodeId)!;
        const option = node.options.find(entry => entry.id === optionId);
        if (!option) reject(400, 'Такого ответа нет.');
        const actor = characterId
          ? (await q.query('SELECT id, name FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0]
          : null;
        if (characterId && (!actor || !(await canActAs(q, member, userId, characterId)))) reject(403, 'Отвечать можно своим персонажем.');
        const speaker = actor?.name ?? (await q.query('SELECT display_name FROM users WHERE id=$1', [userId])).rows[0]?.display_name ?? 'Участник';

        let success: boolean | null = null;
        let total: number | null = null;
        if (option.check) {
          if (!actor) reject(400, 'Для этого ответа нужна проверка — выберите, кто отвечает.');
          const rolled = await rollSkillCheck(q, campaignId, userId, actor.id, option.check.skill, `${findSrdSkill(option.check.skill)?.nameRu ?? option.check.skill}: ${session.title}`, option.check.dc);
          success = rolled.success;
          total = rolled.total;
        }
        const next = nextNode(option, success);
        const history = [
          ...(session.history as unknown[]),
          {
            speaker: node.speaker || session.npc_name || null, text: node.text, answer: option.label, by: speaker,
            ...(option.check ? { check: findSrdSkill(option.check.skill)?.nameRu ?? option.check.skill, total, success } : {}),
          },
        ].slice(-50);
        if (next === null) {
          await q.query('DELETE FROM dialogue_sessions WHERE campaign_id=$1', [campaignId]);
        } else {
          await q.query('UPDATE dialogue_sessions SET node_id=$2, history=$3::jsonb WHERE campaign_id=$1', [campaignId, next, JSON.stringify(history)]);
        }
        return { ended: next === null, success, total, rolled: Boolean(option.check) };
      });
      void notifyCampaign(campaignId, { type: 'dialogue' });
      if (result.rolled) void notifyCampaign(campaignId, { type: 'rolls' });
      return result;
    },
  );

  app.post<{ Params: { campaignId: string } }>(
    '/campaigns/:campaignId/dialogue/end',
    { schema: { params: campaignParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      await db.transaction(async q => {
        await assertManager(q, campaignId, userId);
        await q.query('DELETE FROM dialogue_sessions WHERE campaign_id=$1', [campaignId]);
      });
      void notifyCampaign(campaignId, { type: 'dialogue' });
      return { active: false };
    },
  );
}
