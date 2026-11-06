import { announceExperience, type ExperienceEvent } from '../../characters/experience.ts';
import { recordCombatEvent } from '../combat/combat-events.ts';
import { hasEvasion, shieldMasterBonus, shieldMasterDodge } from '../../rules/class-features.ts';
import type { Queryable } from '../../db.ts';
import { bumpScene, objectSchema, reject, sceneParams, uuid, type SceneFeatureContext } from '../scene-feature.ts';
import { touches } from './scene-templates.ts';
import { findSrdSkill } from '../../rules/srd-data.ts';
import type { Area, AreaShape } from '../../../../../packages/domain/map/areas.ts';
import { hasTokens, parseExpression, rollExpression } from '../../../../../packages/domain/dice/expression.ts';

type TriggerParams = { campaignId: string; sceneId: string; triggerId: string };

export type Notice = { title: string; detail: string; secret: boolean; characterId?: string; experience?: ExperienceEvent[] };

type Actor = { characterId: string; name: string; worldX?: number; worldZ?: number; size?: string };

export type TriggerContext = SceneFeatureContext & {
  rollCheckFor: (
    q: Queryable, campaignId: string, userId: string, characterId: string, kind: 'save' | 'skill', key: string, label: string, hidden: boolean, log?: boolean, dc?: number | null,
    extraDisadvantages?: string[], bonus?: { value: number; reason: string } | null,
  ) => Promise<{ total: number; roll: any; autoFail: boolean; success: boolean | null }>;
  hpChange: (
    q: Queryable, campaignId: string, userId: string, characterId: string,
    change: { mode: 'damage'; amount: number; damageType: string | null; critical: boolean; sourceId?: string | null },
  ) => Promise<{ applied: number; blocked: string | null; modified: string | null; dropped: boolean; name: string; notices: Array<{ title: string; detail: string }>; experience: ExperienceEvent | null }>;
  insertRoll: (
    q: Queryable, campaignId: string, userId: string, characterId: string | null, label: string | null,
    formula: string, results: number[], modifier: number, total: number, hidden: boolean, breakdown?: unknown[] | null,
  ) => Promise<any>;
  rollDie: (sides: number) => number;
  notifyManagers: (campaignId: string, message: Record<string, unknown>) => Promise<void>;
  fall?: (q: Queryable, campaignId: string, userId: string, characterId: string, feet: number, hidden: boolean) => Promise<{ message: string } | null>;
};

const ABILITIES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
const ABILITY_SHORT: Record<string, string> = {
  strength: 'СИЛ', dexterity: 'ЛОВ', constitution: 'ТЕЛ', intelligence: 'ИНТ', wisdom: 'МДР', charisma: 'ХАР',
};
export const DAMAGE_TYPE_RU: Record<string, string> = {
  acid: 'кислота', bludgeoning: 'дробящий', cold: 'холод', fire: 'огонь', force: 'силовое поле',
  lightning: 'электричество', necrotic: 'некротическая энергия', piercing: 'колющий', poison: 'яд',
  psychic: 'психическая энергия', radiant: 'излучение', slashing: 'рубящий', thunder: 'звук',
};

const COLUMNS = `id, kind, shape, x, z, direction, size_feet::float8 AS size_feet, object_id, name, message,
  check_kind, check_key, dc, damage_formula, damage_type, half_on_success, once, enabled, secret, fired_count, on_turn, caster_id, fall_feet,
  height_feet::float8 AS height_feet`;

export function pathPoints(from: { x: number; z: number }, to: { x: number; z: number }) {
  const dx = to.x - from.x, dz = to.z - from.z;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) - 1e-9));
  return Array.from({ length: steps }, (_, index) => ({
    world_x: from.x + (dx * (index + 1)) / steps,
    world_z: from.z + (dz * (index + 1)) / steps,
  }));
}

function areaOf(trigger: any, feetPerUnit: number): Area {
  return {
    shape: trigger.shape as AreaShape,
    x: Number(trigger.x),
    z: Number(trigger.z),
    direction: Number(trigger.direction),
    size: Number(trigger.size_feet) / feetPerUnit,
    width: 5 / feetPerUnit,
    ...(trigger.height_feet ? { height: Number(trigger.height_feet) / feetPerUnit } : {}),
  };
}

export function createTriggerEngine(ctx: TriggerContext) {
  const { app, db, auth, membership, canManage, getScene, notify, notifyCampaign, rollCheckFor, insertRoll, rollDie, notifyManagers, hpChange, fall } = ctx;

  async function applyDamage(
    q: Queryable, campaignId: string, userId: string, characterId: string, amount: number, parts: string[], experience: ExperienceEvent[] = [],
    casterId: string | null = null, damageType: string | null = null,
  ) {
    const change = await hpChange(q, campaignId, userId, characterId, { mode: 'damage', amount, damageType, critical: false, sourceId: casterId });
    if (change.blocked === 'immune') parts.push(`${change.name}: иммунитет.`);
    else if (change.modified === 'resisted') parts.push(`${change.name}: сопротивление — вдвое меньше.`);
    else if (change.modified === 'vulnerable') parts.push(`${change.name}: уязвимость — вдвое больше.`);
    if (change.applied > 0) {
      await recordCombatEvent(q, campaignId, {
        targetId: characterId, actorId: casterId, kind: 'damage', amount: change.applied, dropped: change.dropped, source: casterId ? 'zone' : 'trap',
      });
    }
    for (const notice of change.notices) parts.push(`${notice.title}. ${notice.detail}`);
    if (change.experience) {
      experience.push(change.experience);
      parts.push(`${change.experience.reason}.`);
    }
    return change.applied;
  }

  async function fire(q: Queryable, campaignId: string, userId: string, trigger: any, actor: Actor | null): Promise<Notice> {
    const parts: string[] = [];
    const experience: ExperienceEvent[] = [];
    if (trigger.fall_feet && actor) {
      const flying = (await q.query(`SELECT 1 FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code IN ('dragon_wings', 'flying') AND active`, [campaignId, actor.characterId])).rows[0];
      if (flying) return { title: `${trigger.name}: ${actor.name} пролетает над ямой`, detail: 'Летящему яма не страшна.', secret: trigger.secret };
    }
    if (trigger.message) parts.push(trigger.message);
    let success: boolean | null = null;

    if (trigger.check_kind && actor) {
      const what = trigger.check_kind === 'save'
        ? `Спасбросок ${ABILITY_SHORT[trigger.check_key] ?? trigger.check_key}`
        : `Проверка: ${findSrdSkill(trigger.check_key)?.nameRu ?? trigger.check_key}`;
      const shield = trigger.check_kind === 'save' && trigger.check_key === 'dexterity' ? await shieldMasterBonus(q, campaignId, actor.characterId) : null;
      const rolled = await rollCheckFor(
        q, campaignId, userId, actor.characterId, trigger.check_kind, trigger.check_key,
        `${what} (СЛ ${trigger.dc}), ${trigger.name} — ${actor.name}`, false, !trigger.secret, trigger.dc, [], shield,
      );
      success = rolled.success === true;
      parts.push(`${actor.name}: ${what.charAt(0).toLowerCase()}${what.slice(1)} — ${rolled.total}${rolled.autoFail ? ' (автопровал)' : ''}, ${success ? 'успех' : 'провал'}.`);
    }

    if (trigger.damage_formula && actor) {
      const parsed = parseExpression(trigger.damage_formula);
      if (parsed.ok) {
        const rolled = rollExpression(parsed.expression, rollDie);
        if (rolled.ok) {
          if (!trigger.secret) {
            await insertRoll(
              q, campaignId, userId, actor.characterId, `Урон: ${trigger.name} — ${actor.name}`,
              trigger.damage_formula, rolled.dice, rolled.modifier, rolled.total, false, rolled.groups,
            );
          }
          let amount = Math.max(0, rolled.total);
          const evades = trigger.check_kind === 'save' && trigger.check_key === 'dexterity' && trigger.half_on_success && (await hasEvasion(q, campaignId, actor.characterId));
          const shielded = success === true && !evades && trigger.check_kind === 'save' && trigger.check_key === 'dexterity' && trigger.half_on_success
            && amount > 0 && (await shieldMasterDodge(q, campaignId, actor.characterId));
          if (shielded) parts.push(`${actor.name}: «Мастер щита» — щит принял удар.`);
          if (success === true) amount = trigger.half_on_success && !evades && !shielded ? Math.floor(amount / 2) : 0;
          else if (evades) amount = Math.floor(amount / 2);
          const after: string[] = [];
          const applied = amount > 0 ? await applyDamage(q, campaignId, userId, actor.characterId, amount, after, experience, trigger.caster_id ?? null, trigger.damage_type ?? null) : 0;
          const type = trigger.damage_type ? ` (${DAMAGE_TYPE_RU[trigger.damage_type] ?? trigger.damage_type})` : '';
          parts.push(applied > 0 ? `${actor.name} получает ${applied} урона${type}.` : `${actor.name} не получает урона.`);
          parts.push(...after);
        }
      }
    }

    if (trigger.fall_feet && actor && fall) {
      if (success === true) parts.push(`${actor.name} удерживается на краю ямы.`);
      else {
        const fell = await fall(q, campaignId, userId, actor.characterId, Number(trigger.fall_feet), trigger.secret === true);
        if (fell) parts.push(fell.message);
      }
    }

    await q.query(
      `UPDATE scene_triggers SET fired_count=fired_count+1, enabled = CASE WHEN once THEN false ELSE enabled END
       WHERE id=$1`,
      [trigger.id],
    );

    return {
      title: `Сработало: ${trigger.name}`,
      detail: parts.join(' ') || 'Без последствий.',
      secret: trigger.secret,
      ...(actor && (trigger.damage_formula || trigger.fall_feet) ? { characterId: actor.characterId } : {}),
      ...(experience.length ? { experience } : {}),
    };
  }

  async function altitudeOf(q: Queryable, campaignId: string, characterId: string): Promise<number> {
    const row = (
      await q.query(
        `SELECT MAX(COALESCE((parameters->>'height')::float8, 0)) AS height FROM character_effects
         WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code IN ('flying', 'dragon_wings')`,
        [campaignId, characterId],
      )
    ).rows[0];
    return Number(row?.height ?? 0);
  }

  async function fireEnter(
    q: Queryable, campaignId: string, scene: any, userId: string,
    actor: { characterId: string; name: string; size: string }, from: { x: number; z: number }, to: { x: number; z: number },
  ): Promise<Notice[]> {
    if (from.x === to.x && from.z === to.z) return [];
    const triggers = (
      await q.query(
        `SELECT ${COLUMNS} FROM scene_triggers WHERE campaign_id=$1 AND scene_id=$2 AND kind='enter' AND enabled
         ORDER BY created_at, id FOR UPDATE`,
        [campaignId, scene.id],
      )
    ).rows;

    const notices: Notice[] = [];
    const path = pathPoints(from, to);
    const altitude = triggers.length ? await altitudeOf(q, campaignId, actor.characterId) : 0;
    for (const trigger of triggers) {
      const area = areaOf(trigger, scene.feet_per_unit);
      if (touches(area, scene, { world_x: from.x, world_z: from.z, size: actor.size, altitude_feet: altitude })) continue;
      if (path.some(point => touches(area, scene, { ...point, size: actor.size, altitude_feet: altitude }))) notices.push(await fire(q, campaignId, userId, trigger, actor));
    }
    if (notices.length) await bumpScene(q, scene.id);
    return notices;
  }

  async function fireTurnStart(q: Queryable, campaignId: string, scene: any, userId: string, characterId: string): Promise<Notice[]> {
    const placement = (
      await q.query(
        `SELECT p.x, p.z, c.name, c.size FROM scene_objects p JOIN characters c ON c.campaign_id=p.campaign_id AND c.id=p.character_id
         WHERE p.campaign_id=$1 AND p.scene_id=$2 AND p.character_id=$3 AND p.parent_object_id IS NULL LIMIT 1`,
        [campaignId, scene.id, characterId],
      )
    ).rows[0];
    if (!placement) return [];
    const triggers = (
      await q.query(
        `SELECT ${COLUMNS} FROM scene_triggers WHERE campaign_id=$1 AND scene_id=$2 AND kind='enter' AND enabled AND on_turn
         ORDER BY created_at, id FOR UPDATE`,
        [campaignId, scene.id],
      )
    ).rows;
    const notices: Notice[] = [];
    const altitude = triggers.length ? await altitudeOf(q, campaignId, characterId) : 0;
    for (const trigger of triggers) {
      if (!touches(areaOf(trigger, scene.feet_per_unit), scene, { world_x: Number(placement.x), world_z: Number(placement.z), size: placement.size, altitude_feet: altitude })) continue;
      notices.push(await fire(q, campaignId, userId, trigger, { characterId, name: placement.name }));
    }
    if (notices.length) await bumpScene(q, scene.id);
    return notices;
  }

  async function fireOpen(q: Queryable, campaignId: string, userId: string, objectId: string, actor: Actor | null): Promise<Notice[]> {
    const triggers = (
      await q.query(
        `SELECT ${COLUMNS} FROM scene_triggers WHERE campaign_id=$1 AND kind='open' AND object_id=$2 AND enabled
         ORDER BY created_at, id FOR UPDATE`,
        [campaignId, objectId],
      )
    ).rows;
    const notices: Notice[] = [];
    for (const trigger of triggers) notices.push(await fire(q, campaignId, userId, trigger, actor));
    return notices;
  }

  function send(campaignId: string, notices: Notice[]) {
    for (const notice of notices) {
      const message = { type: 'notice', title: notice.title, detail: notice.detail };
      void (notice.secret ? notifyManagers(campaignId, message) : notifyCampaign(campaignId, message));
      for (const event of notice.experience ?? []) announceExperience(notifyCampaign, campaignId, event);
    }
    if (notices.length) {
      void notifyCampaign(campaignId, { type: 'rolls' });
      void notifyCampaign(campaignId, { type: 'changed' });
      for (const notice of notices) {
        if (notice.characterId) void notifyCampaign(campaignId, { type: 'character', characterId: notice.characterId });
      }
    }
  }

  async function requireManager(q: Queryable, campaignId: string, userId: string) {
    const member = await membership(q, campaignId, userId, true);
    if (!(await canManage(q, member, userId))) reject(403, 'Триггеры задаёт мастер сцен.');
  }

  type Body = {
    kind?: 'enter' | 'open';
    shape?: AreaShape; x?: number; z?: number; direction?: number; sizeFeet?: number; objectId?: string;
    name?: string; message?: string | null;
    checkKind?: 'save' | 'skill' | null; checkKey?: string | null; dc?: number | null;
    damageFormula?: string | null; damageType?: string | null;
    halfOnSuccess?: boolean; once?: boolean; enabled?: boolean; secret?: boolean;
    detectDc?: number | null; detected?: boolean;
    onTurn?: boolean;
    fallFeet?: number | null;
  };

  const nullableString = (max: number) => ({ oneOf: [{ type: 'string', maxLength: max }, { type: 'null' }] });
  const fields = {
    shape: { type: 'string', enum: ['circle', 'cone', 'square', 'line'] },
    x: { type: 'number', minimum: -1000, maximum: 1000 },
    z: { type: 'number', minimum: -1000, maximum: 1000 },
    direction: { type: 'number', minimum: 0, exclusiveMaximum: 360 },
    sizeFeet: { type: 'number', exclusiveMinimum: 0, maximum: 1000 },
    objectId: uuid,
    name: { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' },
    message: nullableString(500),
    checkKind: { oneOf: [{ type: 'string', enum: ['save', 'skill'] }, { type: 'null' }] },
    checkKey: nullableString(64),
    dc: { oneOf: [{ type: 'integer', minimum: 1, maximum: 40 }, { type: 'null' }] },
    damageFormula: nullableString(100),
    damageType: nullableString(32),
    halfOnSuccess: { type: 'boolean' },
    once: { type: 'boolean' },
    enabled: { type: 'boolean' },
    secret: { type: 'boolean' },
    detectDc: { oneOf: [{ type: 'integer', minimum: 1, maximum: 40 }, { type: 'null' }] },
    detected: { type: 'boolean' },
    onTurn: { type: 'boolean' },
    fallFeet: { oneOf: [{ type: 'integer', minimum: 1, maximum: 1000 }, { type: 'null' }] },
  };

  function validateRules(body: { checkKind?: string | null; checkKey?: string | null; dc?: number | null; damageFormula?: string | null }) {
    if (body.checkKind) {
      if (!body.checkKey || !body.dc) reject(400, 'Для проверки нужны характеристика или навык и СЛ.');
      if (body.checkKind === 'save' && !ABILITIES.includes(body.checkKey)) reject(400, 'Неизвестная характеристика спасброска.');
      if (body.checkKind === 'skill' && !findSrdSkill(body.checkKey)) reject(400, 'Неизвестный навык.');
    }
    if (body.damageFormula) {
      const parsed = parseExpression(body.damageFormula);
      if (!parsed.ok || hasTokens(parsed.expression)) reject(400, 'Формула урона — кости и числа, например 2d6 или 1d10+2.');
    }
  }

  app.get<{ Params: { campaignId: string; sceneId: string } }>(
    '/campaigns/:campaignId/scenes/:sceneId/triggers',
    { schema: { params: sceneParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId, sceneId } = request.params;
      return db.transaction(async q => {
        await requireManager(q, campaignId, userId);
        await getScene(q, campaignId, sceneId);
        return { triggers: await loadTriggers(q, campaignId, sceneId) };
      });
    },
  );

  app.post<{ Params: { campaignId: string; sceneId: string }; Body: Body }>(
    '/campaigns/:campaignId/scenes/:sceneId/triggers',
    { schema: { params: sceneParams, body: objectSchema({ kind: { type: 'string', enum: ['enter', 'open'] }, ...fields }, ['kind', 'name']) } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, sceneId } = request.params;
      const body = request.body;

      const created = await db.transaction(async q => {
        await requireManager(q, campaignId, userId);
        await getScene(q, campaignId, sceneId, true);
        validateRules(body);

        if (body.kind === 'enter' && (body.shape === undefined || body.x === undefined || body.z === undefined || body.sizeFeet === undefined)) {
          reject(400, 'Для области нужны форма, точка и размер.');
        }
        if (body.kind === 'open') {
          if (!body.objectId) reject(400, 'Выберите предмет.');
          const object = (await q.query('SELECT kind FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, body.objectId])).rows[0];
          if (!object || object.kind !== 'object') reject(400, 'Триггер «при открытии» вешают на предмет.');
        }

        const row = (
          await q.query(
            `INSERT INTO scene_triggers (
               campaign_id, scene_id, kind, shape, x, z, direction, size_feet, object_id, name, message,
               check_kind, check_key, dc, damage_formula, damage_type, half_on_success, once, enabled, secret, created_by,
               detect_dc, detected, on_turn, fall_feet
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
             RETURNING id`,
            [
              campaignId, sceneId, body.kind,
              body.kind === 'enter' ? body.shape : null, body.kind === 'enter' ? body.x : null, body.kind === 'enter' ? body.z : null,
              body.direction ?? 0, body.kind === 'enter' ? body.sizeFeet : null, body.kind === 'open' ? body.objectId : null,
              body.name!.trim(), body.message?.trim() || null,
              body.checkKind ?? null, body.checkKind ? body.checkKey : null, body.checkKind ? body.dc : null,
              body.damageFormula?.trim() || null, body.damageType ?? null,
              body.halfOnSuccess ?? true, body.once ?? true, body.enabled ?? true, body.secret ?? false, userId,
              body.kind === 'enter' ? body.detectDc ?? null : null, body.detected ?? false,
              body.kind === 'enter' && body.onTurn === true,
              body.kind === 'enter' ? body.fallFeet ?? null : null,
            ],
          )
        ).rows[0];

        await bumpScene(q, sceneId);
        return (await loadTriggers(q, campaignId, sceneId)).find(trigger => trigger.id === row.id);
      });

      void notify(campaignId, sceneId);
      return reply.code(201).send(created);
    },
  );

  app.patch<{ Params: TriggerParams; Body: Body }>(
    '/campaigns/:campaignId/scenes/:sceneId/triggers/:triggerId',
    {
      schema: {
        params: objectSchema({ campaignId: uuid, sceneId: uuid, triggerId: uuid }),
        body: { ...objectSchema(fields, []), minProperties: 1 },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, sceneId, triggerId } = request.params;
      const body = request.body;

      const updated = await db.transaction(async q => {
        await requireManager(q, campaignId, userId);
        await getScene(q, campaignId, sceneId, true);
        const current = (await q.query(`SELECT ${COLUMNS} FROM scene_triggers WHERE campaign_id=$1 AND scene_id=$2 AND id=$3 FOR UPDATE`, [campaignId, sceneId, triggerId])).rows[0];
        if (!current) reject(404, 'Триггера нет.');

        const next = {
          checkKind: body.checkKind !== undefined ? body.checkKind : current.check_kind,
          checkKey: body.checkKey !== undefined ? body.checkKey : current.check_key,
          dc: body.dc !== undefined ? body.dc : current.dc,
          damageFormula: body.damageFormula !== undefined ? body.damageFormula : current.damage_formula,
        };
        validateRules(next);

        await q.query(
          `UPDATE scene_triggers SET
             shape = COALESCE($4, shape), x = COALESCE($5, x), z = COALESCE($6, z),
             direction = COALESCE($7, direction), size_feet = COALESCE($8, size_feet),
             name = COALESCE($9, name),
             message = CASE WHEN $10 THEN $11 ELSE message END,
             check_kind = $12, check_key = $13, dc = $14,
             damage_formula = $15,
             damage_type = CASE WHEN $16 THEN $17 ELSE damage_type END,
             half_on_success = COALESCE($18, half_on_success), once = COALESCE($19, once),
             enabled = COALESCE($20, enabled), secret = COALESCE($21, secret),
             detect_dc = CASE WHEN $22 THEN $23::integer ELSE detect_dc END, detected = COALESCE($24, detected),
             on_turn = COALESCE($25, on_turn),
             fall_feet = CASE WHEN $26 THEN $27::integer ELSE fall_feet END
           WHERE campaign_id=$1 AND scene_id=$2 AND id=$3`,
          [
            campaignId, sceneId, triggerId,
            current.kind === 'enter' ? body.shape ?? null : null, current.kind === 'enter' ? body.x ?? null : null,
            current.kind === 'enter' ? body.z ?? null : null, body.direction ?? null,
            current.kind === 'enter' ? body.sizeFeet ?? null : null,
            body.name?.trim() ?? null,
            body.message !== undefined, body.message?.trim() || null,
            next.checkKind ?? null, next.checkKind ? next.checkKey : null, next.checkKind ? next.dc : null,
            next.damageFormula?.trim() || null,
            body.damageType !== undefined, body.damageType ?? null,
            body.halfOnSuccess ?? null, body.once ?? null, body.enabled ?? null, body.secret ?? null,
            body.detectDc !== undefined, body.detectDc ?? null, body.detected ?? null,
            body.onTurn ?? null,
            current.kind === 'enter' && body.fallFeet !== undefined, body.fallFeet ?? null,
          ],
        );
        await bumpScene(q, sceneId);
        return (await loadTriggers(q, campaignId, sceneId)).find(trigger => trigger.id === triggerId);
      });

      void notify(campaignId, sceneId);
      return updated;
    },
  );

  app.delete<{ Params: TriggerParams }>(
    '/campaigns/:campaignId/scenes/:sceneId/triggers/:triggerId',
    { schema: { params: objectSchema({ campaignId: uuid, sceneId: uuid, triggerId: uuid }) } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, sceneId, triggerId } = request.params;
      await db.transaction(async q => {
        await requireManager(q, campaignId, userId);
        const deleted = await q.query('DELETE FROM scene_triggers WHERE campaign_id=$1 AND scene_id=$2 AND id=$3 RETURNING id', [campaignId, sceneId, triggerId]);
        if (!deleted.rows[0]) reject(404, 'Триггера нет.');
        await bumpScene(q, sceneId);
      });
      void notify(campaignId, sceneId);
      return reply.code(204).send();
    },
  );

  return { fireEnter, fireOpen, fireTurnStart, send };
}

export async function loadTriggers(q: Queryable, campaignId: string, sceneId: string) {
  return (
    await q.query(
      `SELECT t.id, t.kind, t.shape, t.x, t.z, t.direction, t.size_feet::float8 AS size_feet, t.object_id, t.name,
              t.message, t.check_kind, t.check_key, t.dc, t.damage_formula, t.damage_type, t.half_on_success,
              t.once, t.enabled, t.secret, t.fired_count, t.detect_dc, t.detected, t.on_turn, t.fall_feet, c.name AS object_name
       FROM scene_triggers t
       LEFT JOIN characters c ON c.campaign_id = t.campaign_id AND c.id = t.object_id
       WHERE t.campaign_id=$1 AND t.scene_id=$2
       ORDER BY t.created_at, t.id`,
      [campaignId, sceneId],
    )
  ).rows;
}
