import { findSrdSpell, srdSpellRuFields } from '../rules/srd-data.ts';
import { mergeSpellMechanics } from '../../../../packages/domain/spells/spell-mechanics.ts';
import { aimedSpellArea } from '../../../../packages/domain/map/area-placement.ts';
import { DAMAGE_TYPES, describeTemplate, normalizeTemplate } from '../../../../packages/domain/spells/spell-template.ts';
import { templateCastPlan } from '../../../../packages/domain/spells/spell-template-engine.ts';

import { characterAccessLevel, requireCharacterAccess } from '../characters/sheet/access.ts';
import { characterParams, type CharacterParams, reject, uuid } from '../characters/sheet/shared.ts';
import { loadVisibleSet } from '../characters/sheet/visibility.ts';
import { customSpellColumns } from './campaign-spells.ts';
import { MECHANICS_COLUMNS, srdEffective, textMechanics } from './mechanics.ts';
import type { RouteContext } from '../system/route-context.ts';

type CharacterSpellParams = CharacterParams & { spellId: string };

export const characterSpellParams = {
  type: 'object', required: ['campaignId', 'characterId', 'spellId'], additionalProperties: false,
  properties: { campaignId: uuid, characterId: uuid, spellId: uuid },
};

export function resolveCharacterSpell(row: any, customByI: Map<string, any>) {
  const flags = { granted: row.granted === true, slotless: row.slotless === true };
  if (row.source === 'srd') {
    const spell = findSrdSpell(row.srd_index);
    return {
      id: row.id, source: 'srd', prepared: row.prepared, ...flags,
      srdIndex: row.srd_index, customSpellId: null,
      spell: spell ?? null,
    };
  }
  return {
    id: row.id, source: 'custom', prepared: row.prepared, ...flags,
    srdIndex: null, customSpellId: row.custom_spell_id,
    spell: customByI.get(row.custom_spell_id) ?? null,
  };
}

export function registerCharacterSpellRoutes(ctx: RouteContext) {
  const { app, auth, db, membership } = ctx;

  app.get<{ Params: CharacterParams }>(
    '/campaigns/:campaignId/characters/:characterId/spells',
    { schema: { params: characterParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;

      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId);
        const privileged = await characterAccessLevel(ctx, q, campaignId, characterId, userId, member);

        const allRows = (
          await q.query(
            `SELECT id, source, srd_index, custom_spell_id, prepared, granted, slotless
             FROM character_spells WHERE campaign_id=$1 AND character_id=$2`,
            [campaignId, characterId],
          )
        ).rows;
        const hidden = privileged ? null : await loadVisibleSet(q, campaignId, characterId, 'spell', userId);
        const rows = allRows.filter(r => !hidden?.has(`spell:${r.id}`));

        const customIds = rows.filter(r => r.source === 'custom').map(r => r.custom_spell_id);
        const customRows = customIds.length
          ? (await q.query(
              `SELECT ${customSpellColumns} FROM campaign_spells WHERE campaign_id=$1 AND id = ANY($2::uuid[])`,
              [campaignId, customIds],
            )).rows
          : [];
        const customById = new Map(customRows.map(r => [r.id, r]));
        const characterLevel = Number((await q.query('SELECT level FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0]?.level ?? 1);

        const srdIndices = rows.filter(r => r.source === 'srd').map(r => r.srd_index);
        const mechanicsRows = srdIndices.length
          ? (await q.query(
              `SELECT srd_index, damage_formula, healing_formula, upcast_formula, ${MECHANICS_COLUMNS.join(', ')}
               FROM srd_spell_mechanics WHERE srd_index = ANY($1::text[])`,
              [srdIndices],
            )).rows
          : [];
        const mechanicsByIndex = new Map(mechanicsRows.map(r => [r.srd_index, r]));
        const overrideRows = srdIndices.length
          ? (await q.query('SELECT srd_index, template FROM campaign_srd_templates WHERE campaign_id=$1 AND srd_index = ANY($2::text[])', [campaignId, srdIndices])).rows
          : [];
        const overrideByIndex = new Map(overrideRows.map(r => [r.srd_index as string, r.template]));
        const planView = (template: unknown) => {
          const t = normalizeTemplate(template);
          const plan = templateCastPlan(t, { slotLevel: t.passport.level, characterLevel, mode: null });
          const damageParam = t.options.params.find(param => param.kind === 'damage-type');
          return {
            mechanics: plan.mechanics,
            area: plan.area,
            riders: plan.riders.map(rider => rider.kind),
            projectiles: plan.projectiles,
            targetLimit: plan.targetLimit,
            singleTarget: plan.single,
            needsTarget: plan.needsTarget,
            teleport: plan.teleportFeet ? { rangeFeet: plan.teleportFeet } : null,
            element: damageParam ? (damageParam.options.length ? damageParam.options : DAMAGE_TYPES.map(([key]) => key)) : null,
            modes: t.options.modes.map(mode => ({ id: mode.id, name: mode.name })),
            summary: describeTemplate(t),
            manual: plan.manual,
            art: t.passport.art || null,
            templated: true,
          };
        };

        const spells = rows.map(row => {
          const resolved = resolveCharacterSpell(row, customById);
          if (resolved.source === 'srd' && resolved.spell) {
            const m = mechanicsByIndex.get(row.srd_index);
            return {
              ...resolved,
              spell: {
                ...resolved.spell,
                ...srdSpellRuFields(row.srd_index),
                damageFormula: m?.damage_formula ?? null, healingFormula: m?.healing_formula ?? null,
                upcastFormula: m?.upcast_formula ?? null,
                mechanics: srdEffective(resolved.spell, m),
                ...textMechanics(resolved.spell),
                ...(overrideByIndex.has(row.srd_index) ? { ...planView(overrideByIndex.get(row.srd_index)), summon: null, shape: null } : {}),
              },
            };
          }
          if (resolved.source === 'custom' && resolved.spell && (resolved.spell as any).template) {
            const custom: any = resolved.spell;
            return { ...resolved, spell: { ...custom, ...planView(custom.template) } };
          }
          if (resolved.source === 'custom' && resolved.spell) {
            const custom: any = resolved.spell;
            return {
              ...resolved,
              spell: {
                ...custom,
                area: aimedSpellArea({ desc: custom.description, range: custom.range }, { attack: Boolean(custom.attackKind), single: false, riders: [] }),
                mechanics: mergeSpellMechanics(null, {
                  damage_formula: custom.damageFormula, healing_formula: custom.healingFormula, upcast_formula: custom.upcastFormula,
                  attack_kind: custom.attackKind, save_ability: custom.saveAbility, half_on_save: custom.halfOnSave,
                  damage_type: custom.damageType, condition_code: custom.conditionCode, condition_rounds: custom.conditionRounds,
                  condition_repeat: custom.conditionRepeat, creates_zone: custom.createsZone,
                }),
              },
            };
          }
          return resolved;
        });

        return { spells };
      });
    },
  );

  app.post<{
    Params: CharacterParams;
    Body: { source: 'srd' | 'custom'; srdIndex?: string; customSpellId?: string; prepared?: boolean };
  }>(
    '/campaigns/:campaignId/characters/:characterId/spells',
    {
      schema: {
        params: characterParams,
        body: {
          type: 'object', required: ['source'], additionalProperties: false,
          properties: {
            source: { type: 'string', enum: ['srd', 'custom'] },
            srdIndex: { type: 'string', minLength: 1, maxLength: 100 },
            customSpellId: uuid,
            prepared: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const { source, srdIndex, customSpellId, prepared } = request.body;

      if (source === 'srd' && !srdIndex) reject(400, 'Укажите srdIndex.');
      if (source === 'custom' && !customSpellId) reject(400, 'Укажите customSpellId.');
      if (source === 'srd' && srdIndex && !findSrdSpell(srdIndex)) reject(404, 'Заклинание SRD не найдено.');

      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await requireCharacterAccess(ctx, q, campaignId, characterId, userId, member);

        if (source === 'custom') {
          const spell = (
            await q.query(
              'SELECT status, created_by FROM campaign_spells WHERE campaign_id=$1 AND id=$2',
              [campaignId, customSpellId],
            )
          ).rows[0];
          if (!spell) reject(404, 'Заклинание не найдено.');
          if (spell.status !== 'approved' && spell.created_by !== userId) {
            reject(403, 'Это заклинание ещё не одобрено мастером.');
          }
        }

        const existing = (
          await q.query(
            source === 'srd'
              ? 'SELECT id FROM character_spells WHERE character_id=$1 AND source=\'srd\' AND srd_index=$2'
              : 'SELECT id FROM character_spells WHERE character_id=$1 AND source=\'custom\' AND custom_spell_id=$2',
            [characterId, source === 'srd' ? srdIndex : customSpellId],
          )
        ).rows[0];
        if (existing) return { id: existing.id, alreadyKnown: true };

        const inserted = await q.query(
          `INSERT INTO character_spells (campaign_id, character_id, source, srd_index, custom_spell_id, prepared)
           VALUES ($1,$2,$3,$4,$5,$6)
           RETURNING id`,
          [campaignId, characterId, source, source === 'srd' ? srdIndex : null, source === 'custom' ? customSpellId : null, prepared ?? true],
        );

        return { id: inserted.rows[0].id, alreadyKnown: false };
      });

      return reply.code(201).send(result);
    },
  );

  app.patch<{ Params: CharacterSpellParams; Body: { prepared: boolean } }>(
    '/campaigns/:campaignId/characters/:characterId/spells/:spellId',
    {
      schema: {
        params: characterSpellParams,
        body: { type: 'object', required: ['prepared'], additionalProperties: false, properties: { prepared: { type: 'boolean' } } },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId, spellId } = request.params;
      const { prepared } = request.body;

      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await requireCharacterAccess(ctx, q, campaignId, characterId, userId, member);

        const granted = (await q.query('SELECT granted FROM character_spells WHERE campaign_id=$1 AND character_id=$2 AND id=$3', [campaignId, characterId, spellId])).rows[0];
        if (granted?.granted && !prepared) reject(400, 'Дарованное заклинание подготовлено всегда.');
        const { rows } = await q.query(
          `UPDATE character_spells SET prepared=$1
           WHERE campaign_id=$2 AND character_id=$3 AND id=$4
           RETURNING id, source, srd_index, custom_spell_id, prepared, granted, slotless`,
          [prepared, campaignId, characterId, spellId],
        );

        if (!rows[0]) reject(404, 'Заклинание персонажа не найдено.');
        return rows[0];
      });
    },
  );

  app.delete<{ Params: CharacterSpellParams }>(
    '/campaigns/:campaignId/characters/:characterId/spells/:spellId',
    { schema: { params: characterSpellParams } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, characterId, spellId } = request.params;

      await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await requireCharacterAccess(ctx, q, campaignId, characterId, userId, member);

        await q.query(
          'DELETE FROM character_spells WHERE campaign_id=$1 AND character_id=$2 AND id=$3',
          [campaignId, characterId, spellId],
        );
      });

      return reply.code(204).send();
    },
  );
}
