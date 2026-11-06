import type { Queryable } from '../../db.ts';
import { bumpScene, objectSchema, reject, sceneParams, uuid, type SceneFeatureContext } from '../scene-feature.ts';
import { inAreaAt, type Area, type AreaShape } from '../../../../../packages/domain/map/areas.ts';
import { footprintCells, occupiedCells } from '../../../../../packages/domain/map/footprint.ts';
import type { Cover } from '../../../../../packages/domain/combat/targeting.ts';

type TemplateParams = { campaignId: string; sceneId: string; templateId: string };

type PlacementView = {
  id: string;
  character_id: string;
  kind: 'character' | 'npc' | 'object';
  name: string;
  size: string;
  world_x: number;
  world_z: number;
  altitude_feet?: number;
};

export type TemplateContext = SceneFeatureContext & {
  loadPlacements: (q: Queryable, campaignId: string, sceneId: string) => Promise<PlacementView[]>;
  rollSaveAgainst: (
    q: Queryable, campaignId: string, userId: string, characterId: string, ability: string, dc: number, label: string, hidden: boolean,
    bonus?: { value: number; reason: string } | null, disadvantages?: string[],
    against?: { condition?: string | null; magic?: boolean; damageType?: string | null } | null,
  ) => Promise<{ total: number; roll: any; autoFail: boolean; success: boolean }>;
  addCondition: (q: Queryable, campaignId: string, characterId: string, code: string, parameters?: Record<string, unknown>) => Promise<boolean>;
  areaCovers: (q: Queryable, campaignId: string, scene: any, origin: { x: number; z: number }) => Promise<Map<string, Cover>>;
  areaCoverBonus: (cover: Cover | undefined, ability: string) => { value: number; reason: string } | null;
};

const EFFECT_CODES = [
  'blinded', 'charmed', 'deafened', 'frightened', 'grappled', 'incapacitated', 'invisible',
  'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious',
];

const SHAPES: AreaShape[] = ['circle', 'cone', 'square', 'line'];
const ABILITIES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'] as const;
const ABILITY_SHORT: Record<string, string> = {
  strength: 'СИЛ', dexterity: 'ЛОВ', constitution: 'ТЕЛ', intelligence: 'ИНТ', wisdom: 'МДР', charisma: 'ХАР',
};
const MAX_TEMPLATES = 30;

export async function loadTemplates(q: Queryable, campaignId: string, sceneId: string) {
  return (
    await q.query(
      `SELECT t.id, t.shape, t.x, t.z, t.direction, t.size_feet::float8 AS size_feet,
              t.width_feet::float8 AS width_feet, t.color, t.label, t.created_by, u.display_name AS author_name
       FROM scene_templates t
       JOIN users u ON u.id = t.created_by
       WHERE t.campaign_id=$1 AND t.scene_id=$2
       ORDER BY t.created_at, t.id`,
      [campaignId, sceneId],
    )
  ).rows;
}

export function areaOf(template: any, feetPerUnit: number): Area {
  return {
    shape: template.shape,
    x: Number(template.x),
    z: Number(template.z),
    direction: Number(template.direction),
    size: Number(template.size_feet) / feetPerUnit,
    width: (Number(template.width_feet ?? 5)) / feetPerUnit,
  };
}

export function touches(area: Area, scene: any, placement: { world_x: number; world_z: number; size: string; altitude_feet?: number }) {
  const up = Number(placement.altitude_feet ?? 0) / Number(scene.feet_per_unit || 5);
  return occupiedCells(scene, placement.world_x, placement.world_z, footprintCells(placement.size)).some(cell =>
    inAreaAt(area, cell.col - scene.width_cells / 2 + 0.5, cell.row - scene.height_cells / 2 + 0.5, up));
}

export function registerTemplateRoutes(ctx: TemplateContext) {
  const { app, db, auth, membership, canManage, getScene, notify, notifyCampaign, loadPlacements, rollSaveAgainst, addCondition, areaCovers, areaCoverBonus } = ctx;
  const templateParams = objectSchema({ campaignId: uuid, sceneId: uuid, templateId: uuid });

  app.post<{
    Params: { campaignId: string; sceneId: string };
    Body: { shape: AreaShape; x: number; z: number; direction?: number; sizeFeet: number; widthFeet?: number; color?: string; label?: string };
  }>(
    '/campaigns/:campaignId/scenes/:sceneId/templates',
    {
      schema: {
        params: sceneParams,
        body: objectSchema({
          shape: { type: 'string', enum: SHAPES },
          x: { type: 'number', minimum: -1000, maximum: 1000 },
          z: { type: 'number', minimum: -1000, maximum: 1000 },
          direction: { type: 'number', minimum: 0, exclusiveMaximum: 360 },
          sizeFeet: { type: 'number', exclusiveMinimum: 0, maximum: 1000 },
          widthFeet: { type: 'number', exclusiveMinimum: 0, maximum: 100 },
          color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
          label: { type: 'string', maxLength: 100 },
        }, ['shape', 'x', 'z', 'sizeFeet']),
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, sceneId } = request.params;
      const body = request.body;

      const created = await db.transaction(async q => {
        await membership(q, campaignId, userId, true);
        await getScene(q, campaignId, sceneId, true);

        const count = (await q.query('SELECT count(*)::int AS n FROM scene_templates WHERE campaign_id=$1 AND scene_id=$2', [campaignId, sceneId])).rows[0].n;
        if (count >= MAX_TEMPLATES) reject(400, `На сцене уже ${MAX_TEMPLATES} шаблонов — уберите ненужные.`);

        const id = (
          await q.query(
            `INSERT INTO scene_templates (campaign_id, scene_id, shape, x, z, direction, size_feet, width_feet, color, label, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
            [
              campaignId, sceneId, body.shape, body.x, body.z, body.direction ?? 0, body.sizeFeet,
              body.shape === 'line' ? body.widthFeet ?? 5 : null,
              (body.color ?? '#e8835a').toLowerCase(), body.label?.trim() || null, userId,
            ],
          )
        ).rows[0].id;

        await bumpScene(q, sceneId);
        return (await loadTemplates(q, campaignId, sceneId)).find(template => template.id === id);
      });

      void notify(campaignId, sceneId);
      return reply.code(201).send(created);
    },
  );

  app.patch<{
    Params: TemplateParams;
    Body: { x?: number; z?: number; direction?: number; sizeFeet?: number; widthFeet?: number; color?: string; label?: string | null; shape?: AreaShape };
  }>(
    '/campaigns/:campaignId/scenes/:sceneId/templates/:templateId',
    {
      schema: {
        params: templateParams,
        body: {
          ...objectSchema({
            shape: { type: 'string', enum: SHAPES },
            x: { type: 'number', minimum: -1000, maximum: 1000 },
            z: { type: 'number', minimum: -1000, maximum: 1000 },
            direction: { type: 'number', minimum: 0, exclusiveMaximum: 360 },
            sizeFeet: { type: 'number', exclusiveMinimum: 0, maximum: 1000 },
            widthFeet: { type: 'number', exclusiveMinimum: 0, maximum: 100 },
            color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
            label: { type: ['string', 'null'], maxLength: 100 },
          }, []),
          minProperties: 1,
        },
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, sceneId, templateId } = request.params;
      const body = request.body;

      const updated = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await getScene(q, campaignId, sceneId, true);
        const template = (
          await q.query('SELECT * FROM scene_templates WHERE campaign_id=$1 AND scene_id=$2 AND id=$3 FOR UPDATE', [campaignId, sceneId, templateId])
        ).rows[0];
        if (!template) reject(404, 'Шаблона нет.');
        if (template.created_by !== userId && !(await canManage(q, member, userId))) reject(403, 'Менять чужой шаблон может мастер.');

        const shape = body.shape ?? template.shape;
        const width = shape === 'line' ? body.widthFeet ?? (template.width_feet === null ? 5 : Number(template.width_feet)) : null;
        await q.query(
          `UPDATE scene_templates SET shape=$2, x=$3, z=$4, direction=$5, size_feet=$6, width_feet=$7, color=$8, label=$9 WHERE id=$1`,
          [
            templateId, shape, body.x ?? template.x, body.z ?? template.z,
            shape === 'circle' ? 0 : body.direction ?? template.direction,
            body.sizeFeet ?? template.size_feet, width,
            body.color ? body.color.toLowerCase() : template.color,
            body.label === undefined ? template.label : body.label?.trim() || null,
          ],
        );
        await bumpScene(q, sceneId);
        return (await loadTemplates(q, campaignId, sceneId)).find(entry => entry.id === templateId);
      });

      void notify(campaignId, sceneId);
      return reply.send(updated);
    },
  );

  app.delete<{ Params: TemplateParams }>(
    '/campaigns/:campaignId/scenes/:sceneId/templates/:templateId',
    { schema: { params: templateParams } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, sceneId, templateId } = request.params;

      await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await getScene(q, campaignId, sceneId, true);
        const template = (
          await q.query('SELECT created_by FROM scene_templates WHERE campaign_id=$1 AND scene_id=$2 AND id=$3', [campaignId, sceneId, templateId])
        ).rows[0];
        if (!template) reject(404, 'Шаблона нет.');
        if (template.created_by !== userId && !(await canManage(q, member, userId))) reject(403, 'Убрать чужой шаблон может мастер.');
        await q.query('DELETE FROM scene_templates WHERE id=$1', [templateId]);
        await bumpScene(q, sceneId);
      });

      void notify(campaignId, sceneId);
      return reply.code(204).send();
    },
  );

  app.post<{
    Params: TemplateParams;
    Body: {
      ability: string; dc: number; hidden?: boolean;
      effect?: { code: string; durationRounds?: number; repeatSave?: 'end' | 'start' };
    };
  }>(
    '/campaigns/:campaignId/scenes/:sceneId/templates/:templateId/saves',
    {
      schema: {
        params: templateParams,
        body: objectSchema({
          ability: { type: 'string', enum: [...ABILITIES] },
          dc: { type: 'integer', minimum: 1, maximum: 40 },
          hidden: { type: 'boolean' },
          effect: objectSchema({
            code: { type: 'string', enum: EFFECT_CODES },
            durationRounds: { type: 'integer', minimum: 1, maximum: 1000 },
            repeatSave: { type: 'string', enum: ['end', 'start'] },
          }, ['code']),
        }, ['ability', 'dc']),
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, sceneId, templateId } = request.params;
      const { ability, dc, hidden, effect } = request.body;

      const results = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        if (!(await canManage(q, member, userId))) reject(403, 'Спасброски по области бросает мастер.');
        const scene = await getScene(q, campaignId, sceneId, true);
        const template = (
          await q.query('SELECT * FROM scene_templates WHERE campaign_id=$1 AND scene_id=$2 AND id=$3', [campaignId, sceneId, templateId])
        ).rows[0];
        if (!template) reject(404, 'Шаблона нет.');

        const area = areaOf(template, scene.feet_per_unit);
        const covers = await areaCovers(q, campaignId, scene, { x: area.x, z: area.z });
        const affected = (await loadPlacements(q, campaignId, sceneId))
          .filter(placement => placement.kind !== 'object' && touches(area, scene, placement) && covers.get(placement.character_id) !== 'total');

        const list: Array<{
          characterId: string; name: string; total: number; success: boolean; autoFail: boolean; rollId: string; conditionApplied: boolean; cover?: Cover;
        }> = [];
        for (const placement of affected) {
          const label = `Спасбросок ${ABILITY_SHORT[ability]} (СЛ ${dc})${template.label ? `, ${template.label}` : ''} — ${placement.name}`;
          const cover = covers.get(placement.character_id);
          const bonus = areaCoverBonus(cover, ability);
          const save = await rollSaveAgainst(q, campaignId, userId, placement.character_id, ability, dc, label, hidden ?? false, bonus, [], { condition: effect?.code ?? null });
          let conditionApplied = false;
          if (effect && !save.success) {
            await addCondition(q, campaignId, placement.character_id, effect.code, {
              source: 'apply',
              ...(template.label ? { sourceName: template.label } : {}),
              ...(effect.durationRounds ? { remainingRounds: effect.durationRounds, durationRounds: effect.durationRounds } : {}),
              ...(effect.repeatSave ? { repeatSave: effect.repeatSave, save: { ability, dc } } : {}),
            });
            conditionApplied = true;
          }
          list.push({
            characterId: placement.character_id, name: placement.name, total: save.total, success: save.success,
            autoFail: save.autoFail, rollId: save.roll.id, conditionApplied, ...(bonus && cover ? { cover } : {}),
          });
        }
        return list;
      });

      void notifyCampaign(campaignId, { type: 'rolls' });
      if (effect) {
        void notifyCampaign(campaignId, { type: 'changed' });
        for (const entry of results) if (entry.conditionApplied) void notifyCampaign(campaignId, { type: 'character', characterId: entry.characterId });
      }
      return { results };
    },
  );
}
