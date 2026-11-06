import type { Queryable } from '../../db.ts';
import { objectSchema, reject, uuid, type SceneFeatureContext } from '../scene-feature.ts';

type Rights = { sceneManager: boolean; characterManager: boolean; editGrants: Set<string> };

export type BlockKind = 'both' | 'sight' | 'move';

export type ObjectStateRow = {
  openable: boolean;
  is_open: boolean;
  locked: boolean;
  lock_dc: number | null;
  lock_known: boolean;
  break_dc: number | null;
  broken: boolean;
  trap_armed: boolean;
  trap_detect_dc: number | null;
  trap_disarm_dc: number | null;
  trap_detected: boolean;
  trap_note: string | null;
  blocks: boolean;
  block_kind: BlockKind;
  light_bright_feet: number | null;
  light_dim_feet: number | null;
  light_open_flame: boolean;
  light_cone: boolean;
  lit: boolean;
  secret_dc: number | null;
  secret_found: boolean;
  passage_scene_id: string | null;
  passage_target_id: string | null;
  hazard: Record<string, unknown> | null;
};

const EMPTY: ObjectStateRow = {
  openable: false, is_open: false, locked: false, lock_dc: null, lock_known: false, break_dc: null, broken: false,
  trap_armed: false, trap_detect_dc: null, trap_disarm_dc: null, trap_detected: false, trap_note: null,
  blocks: false, block_kind: 'both',
  light_bright_feet: null, light_dim_feet: null, lit: true, light_open_flame: false, light_cone: false,
  secret_dc: null, secret_found: false, passage_scene_id: null, passage_target_id: null, hazard: null,
};

export function lightOf(row: ObjectStateRow | undefined) {
  if (!row || !row.lit) return null;
  const bright = row.light_bright_feet ?? 0;
  const dim = row.light_dim_feet ?? 0;
  return bright + dim > 0 ? { bright, dim, cone: row.light_cone === true } : null;
}

function lightView(row: ObjectStateRow) {
  const bright = row.light_bright_feet ?? 0;
  const dim = row.light_dim_feet ?? 0;
  return bright + dim > 0 ? { bright, dim, lit: row.lit, openFlame: row.light_open_flame === true, cone: row.light_cone === true } : null;
}

export function isBlocking(row: ObjectStateRow | undefined, mode?: 'sight' | 'move') {
  if (!row?.blocks || row.broken || (row.openable && row.is_open)) return false;
  return !mode || row.block_kind === 'both' || row.block_kind === mode;
}

const COLUMNS = Object.keys(EMPTY) as Array<keyof ObjectStateRow>;

export async function loadStates(q: Queryable, campaignId: string, characterIds: string[]) {
  if (!characterIds.length) return new Map<string, ObjectStateRow>();
  const rows = (
    await q.query(
      `SELECT character_id, ${COLUMNS.join(', ')} FROM object_states
       WHERE campaign_id=$1 AND character_id::text = ANY(string_to_array($2, ','))`,
      [campaignId, characterIds.join(',')],
    )
  ).rows;
  return new Map(rows.map(row => [String(row.character_id), row as ObjectStateRow]));
}

export function stateView(row: ObjectStateRow | undefined, full: boolean) {
  if (!row) return null;

  if (full) {
    return {
      full: true,
      openable: row.openable,
      open: row.is_open,
      locked: row.locked,
      lockDc: row.lock_dc,
      lockKnown: row.lock_known,
      breakDc: row.break_dc,
      broken: row.broken,
      blocks: row.blocks,
      blockKind: row.block_kind,
      light: lightView(row),
      trap: { armed: row.trap_armed, detectDc: row.trap_detect_dc, disarmDc: row.trap_disarm_dc, detected: row.trap_detected, note: row.trap_note },
      secret: row.secret_dc !== null && row.secret_dc !== undefined ? { dc: row.secret_dc, found: row.secret_found } : null,
      passage: row.passage_scene_id ? { sceneId: row.passage_scene_id, targetId: row.passage_target_id } : null,
      hazard: row.hazard ?? null,
    };
  }

  return {
    full: false,
    openable: row.openable,
    open: row.is_open,
    locked: row.lock_known ? row.locked : null,
    broken: row.broken,
    blocks: row.blocks,
    blockKind: row.block_kind,
    light: lightView(row),
    trap: row.trap_detected ? { armed: row.trap_armed, detected: true } : null,
    ...(row.passage_scene_id ? { passage: { sceneId: row.passage_scene_id } } : {}),
  };
}

export type ObjectStateContext = SceneFeatureContext & {
  rightsOf: (q: Queryable, member: any, userId: string) => Promise<Rights>;
  rollSkill: (q: Queryable, member: any, campaignId: string, userId: string, actorId: string, skill: string, what: string) =>
    Promise<{ total: number; roll: any }>;
  canActAs: (q: Queryable, member: any, userId: string, characterId: string) => Promise<boolean>;
  fireOpen: (q: Queryable, campaignId: string, userId: string, objectId: string, actor: { characterId: string; name: string } | null) =>
    Promise<Array<{ title: string; detail: string; secret: boolean }>>;
  sendNotices: (campaignId: string, notices: Array<{ title: string; detail: string; secret: boolean }>) => void;
};

const ACTIONS = ['open', 'close', 'pick', 'force', 'search', 'disarm', 'light', 'douse'] as const;
type Action = (typeof ACTIONS)[number];
const dc = { oneOf: [{ type: 'integer', minimum: 1, maximum: 40 }, { type: 'null' }] };

async function saveState(q: Queryable, campaignId: string, characterId: string, state: ObjectStateRow) {
  const values = COLUMNS.map(column => state[column]);
  await q.query(
    `INSERT INTO object_states (campaign_id, character_id, ${COLUMNS.join(', ')})
     VALUES ($1, $2, ${COLUMNS.map((_, index) => `$${index + 3}`).join(', ')})
     ON CONFLICT (campaign_id, character_id) DO UPDATE SET
       ${COLUMNS.map(column => `${column}=EXCLUDED.${column}`).join(', ')},
       revision=object_states.revision+1, updated_at=now()`,
    [campaignId, characterId, ...values],
  );
}

function normalize(state: ObjectStateRow): ObjectStateRow {
  const next = { ...state };
  if (!next.openable) {
    next.is_open = false;
    next.locked = false;
  }
  if (next.broken) next.locked = false;
  if (next.locked) next.is_open = false;
  return next;
}

export function registerObjectStateRoutes(context: ObjectStateContext) {
  const { app, db, auth, membership, notifyCampaign, rightsOf, rollSkill, canActAs, fireOpen, sendNotices } = context;
  const characterParams = objectSchema({ campaignId: uuid, characterId: uuid });

  async function loadObject(q: Queryable, campaignId: string, characterId: string, lightOnly = false) {
    const object = (
      await q.query('SELECT id, name, kind, owner_user_id FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])
    ).rows[0];
    if (!object) reject(404, 'Объект не найден.');
    if (object.kind !== 'object' && !lightOnly) reject(400, 'Состояния (открыт, заперт, ловушка) бывают у предметов, не у существ; у существа — только свет.');
    return object as { id: string; name: string; kind: string; owner_user_id: string | null };
  }

  const LIGHT_FIELDS = new Set(['lightBrightFeet', 'lightDimFeet', 'lit', 'lightOpenFlame', 'lightCone']);

  function controls(rights: Rights, userId: string, object: { id: string; owner_user_id: string | null }) {
    return rights.sceneManager || rights.characterManager || object.owner_user_id === userId || rights.editGrants.has(object.id);
  }

  app.put<{
    Params: { campaignId: string; characterId: string };
    Body: {
      openable?: boolean; open?: boolean; locked?: boolean; lockDc?: number | null; lockKnown?: boolean;
      breakDc?: number | null; broken?: boolean;
      trapArmed?: boolean; trapDetectDc?: number | null; trapDisarmDc?: number | null; trapDetected?: boolean; trapNote?: string | null;
      blocks?: boolean; blockKind?: BlockKind;
      lightBrightFeet?: number | null; lightDimFeet?: number | null; lit?: boolean; lightOpenFlame?: boolean; lightCone?: boolean;
      secretDc?: number | null; secretFound?: boolean; passageSceneId?: string | null; passageTargetId?: string | null;
      hazard?: Record<string, unknown> | null;
    };
  }>(
    '/campaigns/:campaignId/characters/:characterId/state',
    {
      schema: {
        params: characterParams,
        body: {
          ...objectSchema({
            openable: { type: 'boolean' }, open: { type: 'boolean' }, locked: { type: 'boolean' }, lockDc: dc,
            lockKnown: { type: 'boolean' }, breakDc: dc, broken: { type: 'boolean' },
            trapArmed: { type: 'boolean' }, trapDetectDc: dc, trapDisarmDc: dc, trapDetected: { type: 'boolean' },
            trapNote: { oneOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }] },
            blocks: { type: 'boolean' },
            blockKind: { type: 'string', enum: ['both', 'sight', 'move'] },
            lightBrightFeet: { oneOf: [{ type: 'integer', minimum: 0, maximum: 1000 }, { type: 'null' }] },
            lightDimFeet: { oneOf: [{ type: 'integer', minimum: 0, maximum: 1000 }, { type: 'null' }] },
            lit: { type: 'boolean' },
            lightOpenFlame: { type: 'boolean' },
            lightCone: { type: 'boolean' },
            secretDc: dc, secretFound: { type: 'boolean' },
            passageSceneId: { oneOf: [uuid, { type: 'null' }] }, passageTargetId: { oneOf: [uuid, { type: 'null' }] },
            hazard: {
              oneOf: [
                {
                  type: 'object', additionalProperties: false, required: ['radiusFeet', 'formula', 'damageType'],
                  properties: {
                    types: { type: 'array', maxItems: 13, items: { type: 'string', maxLength: 32 } },
                    radiusFeet: { type: 'number', exclusiveMinimum: 0, maximum: 120 },
                    formula: { type: 'string', minLength: 1, maxLength: 20 },
                    damageType: { type: 'string', maxLength: 32 },
                    save: { oneOf: [{ type: 'string', enum: ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'] }, { type: 'null' }] },
                    dc: { oneOf: [{ type: 'integer', minimum: 1, maximum: 40 }, { type: 'null' }] },
                    halfOnSuccess: { type: 'boolean' },
                    message: { oneOf: [{ type: 'string', maxLength: 300 }, { type: 'null' }] },
                  },
                },
                { type: 'null' },
              ],
            },
          }, []),
          minProperties: 1,
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const body = request.body;

      const state = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const object = await loadObject(q, campaignId, characterId, Object.keys(body).every(key => LIGHT_FIELDS.has(key)));
        if (!controls(await rightsOf(q, member, userId), userId, object)) {
          reject(403, 'Состояния объекта задаёт мастер или тот, кто им управляет.');
        }

        if (body.passageSceneId) {
          const scene = (await q.query('SELECT 1 FROM scenes WHERE campaign_id=$1 AND id=$2', [campaignId, body.passageSceneId])).rows[0];
          if (!scene) reject(400, 'Сцены прохода нет в этой кампании.');
        }
        if (body.passageTargetId) {
          const target = (await q.query(`SELECT 1 FROM characters WHERE campaign_id=$1 AND id=$2 AND kind='object'`, [campaignId, body.passageTargetId])).rows[0];
          if (!target) reject(400, 'Цель прохода — предмет этой кампании.');
        }
        const current = (await loadStates(q, campaignId, [characterId])).get(characterId) ?? EMPTY;
        const next = normalize({
          ...current,
          ...(body.openable !== undefined ? { openable: body.openable } : {}),
          ...(body.open !== undefined ? { is_open: body.open } : {}),
          ...(body.locked !== undefined ? { locked: body.locked } : {}),
          ...(body.lockDc !== undefined ? { lock_dc: body.lockDc } : {}),
          ...(body.lockKnown !== undefined ? { lock_known: body.lockKnown } : {}),
          ...(body.breakDc !== undefined ? { break_dc: body.breakDc } : {}),
          ...(body.broken !== undefined ? { broken: body.broken } : {}),
          ...(body.trapArmed !== undefined ? { trap_armed: body.trapArmed } : {}),
          ...(body.trapDetectDc !== undefined ? { trap_detect_dc: body.trapDetectDc } : {}),
          ...(body.trapDisarmDc !== undefined ? { trap_disarm_dc: body.trapDisarmDc } : {}),
          ...(body.trapDetected !== undefined ? { trap_detected: body.trapDetected } : {}),
          ...(body.trapNote !== undefined ? { trap_note: body.trapNote?.trim() || null } : {}),
          ...(body.blocks !== undefined ? { blocks: body.blocks } : {}),
          ...(body.blockKind !== undefined ? { block_kind: body.blockKind } : {}),
          ...(body.lightBrightFeet !== undefined ? { light_bright_feet: body.lightBrightFeet } : {}),
          ...(body.lightDimFeet !== undefined ? { light_dim_feet: body.lightDimFeet } : {}),
          ...(body.lit !== undefined ? { lit: body.lit } : {}),
          ...(body.lightOpenFlame !== undefined ? { light_open_flame: body.lightOpenFlame } : {}),
          ...(body.lightCone !== undefined ? { light_cone: body.lightCone } : {}),
          ...(body.secretDc !== undefined ? { secret_dc: body.secretDc } : {}),
          ...(body.secretFound !== undefined ? { secret_found: body.secretFound } : {}),
          ...(body.passageSceneId !== undefined ? { passage_scene_id: body.passageSceneId, ...(body.passageSceneId === null ? { passage_target_id: null } : {}) } : {}),
          ...(body.passageTargetId !== undefined ? { passage_target_id: body.passageTargetId } : {}),
          ...(body.hazard !== undefined ? { hazard: body.hazard } : {}),
        });
        await saveState(q, campaignId, characterId, next);
        return stateView(next, true);
      });

      void notifyCampaign(campaignId, { type: 'changed' });
      return { state };
    },
  );

  app.post<{ Params: { campaignId: string; characterId: string }; Body: { action: Action; actorId?: string } }>(
    '/campaigns/:campaignId/characters/:characterId/interact',
    {
      schema: {
        params: characterParams,
        body: objectSchema({ action: { type: 'string', enum: [...ACTIONS] }, actorId: uuid }, ['action']),
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const { action, actorId } = request.body;

      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const object = await loadObject(q, campaignId, characterId, action === 'light' || action === 'douse');
        const controlled = controls(await rightsOf(q, member, userId), userId, object);
        if (object.kind !== 'object' && !controlled) reject(403, `Свет «${object.name}» зажигает и гасит тот, кто им управляет.`);

        if (!controlled) {
          const visible = (
            await q.query(
              `SELECT 1 FROM scene_objects p
               LEFT JOIN object_states s ON s.campaign_id = p.campaign_id AND s.character_id = p.character_id
               WHERE p.campaign_id=$1 AND p.character_id=$2 AND NOT p.hidden
                 AND (s.secret_dc IS NULL OR s.secret_found) LIMIT 1`,
              [campaignId, characterId],
            )
          ).rows[0];
          if (!visible) reject(404, 'Объект не найден.');
        }

        if (actorId && !(await canActAs(q, member, userId, actorId))) reject(403, 'Действовать можно своим персонажем.');

        const state = { ...((await loadStates(q, campaignId, [characterId])).get(characterId) ?? EMPTY) };
        let outcome: string;
        let message: string;
        let roll: any = null;
        let trapSprung = false;
        let opened = false;

        const needActor = () => {
          if (!actorId) reject(400, 'Выберите, кто это делает.');
          return actorId;
        };
        const check = async (skill: string, what: string) => {
          const rolled = await rollSkill(q, member, campaignId, userId, needActor(), skill, `${what}: ${object.name}`);
          roll = rolled.roll;
          return rolled.total;
        };
        const spring = () => {
          trapSprung = true;
          state.trap_armed = false;
          state.trap_detected = true;
        };

        if (action === 'light' || action === 'douse') {
          if (!(state.light_bright_feet ?? 0) && !(state.light_dim_feet ?? 0)) reject(400, `«${object.name}» не светит.`);
          if (action === 'light' && state.light_open_flame) {
            const storm = (
              await q.query(
                `SELECT 1 FROM scene_objects p JOIN scenes s ON s.id = p.scene_id
                 WHERE p.campaign_id=$1 AND p.character_id=$2 AND s.weather='storm' LIMIT 1`,
                [campaignId, characterId],
              )
            ).rows[0];
            if (storm) reject(400, `Под ливнем «${object.name}» не зажечь — открытый огонь гаснет.`);
          }
          state.lit = action === 'light';
          outcome = state.lit ? 'lit' : 'doused';
          message = state.lit ? `«${object.name}» горит.` : `«${object.name}» погас.`;
        } else if (action === 'open' || action === 'close') {
          if (!state.openable) reject(400, `«${object.name}» не открывается.`);

          if (action === 'close') {
            if (state.broken) reject(400, `«${object.name}» сломан — не закрыть.`);
            state.is_open = false;
            outcome = 'closed';
            message = `«${object.name}» закрыт.`;
          } else if (state.locked) {
            state.lock_known = true;
            outcome = 'locked';
            message = `«${object.name}» заперт.`;
          } else {
            state.is_open = true;
            opened = true;
            outcome = 'opened';
            message = `«${object.name}» открыт.`;
            if (state.trap_armed) spring();
          }
        } else if (action === 'pick') {
          if (!state.locked) reject(400, `«${object.name}» не заперт.`);
          state.lock_known = true;

          if (state.lock_dc === null) {
            outcome = 'impossible';
            message = 'Этот замок не взломать — нужен ключ.';
          } else if ((await check('sleight-of-hand', 'Взлом замка')) >= state.lock_dc) {
            state.locked = false;
            outcome = 'success';
            message = `Замок «${object.name}» поддался.`;
          } else {
            outcome = 'failure';
            message = 'Замок не поддаётся.';
          }
        } else if (action === 'force') {
          if (!state.openable || state.is_open || state.broken) reject(400, `«${object.name}» нечего выбивать.`);

          if (state.break_dc === null) {
            outcome = 'impossible';
            message = `«${object.name}» не выбить.`;
          } else if ((await check('athletics', 'Выбить')) >= state.break_dc) {
            state.broken = true;
            state.locked = false;
            state.is_open = true;
            state.lock_known = true;
            opened = true;
            outcome = 'success';
            message = `«${object.name}» выбит.`;
            if (state.trap_armed) spring();
          } else {
            outcome = 'failure';
            message = `«${object.name}» устоял.`;
          }
        } else if (action === 'search') {
          const total = await check('perception', 'Поиск ловушек');
          if (state.trap_armed && !state.trap_detected && state.trap_detect_dc !== null && total >= state.trap_detect_dc) {
            state.trap_detected = true;
            outcome = 'found';
            message = `Найдена ловушка на «${object.name}»!`;
          } else {
            outcome = 'nothing';
            message = state.trap_detected && state.trap_armed ? 'Ловушка уже найдена.' : 'Ничего подозрительного не нашли.';
          }
        } else {
          if (!state.trap_detected || !state.trap_armed) reject(400, 'Обезвреживать нечего — сначала найдите ловушку.');
          const total = await check('sleight-of-hand', 'Обезвреживание ловушки');
          const target = state.trap_disarm_dc ?? 99;

          if (total >= target) {
            state.trap_armed = false;
            outcome = 'success';
            message = 'Ловушка обезврежена.';
          } else if (target - total >= 5) {
            spring();
            outcome = 'trap';
            message = 'Ловушка сработала!';
          } else {
            outcome = 'failure';
            message = 'Не получилось — но ловушка пока цела.';
          }
        }

        if (trapSprung) {
          outcome = 'trap';
          message = `${message} Сработала ловушка!${state.trap_note ? ` ${state.trap_note}` : ''}`;
        }

        await saveState(q, campaignId, characterId, normalize(state));

        let notices: Array<{ title: string; detail: string; secret: boolean }> = [];
        if (opened) {
          let actor: { characterId: string; name: string } | null = null;
          if (actorId) {
            const row = (await q.query('SELECT id, name FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, actorId])).rows[0];
            if (row) actor = { characterId: row.id, name: row.name };
          }
          notices = await fireOpen(q, campaignId, userId, characterId, actor);
        }

        return {
          notices,
          outcome,
          message,
          roll,
          trapSprung,
          name: object.name,
          state: stateView(normalize(state), controlled),
        };
      });

      void notifyCampaign(campaignId, { type: 'changed' });
      if (result.roll) void notifyCampaign(campaignId, { type: 'rolls' });
      if (result.trapSprung) {
        void notifyCampaign(campaignId, { type: 'notice', title: `Сработала ловушка: «${result.name}»`, detail: result.message });
      }

      sendNotices(campaignId, result.notices);
      return { outcome: result.outcome, message: result.message, roll: result.roll, state: result.state };
    },
  );
}
