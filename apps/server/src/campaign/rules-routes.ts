import type {
  FastifyPluginAsync,
  FastifyRequest,
} from 'fastify';

import type { Database, Queryable } from '../db.ts';
import { isFormulaShapeValid } from '../../../../packages/domain/dice/formula.ts';

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
type RuleParams = CampaignParams & { ruleId: string };

const RULE_KINDS = ['flag', 'number', 'formula', 'text'] as const;
type RuleKind = typeof RULE_KINDS[number];

function reject(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}

const uuid = { type: 'string', format: 'uuid' };

function objectSchema(properties: Record<string, unknown>, required: string[] = Object.keys(properties)) {
  return {
    type: 'object',
    required,
    additionalProperties: false,
    properties,
  };
}

const campaignParams = objectSchema({ campaignId: uuid });
const ruleParams = objectSchema({ campaignId: uuid, ruleId: uuid });

const KEY_PATTERN = '^[a-z][a-z0-9_]{0,63}$';

function validateValue(kind: string, value: unknown): void {
  if (kind === 'flag') {
    if (typeof value !== 'boolean') reject(400, 'Флаг должен быть включён или выключен.');
  } else if (kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1_000_000) {
      reject(400, 'Число вне допустимого диапазона.');
    }
  } else if (kind === 'formula') {
    if (typeof value !== 'string' || !isFormulaShapeValid(value)) {
      reject(400, 'Формула должна быть в виде NdM с необязательными членами через + или -: число или переменная @str/@dex/@con/@int/@wis/@cha/@prof, например 2d6+3 или 1d20+@dex+@prof.');
    }
  } else if (kind === 'text') {
    if (typeof value !== 'string' || value.length > 2000) {
      reject(400, 'Текст правила не длиннее 2000 символов.');
    }
  } else {
    reject(400, 'Неизвестный тип правила.');
  }
}

export const rulesRoutes: FastifyPluginAsync<Options> =
async (app, options) => {
  const { db, auth, membership } = options;

  async function canManageRules(q: Queryable, member: any, userId: string): Promise<boolean> {
    if (member.owner_user_id === userId || member.is_full_gm) return true;

    const { rows } = await q.query(
      `SELECT 1 FROM member_permissions WHERE campaign_id=$1 AND user_id=$2 AND permission='rules.manage'`,
      [member.campaign_id, userId],
    );

    return rows.length > 0;
  }

  app.get<{ Params: CampaignParams }>(
    '/campaigns/:campaignId/rules',
    { schema: { params: campaignParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;

      const member = await membership(db, campaignId, userId);
      const canManage = await canManageRules(db, member, userId);

      const rules = (
        await db.query(
          `SELECT r.id, r.key, r.kind, r.label, r.description, r.value, r.revision,
                  r.updated_at, u.display_name AS updated_by_name
           FROM campaign_rules r
           JOIN users u ON u.id = r.updated_by
           WHERE r.campaign_id=$1
           ORDER BY r.kind, r.label, r.id`,
          [campaignId],
        )
      ).rows;

      return { canManage, rules };
    },
  );

  app.post<{
    Params: CampaignParams;
    Body: { key: string; kind: RuleKind; label: string; description?: string; value: unknown };
  }>(
    '/campaigns/:campaignId/rules',
    {
      schema: {
        params: campaignParams,
        body: objectSchema({
          key: { type: 'string', pattern: KEY_PATTERN },
          kind: { type: 'string', enum: RULE_KINDS as unknown as string[] },
          label: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
          description: { type: 'string', maxLength: 2000 },
          value: {},
        }, ['key', 'kind', 'label', 'value']),
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const { key, kind, label, description, value } = request.body;

      validateValue(kind, value);

      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);

        if (!(await canManageRules(q, member, userId))) {
          reject(403, 'Изменять правила кампании может только мастер или тот, кому это разрешено.');
        }

        const inserted = await q.query(
          `INSERT INTO campaign_rules (campaign_id, key, kind, label, description, value, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
           RETURNING id, key, kind, label, description, value, revision, updated_at`,
          [campaignId, key, kind, label.trim(), description ?? '', JSON.stringify(value), userId],
        );

        return inserted.rows[0];
      });

      return reply.code(201).send(result);
    },
  );

  app.put<{
    Params: RuleParams;
    Body: { label: string; description?: string; value: unknown; revision: number };
  }>(
    '/campaigns/:campaignId/rules/:ruleId',
    {
      schema: {
        params: ruleParams,
        body: objectSchema({
          label: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
          description: { type: 'string', maxLength: 2000 },
          value: {},
          revision: { type: 'integer', minimum: 1 },
        }, ['label', 'value', 'revision']),
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, ruleId } = request.params;
      const { label, description, value, revision } = request.body;

      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);

        if (!(await canManageRules(q, member, userId))) {
          reject(403, 'Изменять правила кампании может только мастер или тот, кому это разрешено.');
        }

        const rule = (
          await q.query(
            `SELECT kind, revision FROM campaign_rules WHERE campaign_id=$1 AND id=$2 FOR UPDATE`,
            [campaignId, ruleId],
          )
        ).rows[0];

        if (!rule) reject(404, 'Правило не найдено.');
        if (rule.revision !== revision) {
          reject(409, 'Это правило уже изменил кто-то другой — обновите страницу и попробуйте снова.');
        }

        validateValue(rule.kind, value);

        const updated = await q.query(
          `UPDATE campaign_rules
           SET label=$1, description=$2, value=$3::jsonb, revision=revision+1, updated_by=$4, updated_at=now()
           WHERE campaign_id=$5 AND id=$6
           RETURNING id, key, kind, label, description, value, revision, updated_at`,
          [label.trim(), description ?? '', JSON.stringify(value), userId, campaignId, ruleId],
        );

        return updated.rows[0];
      });
    },
  );

  app.delete<{ Params: RuleParams }>(
    '/campaigns/:campaignId/rules/:ruleId',
    { schema: { params: ruleParams } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, ruleId } = request.params;

      await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);

        if (!(await canManageRules(q, member, userId))) {
          reject(403, 'Удалять правила кампании может только мастер или тот, кому это разрешено.');
        }

        await q.query(`DELETE FROM campaign_rules WHERE campaign_id=$1 AND id=$2`, [campaignId, ruleId]);
      });

      return reply.code(204).send();
    },
  );
};
