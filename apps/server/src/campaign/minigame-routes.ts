import { MAP_STORIES, createMapFragments, actMapFragments, viewMapFragments, type MapFragments, type MapCommand } from '../../../../packages/domain/minigames/map-fragments.ts';
import { createDuel, actDuel, viewDuel, type Duel, type DuelCommand } from '../../../../packages/domain/minigames/duel.ts';
import { createChase, actChase, type Chase, type ChaseCommand } from '../../../../packages/domain/minigames/chase.ts';
import { createAlchemy, actAlchemy, type Alchemy, type AlchemyCommand } from '../../../../packages/domain/minigames/alchemy.ts';
import { createRitual, actRitual, type Ritual, type RitualCommand } from '../../../../packages/domain/minigames/seal-ritual.ts';
import { randomInt } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { Database, Queryable } from '../db.ts';
import { objectSchema, uuid, reject } from '../tabletop/scene-feature.ts';
import { actDragonGame, createDragonGame, type DragonAction, type DragonGame } from '../../../../packages/domain/minigames/dragon-dice.ts';

import { actRuneLock, createRuneLock, viewRuneLock, type RuneAction, type RuneLock, type RuneSymbol } from '../../../../packages/domain/minigames/rune-lock.ts';

type Options = { db: Database; auth: (request: FastifyRequest) => Promise<string>;
  membership: (q: Queryable, campaignId: string, userId: string, lock?: boolean) => Promise<any>;
};
export const minigameRoutes: FastifyPluginAsync<Options> = async (app, { db, auth, membership }) => {
  const fragmentMaps = new Map<string, MapFragments>();
  const duels = new Map<string, Duel>();
  const games = new Map<string, DragonGame>();
  const chases = new Map<string, Chase>();
  const cauldrons = new Map<string, Alchemy>();
  const rituals = new Map<string, Ritual>();
  const locks = new Map<string, RuneLock>();
  app.addHook('onClose', async () => { games.clear(); locks.clear(); rituals.clear(); cauldrons.clear(); chases.clear(); duels.clear(); fragmentMaps.clear(); });
  const params = objectSchema({ campaignId: uuid });
  const path = '/campaigns/:campaignId/minigames/dragon-dice';
  async function viewer(request: FastifyRequest, campaignId: string) {
    const id = await auth(request);
    const member = await membership(db, campaignId, id);
    const { rows } = await db.query('SELECT display_name FROM users WHERE id=$1', [id]);
    return { id, name: String(rows[0]?.display_name ?? 'Игрок'), manager: member.owner_user_id === id || Boolean(member.is_full_gm) };
  }
  app.get<{ Params: { campaignId: string } }>(path, { schema: { params } }, async request => {
    const user = await viewer(request, request.params.campaignId);
    return { game: games.get(request.params.campaignId) ?? null, userId: user.id, manager: user.manager };
  });
  app.post<{ Params: { campaignId: string }; Body: { action: DragonAction | 'create'; revision: number } }>(path, {
    schema: { params, body: objectSchema({ action: { type: 'string', enum: ['create', 'join', 'leave', 'start', 'roll', 'bank', 'cancel'] }, revision: { type: 'integer', minimum: 0 } }) },
  }, async request => {
    const campaignId = request.params.campaignId;
    const user = await viewer(request, campaignId);
    const current = games.get(campaignId);
    if ((current?.revision ?? 0) !== request.body.revision) reject(409, 'Стол уже изменился. Состояние обновлено — повторите действие.');
    let game: DragonGame;
    if (request.body.action === 'create') {
      if (current && (current.phase === 'lobby' || current.phase === 'playing')) reject(409, 'В кампании уже открыта партия.');
      if (!current && games.size >= 1024) reject(409, 'Лимит столов сервера достигнут — перезапустите сервер, чтобы освободить место.');
      game = createDragonGame(user.id, user.name, (current?.revision ?? 0) + 1);
    } else {
      if (!current) return reject(404, 'Партия не найдена.');
      try { game = actDragonGame(current, request.body.action, user, () => randomInt(1, 7)); }
      catch (cause) { return reject(409, cause instanceof Error ? cause.message : 'Действие недоступно.'); }
    }
    games.set(campaignId, game);
    return { game, userId: user.id, manager: user.manager };
  });
  const runePath = '/campaigns/:campaignId/minigames/rune-lock';
  app.get<{ Params: { campaignId: string } }>(runePath, { schema: { params } }, async request => {
    const user = await viewer(request, request.params.campaignId);
    const game = locks.get(request.params.campaignId);
    return { game: game ? viewRuneLock(game, user.manager) : null, manager: user.manager };
  });
  type RuneBody = { revision: number; action: RuneAction['action'] | 'create' | 'symbols'; symbols?: RuneSymbol[]; solution?: number[]; hint?: string; limit?: number; ring?: number; step?: number };
  const revision = { type: 'integer', minimum: 0 };
  const symbols = { type: 'array', minItems: 6, maxItems: 6, items: objectSchema({ name: { type: 'string', minLength: 1, maxLength: 40, pattern: '\\S' }, assetId: { anyOf: [uuid, { type: 'null' }] } }) };
  const ring = { type: 'integer', minimum: 0, maximum: 2 };
  app.post<{ Params: { campaignId: string }; Body: RuneBody }>(runePath, {
    schema: { params, body: { oneOf: [
      objectSchema({ action: { const: 'symbols' }, revision, symbols }),
      objectSchema({ action: { const: 'create' }, revision, symbols, solution: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'integer', minimum: 0, maximum: 5 } }, hint: { type: 'string', maxLength: 600 }, limit: { type: 'integer', minimum: 1, maximum: 12 } }, ['action', 'revision', 'solution', 'hint', 'limit']),
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
    const current = locks.get(campaignId);
    if ((current?.revision ?? 0) !== command.revision) return reject(409, 'Кольца уже изменились. Проверьте новое положение и повторите действие.');
    if (command.action !== 'create' && !current) return reject(404, 'Замок не найден.');
    let game: RuneLock;
    try {
      if (command.action === 'create') {
        if (current?.phase === 'active') return reject(409, 'Сначала завершите текущую головоломку.');
        if (!current && locks.size >= 1024) return reject(409, 'Лимит головоломок сервера достигнут — перезапустите сервер, чтобы освободить место.');
        game = createRuneLock(command.solution!, command.hint!, command.limit!, (current?.revision ?? 0) + 1, command.symbols);
      } else if (command.action === 'symbols') {
        game = { ...current!, symbols: structuredClone(command.symbols!), revision: current!.revision + 1 };
      } else {
        game = actRuneLock(current!, command as RuneAction, user.manager);
      }
    } catch (cause) { return reject(409, cause instanceof Error ? cause.message : 'Действие недоступно.'); }
    locks.set(campaignId, game);
    return { game: viewRuneLock(game, user.manager), manager: user.manager };
  });

  const ritualPath = '/campaigns/:campaignId/minigames/seal-ritual';
  app.get<{ Params: { campaignId: string } }>(ritualPath, { schema: { params } }, async request => {
    const user = await viewer(request, request.params.campaignId);
    return { game: rituals.get(request.params.campaignId) ?? null, manager: user.manager };
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
    const current = rituals.get(request.params.campaignId);
    if ((current?.revision ?? 0) !== command.revision) return reject(409, 'Печати уже изменились. Состояние обновлено — повторите действие.');
    if (command.action !== 'create' && !current) return reject(404, 'Ритуал не найден.');
    let game: Ritual;
    try {
      if (command.action === 'create') {
        if (current?.phase === 'active') return reject(409, 'Сначала завершите текущий ритуал.');
        if (!current && rituals.size >= 1024) return reject(409, 'Лимит ритуалов сервера достигнут — перезапустите сервер, чтобы освободить место.');
        game = createRitual((current?.revision ?? 0) + 1, command.limit, randomInt(0, 4));
      } else game = actRitual(current!, command, user);
    } catch (cause) { return reject(409, cause instanceof Error ? cause.message : 'Действие недоступно.'); }
    rituals.set(request.params.campaignId, game);
    return { game, manager: user.manager };
  });

  const alchemyPath = '/campaigns/:campaignId/minigames/alchemy';
  app.get<{ Params: { campaignId: string } }>(alchemyPath, { schema: { params } }, async request => {
    const user = await viewer(request, request.params.campaignId);
    return { game: cauldrons.get(request.params.campaignId) ?? null, manager: user.manager };
  });
  app.post<{ Params: { campaignId: string }; Body: (AlchemyCommand | { action: 'create'; recipe: number; limit: number }) & { revision: number } }>(alchemyPath, {
    schema: { params, body: { oneOf: [
      objectSchema({ action: { const: 'create' }, revision, recipe: { type: 'integer', minimum: 0, maximum: 2 }, limit: { type: 'integer', minimum: 4, maximum: 16 } }),
      objectSchema({ action: { const: 'add' }, revision, ingredient: { type: 'integer', minimum: 0, maximum: 3 } }),
      objectSchema({ action: { type: 'string', enum: ['heat', 'cool', 'stir', 'bottle', 'cancel'] }, revision }),
    ] } },
  }, async request => {
    const user = await viewer(request, request.params.campaignId), command = request.body;
    if (['create', 'cancel'].includes(command.action) && !user.manager) return reject(403, 'Это действие доступно только мастеру.');
    const current = cauldrons.get(request.params.campaignId);
    if ((current?.revision ?? 0) !== command.revision) return reject(409, 'Смесь уже изменилась. Проверьте новое состояние и повторите действие.');
    if (command.action !== 'create' && !current) return reject(404, 'Котёл не найден.');
    let game: Alchemy;
    try {
      if (command.action === 'create') {
        if (current?.phase === 'brewing') return reject(409, 'Сначала завершите текущее приготовление.');
        if (!current && cauldrons.size >= 1024) return reject(409, 'Лимит котлов сервера достигнут — перезапустите сервер, чтобы освободить место.');
        game = createAlchemy((current?.revision ?? 0) + 1, command.recipe, command.limit);
      } else game = actAlchemy(current!, command, user);
    } catch (cause) { return reject(409, cause instanceof Error ? cause.message : 'Действие недоступно.'); }
    cauldrons.set(request.params.campaignId, game);
    return { game, manager: user.manager };
  });
  const chasePath = '/campaigns/:campaignId/minigames/chase';
  app.get<{ Params: { campaignId: string } }>(chasePath, { schema: { params } }, async request => {
    const user = await viewer(request, request.params.campaignId);
    return { game: chases.get(request.params.campaignId) ?? null, manager: user.manager };
  });
  app.post<{ Params: { campaignId: string }; Body: (ChaseCommand | { action: 'create' }) & { revision: number } }>(chasePath, {
    schema: { params, body: { oneOf: [
      objectSchema({ action: { const: 'route' }, revision, route: { type: 'integer', minimum: 0, maximum: 2 } }),
      objectSchema({ action: { type: 'string', enum: ['create', 'sprint', 'hide', 'detour', 'cancel'] }, revision }),
    ] } },
  }, async request => {
    const user = await viewer(request, request.params.campaignId), command = request.body;
    if (['create', 'cancel'].includes(command.action) && !user.manager) return reject(403, 'Это действие доступно только мастеру.');
    const current = chases.get(request.params.campaignId);
    if ((current?.revision ?? 0) !== command.revision) return reject(409, 'Погоня уже продвинулась. Проверьте новое состояние и повторите действие.');
    if (command.action !== 'create' && !current) return reject(404, 'Погоня не найдена.');
    let game: Chase;
    try {
      if (command.action === 'create') {
        if (current && ['route', 'obstacle'].includes(current.phase)) return reject(409, 'Сначала завершите текущую погоню.');
        if (!current && chases.size >= 1024) return reject(409, 'Лимит погонь сервера достигнут — перезапустите сервер, чтобы освободить место.');
        game = createChase((current?.revision ?? 0) + 1);
      } else game = actChase(current!, command, user, max => randomInt(0, max));
    } catch (cause) { return reject(409, cause instanceof Error ? cause.message : 'Действие недоступно.'); }
    chases.set(request.params.campaignId, game);
    return { game, manager: user.manager };
  });
  const duelPath = '/campaigns/:campaignId/minigames/duel';
  app.get<{ Params: { campaignId: string } }>(duelPath, { schema: { params } }, async request => {
    const user = await viewer(request, request.params.campaignId), game = duels.get(request.params.campaignId);
    return { game: game ? viewDuel(game, user.id) : null, userId: user.id, manager: user.manager };
  });
  app.post<{ Params: { campaignId: string }; Body: (DuelCommand | { action: 'create' }) & { revision: number } }>(duelPath, {
    schema: { params, body: { oneOf: [
      objectSchema({ action: { const: 'choose' }, revision, move: { type: 'string', enum: ['strike', 'feint', 'guard', 'rest'] } }),
      objectSchema({ action: { type: 'string', enum: ['create', 'join', 'leave', 'start', 'surrender', 'cancel'] }, revision }),
    ] } },
  }, async request => {
    const user = await viewer(request, request.params.campaignId), command = request.body;
    const current = duels.get(request.params.campaignId);
    if ((current?.revision ?? 0) !== command.revision) return reject(409, 'Дуэль уже изменилась. Проверьте состояние и повторите действие.');
    if (command.action !== 'create' && !current) return reject(404, 'Дуэль не найдена.');
    let game: Duel;
    try {
      if (command.action === 'create') {
        if (current && ['lobby', 'playing'].includes(current.phase)) return reject(409, 'В кампании уже открыта дуэль.');
        if (!current && duels.size >= 1024) return reject(409, 'Лимит дуэлей сервера достигнут — перезапустите сервер, чтобы освободить место.');
        game = createDuel(user.id, user.name, (current?.revision ?? 0) + 1);
      } else game = actDuel(current!, command, user);
    } catch (cause) { return reject(409, cause instanceof Error ? cause.message : 'Действие недоступно.'); }
    duels.set(request.params.campaignId, game);
    return { game: viewDuel(game, user.id), userId: user.id, manager: user.manager };
  });
  const fragmentsPath = '/campaigns/:campaignId/minigames/map-fragments';
  const stories = MAP_STORIES.map((story, id) => ({ id, title: story.title, description: story.description }));
  app.get<{ Params: { campaignId: string } }>(fragmentsPath, { schema: { params } }, async request => {
    const user = await viewer(request, request.params.campaignId), game = fragmentMaps.get(request.params.campaignId);
    return { game: game ? viewMapFragments(game, user.manager) : null, manager: user.manager, stories };
  });
  app.post<{ Params: { campaignId: string }; Body: (MapCommand | { action: 'create'; story: number }) & { revision: number } }>(fragmentsPath, {
    schema: { params, body: { oneOf: [
      objectSchema({ action: { const: 'create' }, revision, story: { type: 'integer', minimum: 0, maximum: 2 } }),
      objectSchema({ action: { const: 'append' }, revision, place: { type: 'integer', minimum: 0, maximum: 4 } }),
      objectSchema({ action: { const: 'remove' }, revision, slot: { type: 'integer', minimum: 0, maximum: 3 } }),
      objectSchema({ action: { const: 'mark' }, revision, scrap: { type: 'integer', minimum: 0, maximum: 3 } }),
      objectSchema({ action: { const: 'note' }, revision, text: { type: 'string', minLength: 1, maxLength: 240 } }),
      objectSchema({ action: { type: 'string', enum: ['check', 'hint', 'solve', 'cancel'] }, revision }),
    ] } },
  }, async request => {
    const user = await viewer(request, request.params.campaignId), command = request.body;
    if (['create', 'hint', 'solve', 'cancel'].includes(command.action) && !user.manager) return reject(403, 'Это действие доступно только мастеру.');
    const current = fragmentMaps.get(request.params.campaignId);
    if ((current?.revision ?? 0) !== command.revision) return reject(409, 'Карта уже изменилась. Проверьте состояние и повторите действие.');
    if (command.action !== 'create' && !current) return reject(404, 'Карта не найдена.');
    let game: MapFragments;
    try {
      if (command.action === 'create') {
        if (current?.phase === 'active') return reject(409, 'Сначала завершите текущий поиск.');
        if (!current && fragmentMaps.size >= 1024) return reject(409, 'Лимит карт сервера достигнут — перезапустите сервер, чтобы освободить место.');
        game = createMapFragments((current?.revision ?? 0) + 1, command.story);
      } else game = actMapFragments(current!, command, user);
    } catch (cause) { return reject(409, cause instanceof Error ? cause.message : 'Действие недоступно.'); }
    fragmentMaps.set(request.params.campaignId, game);
    return { game: viewMapFragments(game, user.manager), manager: user.manager, stories };
  });
};
