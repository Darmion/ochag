import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { copyFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { ASSETS_DIR } from '../system/asset-routes.ts';
import type { Database, Queryable } from '../db.ts';
import {
  CLASSES, describeCasting, describeDuration, isArtAsset, normalizeTemplate, optionLabel, validateTemplate, type SpellTemplate,
} from '../../../../packages/domain/spells/spell-template.ts';
import { suggestTemplate } from '../../../../packages/domain/spells/spell-template-suggest.ts';
import { legacySpellTemplate } from '../../../../packages/domain/spells/spell-template-convert.ts';
import { srdTemplateOf } from '../../../../packages/domain/spells/srd-spell-templates.ts';

type Options = {
  db: Database;
  auth: (request: FastifyRequest) => Promise<string>;
  membership: (db: Queryable, campaignId: string, userId: string, lock?: boolean) => Promise<any>;
  requirePermission: (db: Queryable, membership: any, userId: string, permission: string) => Promise<void>;
};

const uuid = { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' };
const campaignParams = { type: 'object', required: ['campaignId'], additionalProperties: false, properties: { campaignId: uuid } };
const spellParams = { type: 'object', required: ['campaignId', 'spellId'], additionalProperties: false, properties: { campaignId: uuid, spellId: uuid } };
const srdParams = { type: 'object', required: ['campaignId', 'index'], additionalProperties: false, properties: { campaignId: uuid, index: { type: 'string', pattern: '^[a-z0-9-]{1,64}$' } } };
const templateBody = { type: 'object' };
const suggestionsBody = { oneOf: [{ type: 'object' }, { type: 'null' }] };

function reject(statusCode: number, message: string, details?: unknown): never {
  throw Object.assign(new Error(message), { statusCode, ...(details !== undefined ? { details } : {}) });
}

function flatColumns(t: SpellTemplate) {
  const c = t.casting;
  return {
    name: t.passport.name,
    level: t.passport.level,
    school: t.passport.school.charAt(0).toUpperCase() + t.passport.school.slice(1),
    casting_time: describeCasting(t).split(' · ')[0]!.slice(0, 200),
    range: (describeCasting(t).split(' · ')[2] ?? '').slice(0, 200),
    components: [c.verbal ? 'В' : '', c.somatic ? 'С' : '', c.material ? 'М' : ''].filter(Boolean).join(', '),
    material: c.material && c.materialText ? c.materialText.slice(0, 500) : null,
    duration: describeDuration(t).slice(0, 200),
    concentration: t.duration.concentration,
    ritual: c.ritual,
    classes: t.passport.classes.map(entry => optionLabel(CLASSES, entry)).join(', ').slice(0, 300),
    description: t.passport.description,
    higher_level: t.passport.higherLevel || null,
  };
}

const SPELL_COLUMNS = `id, created_by AS "createdBy", name, level, school, casting_time AS "castingTime", range, components, material,
  duration, concentration, ritual, classes, description AS desc, higher_level AS "higherLevel", status,
  reviewed_by AS "reviewedBy", reviewed_at AS "reviewedAt", template, template_version AS "templateVersion",
  suggestions, special_notify AS "specialNotify", review_note AS "reviewNote", origin_spell_id AS "originSpellId"`;

function unresolvedSuggestions(suggestions: unknown): number {
  const items = suggestions && typeof suggestions === 'object' && Array.isArray((suggestions as any).items) ? (suggestions as any).items as any[] : [];
  return items.filter(item => item?.status === 'suggested').length;
}

function assertReady(t: SpellTemplate, suggestions: unknown) {
  if (unresolvedSuggestions(suggestions)) reject(400, 'Остались непринятые подсказки: примите, измените или очистите каждую.');
  const { errors } = validateTemplate(t);
  if (errors.length) reject(400, `В шаблоне ошибки: ${errors.map(issue => `${issue.path} — ${issue.message}`).join('; ')}`, { errors });
}

async function cleanArt(q: Queryable, campaignId: string, t: SpellTemplate): Promise<SpellTemplate> {
  if (!isArtAsset(t.passport.art)) return t;
  const found = (await q.query(`SELECT 1 FROM assets WHERE campaign_id=$1 AND id=$2 AND kind IN ('object_image', 'art_sprite')`, [campaignId, t.passport.art])).rows.length;
  if (!found) t.passport.art = '';
  return t;
}

async function copyArt(q: Queryable, fromCampaign: string, toCampaign: string, art: string, userId: string, written: string[]): Promise<string> {
  if (!isArtAsset(art)) return art;
  const asset = (await q.query('SELECT content_type, byte_size, storage_key, original_filename FROM assets WHERE campaign_id=$1 AND id=$2', [fromCampaign, art])).rows[0] as any;
  if (!asset) return '';
  const id = randomUUID();
  const storageKey = `${id}${path.extname(String(asset.storage_key))}`;
  try {
    await copyFile(path.join(ASSETS_DIR, String(asset.storage_key)), path.join(ASSETS_DIR, storageKey));
  } catch {
    return '';
  }
  written.push(storageKey);
  await q.query(
    `INSERT INTO assets (id, campaign_id, kind, content_type, byte_size, storage_key, original_filename, uploaded_by)
     VALUES ($1,$2,'object_image',$3,$4,$5,$6,$7)`,
    [id, toCampaign, asset.content_type, asset.byte_size, storageKey, asset.original_filename, userId],
  );
  return id;
}

export async function convertLegacySpells(q: Queryable): Promise<number> {
  const rows = (await q.query('SELECT * FROM campaign_spells WHERE template IS NULL')).rows as any[];
  for (const row of rows) {
    const t = legacySpellTemplate({
      name: row.name, level: row.level, school: row.school, description: row.description, higher_level: row.higher_level,
      castingTime: row.casting_time, range: row.range, duration: row.duration, components: row.components, material: row.material,
      concentration: row.concentration, ritual: row.ritual, attackKind: row.attack_kind, saveAbility: row.save_ability, halfOnSave: row.half_on_save,
      damageFormula: row.damage_formula, damageType: row.damage_type, healingFormula: row.healing_formula, upcastFormula: row.upcast_formula,
      conditionCode: row.condition_code, conditionRounds: row.condition_rounds, conditionRepeat: row.condition_repeat, createsZone: row.creates_zone,
    });
    await q.query('UPDATE campaign_spells SET template=$3::jsonb WHERE campaign_id=$1 AND id=$2 AND template IS NULL', [row.campaign_id, row.id, JSON.stringify(t)]);
  }
  return rows.length;
}

export const spellTemplateRoutes: FastifyPluginAsync<Options> = async (app, { db, auth, membership, requirePermission }) => {
  app.addHook('onReady', async () => {
    try {
      const converted = await convertLegacySpells(db);
      if (converted) app.log.info({ converted }, 'campaign spells moved to templates');
    } catch (error) {
      app.log.warn({ error }, 'campaign spell conversion failed');
    }
  });

  async function isManager(q: Queryable, member: any, userId: string) {
    try {
      await requirePermission(q, member, userId, 'characters.manage');
      return true;
    } catch {
      return false;
    }
  }

  async function loadSpell(q: Queryable, campaignId: string, spellId: string, lock = false) {
    const row = (await q.query(`SELECT * FROM campaign_spells WHERE campaign_id=$1 AND id=$2${lock ? ' FOR UPDATE' : ''}`, [campaignId, spellId])).rows[0] as any;
    if (!row) reject(404, 'Заклинание не найдено.');
    return row;
  }

  async function view(q: Queryable, campaignId: string, spellId: string, userId: string, manager: boolean) {
    const spell = (await q.query(`SELECT ${SPELL_COLUMNS} FROM campaign_spells WHERE campaign_id=$1 AND id=$2`, [campaignId, spellId])).rows[0] as any;
    if (!spell) reject(404, 'Заклинание не найдено.');
    if (spell.status !== 'approved' && spell.createdBy !== userId && !manager) reject(404, 'Заклинание не найдено.');
    const revisions = (await q.query(
      `SELECT r.id, r.version, r.template, r.status, r.submitted_by AS "submittedBy", r.submitted_at AS "submittedAt", r.reviewed_by AS "reviewedBy",
              r.reviewed_at AS "reviewedAt", r.note, u.display_name AS "submittedByName"
       FROM campaign_spell_revisions r LEFT JOIN users u ON u.id = r.submitted_by
       WHERE r.campaign_id=$1 AND r.spell_id=$2 ORDER BY r.submitted_at DESC LIMIT 50`,
      [campaignId, spellId],
    )).rows as any[];
    const author = (await q.query('SELECT display_name AS name FROM users WHERE id=$1', [spell.createdBy])).rows[0]?.name ?? null;
    const proposal = revisions.find(entry => ['draft', 'pending', 'rework'].includes(entry.status) && (manager || entry.submittedBy === userId)) ?? null;
    return {
      spell: { ...spell, template: spell.template ? normalizeTemplate(spell.template) : null, authorName: author },
      proposal: proposal ? { ...proposal, template: normalizeTemplate(proposal.template) } : null,
      history: revisions.filter(entry => entry.status === 'applied' || entry.status === 'approved' || entry.status === 'rejected')
        .map(({ template: _template, ...rest }) => rest),
      canEdit: spell.createdBy === userId || manager,
      canReview: manager,
    };
  }

  app.post<{ Params: { campaignId: string }; Body: { description: string; higherLevel?: string; level?: number } }>(
    '/campaigns/:campaignId/spell-templates/suggest',
    {
      schema: {
        params: campaignParams,
        body: {
          type: 'object', required: ['description'], additionalProperties: false,
          properties: { description: { type: 'string', maxLength: 20000 }, higherLevel: { type: 'string', maxLength: 5000 }, level: { type: 'integer', minimum: 0, maximum: 9 } },
        },
      },
    },
    async request => {
      const userId = await auth(request);
      await membership(db, request.params.campaignId, userId);
      const { description, higherLevel, level } = request.body;
      return { suggestions: suggestTemplate({ description, higherLevel: higherLevel ?? '', level: level ?? 1 }) };
    },
  );

  app.get<{ Params: { campaignId: string } }>(
    '/campaigns/:campaignId/spell-templates/other-campaigns',
    { schema: { params: campaignParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      await membership(db, campaignId, userId);
      const rows = (await db.query(
        `SELECT c.id, c.name FROM campaigns c JOIN campaign_members m ON m.campaign_id = c.id AND m.user_id = $1
         WHERE c.id <> $2 AND (c.owner_user_id = $1 OR m.is_full_gm OR EXISTS (
           SELECT 1 FROM member_permissions p WHERE p.campaign_id = c.id AND p.user_id = $1 AND p.permission = 'characters.manage'))
         ORDER BY c.name`,
        [userId, campaignId],
      )).rows;
      return { campaigns: rows };
    },
  );

  app.post<{ Params: { campaignId: string }; Body: { template: Record<string, unknown>; suggestions?: Record<string, unknown> | null; submit?: boolean } }>(
    '/campaigns/:campaignId/spell-templates',
    { schema: { params: campaignParams, body: { type: 'object', required: ['template'], additionalProperties: false, properties: { template: templateBody, suggestions: suggestionsBody, submit: { type: 'boolean' } } } } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const t = normalizeTemplate(request.body.template);
      if (!t.passport.name) reject(400, 'Впишите название заклинания в поле «А1 Название».');
      const submit = request.body.submit === true;
      if (submit) assertReady(t, request.body.suggestions);
      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const manager = await isManager(q, member, userId);
        await cleanArt(q, campaignId, t);
        const status = submit ? (manager ? 'approved' : 'pending') : 'draft';
        const flat = flatColumns(t);
        const row = (await q.query(
          `INSERT INTO campaign_spells
             (campaign_id, created_by, name, level, school, casting_time, range, components, material, duration, concentration, ritual,
              classes, description, higher_level, status, reviewed_by, reviewed_at, template, suggestions)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20::jsonb)
           RETURNING id`,
          [
            campaignId, userId, flat.name, flat.level, flat.school, flat.casting_time, flat.range, flat.components, flat.material, flat.duration,
            flat.concentration, flat.ritual, flat.classes, flat.description, flat.higher_level, status,
            status === 'approved' ? userId : null, status === 'approved' ? new Date() : null,
            JSON.stringify(t), !submit && request.body.suggestions ? JSON.stringify(request.body.suggestions) : null,
          ],
        )).rows[0] as { id: string };
        if (status === 'approved') {
          await q.query(`INSERT INTO campaign_spell_revisions (campaign_id, spell_id, version, template, status, submitted_by, reviewed_by, reviewed_at) VALUES ($1,$2,1,$3::jsonb,'applied',$4,$4,now())`, [campaignId, row.id, JSON.stringify(t), userId]);
        }
        return view(q, campaignId, row.id, userId, manager);
      });
      return reply.code(201).send(result);
    },
  );

  app.get<{ Params: { campaignId: string; spellId: string } }>(
    '/campaigns/:campaignId/spell-templates/:spellId',
    { schema: { params: spellParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId, spellId } = request.params;
      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId);
        return view(q, campaignId, spellId, userId, await isManager(q, member, userId));
      });
    },
  );

  app.put<{ Params: { campaignId: string; spellId: string }; Body: { template: Record<string, unknown>; suggestions?: Record<string, unknown> | null; submit?: boolean } }>(
    '/campaigns/:campaignId/spell-templates/:spellId',
    { schema: { params: spellParams, body: { type: 'object', required: ['template'], additionalProperties: false, properties: { template: templateBody, suggestions: suggestionsBody, submit: { type: 'boolean' } } } } },
    async request => {
      const userId = await auth(request);
      const { campaignId, spellId } = request.params;
      const t = normalizeTemplate(request.body.template);
      if (!t.passport.name) reject(400, 'Впишите название заклинания в поле «А1 Название».');
      const submit = request.body.submit === true;
      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const manager = await isManager(q, member, userId);
        const spell = await loadSpell(q, campaignId, spellId, true);
        const author = spell.created_by === userId;
        if (!author && !manager) reject(403, 'Править заклинание может его автор или мастер.');
        await cleanArt(q, campaignId, t);
        const flat = flatColumns(t);
        const writeSpell = async (status: string, version: number, suggestions: unknown) => q.query(
          `UPDATE campaign_spells SET name=$3, level=$4, school=$5, casting_time=$6, range=$7, components=$8, material=$9, duration=$10,
             concentration=$11, ritual=$12, classes=$13, description=$14, higher_level=$15, status=$16, template=$17::jsonb,
             template_version=$18, suggestions=$19::jsonb, review_note = CASE WHEN $16 = 'approved' THEN NULL ELSE review_note END
           WHERE campaign_id=$1 AND id=$2`,
          [campaignId, spellId, flat.name, flat.level, flat.school, flat.casting_time, flat.range, flat.components, flat.material, flat.duration,
            flat.concentration, flat.ritual, flat.classes, flat.description, flat.higher_level, status, JSON.stringify(t), version, suggestions ? JSON.stringify(suggestions) : null],
        );
        if (spell.status === 'approved') {
          if (manager) {
            assertReady(t, request.body.suggestions);
            const version = Number(spell.template_version ?? 1) + 1;
            await writeSpell('approved', version, null);
            await q.query(`INSERT INTO campaign_spell_revisions (campaign_id, spell_id, version, template, status, submitted_by, reviewed_by, reviewed_at) VALUES ($1,$2,$3,$4::jsonb,'applied',$5,$5,now())`, [campaignId, spellId, version, JSON.stringify(t), userId]);
          } else {
            if (submit) assertReady(t, request.body.suggestions);
            const open = (await q.query(`SELECT id FROM campaign_spell_revisions WHERE campaign_id=$1 AND spell_id=$2 AND status IN ('draft','pending','rework') AND submitted_by=$3 ORDER BY submitted_at DESC LIMIT 1 FOR UPDATE`, [campaignId, spellId, userId])).rows[0] as { id: string } | undefined;
            const status = submit ? 'pending' : 'draft';
            if (open) await q.query(`UPDATE campaign_spell_revisions SET template=$2::jsonb, status=$3, submitted_at=now(), note=CASE WHEN $3 = 'pending' THEN NULL ELSE note END WHERE id=$1`, [open.id, JSON.stringify(t), status]);
            else await q.query(`INSERT INTO campaign_spell_revisions (campaign_id, spell_id, version, template, status, submitted_by) VALUES ($1,$2,$3,$4::jsonb,$5,$6)`, [campaignId, spellId, Number(spell.template_version ?? 1) + 1, JSON.stringify(t), status, userId]);
          }
        } else {
          if (submit) assertReady(t, request.body.suggestions);
          const status = submit ? (manager ? 'approved' : 'pending') : spell.status === 'pending' && !manager ? 'pending' : spell.status === 'approved' ? 'approved' : spell.status === 'draft' ? 'draft' : spell.status;
          await writeSpell(status, Number(spell.template_version ?? 1), submit ? null : request.body.suggestions);
          if (status === 'approved') {
            await q.query('UPDATE campaign_spells SET reviewed_by=$3, reviewed_at=now() WHERE campaign_id=$1 AND id=$2', [campaignId, spellId, userId]);
            await q.query(`INSERT INTO campaign_spell_revisions (campaign_id, spell_id, version, template, status, submitted_by, reviewed_by, reviewed_at) VALUES ($1,$2,$3,$4::jsonb,'applied',$5,$5,now())`, [campaignId, spellId, Number(spell.template_version ?? 1), JSON.stringify(t), userId]);
          }
        }
        return view(q, campaignId, spellId, userId, manager);
      });
    },
  );

  app.post<{ Params: { campaignId: string; spellId: string }; Body: { decision: 'approve' | 'rework' | 'reject'; note?: string; template?: Record<string, unknown> } }>(
    '/campaigns/:campaignId/spell-templates/:spellId/review',
    {
      schema: {
        params: spellParams,
        body: {
          type: 'object', required: ['decision'], additionalProperties: false,
          properties: { decision: { type: 'string', enum: ['approve', 'rework', 'reject'] }, note: { type: 'string', maxLength: 2000 }, template: templateBody },
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, spellId } = request.params;
      const { decision, note } = request.body;
      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await requirePermission(q, member, userId, 'characters.manage');
        const spell = await loadSpell(q, campaignId, spellId, true);
        const edited = request.body.template ? await cleanArt(q, campaignId, normalizeTemplate(request.body.template)) : null;
        if (spell.status === 'pending' || spell.status === 'rework' || spell.status === 'rejected' || spell.status === 'draft') {
          if (decision === 'approve') {
            const t = edited ?? normalizeTemplate(spell.template ?? {});
            assertReady(t, null);
            const flat = flatColumns(t);
            await q.query(
              `UPDATE campaign_spells SET status='approved', reviewed_by=$3, reviewed_at=now(), review_note=$4, template=$5::jsonb, suggestions=NULL,
                 name=$6, level=$7, school=$8, description=$9, concentration=$10, ritual=$11, casting_time=$12, range=$13, duration=$14, components=$15
               WHERE campaign_id=$1 AND id=$2`,
              [campaignId, spellId, userId, note ?? null, JSON.stringify(t), flat.name, flat.level, flat.school, flat.description, flat.concentration, flat.ritual, flat.casting_time, flat.range, flat.duration, flat.components],
            );
            await q.query(`INSERT INTO campaign_spell_revisions (campaign_id, spell_id, version, template, status, submitted_by, reviewed_by, reviewed_at, note) VALUES ($1,$2,$3,$4::jsonb,'approved',$5,$6,now(),$7)`, [campaignId, spellId, Number(spell.template_version ?? 1), JSON.stringify(t), spell.created_by, userId, note ?? (edited ? 'принято с правками мастера' : null)]);
          } else {
            await q.query(`UPDATE campaign_spells SET status=$3, reviewed_by=$4, reviewed_at=now(), review_note=$5 WHERE campaign_id=$1 AND id=$2`, [campaignId, spellId, decision === 'rework' ? 'rework' : 'rejected', userId, note ?? null]);
          }
          return view(q, campaignId, spellId, userId, true);
        }
        const proposal = (await q.query(`SELECT * FROM campaign_spell_revisions WHERE campaign_id=$1 AND spell_id=$2 AND status='pending' ORDER BY submitted_at DESC LIMIT 1 FOR UPDATE`, [campaignId, spellId])).rows[0] as any;
        if (!proposal) reject(400, 'Рассматривать нечего: новых версий нет.');
        if (decision === 'approve') {
          const t = edited ?? normalizeTemplate(proposal.template);
          assertReady(t, null);
          const version = Number(spell.template_version ?? 1) + 1;
          const flat = flatColumns(t);
          await q.query(
            `UPDATE campaign_spells SET template=$3::jsonb, template_version=$4, reviewed_by=$5, reviewed_at=now(), review_note=NULL,
               name=$6, level=$7, school=$8, description=$9, concentration=$10, ritual=$11, casting_time=$12, range=$13, duration=$14, components=$15
             WHERE campaign_id=$1 AND id=$2`,
            [campaignId, spellId, JSON.stringify(t), version, userId, flat.name, flat.level, flat.school, flat.description, flat.concentration, flat.ritual, flat.casting_time, flat.range, flat.duration, flat.components],
          );
          await q.query(`UPDATE campaign_spell_revisions SET status='approved', version=$2, template=$3::jsonb, reviewed_by=$4, reviewed_at=now(), note=$5 WHERE id=$1`, [proposal.id, version, JSON.stringify(t), userId, note ?? (edited ? 'принято с правками мастера' : null)]);
        } else {
          await q.query(`UPDATE campaign_spell_revisions SET status=$2, reviewed_by=$3, reviewed_at=now(), note=$4 WHERE id=$1`, [proposal.id, decision === 'rework' ? 'rework' : 'rejected', userId, note ?? null]);
        }
        return view(q, campaignId, spellId, userId, true);
      });
    },
  );

  app.post<{ Params: { campaignId: string; spellId: string }; Body: { campaignIds: string[] } }>(
    '/campaigns/:campaignId/spell-templates/:spellId/apply',
    { schema: { params: spellParams, body: { type: 'object', required: ['campaignIds'], additionalProperties: false, properties: { campaignIds: { type: 'array', maxItems: 50, items: uuid } } } } },
    async request => {
      const userId = await auth(request);
      const { campaignId, spellId } = request.params;
      const written: string[] = [];
      try {
        return await db.transaction(async q => {
          const member = await membership(q, campaignId, userId);
          await requirePermission(q, member, userId, 'characters.manage');
          const spell = await loadSpell(q, campaignId, spellId);
          if (spell.status !== 'approved' || !spell.template) reject(400, 'Применить можно принятое заклинание с шаблоном.');
          const t = normalizeTemplate(spell.template);
          const flat = flatColumns(t);
          const origin = spell.origin_spell_id ?? spell.id;
          const applied: Array<{ campaignId: string; spellId: string; created: boolean }> = [];
          for (const targetId of [...new Set(request.body.campaignIds)].filter(id => id !== campaignId)) {
            const there = await membership(q, targetId, userId, true);
            await requirePermission(q, there, userId, 'characters.manage');
            const copy = (await q.query('SELECT id, template_version FROM campaign_spells WHERE campaign_id=$1 AND (origin_spell_id=$2 OR id=$2) LIMIT 1 FOR UPDATE', [targetId, origin])).rows[0] as any;
            const copied: SpellTemplate = { ...t, passport: { ...t.passport, art: await copyArt(q, campaignId, targetId, t.passport.art, userId, written) } };
            if (copy) {
              await q.query(
                `UPDATE campaign_spells SET template=$3::jsonb, template_version=template_version+1, status='approved', reviewed_by=$4, reviewed_at=now(),
                   name=$5, level=$6, school=$7, description=$8, concentration=$9, ritual=$10, casting_time=$11, range=$12, duration=$13, components=$14
                 WHERE campaign_id=$1 AND id=$2`,
                [targetId, copy.id, JSON.stringify(copied), userId, flat.name, flat.level, flat.school, flat.description, flat.concentration, flat.ritual, flat.casting_time, flat.range, flat.duration, flat.components],
              );
              applied.push({ campaignId: targetId, spellId: copy.id, created: false });
            } else {
              const row = (await q.query(
                `INSERT INTO campaign_spells
                   (campaign_id, created_by, name, level, school, casting_time, range, components, material, duration, concentration, ritual,
                    classes, description, higher_level, status, reviewed_by, reviewed_at, template, origin_spell_id)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'approved',$2,now(),$16::jsonb,$17) RETURNING id`,
                [targetId, userId, flat.name, flat.level, flat.school, flat.casting_time, flat.range, flat.components, flat.material, flat.duration,
                  flat.concentration, flat.ritual, flat.classes, flat.description, flat.higher_level, JSON.stringify(copied), origin],
              )).rows[0] as { id: string };
              applied.push({ campaignId: targetId, spellId: row.id, created: true });
            }
          }
          return { applied };
        });
      } catch (cause) {
        for (const key of written) await unlink(path.join(ASSETS_DIR, key)).catch(() => {});
        throw cause;
      }
    },
  );

  app.patch<{ Params: { campaignId: string; spellId: string }; Body: { notify: boolean } }>(
    '/campaigns/:campaignId/spell-templates/:spellId/special',
    { schema: { params: spellParams, body: { type: 'object', required: ['notify'], additionalProperties: false, properties: { notify: { type: 'boolean' } } } } },
    async request => {
      const userId = await auth(request);
      const { campaignId, spellId } = request.params;
      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await requirePermission(q, member, userId, 'characters.manage');
        await loadSpell(q, campaignId, spellId, true);
        await q.query('UPDATE campaign_spells SET special_notify=$3 WHERE campaign_id=$1 AND id=$2', [campaignId, spellId, request.body.notify]);
        return { specialNotify: request.body.notify };
      });
    },
  );

  async function srdView(q: Queryable, campaignId: string, index: string, manager: boolean) {
    const base = srdTemplateOf(index);
    if (!base) reject(404, 'Заклинание SRD не найдено.');
    const row = (await q.query('SELECT template, template_version, special_notify, updated_at FROM campaign_srd_templates WHERE campaign_id=$1 AND srd_index=$2', [campaignId, index])).rows[0] as any;
    return {
      index,
      template: row ? normalizeTemplate(row.template) : base,
      overridden: Boolean(row),
      templateVersion: row ? Number(row.template_version) : 1,
      specialNotify: row ? row.special_notify !== false : true,
      updatedAt: row?.updated_at ?? null,
      canEdit: manager,
    };
  }

  app.get<{ Params: { campaignId: string } }>(
    '/campaigns/:campaignId/srd-templates',
    { schema: { params: campaignParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      await membership(db, campaignId, userId);
      const rows = (await db.query('SELECT srd_index AS index, template_version AS "templateVersion", updated_at AS "updatedAt" FROM campaign_srd_templates WHERE campaign_id=$1 ORDER BY srd_index', [campaignId])).rows;
      return { overrides: rows };
    },
  );

  app.get<{ Params: { campaignId: string; index: string } }>(
    '/campaigns/:campaignId/srd-templates/:index',
    { schema: { params: srdParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId, index } = request.params;
      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId);
        return srdView(q, campaignId, index, await isManager(q, member, userId));
      });
    },
  );

  app.put<{ Params: { campaignId: string; index: string }; Body: { template: Record<string, unknown> } }>(
    '/campaigns/:campaignId/srd-templates/:index',
    { schema: { params: srdParams, body: { type: 'object', required: ['template'], additionalProperties: false, properties: { template: templateBody } } } },
    async request => {
      const userId = await auth(request);
      const { campaignId, index } = request.params;
      if (!srdTemplateOf(index)) reject(404, 'Заклинание SRD не найдено.');
      const t = normalizeTemplate(request.body.template);
      t.origin = { srd: index, reviewed: true };
      assertReady(t, null);
      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await requirePermission(q, member, userId, 'characters.manage');
        await cleanArt(q, campaignId, t);
        await q.query(
          `INSERT INTO campaign_srd_templates (campaign_id, srd_index, template, updated_by) VALUES ($1,$2,$3::jsonb,$4)
           ON CONFLICT (campaign_id, srd_index) DO UPDATE SET template=EXCLUDED.template, template_version=campaign_srd_templates.template_version+1,
             updated_by=EXCLUDED.updated_by, updated_at=now()`,
          [campaignId, index, JSON.stringify(t), userId],
        );
        return srdView(q, campaignId, index, true);
      });
    },
  );

  app.delete<{ Params: { campaignId: string; index: string } }>(
    '/campaigns/:campaignId/srd-templates/:index',
    { schema: { params: srdParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId, index } = request.params;
      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await requirePermission(q, member, userId, 'characters.manage');
        await q.query('DELETE FROM campaign_srd_templates WHERE campaign_id=$1 AND srd_index=$2', [campaignId, index]);
        return srdView(q, campaignId, index, true);
      });
    },
  );

  app.patch<{ Params: { campaignId: string; index: string }; Body: { notify: boolean } }>(
    '/campaigns/:campaignId/srd-templates/:index/special',
    { schema: { params: srdParams, body: { type: 'object', required: ['notify'], additionalProperties: false, properties: { notify: { type: 'boolean' } } } } },
    async request => {
      const userId = await auth(request);
      const { campaignId, index } = request.params;
      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await requirePermission(q, member, userId, 'characters.manage');
        const changed = (await q.query('UPDATE campaign_srd_templates SET special_notify=$3 WHERE campaign_id=$1 AND srd_index=$2 RETURNING srd_index', [campaignId, index, request.body.notify])).rows.length;
        if (!changed) reject(400, 'У этого заклинания нет правки кампании.');
        return { specialNotify: request.body.notify };
      });
    },
  );
};
