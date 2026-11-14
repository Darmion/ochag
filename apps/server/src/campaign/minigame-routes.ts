import { MAP_STORIES, createMapFragments, actMapFragments, applyMapCheck, mapCheckAllowed, viewMapFragments, type MapFragments, type MapCommand } from '../../../../packages/domain/minigames/map-fragments.ts';
import { createDuel, actDuel, viewDuel, type Duel, type DuelCommand } from '../../../../packages/domain/minigames/duel.ts';
import { createChase, actChase, type Chase, type ChaseCommand } from '../../../../packages/domain/minigames/chase.ts';
import { RECIPES, createAlchemy, actAlchemy, type Alchemy, type AlchemyCommand } from '../../../../packages/domain/minigames/alchemy.ts';
import { createRitual, actRitual, type Ritual, type RitualCommand } from '../../../../packages/domain/minigames/seal-ritual.ts';
import { randomInt } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { Database, Queryable } from '../db.ts';
import { objectSchema, uuid, reject } from '../tabletop/scene-feature.ts';
import { CHEAT_DC, actDragonGame, applyCheat, cheatAllowed, createDragonGame, dragonWinners, type DragonAction, type DragonGame } from '../../../../packages/domain/minigames/dragon-dice.ts';
import { STAKE_MAX_CP, agreeToStake, assertWagerReady, setStake, withdrawStake } from '../../../../packages/domain/minigames/wagers.ts';
import { settleWager } from './minigame-wagers.ts';
import { newCheck } from '../../../../packages/domain/minigames/skill-checks.ts';
import { findSrdSkill } from '../rules/srd-data.ts';
import { rollSkillAgainst } from '../tabletop/rolls/checks.ts';

import { actRuneLock, applyRuneCheck, createRuneLock, runeCheckAllowed, viewRuneLock, type RuneAction, type RuneLock, type RuneSymbol } from '../../../../packages/domain/minigames/rune-lock.ts';
import type { CampaignEvent, CampaignEvents } from '../system/campaign-events.ts';
import { actableHeroes, checkActor, doorLink, givePotion, heroLink, linkChoices, lockTarget, objectLink, revealSecret, unlockTarget, type Door } from './minigame-links.ts';

type Options = { db: Database; auth: (request: FastifyRequest) => Promise<string>;
  membership: (q: Queryable, campaignId: string, userId: string, lock?: boolean) => Promise<any>;
  events: CampaignEvents;
};
type Kind = 'dragon-dice' | 'rune-lock' | 'seal-ritual' | 'alchemy' | 'chase' | 'duel' | 'map-fragments';

// Each campaign keeps one game of each kind in campaign_minigames (migration 108), so a restart no longer loses it.
// Every POST here also tells the table's /live sockets which game changed (system/campaign-events.ts).
export const minigameRoutes: FastifyPluginAsync<Options> = async (app, { db, auth, membership, events }) => {
  async function stored<T>(campaignId: string, kind: Kind): Promise<T | null> {
    const row = (await db.query('SELECT state FROM campaign_minigames WHERE campaign_id=$1 AND kind=$2', [campaignId, kind])).rows[0];
    return (row?.state ?? null) as T | null;
  }
  // A move reads the game under a row lock: two players acting at once cannot both build on the same revision.
  // A move that reaches the map or a sheet (minigame-links.ts) changes it in the same transaction; its live messages
  // go out after the commit.
  async function change<T>(campaignId: string, kind: Kind, next: (current: T | null, q: Queryable, sent: CampaignEvent[]) => T | Promise<T>): Promise<T> {
    const sent: CampaignEvent[] = [];
    const game = await db.transaction(async q => {
      await q.query('INSERT INTO campaign_minigames (campaign_id, kind) VALUES ($1,$2) ON CONFLICT DO NOTHING', [campaignId, kind]);
      const current = ((await q.query(
        'SELECT state FROM campaign_minigames WHERE campaign_id=$1 AND kind=$2 FOR UPDATE', [campaignId, kind],
      )).rows[0]?.state ?? null) as T | null;
      const game = await next(current, q, sent);
      await q.query('UPDATE campaign_minigames SET state=$3::jsonb, updated_at=now() WHERE campaign_id=$1 AND kind=$2', [campaignId, kind, JSON.stringify(game)]);
      return game;
    });
    for (const event of sent) events.emit(campaignId, event);
    return game;
  }
  const failed = (cause: unknown): never => {
    if (cause && typeof cause === 'object' && 'statusCode' in cause) throw cause;
    return reject(409, cause instanceof Error ? cause.message : 'Действие недоступно.');
  };
  // Only the rules' own errors become 409: a database error inside a move stays a 500.
  const attempt = <T>(move: () => T): T => {
    try { return move(); } catch (cause) { return failed(cause); }
  };

  const params = objectSchema({ campaignId: uuid });
  const path = '/campaigns/:campaignId/minigames/dragon-dice';
  async function viewer(request: FastifyRequest, campaignId: string) {
    const id = await auth(request);
    const member = await membership(db, campaignId, id);
    const { rows } = await db.query('SELECT display_name FROM users WHERE id=$1', [id]);
    return { id, name: String(rows[0]?.display_name ?? 'Игрок'), manager: member.owner_user_id === id || Boolean(member.is_full_gm), member };
  }
  // Stake, consent and withdrawal are the same in every game with winners (roadmap 4.6); null means «not a wager move».
  type WagerMove = { action: string; stakeCp?: number; heroId?: string };
  async function wagerMove<T extends DragonGame | Duel>(q: Queryable, campaignId: string, user: { id: string; member: any }, current: T, command: WagerMove) {
    if (command.action === 'stake') return attempt(() => setStake(current, user, command.stakeCp!));
    if (command.action === 'agree') {
      const hero = await checkActor(q, user.member, campaignId, user.id, command.heroId!);
      return attempt(() => agreeToStake(current, { userId: user.id, heroId: hero.id, heroName: hero.name }));
    }
    if (command.action === 'withdraw') {
      if (current.phase !== 'lobby') reject(409, 'Ставку отзывают до начала игры.');
      return { ...withdrawStake(current, user.id), revision: current.revision + 1 };
    }
    if (command.action === 'start') attempt(() => assertWagerReady(current));
    return null;
  }
  const stake = { type: 'integer', minimum: 0, maximum: STAKE_MAX_CP };
  // A hero's check in a game (roadmap 4.4): allowed first, then rolled with the hero's modifiers into the roll log.
  async function heroCheck(q: Queryable, campaignId: string, user: { id: string; member: any }, heroId: string, allowed: (actor: { id: string; name: string }) => void,
    check: { skill: string; dc: number }, title: string, sent: CampaignEvent[]) {
    const actor = await checkActor(q, user.member, campaignId, user.id, heroId);
    attempt(() => allowed(actor));
    const rolled = await rollSkillAgainst(q, campaignId, user.id, actor.id, check.skill, `${findSrdSkill(check.skill)?.nameRu ?? check.skill}: ${title}`, check.dc);
    sent.push({ type: 'rolls' });
    return { actor, success: rolled.success === true };
  }
  app.get<{ Params: { campaignId: string } }>(path, { schema: { params } }, async request => {
    const user = await viewer(request, request.params.campaignId);
    return {
      game: await stored<DragonGame>(request.params.campaignId, 'dragon-dice'), userId: user.id, manager: user.manager,
      actors: await actableHeroes(db, request.params.campaignId, user.id, user.manager),
    };
  });
  const dc = { type: 'integer', minimum: 5, maximum: 30 };
  app.post<{ Params: { campaignId: string }; Body: { action: DragonAction | 'create' | 'cheat' | 'stake' | 'agree' | 'withdraw'; revision: number; cheatDc?: number; heroId?: string; stakeCp?: number } }>(path, {
    schema: { params, body: { oneOf: [
      objectSchema({ action: { const: 'create' }, revision: { type: 'integer', minimum: 0 }, cheatDc: dc }, ['action', 'revision']),
      objectSchema({ action: { type: 'string', enum: ['cheat', 'agree'] }, revision: { type: 'integer', minimum: 0 }, heroId: uuid }),
      objectSchema({ action: { const: 'stake' }, revision: { type: 'integer', minimum: 0 }, stakeCp: stake }),
      objectSchema({ action: { type: 'string', enum: ['join', 'leave', 'start', 'roll', 'bank', 'cancel', 'withdraw'] }, revision: { type: 'integer', minimum: 0 } }),
    ] } },
  }, async request => {
    const campaignId = request.params.campaignId;
    const user = await viewer(request, campaignId);
    const command = request.body;
    // Only the GM sets how hard it is to hide a dragon; a table opened by a player keeps the usual DC.
    if (command.action === 'create' && command.cheatDc !== undefined && !user.manager) return reject(403, 'СЛ подмены задаёт мастер.');
    const game = await change<DragonGame>(campaignId, 'dragon-dice', async (current, q, sent) => {
      if ((current?.revision ?? 0) !== command.revision) reject(409, 'Стол уже изменился. Состояние обновлено — повторите действие.');
      if (command.action === 'create') {
        if (current && (current.phase === 'lobby' || current.phase === 'playing')) reject(409, 'В кампании уже открыта партия.');
        return createDragonGame(user.id, user.name, (current?.revision ?? 0) + 1, command.cheatDc ?? CHEAT_DC);
      }
      if (!current) return reject(404, 'Партия не найдена.');
      const staked = await wagerMove(q, campaignId, user, current, command);
      if (staked) return staked;
      let moved: DragonGame;
      if (command.action === 'cheat') {
        const { success } = await heroCheck(q, campaignId, user, command.heroId!, () => cheatAllowed(current, user),
          { skill: 'sleight-of-hand', dc: current.cheatDc ?? CHEAT_DC }, 'подмена кости', sent);
        moved = attempt(() => applyCheat(current, user, success));
      } else moved = attempt(() => actDragonGame(current, command.action as DragonAction, user, () => randomInt(1, 7)));
      if (command.action === 'leave') moved = withdrawStake(moved, user.id);
      return settleWager(q, campaignId, current, moved, () => dragonWinners(moved).map(player => player.id), sent);
    });
    return { game, userId: user.id, manager: user.manager };
  });
  const runePath = '/campaigns/:campaignId/minigames/rune-lock';
  app.get<{ Params: { campaignId: string } }>(runePath, { schema: { params } }, async request => {
    const user = await viewer(request, request.params.campaignId);
    const game = await stored<RuneLock>(request.params.campaignId, 'rune-lock');
    return {
      game: game ? viewRuneLock(game, user.manager) : null, manager: user.manager,
      actors: await actableHeroes(db, request.params.campaignId, user.id, user.manager),
      ...(user.manager ? { lockables: await linkChoices(db, request.params.campaignId, 'lockable') } : {}),
    };
  });
  type RuneBody = {
    revision: number; action: RuneAction['action'] | 'create' | 'symbols' | 'skill'; symbols?: RuneSymbol[]; solution?: number[]; hint?: string; limit?: number;
    ring?: number; step?: number; targetId?: string; door?: Door; checkSkill?: string; checkDc?: number; heroId?: string;
  };
  const checkDc = { type: 'integer', minimum: 5, maximum: 30 };
  const point = { type: 'number', minimum: -1000, maximum: 1000 };
  const door = objectSchema({ sceneId: uuid, x1: point, z1: point, x2: point, z2: point });
  const revision = { type: 'integer', minimum: 0 };
  const symbols = { type: 'array', minItems: 6, maxItems: 6, items: objectSchema({ name: { type: 'string', minLength: 1, maxLength: 40, pattern: '\\S' }, assetId: { anyOf: [uuid, { type: 'null' }] } }) };
  const ring = { type: 'integer', minimum: 0, maximum: 2 };
  app.post<{ Params: { campaignId: string }; Body: RuneBody }>(runePath, {
    schema: { params, body: { oneOf: [
      objectSchema({ action: { const: 'symbols' }, revision, symbols }),
      objectSchema({ action: { const: 'create' }, revision, symbols, solution: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'integer', minimum: 0, maximum: 5 } }, hint: { type: 'string', maxLength: 600 }, limit: { type: 'integer', minimum: 1, maximum: 12 }, targetId: uuid, door, checkSkill: { type: 'string', enum: ['arcana', 'investigation'] }, checkDc }, ['action', 'revision', 'solution', 'hint', 'limit']),
      objectSchema({ action: { const: 'skill' }, revision, ring, heroId: uuid }),
      objectSchema({ action: { const: 'rotate' }, revision, ring, step: { type: 'integer', enum: [-1, 1] } }),
      objectSchema({ action: { const: 'reveal' }, revision, ring }),
      objectSchema({ action: { type: 'string', enum: ['check', 'open', 'cancel'] }, revision }),
    ] } },
  }, async request => {
    const campaignId = request.params.campaignId;
    const user = await viewer(request, campaignId);
    const command = request.body;
    if (['create', 'symbols', 'reveal', 'open', 'cancel'].includes(command.action) && !user.manager) return reject(403, 'Это действие доступно только мастеру.');
    if (command.symbols) {
      const ids = [...new Set(command.symbols.map(s => s.assetId).filter(Boolean))];
      if (ids.length) {
        const { rows } = await db.query("SELECT id FROM assets WHERE campaign_id=$1 AND id=ANY($2::uuid[]) AND content_type IN ('image/png','image/jpeg','image/webp')", [campaignId, ids]);
        if (rows.length !== ids.length) return reject(400, 'Изображение не найдено в этой кампании.');
      }
    }
    if (command.targetId && command.door) return reject(400, 'Замок вешается на что-то одно: на предмет или на дверь.');
    const game = await change<RuneLock>(campaignId, 'rune-lock', async (current, q, sent) => {
      if ((current?.revision ?? 0) !== command.revision) reject(409, 'Кольца уже изменились. Проверьте новое положение и повторите действие.');
      if (command.action !== 'create' && !current) reject(404, 'Замок не найден.');
      if (command.action === 'create') {
        if (current?.phase === 'active') reject(409, 'Сначала завершите текущую головоломку.');
        const target = command.targetId ? await objectLink(q, campaignId, command.targetId) : command.door ? await doorLink(q, campaignId, command.door) : null;
        const created = attempt(() => createRuneLock(command.solution!, command.hint!, command.limit!, (current?.revision ?? 0) + 1, command.symbols, target,
          newCheck('rune-lock', command.checkSkill, command.checkDc)));
        if (target) {
          await lockTarget(q, campaignId, target);
          sent.push({ type: 'changed' });
        }
        return created;
      }
      if (command.action === 'symbols') return { ...current!, symbols: structuredClone(command.symbols!), revision: current!.revision + 1 };
      if (command.action === 'skill') {
        const { actor, success } = await heroCheck(q, campaignId, user, command.heroId!, actor => runeCheckAllowed(current!, command.ring!, actor),
          current!.check!, 'рунный замок', sent);
        return attempt(() => applyRuneCheck(current!, command.ring!, actor, success));
      }
      const moved = attempt(() => actRuneLock(current!, command as RuneAction, user.manager));
      if (moved.phase !== 'opened' || current!.phase === 'opened' || !moved.target) return moved;
      const outcome = await unlockTarget(q, campaignId, moved.target);
      sent.push(...outcome.events);
      return { ...moved, effect: outcome.text };
    });
    return { game: viewRuneLock(game, user.manager), manager: user.manager };
  });

  const ritualPath = '/campaigns/:campaignId/minigames/seal-ritual';
  app.get<{ Params: { campaignId: string } }>(ritualPath, { schema: { params } }, async request => {
    const user = await viewer(request, request.params.campaignId);
    return { game: await stored<Ritual>(request.params.campaignId, 'seal-ritual'), manager: user.manager };
  });
  app.post<{ Params: { campaignId: string }; Body: (RitualCommand | { action: 'create'; limit: number }) & { revision: number } }>(ritualPath, {
    schema: { params, body: { oneOf: [
      objectSchema({ action: { const: 'create' }, revision, limit: { type: 'integer', minimum: 6, maximum: 20 } }),
      objectSchema({ action: { const: 'transfer' }, revision, from: { type: 'integer', minimum: 0, maximum: 3 }, direction: { type: 'integer', enum: [-1, 1] }, amount: { type: 'integer', enum: [1, 2] } }),
      objectSchema({ action: { type: 'string', enum: ['stabilize', 'cancel'] }, revision }),
    ] } },
  }, async request => {
    const user = await viewer(request, request.params.campaignId), command = request.body;
    if (['create', 'cancel'].includes(command.action) && !user.manager) return reject(403, 'Это действие доступно только мастеру.');
    const game = await change<Ritual>(request.params.campaignId, 'seal-ritual', current => {
      if ((current?.revision ?? 0) !== command.revision) reject(409, 'Печати уже изменились. Состояние обновлено — повторите действие.');
      if (command.action !== 'create' && !current) reject(404, 'Ритуал не найден.');
      try {
        if (command.action === 'create') {
          if (current?.phase === 'active') reject(409, 'Сначала завершите текущий ритуал.');
          return createRitual((current?.revision ?? 0) + 1, command.limit, randomInt(0, 4));
        }
        return actRitual(current!, command, user);
      } catch (cause) { return failed(cause); }
    });
    return { game, manager: user.manager };
  });

  const alchemyPath = '/campaigns/:campaignId/minigames/alchemy';
  app.get<{ Params: { campaignId: string } }>(alchemyPath, { schema: { params } }, async request => {
    const user = await viewer(request, request.params.campaignId);
    return {
      game: await stored<Alchemy>(request.params.campaignId, 'alchemy'), manager: user.manager,
      ...(user.manager ? { heroes: await linkChoices(db, request.params.campaignId, 'hero') } : {}),
    };
  });
  app.post<{ Params: { campaignId: string }; Body: (AlchemyCommand | { action: 'create'; recipe: number; limit: number; heroId?: string }) & { revision: number } }>(alchemyPath, {
    schema: { params, body: { oneOf: [
      objectSchema({ action: { const: 'create' }, revision, recipe: { type: 'integer', minimum: 0, maximum: 2 }, limit: { type: 'integer', minimum: 4, maximum: 16 }, heroId: uuid }, ['action', 'revision', 'recipe', 'limit']),
      objectSchema({ action: { const: 'add' }, revision, ingredient: { type: 'integer', minimum: 0, maximum: 3 } }),
      objectSchema({ action: { type: 'string', enum: ['heat', 'cool', 'stir', 'bottle', 'cancel'] }, revision }),
    ] } },
  }, async request => {
    const user = await viewer(request, request.params.campaignId), command = request.body;
    if (['create', 'cancel'].includes(command.action) && !user.manager) return reject(403, 'Это действие доступно только мастеру.');
    const campaignId = request.params.campaignId;
    const game = await change<Alchemy>(campaignId, 'alchemy', async (current, q, sent) => {
      if ((current?.revision ?? 0) !== command.revision) reject(409, 'Смесь уже изменилась. Проверьте новое состояние и повторите действие.');
      if (command.action !== 'create' && !current) reject(404, 'Котёл не найден.');
      if (command.action === 'create') {
        if (current?.phase === 'brewing') reject(409, 'Сначала завершите текущее приготовление.');
        const recipient = command.heroId ? await heroLink(q, campaignId, command.heroId) : null;
        return attempt(() => createAlchemy((current?.revision ?? 0) + 1, command.recipe, command.limit, recipient));
      }
      const moved = attempt(() => actAlchemy(current!, command, user));
      if (moved.phase !== 'perfect' || current!.phase === 'perfect' || !moved.recipient) return moved;
      const outcome = await givePotion(q, campaignId, moved.recipient, RECIPES[moved.recipe]!);
      sent.push(...outcome.events);
      return { ...moved, effect: outcome.text };
    });
    return { game, manager: user.manager };
  });
  const chasePath = '/campaigns/:campaignId/minigames/chase';
  app.get<{ Params: { campaignId: string } }>(chasePath, { schema: { params } }, async request => {
    const user = await viewer(request, request.params.campaignId);
    return { game: await stored<Chase>(request.params.campaignId, 'chase'), manager: user.manager };
  });
  app.post<{ Params: { campaignId: string }; Body: (ChaseCommand | { action: 'create' }) & { revision: number } }>(chasePath, {
    schema: { params, body: { oneOf: [
      objectSchema({ action: { const: 'route' }, revision, route: { type: 'integer', minimum: 0, maximum: 2 } }),
      objectSchema({ action: { type: 'string', enum: ['create', 'sprint', 'hide', 'detour', 'cancel'] }, revision }),
    ] } },
  }, async request => {
    const user = await viewer(request, request.params.campaignId), command = request.body;
    if (['create', 'cancel'].includes(command.action) && !user.manager) return reject(403, 'Это действие доступно только мастеру.');
    const game = await change<Chase>(request.params.campaignId, 'chase', current => {
      if ((current?.revision ?? 0) !== command.revision) reject(409, 'Погоня уже продвинулась. Проверьте новое состояние и повторите действие.');
      if (command.action !== 'create' && !current) reject(404, 'Погоня не найдена.');
      try {
        if (command.action === 'create') {
          if (current && ['route', 'obstacle'].includes(current.phase)) reject(409, 'Сначала завершите текущую погоню.');
          return createChase((current?.revision ?? 0) + 1);
        }
        return actChase(current!, command, user, max => randomInt(0, max));
      } catch (cause) { return failed(cause); }
    });
    return { game, manager: user.manager };
  });
  const duelPath = '/campaigns/:campaignId/minigames/duel';
  app.get<{ Params: { campaignId: string } }>(duelPath, { schema: { params } }, async request => {
    const user = await viewer(request, request.params.campaignId), game = await stored<Duel>(request.params.campaignId, 'duel');
    return {
      game: game ? viewDuel(game, user.id) : null, userId: user.id, manager: user.manager,
      actors: await actableHeroes(db, request.params.campaignId, user.id, user.manager),
    };
  });
  type DuelBody = (DuelCommand | { action: 'create' | 'withdraw' } | { action: 'stake'; stakeCp: number } | { action: 'agree'; heroId: string }) & { revision: number };
  app.post<{ Params: { campaignId: string }; Body: DuelBody }>(duelPath, {
    schema: { params, body: { oneOf: [
      objectSchema({ action: { const: 'choose' }, revision, move: { type: 'string', enum: ['strike', 'feint', 'guard', 'rest'] } }),
      objectSchema({ action: { const: 'stake' }, revision, stakeCp: stake }),
      objectSchema({ action: { const: 'agree' }, revision, heroId: uuid }),
      objectSchema({ action: { type: 'string', enum: ['create', 'join', 'leave', 'start', 'surrender', 'cancel', 'withdraw'] }, revision }),
    ] } },
  }, async request => {
    const campaignId = request.params.campaignId;
    const user = await viewer(request, campaignId), command = request.body;
    const game = await change<Duel>(campaignId, 'duel', async (current, q, sent) => {
      if ((current?.revision ?? 0) !== command.revision) reject(409, 'Дуэль уже изменилась. Проверьте состояние и повторите действие.');
      if (command.action !== 'create' && !current) reject(404, 'Дуэль не найдена.');
      if (command.action === 'create') {
        if (current && ['lobby', 'playing'].includes(current.phase)) reject(409, 'В кампании уже открыта дуэль.');
        return createDuel(user.id, user.name, (current?.revision ?? 0) + 1);
      }
      const staked = await wagerMove(q, campaignId, user, current!, command as WagerMove);
      if (staked) return staked;
      let moved = attempt(() => actDuel(current!, command as DuelCommand, user));
      if (command.action === 'leave') moved = withdrawStake(moved, user.id);
      return settleWager(q, campaignId, current, moved, () => (moved.winnerId ? [moved.winnerId] : []), sent);
    });
    return { game: viewDuel(game, user.id), userId: user.id, manager: user.manager };
  });
  const fragmentsPath = '/campaigns/:campaignId/minigames/map-fragments';
  const stories = MAP_STORIES.map((story, id) => ({ id, title: story.title, description: story.description }));
  app.get<{ Params: { campaignId: string } }>(fragmentsPath, { schema: { params } }, async request => {
    const user = await viewer(request, request.params.campaignId), game = await stored<MapFragments>(request.params.campaignId, 'map-fragments');
    return {
      game: game ? viewMapFragments(game, user.manager) : null, manager: user.manager, stories,
      actors: await actableHeroes(db, request.params.campaignId, user.id, user.manager),
      ...(user.manager ? { secrets: await linkChoices(db, request.params.campaignId, 'secret') } : {}),
    };
  });
  type MapBody = (MapCommand | { action: 'create'; story: number; targetId?: string; checkSkill?: string; checkDc?: number } | { action: 'skill'; heroId: string }) & { revision: number };
  app.post<{ Params: { campaignId: string }; Body: MapBody }>(fragmentsPath, {
    schema: { params, body: { oneOf: [
      objectSchema({ action: { const: 'create' }, revision, story: { type: 'integer', minimum: 0, maximum: 2 }, targetId: uuid,
        checkSkill: { type: 'string', enum: ['history', 'survival', 'investigation'] }, checkDc }, ['action', 'revision', 'story']),
      objectSchema({ action: { const: 'skill' }, revision, heroId: uuid }),
      objectSchema({ action: { const: 'append' }, revision, place: { type: 'integer', minimum: 0, maximum: 4 } }),
      objectSchema({ action: { const: 'remove' }, revision, slot: { type: 'integer', minimum: 0, maximum: 3 } }),
      objectSchema({ action: { const: 'mark' }, revision, scrap: { type: 'integer', minimum: 0, maximum: 3 } }),
      objectSchema({ action: { const: 'note' }, revision, text: { type: 'string', minLength: 1, maxLength: 240 } }),
      objectSchema({ action: { type: 'string', enum: ['check', 'hint', 'solve', 'cancel'] }, revision }),
    ] } },
  }, async request => {
    const user = await viewer(request, request.params.campaignId), command = request.body;
    if (['create', 'hint', 'solve', 'cancel'].includes(command.action) && !user.manager) return reject(403, 'Это действие доступно только мастеру.');
    const campaignId = request.params.campaignId;
    const game = await change<MapFragments>(campaignId, 'map-fragments', async (current, q, sent) => {
      if ((current?.revision ?? 0) !== command.revision) reject(409, 'Карта уже изменилась. Проверьте состояние и повторите действие.');
      if (command.action !== 'create' && !current) reject(404, 'Карта не найдена.');
      if (command.action === 'create') {
        if (current?.phase === 'active') reject(409, 'Сначала завершите текущий поиск.');
        const target = command.targetId ? await objectLink(q, campaignId, command.targetId) : null;
        return attempt(() => createMapFragments((current?.revision ?? 0) + 1, command.story, target, newCheck('map-fragments', command.checkSkill, command.checkDc)));
      }
      if (command.action === 'skill') {
        const { actor, success } = await heroCheck(q, campaignId, user, command.heroId, actor => mapCheckAllowed(current!, actor),
          current!.check!, 'карта по обрывкам', sent);
        return attempt(() => applyMapCheck(current!, actor, success));
      }
      const moved = attempt(() => actMapFragments(current!, command, user));
      if (moved.phase !== 'solved' || current!.phase === 'solved' || !moved.target) return moved;
      const outcome = await revealSecret(q, campaignId, moved.target);
      sent.push(...outcome.events);
      return { ...moved, effect: outcome.text };
    });
    return { game: viewMapFragments(game, user.manager), manager: user.manager, stories };
  });
};
