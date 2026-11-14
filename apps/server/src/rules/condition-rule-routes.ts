import { randomBytes } from 'node:crypto';

import type { Queryable } from '../db.ts';
import { objectSchema, reject, uuid, type SceneFeatureContext } from '../tabletop/scene-feature.ts';
import {
  CONDITION_KINDS, CUSTOM_CODE, MAX_STAGES, SRD_CONDITION_RULES, builtInRule, builtInRules, describeRule, modOfRule, normalizeClauses, normalizeStages, type Clause, type ConditionRule, type ConditionStage,
} from '../../../../packages/domain/combat/condition-rules.ts';
import { campaignConditionRules, invalidateConditionRules, isCustomCode, sameClauses, sameStages } from './condition-rules.ts';

const MAX_CUSTOM = 60;
const codeParams = objectSchema({ campaignId: uuid, code: { type: 'string', pattern: `^(${[...SRD_CONDITION_RULES.keys()].join('|')}|custom_[a-z0-9]{6,40}|mod_[a-z0-9_]{2,40})$` } });
const ruleBody = {
  name: { type: 'string', minLength: 1, maxLength: 60, pattern: '\\S' },
  icon: { type: 'string', minLength: 1, maxLength: 40, pattern: '^[A-Za-z0-9]+$' },
  kind: { type: 'string', enum: [...CONDITION_KINDS] },
  iconAssetId: { anyOf: [uuid, { type: 'null' }] },
  description: { type: 'string', maxLength: 2000 },
  clauses: { type: 'array', maxItems: 40, items: { type: 'object' } },
  stages: { type: 'array', maxItems: MAX_STAGES, items: { type: 'object' } },
};
type RuleBody = { name?: string; icon?: string; iconAssetId?: string | null; kind?: ConditionRule['kind']; description?: string; clauses?: unknown[]; stages?: unknown[] };

function cleanClauses(input: unknown[] | undefined): Clause[] {
  return normalizeClauses(input ?? []);
}

const stagesJson = (stages: ConditionStage[]) => (stages.length ? JSON.stringify(stages) : null);

async function assertIconAsset(q: Queryable, campaignId: string, assetId: string | null | undefined) {
  if (!assetId) return;
  const found = (await q.query(`SELECT 1 FROM assets WHERE campaign_id=$1 AND id=$2 AND kind='object_image'`, [campaignId, assetId])).rows.length;
  if (!found) reject(400, 'Картинка для значка не найдена — загрузите её ещё раз.');
}

function view(rule: ConditionRule, inUse: number) {
  const standard = builtInRule(rule.code);
  const modName = modOfRule(rule.code);
  return {
    ...rule,
    iconAssetId: rule.iconAssetId ?? null,
    description: rule.description ?? '',
    summary: describeRule(rule),
    standard: Boolean(standard),
    origin: modName ? 'mod' : standard ? 'srd' : 'campaign',
    ...(modName ? { modName } : {}),
    stages: rule.stages ?? [],
    changed: standard
      ? !sameClauses(rule.clauses, standard.clauses) || !sameStages(rule.stages, standard.stages) || (rule.description ?? '') !== (standard.description ?? '')
      : true,
    iconChanged: standard ? rule.icon !== standard.icon || Boolean(rule.iconAssetId) : false,
    inUse,
    ...(standard ? { srd: { clauses: standard.clauses, stages: standard.stages ?? [], summary: describeRule(standard), icon: standard.icon } } : {}),
  };
}

export function registerConditionRuleRoutes(ctx: SceneFeatureContext) {
  const { app, db, auth, membership, canManage, notifyCampaign } = ctx;

  async function requireGm(q: Queryable, campaignId: string, userId: string, message: string) {
    const member = await membership(q, campaignId, userId, true);
    if (!(await canManage(q, member, userId))) reject(403, message);
  }

  async function listView(q: Queryable, campaignId: string) {
    const rules = await campaignConditionRules(q, campaignId);
    const used = new Map((await q.query(
      'SELECT effect_code, count(DISTINCT character_id)::int AS n FROM character_effects WHERE campaign_id=$1 AND active GROUP BY effect_code',
      [campaignId],
    )).rows.map(row => [String(row.effect_code), Number(row.n)]));
    const order = [...builtInRules().keys()];
    return [...rules.values()]
      .sort((a, b) => (order.indexOf(a.code) + 1 || 999) - (order.indexOf(b.code) + 1 || 999) || a.name.localeCompare(b.name, 'ru'))
      .map(rule => view(rule, used.get(rule.code) ?? 0));
  }

  function changed(campaignId: string) {
    invalidateConditionRules(campaignId);
    void notifyCampaign(campaignId, { type: 'conditions' });
    void notifyCampaign(campaignId, { type: 'changed' });
  }

  app.get<{ Params: { campaignId: string } }>(
    '/campaigns/:campaignId/condition-rules',
    { schema: { params: objectSchema({ campaignId: uuid }) } },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId);
        return { canEdit: await canManage(q, member, userId), rules: await listView(q, campaignId) };
      });
    },
  );

  app.put<{ Params: { campaignId: string; code: string }; Body: RuleBody }>(
    '/campaigns/:campaignId/condition-rules/:code',
    { schema: { params: codeParams, body: objectSchema(ruleBody, ['clauses']) } },
    async request => {
      const userId = await auth(request);
      const { campaignId, code } = request.params;
      const saved = await db.transaction(async q => {
        await requireGm(q, campaignId, userId, 'Правила состояний меняет мастер.');
        const standard = builtInRule(code);
        const current = (await campaignConditionRules(q, campaignId)).get(code);
        if (!standard && !current) reject(404, 'Такого состояния в кампании нет.');
        const body = request.body;
        const iconAssetId = body.iconAssetId === undefined ? current?.iconAssetId ?? null : body.iconAssetId;
        await assertIconAsset(q, campaignId, iconAssetId);
        const icon = body.icon ?? current?.icon ?? standard!.icon;
        const clauses = cleanClauses(body.clauses);
        const stages = body.stages === undefined ? current?.stages ?? standard?.stages ?? [] : normalizeStages(body.stages);
        const description = (body.description ?? current?.description ?? '').trim();
        const ownDescription = standard && description === (standard.description ?? '') ? '' : description;
        const srdClauses = Boolean(standard) && sameClauses(clauses, standard!.clauses);
        const srdStages = Boolean(standard) && sameStages(stages, standard!.stages);
        if (standard && srdClauses && srdStages && !ownDescription && icon === standard.icon && !iconAssetId) {
          await q.query('DELETE FROM campaign_conditions WHERE campaign_id=$1 AND code=$2', [campaignId, code]);
        } else {
          await q.query(
            `INSERT INTO campaign_conditions (campaign_id, code, name, icon, icon_asset_id, kind, description, clauses, stages, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)
             ON CONFLICT (campaign_id, code) DO UPDATE SET name=EXCLUDED.name, icon=EXCLUDED.icon, icon_asset_id=EXCLUDED.icon_asset_id, kind=EXCLUDED.kind,
               description=EXCLUDED.description, clauses=EXCLUDED.clauses, stages=EXCLUDED.stages, updated_by=EXCLUDED.updated_by, updated_at=now(),
               revision=campaign_conditions.revision+1`,
            [
              campaignId, code, standard ? standard.name : (body.name?.trim() ?? current!.name), icon, iconAssetId,
              standard ? standard.kind : body.kind ?? current!.kind, ownDescription, srdClauses ? null : JSON.stringify(clauses),
              standard && srdStages ? null : stagesJson(stages), userId,
            ],
          );
        }
        invalidateConditionRules(campaignId);
        return (await listView(q, campaignId)).find(rule => rule.code === code)!;
      });
      changed(campaignId);
      return saved;
    },
  );

  app.post<{ Params: { campaignId: string }; Body: RuleBody }>(
    '/campaigns/:campaignId/condition-rules',
    { schema: { params: objectSchema({ campaignId: uuid }), body: objectSchema(ruleBody, ['name']) } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const created = await db.transaction(async q => {
        await requireGm(q, campaignId, userId, 'Свои состояния создаёт мастер.');
        const count = Number((await q.query(`SELECT count(*)::int AS n FROM campaign_conditions WHERE campaign_id=$1 AND code LIKE 'custom\\_%'`, [campaignId])).rows[0].n);
        if (count >= MAX_CUSTOM) reject(400, `Своих состояний не больше ${MAX_CUSTOM} — удалите ненужные.`);
        const code = `custom_${randomBytes(5).toString('hex')}`;
        if (!CUSTOM_CODE.test(code)) reject(500, 'Не удалось придумать код состояния.');
        const body = request.body;
        await assertIconAsset(q, campaignId, body.iconAssetId);
        await q.query(
          `INSERT INTO campaign_conditions (campaign_id, code, name, icon, icon_asset_id, kind, description, clauses, stages, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)`,
          [
            campaignId, code, body.name!.trim(), body.icon ?? 'alert', body.iconAssetId ?? null, body.kind ?? 'condition',
            (body.description ?? '').trim(), JSON.stringify(cleanClauses(body.clauses)), stagesJson(normalizeStages(body.stages ?? [])), userId,
          ],
        );
        invalidateConditionRules(campaignId);
        return (await listView(q, campaignId)).find(rule => rule.code === code)!;
      });
      changed(campaignId);
      return reply.code(201).send(created);
    },
  );

  app.delete<{ Params: { campaignId: string; code: string } }>(
    '/campaigns/:campaignId/condition-rules/:code',
    { schema: { params: codeParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId, code } = request.params;
      const result = await db.transaction(async q => {
        await requireGm(q, campaignId, userId, 'Правила состояний меняет мастер.');
        if (isCustomCode(code)) {
          const holders = (await q.query(
            `SELECT DISTINCT c.name FROM character_effects e JOIN characters c ON c.campaign_id=e.campaign_id AND c.id=e.character_id
             WHERE e.campaign_id=$1 AND e.effect_code=$2 AND e.active ORDER BY c.name LIMIT 6`,
            [campaignId, code],
          )).rows.map(row => String(row.name));
          if (holders.length) reject(409, `Это состояние сейчас на существах: ${holders.join(', ')}. Снимите его, потом удаляйте.`);
        }
        const standard = builtInRule(code);
        const kept = standard
          ? (await q.query(
            `UPDATE campaign_conditions SET clauses=NULL, stages=NULL, description='', updated_by=$4, updated_at=now(), revision=revision+1
             WHERE campaign_id=$1 AND code=$2 AND (icon<>$3 OR icon_asset_id IS NOT NULL) RETURNING code`,
            [campaignId, code, standard.icon, userId],
          )).rows.length
          : 0;
        const removed = kept || (await q.query('DELETE FROM campaign_conditions WHERE campaign_id=$1 AND code=$2 RETURNING code', [campaignId, code])).rows.length;
        if (!removed && isCustomCode(code)) reject(404, 'Такого состояния в кампании нет.');
        invalidateConditionRules(campaignId);
        return { code, reset: !isCustomCode(code), rules: await listView(q, campaignId) };
      });
      changed(campaignId);
      return result;
    },
  );
}
