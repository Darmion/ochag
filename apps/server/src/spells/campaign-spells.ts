import { reject, uuid, type CampaignParams } from '../characters/sheet/shared.ts';
import { mechanicsAssignments, mechanicsBody, validateSpellFormula, validateUpcastFormula } from './mechanics.ts';
import type { RouteContext } from '../system/route-context.ts';

type CampaignSpellParams = CampaignParams & { spellId: string };

export const shortText = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength, pattern: '\\S' });

export const campaignParams = {
  type: 'object', required: ['campaignId'], additionalProperties: false,
  properties: { campaignId: uuid },
};

export const campaignSpellParams = {
  type: 'object', required: ['campaignId', 'spellId'], additionalProperties: false,
  properties: { campaignId: uuid, spellId: uuid },
};

export const customSpellColumns = `id, created_by AS "createdBy", name, level, school,
  casting_time AS "castingTime", range, components, material, duration,
  concentration, ritual, classes, description AS desc, higher_level AS "higherLevel",
  status, reviewed_by AS "reviewedBy", reviewed_at AS "reviewedAt",
  damage_formula AS "damageFormula", healing_formula AS "healingFormula",
  upcast_formula AS "upcastFormula",
  attack_kind AS "attackKind", save_ability AS "saveAbility", half_on_save AS "halfOnSave",
  damage_type AS "damageType", condition_code AS "conditionCode", condition_rounds AS "conditionRounds",
  condition_repeat AS "conditionRepeat", creates_zone AS "createsZone",
  template, template_version AS "templateVersion", special_notify AS "specialNotify", review_note AS "reviewNote"`;

export const customSpellBody = {
  name: shortText(200),
  level: { type: 'integer', minimum: 0, maximum: 9 },
  school: shortText(100),
  castingTime: { type: 'string', maxLength: 200 },
  range: { type: 'string', maxLength: 200 },
  components: { type: 'string', maxLength: 200 },
  material: { type: ['string', 'null'], maxLength: 500 },
  duration: { type: 'string', maxLength: 200 },
  concentration: { type: 'boolean' },
  ritual: { type: 'boolean' },
  classes: { type: 'string', maxLength: 300 },
  description: { type: 'string', maxLength: 20000 },
  higherLevel: { type: ['string', 'null'], maxLength: 5000 },
  damageFormula: { type: ['string', 'null'], maxLength: 200 },
  healingFormula: { type: ['string', 'null'], maxLength: 200 },
  upcastFormula: { type: ['string', 'null'], maxLength: 20 },
};

export function canEditCampaignSpell(spell: any, userId: string, member: any) {
  if (spell.created_by === userId) return true;
  return member.owner_user_id === userId || member.is_full_gm;
}

export function registerCampaignSpellRoutes(ctx: RouteContext) {
  const { app, auth, db, membership, requirePermission } = ctx;

  app.get<{ Params: CampaignParams }>(
    '/campaigns/:campaignId/spells',
    { schema: { params: campaignParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;

      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId);

        let isManager = true;
        try {
          await requirePermission(q, member, userId, 'characters.manage');
        } catch {
          isManager = false;
        }

        const { rows } = await q.query(
          `SELECT ${customSpellColumns} FROM campaign_spells
           WHERE campaign_id=$1 AND ($2 OR status='approved' OR created_by=$3)
           ORDER BY level, name`,
          [campaignId, isManager, userId],
        );
        const pendingRevisions = isManager ? (await q.query(
          `SELECT r.spell_id AS "spellId", r.version, u.display_name AS "submittedByName" FROM campaign_spell_revisions r
           LEFT JOIN users u ON u.id = r.submitted_by WHERE r.campaign_id=$1 AND r.status='pending' ORDER BY r.submitted_at`,
          [campaignId],
        )).rows : [];
        return { spells: rows, canReview: isManager, pendingRevisions };
      });
    },
  );

  app.post<{ Params: CampaignParams; Body: {
    name: string; level: number; school: string; castingTime?: string; range?: string;
    components?: string; material?: string | null; duration?: string; concentration?: boolean;
    ritual?: boolean; classes?: string; description?: string; higherLevel?: string | null;
    damageFormula?: string | null; healingFormula?: string | null; upcastFormula?: string | null;
  } }>(
    '/campaigns/:campaignId/spells',
    {
      schema: {
        params: campaignParams,
        body: {
          type: 'object',
          required: ['name', 'level', 'school'],
          additionalProperties: false,
          properties: customSpellBody,
        },
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const b = request.body;
      validateSpellFormula(b.damageFormula ?? null, 'Формула урона');
      validateSpellFormula(b.healingFormula ?? null, 'Формула лечения');
      validateUpcastFormula(b.upcastFormula ?? null);

      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId);

        let isManager = true;
        try {
          await requirePermission(q, member, userId, 'characters.manage');
        } catch {
          isManager = false;
        }

        const { rows } = await q.query(
          `INSERT INTO campaign_spells
             (campaign_id, created_by, name, level, school, casting_time, range, components,
              material, duration, concentration, ritual, classes, description, higher_level,
              status, reviewed_by, reviewed_at, damage_formula, healing_formula, upcast_formula)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
           RETURNING ${customSpellColumns}`,
          [
            campaignId, userId, b.name.trim(), b.level, b.school.trim(),
            b.castingTime ?? '', b.range ?? '', b.components ?? '',
            b.material ?? null, b.duration ?? '', b.concentration ?? false,
            b.ritual ?? false, b.classes ?? '', b.description ?? '', b.higherLevel ?? null,
            isManager ? 'approved' : 'pending', isManager ? userId : null, isManager ? new Date() : null,
            b.damageFormula ?? null, b.healingFormula ?? null, b.upcastFormula ?? null,
          ],
        );

        return rows[0];
      });

      return reply.code(201).send(result);
    },
  );

  app.patch<{ Params: CampaignSpellParams; Body: Partial<{
    name: string; level: number; school: string; castingTime: string; range: string;
    components: string; material: string | null; duration: string; concentration: boolean;
    ritual: boolean; classes: string; description: string; higherLevel: string | null;
    damageFormula: string | null; healingFormula: string | null; upcastFormula: string | null;
  }> }>(
    '/campaigns/:campaignId/spells/:spellId',
    {
      schema: {
        params: campaignSpellParams,
        body: { type: 'object', minProperties: 1, additionalProperties: false, properties: customSpellBody },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, spellId } = request.params;
      const b = request.body;
      if (b.damageFormula !== undefined) validateSpellFormula(b.damageFormula, 'Формула урона');
      if (b.healingFormula !== undefined) validateSpellFormula(b.healingFormula, 'Формула лечения');
      if (b.upcastFormula !== undefined) validateUpcastFormula(b.upcastFormula);

      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);

        const existing = (
          await q.query('SELECT created_by, status FROM campaign_spells WHERE campaign_id=$1 AND id=$2', [campaignId, spellId])
        ).rows[0];
        if (!existing) reject(404, 'Заклинание не найдено.');
        if (!canEditCampaignSpell(existing, userId, member)) reject(403, 'Недостаточно прав.');

        const columns: Array<[keyof typeof b, string]> = [
          ['name', 'name'], ['level', 'level'], ['school', 'school'], ['castingTime', 'casting_time'], ['range', 'range'],
          ['components', 'components'], ['material', 'material'], ['duration', 'duration'], ['concentration', 'concentration'],
          ['ritual', 'ritual'], ['classes', 'classes'], ['description', 'description'], ['higherLevel', 'higher_level'],
          ['damageFormula', 'damage_formula'], ['healingFormula', 'healing_formula'], ['upcastFormula', 'upcast_formula'],
        ];
        const sets: string[] = [];
        const values: unknown[] = [];
        for (const [field, column] of columns) {
          const value = b[field];
          if (value === undefined) continue;
          values.push(typeof value === 'string' && (field === 'name' || field === 'school') ? value.trim() : value);
          sets.push(`${column} = $${values.length + 2}`);
        }
        let isManager = true;
        try {
          await requirePermission(q, member, userId, 'characters.manage');
        } catch {
          isManager = false;
        }
        if (!isManager && existing.status === 'approved') sets.push(`status = 'pending', reviewed_by = NULL, reviewed_at = NULL`);

        const { rows } = await q.query(
          `UPDATE campaign_spells SET ${sets.join(', ')} WHERE campaign_id=$1 AND id=$2 RETURNING ${customSpellColumns}`,
          [campaignId, spellId, ...values],
        );

        return rows[0];
      });
    },
  );

  app.put<{ Params: CampaignSpellParams; Body: Record<string, any> }>(
    '/campaigns/:campaignId/spells/:spellId/mechanics',
    {
      schema: {
        params: campaignSpellParams,
        body: { type: 'object', minProperties: 1, additionalProperties: false, properties: mechanicsBody },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, spellId } = request.params;
      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const existing = (await q.query('SELECT created_by FROM campaign_spells WHERE campaign_id=$1 AND id=$2', [campaignId, spellId])).rows[0];
        if (!existing) reject(404, 'Заклинание не найдено.');
        if (!canEditCampaignSpell(existing, userId, member)) reject(403, 'Недостаточно прав.');
        const { sets, values } = mechanicsAssignments(request.body, 3);
        const { rows } = await q.query(
          `UPDATE campaign_spells SET ${sets.join(', ')} WHERE campaign_id=$1 AND id=$2 RETURNING ${customSpellColumns}`,
          [campaignId, spellId, ...values],
        );
        return rows[0];
      });
    },
  );

  app.delete<{ Params: CampaignSpellParams }>(
    '/campaigns/:campaignId/spells/:spellId',
    { schema: { params: campaignSpellParams } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, spellId } = request.params;

      await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);

        const existing = (
          await q.query('SELECT created_by FROM campaign_spells WHERE campaign_id=$1 AND id=$2', [campaignId, spellId])
        ).rows[0];
        if (!existing) reject(404, 'Заклинание не найдено.');
        if (!canEditCampaignSpell(existing, userId, member)) reject(403, 'Недостаточно прав.');

        await q.query('DELETE FROM campaign_spells WHERE campaign_id=$1 AND id=$2', [campaignId, spellId]);
      });

      return reply.code(204).send();
    },
  );

  app.patch<{ Params: CampaignSpellParams; Body: { status: 'approved' | 'rejected' } }>(
    '/campaigns/:campaignId/spells/:spellId/review',
    {
      schema: {
        params: campaignSpellParams,
        body: {
          type: 'object', required: ['status'], additionalProperties: false,
          properties: { status: { type: 'string', enum: ['approved', 'rejected'] } },
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, spellId } = request.params;
      const { status } = request.body;

      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await requirePermission(q, member, userId, 'characters.manage');

        const { rows } = await q.query(
          `UPDATE campaign_spells SET status=$1, reviewed_by=$2, reviewed_at=now()
           WHERE campaign_id=$3 AND id=$4
           RETURNING ${customSpellColumns}`,
          [status, userId, campaignId, spellId],
        );

        if (!rows[0]) reject(404, 'Заклинание не найдено.');
        return rows[0];
      });
    },
  );
}
