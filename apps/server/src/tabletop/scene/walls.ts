import type { Queryable } from '../../db.ts';
import { loadConditionState } from '../../rules/conditions.ts';
import { incapacitatedReason } from '../../../../../packages/domain/combat/conditions.ts';
import type { WallSegment } from '../../../../../packages/domain/map/los.ts';
import { WALL_KINDS, wallDefense, wallCondition, type WallKind, wallSteps, splitWall, distanceToWall, WALL_IMMUNE, wallReachable } from '../../../../../packages/domain/map/walls.ts';
import { rollDice } from '../../../../../packages/domain/dice/dice.ts';
import { resolveFormula } from '../../../../../packages/domain/dice/formula.ts';
import { footprintCells } from '../../../../../packages/domain/map/footprint.ts';

import { attacksPerActionFor, weaponDamageText } from '../combat/attack.ts';
import type { TableContext } from '../context.ts';
import { notify, notifyCampaign } from '../live/notify.ts';
import { insertRoll, rollDie } from '../rolls/dice.ts';
import { checkModifier, d20Formula } from '../rolls/modifiers.ts';
import { assertLatticePoint, getScene } from './board.ts';
import { blockingPlacements, canManageCharacter, controls, loadPlacements, rightsOf, sheetContext } from './placements.ts';
import { canManage, objectSchema, reject, sceneParams, type SceneParams, uuid, WALL_COLUMNS, wallParams, type WallParams, WALLS_MOVE } from '../shared.ts';

export const WALL_STYLES = ['stone', 'brick', 'wood', 'hedge', 'rock', 'plain', 'image'] as const;
export type WallStyle = typeof WALL_STYLES[number];
export const wallPoint = { type: 'number', minimum: -1000, maximum: 1000 };
export const wallLook = {
  style: { type: 'string', enum: WALL_STYLES },
  textureAssetId: { anyOf: [uuid, { type: 'null' }] },
  kind: { type: 'string', enum: WALL_KINDS },
};

export function wallForPlayer(wall: any) {
  const { hp, hp_max: _hpMax, locked: _locked, ...rest } = wall;
  const defense = wallDefense(wall);
  return { ...rest, condition: wallCondition(hp, defense.hpMax, wall.broken === true, wall.kind) };
}

export async function wallStyleOf(q: Queryable, campaignId: string, style: WallStyle | undefined, textureAssetId: string | null | undefined) {
  const chosen: WallStyle = style ?? (textureAssetId ? 'image' : 'stone');
  if (chosen !== 'image') return { style: chosen, texture: null as string | null };
  if (!textureAssetId) reject(400, 'Для стены с картинкой нужна картинка.');
  const asset = (
    await q.query(`SELECT 1 FROM assets WHERE campaign_id=$1 AND id=$2 AND kind IN ('object_image', 'scene_background')`, [campaignId, textureAssetId])
  ).rows[0];
  if (!asset) reject(400, 'Картинка для стены не найдена.');
  return { style: chosen, texture: textureAssetId };
}

export async function wallManager(ctx: TableContext, q: Queryable, campaignId: string, sceneId: string, userId: string, action: string) {
  const { membership } = ctx;
  const member = await membership(q, campaignId, userId, true);
  if (!(await canManage(q, member, userId))) reject(403, `Стены может ${action} только мастер.`);
  return getScene(q, campaignId, sceneId);
}

export type WallRow = WallSegment & {
  id: string; style: WallStyle; texture_asset_id: string | null; kind: WallKind; open: boolean; locked: boolean;
  hp: number | null; hp_max: number | null; broken: boolean;
};

export async function lockedWall(q: Queryable, campaignId: string, sceneId: string, wallId: string) {
  const wall = (
    await q.query(`SELECT ${WALL_COLUMNS} FROM scene_walls WHERE campaign_id=$1 AND scene_id=$2 AND id=$3 FOR UPDATE`, [campaignId, sceneId, wallId])
  ).rows[0] as WallRow | undefined;
  if (!wall) reject(404, 'Стена не найдена.');
  return wall;
}

export async function isolateTile(q: Queryable, campaignId: string, sceneId: string, userId: string, wall: WallRow, tile: number | undefined) {
  if (tile === undefined || wallSteps(wall) <= 1) return { target: wall, created: [] as WallRow[], removed: [] as string[] };
  const parts = splitWall(wall, tile);
  await q.query('DELETE FROM scene_walls WHERE campaign_id=$1 AND scene_id=$2 AND id=$3', [campaignId, sceneId, wall.id]);
  const created: WallRow[] = [];
  let target: WallRow | null = null;
  for (const part of parts) {
    const row = (
      await q.query(
        `INSERT INTO scene_walls (campaign_id, scene_id, x1, z1, x2, z2, style, texture_asset_id, created_by, kind, open, locked, hp, hp_max, broken)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING ${WALL_COLUMNS}`,
        [campaignId, sceneId, part.x1, part.z1, part.x2, part.z2, wall.style, wall.texture_asset_id, userId, wall.kind, wall.open, wall.locked, wall.hp, wall.hp_max, wall.broken],
      )
    ).rows[0] as WallRow;
    created.push(row);
    if (part.part === 'tile') target = row;
  }
  return { target: target!, created, removed: [wall.id] };
}

export function registerWallRoutes(ctx: TableContext) {
  const { actionEconomy, app, auth, db, membership } = ctx;

  app.post<{
    Params: SceneParams;
    Body: { walls: Array<{ x1: number; z1: number; x2: number; z2: number }>; style?: WallStyle; textureAssetId?: string | null; kind?: WallKind };
  }>(
    '/campaigns/:campaignId/scenes/:sceneId/walls/batch',
    {
      schema: {
        params: sceneParams,
        body: objectSchema({
          walls: { type: 'array', minItems: 1, maxItems: 400, items: objectSchema({ x1: wallPoint, z1: wallPoint, x2: wallPoint, z2: wallPoint }) },
          ...wallLook,
        }, ['walls']),
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, sceneId } = request.params;
      const body = request.body;

      const created = await db.transaction(async q => {
        const scene = await wallManager(ctx, q, campaignId, sceneId, userId, 'рисовать');
        const look = await wallStyleOf(q, campaignId, body.style, body.textureAssetId);
        const rows = [];
        for (const wall of body.walls) {
          assertLatticePoint(scene, wall.x1, wall.z1);
          assertLatticePoint(scene, wall.x2, wall.z2);
          if (wall.x1 === wall.x2 && wall.z1 === wall.z2) reject(400, 'Стена не может быть нулевой длины.');
          rows.push((await q.query(
            `INSERT INTO scene_walls (campaign_id, scene_id, x1, z1, x2, z2, style, texture_asset_id, created_by, kind)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             RETURNING ${WALL_COLUMNS}`,
            [campaignId, sceneId, wall.x1, wall.z1, wall.x2, wall.z2, look.style, look.texture, userId, body.kind ?? 'wall'],
          )).rows[0]);
        }
        await q.query('UPDATE scenes SET revision=revision+1 WHERE id=$1', [sceneId]);
        return rows;
      });

      void notify(ctx, campaignId, sceneId);
      return reply.code(201).send({ walls: created });
    },
  );

  app.patch<{
    Params: SceneParams;
    Body: { ids?: string[]; style: WallStyle; textureAssetId?: string | null };
  }>(
    '/campaigns/:campaignId/scenes/:sceneId/walls',
    {
      schema: {
        params: sceneParams,
        body: objectSchema({ ids: { type: 'array', minItems: 1, maxItems: 5000, items: uuid }, ...wallLook }, ['style']),
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, sceneId } = request.params;
      const body = request.body;

      const changed = await db.transaction(async q => {
        await wallManager(ctx, q, campaignId, sceneId, userId, 'менять');
        const look = await wallStyleOf(q, campaignId, body.style, body.textureAssetId);
        const result = await q.query(
          `UPDATE scene_walls SET style=$3, texture_asset_id=$4
           WHERE campaign_id=$1 AND scene_id=$2 ${body.ids ? 'AND id = ANY($5::uuid[])' : ''}
           RETURNING id`,
          body.ids ? [campaignId, sceneId, look.style, look.texture, body.ids] : [campaignId, sceneId, look.style, look.texture],
        );
        await q.query('UPDATE scenes SET revision=revision+1 WHERE id=$1', [sceneId]);
        return result.rows.length;
      });

      void notify(ctx, campaignId, sceneId);
      return { changed };
    },
  );

  app.post<{ Params: SceneParams; Body: { ids?: string[]; all?: boolean } }>(
    '/campaigns/:campaignId/scenes/:sceneId/walls/remove',
    {
      schema: {
        params: sceneParams,
        body: objectSchema({ ids: { type: 'array', minItems: 1, maxItems: 5000, items: uuid }, all: { type: 'boolean', const: true } }, []),
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, sceneId } = request.params;
      const { ids, all } = request.body;
      if (!ids && !all) reject(400, 'Какие стены убрать: ids или all.');

      const removed = await db.transaction(async q => {
        await wallManager(ctx, q, campaignId, sceneId, userId, 'удалять');
        const result = await q.query(
          `DELETE FROM scene_walls WHERE campaign_id=$1 AND scene_id=$2 ${all ? '' : 'AND id = ANY($3::uuid[])'}
           RETURNING ${WALL_COLUMNS}`,
          all ? [campaignId, sceneId] : [campaignId, sceneId, ids],
        );
        await q.query('UPDATE scenes SET revision=revision+1 WHERE id=$1', [sceneId]);
        return result.rows;
      });

      void notify(ctx, campaignId, sceneId);
      return { walls: removed };
    },
  );

  app.post<{
    Params: SceneParams;
    Body: { x1: number; z1: number; x2: number; z2: number; style?: WallStyle; textureAssetId?: string | null; kind?: WallKind };
  }>(
    '/campaigns/:campaignId/scenes/:sceneId/walls',
    {
      schema: {
        params: sceneParams,
        body: objectSchema({ x1: wallPoint, z1: wallPoint, x2: wallPoint, z2: wallPoint, ...wallLook }, ['x1', 'z1', 'x2', 'z2']),
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, sceneId } = request.params;
      const { x1, z1, x2, z2 } = request.body;

      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);

        if (!(await canManage(q, member, userId))) {
          reject(403, 'Стены может рисовать только мастер.');
        }

        const scene = await getScene(q, campaignId, sceneId);

        assertLatticePoint(scene, x1, z1);
        assertLatticePoint(scene, x2, z2);

        if (x1 === x2 && z1 === z2) {
          reject(400, 'Стена не может быть нулевой длины.');
        }
        const look = await wallStyleOf(q, campaignId, request.body.style, request.body.textureAssetId);

        const inserted = await q.query(
          `INSERT INTO scene_walls (campaign_id, scene_id, x1, z1, x2, z2, style, texture_asset_id, created_by, kind)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING ${WALL_COLUMNS}`,
          [campaignId, sceneId, x1, z1, x2, z2, look.style, look.texture, userId, request.body.kind ?? 'wall'],
        );

        await q.query(
          'UPDATE scenes SET revision=revision+1 WHERE id=$1',
          [sceneId],
        );

        return inserted.rows[0];
      });

      void notify(ctx, campaignId, sceneId);

      return reply.code(201).send(result);
    },
  );

  app.delete<{ Params: WallParams }>(
    '/campaigns/:campaignId/scenes/:sceneId/walls/:wallId',
    { schema: { params: wallParams } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, sceneId, wallId } = request.params;

      await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);

        if (!(await canManage(q, member, userId))) {
          reject(403, 'Стены может удалять только мастер.');
        }

        await getScene(q, campaignId, sceneId);

        const wall = (
          await q.query(
            `SELECT id FROM scene_walls
             WHERE campaign_id=$1 AND scene_id=$2 AND id=$3
             FOR UPDATE`,
            [campaignId, sceneId, wallId],
          )
        ).rows[0];

        if (!wall) reject(404, 'Стена не найдена.');

        await q.query(
          `DELETE FROM scene_walls WHERE campaign_id=$1 AND scene_id=$2 AND id=$3`,
          [campaignId, sceneId, wallId],
        );

        await q.query(
          'UPDATE scenes SET revision=revision+1 WHERE id=$1',
          [sceneId],
        );
      });

      void notify(ctx, campaignId, sceneId);

      return reply.code(204).send();
    },
  );

  app.patch<{
    Params: WallParams;
    Body: {
      tile?: number; style?: WallStyle; textureAssetId?: string | null; kind?: WallKind; open?: boolean; locked?: boolean;
      broken?: boolean; hpMax?: number | null; remove?: boolean;
    };
  }>(
    '/campaigns/:campaignId/scenes/:sceneId/walls/:wallId',
    {
      schema: {
        params: wallParams,
        body: objectSchema({
          tile: { type: 'integer', minimum: 0, maximum: 2000 },
          ...wallLook,
          open: { type: 'boolean' }, locked: { type: 'boolean' }, broken: { type: 'boolean' },
          hpMax: { anyOf: [{ type: 'integer', minimum: 1, maximum: 10000 }, { type: 'null' }] },
          remove: { type: 'boolean', const: true },
        }, []),
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, sceneId, wallId } = request.params;
      const body = request.body;
      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const manager = await canManage(q, member, userId);
        const scene = await getScene(q, campaignId, sceneId);
        const wall = await lockedWall(q, campaignId, sceneId, wallId);
        const changes = Object.keys(body).filter(key => key !== 'tile' && (body as any)[key] !== undefined);
        if (!changes.length) reject(400, 'Что поменять у стены — не указано.');
        if (!manager) {
          if (changes.some(key => key !== 'open')) reject(403, 'Стены правит мастер; игрок только открывает и закрывает двери.');
          if (wall.kind !== 'door') reject(400, 'Это не дверь.');
          if (wall.broken) reject(400, 'Двери нет — разрушена.');
          if (wall.locked && body.open) reject(400, 'Дверь заперта. Открыть её может мастер — или её можно выбить.');
          const rights = await rightsOf(q, member, userId);
          const placements = await loadPlacements(q, campaignId, sceneId);
          const near = placements.some(placement => placement.kind !== 'object' && !placement.parent_object_id
            && controls(rights, userId, placement.character_id, placement.owner_user_id)
            && distanceToWall(wall, { x: placement.world_x, z: placement.world_z }) * scene.feet_per_unit - footprintCells(placement.size) * 2.5 <= 5 + 1e-6);
          if (!near) reject(400, 'Открыть или закрыть дверь может тот, чьё существо стоит рядом с ней (в 5 футах).');
        }
        const { target, created, removed } = await isolateTile(q, campaignId, sceneId, userId, wall, manager ? body.tile : undefined);
        if (body.remove) {
          await q.query('DELETE FROM scene_walls WHERE campaign_id=$1 AND scene_id=$2 AND id=$3', [campaignId, sceneId, target.id]);
          await q.query('UPDATE scenes SET revision=revision+1 WHERE id=$1', [sceneId]);
          return { walls: created.filter(row => row.id !== target.id), removed: [...removed, target.id], target: null };
        }
        const look = body.style !== undefined || body.textureAssetId !== undefined
          ? await wallStyleOf(q, campaignId, body.style ?? target.style, body.textureAssetId === undefined ? target.texture_asset_id : body.textureAssetId)
          : { style: target.style, texture: target.texture_asset_id };
        const kind = body.kind ?? target.kind;
        const door = kind === 'door';
        const hpMax = body.hpMax === undefined ? target.hp_max : body.hpMax;
        const broken = body.broken ?? target.broken;
        const maxNow = wallDefense({ kind, style: look.style, hp_max: hpMax }).hpMax;
        const hp = body.broken === true ? 0 : body.broken === false ? null : target.hp === null ? null : Math.min(target.hp, maxNow);
        const updated = (
          await q.query(
            `UPDATE scene_walls SET style=$4, texture_asset_id=$5, kind=$6, open=$7, locked=$8, hp=$9, hp_max=$10, broken=$11
             WHERE campaign_id=$1 AND scene_id=$2 AND id=$3 RETURNING ${WALL_COLUMNS}`,
            [
              campaignId, sceneId, target.id, look.style, look.texture, kind,
              door && !broken && !(body.locked ?? target.locked) ? (body.open ?? target.open) : false, door ? (body.locked ?? target.locked) : false,
              hp, hpMax, broken,
            ],
          )
        ).rows[0] as WallRow;
        await q.query('UPDATE scenes SET revision=revision+1 WHERE id=$1', [sceneId]);
        const walls = created.length ? created.map(row => (row.id === updated.id ? updated : row)) : [updated];
        return { walls, removed, target: updated };
      });
      void notify(ctx, campaignId, sceneId);
      return { walls: result.walls, removed: result.removed };
    },
  );

  app.post<{ Params: WallParams; Body: { characterId: string; weaponId: string; tile?: number } }>(
    '/campaigns/:campaignId/scenes/:sceneId/walls/:wallId/strike',
    {
      schema: {
        params: wallParams,
        body: objectSchema({ characterId: uuid, weaponId: uuid, tile: { type: 'integer', minimum: 0, maximum: 2000 } }, ['characterId', 'weaponId']),
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, sceneId, wallId } = request.params;
      const { characterId, weaponId, tile } = request.body;
      let economyScene: string | null = null;
      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const manager = await canManage(q, member, userId);
        const scene = await getScene(q, campaignId, sceneId);
        const actor = (
          await q.query(
            `SELECT id, name, kind, owner_user_id, level, class_name, challenge_rating::float8 AS challenge_rating, sheet_extra,
                    strength, dexterity, constitution, intelligence, wisdom, charisma
             FROM characters WHERE campaign_id=$1 AND id=$2`,
            [campaignId, characterId],
          )
        ).rows[0];
        if (!actor || actor.kind === 'object') reject(404, 'Существо не найдено.');
        if (!(await canManageCharacter(q, member, userId, actor.owner_user_id, actor.id))) reject(403, 'Бить стену может тот, чьё это существо, или мастер.');
        const unable = incapacitatedReason(await loadConditionState(q, campaignId, actor.id));
        if (unable) reject(400, `${actor.name} не может действовать: ${unable}.`);
        const wall = await lockedWall(q, campaignId, sceneId, wallId);
        if (wall.broken) reject(400, 'Этот участок уже разрушен.');
        const weapon = (
          await q.query(
            'SELECT id, name, ability, damage_formula, damage_type, range_feet, weapon_kind FROM character_weapons WHERE campaign_id=$1 AND character_id=$2 AND id=$3',
            [campaignId, actor.id, weaponId],
          )
        ).rows[0];
        if (!weapon) reject(404, 'Оружие не найдено у этого существа.');
        const placements = await loadPlacements(q, campaignId, sceneId);
        const placement = placements.find(entry => entry.character_id === actor.id && !entry.parent_object_id);
        if (!placement) reject(400, `${actor.name} не на этой сцене.`);
        const reach = Math.max(5, Number(weapon.range_feet ?? 5));
        const feet = Math.max(0, distanceToWall(wall, { x: placement.world_x, z: placement.world_z }) * scene.feet_per_unit - footprintCells(placement.size) * 2.5);
        if (feet > reach + 1e-6) reject(400, `До стены ${Math.round(feet)} фт., а «${weapon.name}» достаёт на ${reach}.`);
        const aimed = tile !== undefined && wallSteps(wall) > 1 ? splitWall(wall, tile).find(part => part.part === 'tile')! : wall;
        const others = (
          await q.query<WallSegment>(`SELECT x1, z1, x2, z2 FROM scene_walls WHERE campaign_id=$1 AND scene_id=$2 AND id<>$3 ${WALLS_MOVE}`, [campaignId, sceneId, wall.id])
        ).rows;
        const blockers = await blockingPlacements(q, campaignId, scene, placements, 'move');
        if (!wallReachable({ x: placement.world_x, z: placement.world_z, size: footprintCells(placement.size) }, aimed, [...others, ...blockers.flatMap(blocker => blocker.edges)])) {
          reject(400, `Между ${actor.name} и ${wall.kind === 'door' ? 'дверью' : wall.kind === 'window' ? 'окном' : 'стеной'} — другая стена: через стены не бьют.`);
        }
        const spent = await actionEconomy.spend(q, campaignId, actor.id, 'action', { kind: 'attack' }, {
          enforce: await actionEconomy.enforceFor(q, campaignId, manager), sceneId, attacksPerAction: await attacksPerActionFor(q, campaignId, actor.id),
        });
        economyScene = spent?.sceneId ?? null;
        const { target, created, removed } = await isolateTile(q, campaignId, sceneId, userId, wall, tile);
        const defense = wallDefense(target);
        const check = await checkModifier(q, campaignId, actor, 'attack', weapon.id);
        const die = rollDie(20);
        const total = die + check.modifier;
        const critical = die === 20;
        const hit = die !== 1 && (critical || total >= defense.ac);
        const label = `Удар по ${target.kind === 'door' ? 'двери' : target.kind === 'window' ? 'окну' : 'стене'}: ${weapon.name} — ${actor.name}`.slice(0, 100);
        const attackRoll = await insertRoll(q, campaignId, userId, actor.id, label, d20Formula(check.modifier, 'none'), [die], check.modifier, total, false, null, {
          kind: 'attack', hit, critical, wall: { id: target.id, ac: defense.ac },
        });
        let damage = 0;
        let damageRoll: any = null;
        if (hit) {
          const resolved = resolveFormula(weaponDamageText(weapon.damage_formula ?? '1', check), sheetContext(actor, check.proficiencyBonus));
          if (resolved.ok) {
            const base = rollDice(resolved.parsed, rollDie);
            let dice = base.results;
            let rolled = base.total;
            if (critical) {
              const extra = rollDice({ count: resolved.parsed.count, sides: resolved.parsed.sides, modifier: 0 }, rollDie);
              dice = [...dice, ...extra.results];
              rolled += extra.total;
            }
            damage = WALL_IMMUNE.includes(weapon.damage_type) ? 0 : Math.max(0, rolled);
            damageRoll = await insertRoll(q, campaignId, userId, actor.id, `Урон по ${target.kind === 'door' ? 'двери' : target.kind === 'window' ? 'окну' : 'стене'}: ${weapon.name}`.slice(0, 100),
              resolved.formula.slice(0, 20), dice, resolved.parsed.modifier, Math.max(0, rolled), false, null, { kind: 'damage', wall: { id: target.id }, applied: damage });
          }
        }
        const before = target.hp ?? defense.hpMax;
        const hp = Math.max(0, before - damage);
        const broken = hp <= 0;
        const updated = (
          await q.query(
            `UPDATE scene_walls SET hp=$4, broken=$5, open=CASE WHEN $5 THEN false ELSE open END, locked=CASE WHEN $5 THEN false ELSE locked END
             WHERE campaign_id=$1 AND scene_id=$2 AND id=$3 RETURNING ${WALL_COLUMNS}`,
            [campaignId, sceneId, target.id, hp, broken],
          )
        ).rows[0] as WallRow;
        await q.query('UPDATE scenes SET revision=revision+1 WHERE id=$1', [sceneId]);
        const walls = created.length ? created.map(row => (row.id === updated.id ? updated : row)) : [updated];
        return {
          actor: actor.name, weapon: weapon.name, kind: target.kind, hit, critical, total, ac: defense.ac, damage, broken,
          hp: manager ? hp : undefined, hpMax: manager ? defense.hpMax : undefined, condition: wallCondition(hp, defense.hpMax, broken, target.kind),
          rollId: attackRoll.id, damageRollId: damageRoll?.id ?? null, wallId: updated.id, walls: manager ? walls : walls.map(wallForPlayer), removed,
        };
      });
      void notify(ctx, campaignId, sceneId);
      void notifyCampaign(ctx, campaignId, { type: 'rolls' });
      if (economyScene) void notifyCampaign(ctx, campaignId, { type: 'initiative', sceneId: economyScene });
      const what = result.kind === 'door' ? 'Дверь' : result.kind === 'window' ? 'Окно' : 'Стена';
      void notifyCampaign(ctx, campaignId, {
        type: 'notice', tone: result.broken ? 'crit' : 'info',
        title: `${result.actor} бьёт: ${what.toLowerCase()}`,
        detail: result.hit
          ? `${result.weapon}: ${result.total} против КД ${result.ac}${result.critical ? ' (крит)' : ''} — ${result.damage} урона. ${result.broken ? `${what} ${result.condition}!` : `${what}: ${result.condition}.`}`
          : `${result.weapon}: ${result.total} против КД ${result.ac} — мимо.`,
      });
      return result;
    },
  );
}
