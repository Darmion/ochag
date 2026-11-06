import Fastify, { type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type { Database } from './db.ts';
import { createPresence } from './system/presence.ts';
import { foreignHostOnThisComputer, fromInternet } from './system/network.ts';
import { sessionKeys } from './system/rate-keys.ts';
import { characterImportRoutes } from './characters/import-routes.ts';
import { characterRoutes } from './characters/character-routes.ts';
import { minigameRoutes } from './campaign/minigame-routes.ts';
import { noteRoutes } from './campaign/note-routes.ts';
import { tabletopRoutes } from './tabletop/index.ts';
import { createCampaignEvents, eventForRequest } from './system/campaign-events.ts';
import { assetRoutes } from './system/asset-routes.ts';
import { objectFileRoutes } from './system/object-file-routes.ts';
import { spellRoutes } from './spells/spell-routes.ts';
import { spellTemplateRoutes } from './spells/spell-template-routes.ts';
import { transferRoutes } from './system/transfer-routes.ts';
import { updateRoutes } from './system/update-routes.ts';
import { rulesRoutes } from './campaign/rules-routes.ts';
import { describeValidation } from './app/errors.ts';
import { createAppDeps, type AppOptions } from './app/deps.ts';
import { registerAuthRoutes } from './app/auth-routes.ts';
import { registerHostRoutes } from './app/host-routes.ts';
import { registerCampaignRoutes } from './app/campaign-routes.ts';
import { registerMemberRoutes } from './app/member-routes.ts';

export { ApiError } from './app/errors.ts';

function defaultAppVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  try {
    return JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export async function buildApp(db: Database, options: AppOptions = {}) {
  const appVersion = options.appVersion ?? defaultAppVersion();
  const updateDir = options.updateDir !== undefined ? options.updateDir : process.env.UPDATE_DIR ?? null;
  const clientDistDir = options.clientDistDir !== undefined ? options.clientDistDir : process.env.CLIENT_DIST_DIR ?? null;
  const app = Fastify({
    logger: options.logger ? {redact:['req.headers.authorization']} : false,
    bodyLimit: 65536, requestTimeout: 10 * 60_000,
    ajv: {customOptions:{removeAdditional:false,coerceTypes:false}},
    ...(options.https ? {https:options.https} : {}),
  });
  await app.register(rateLimit,{
    max:(_req: FastifyRequest,key: string) => options.rateMax ?? (key.startsWith('session:') ? 600 : 120),
    keyGenerator:sessionKeys(db),
    timeWindow:'1 minute',
    allowList:(req: FastifyRequest) => req.method === 'GET' && req.url.startsWith('/phone/') && !fromInternet(req),
  });
  await app.register(websocket, {
    options: {
      maxPayload: 4096,
    },
  });
  await app.register(multipart, {
    limits: { fileSize: 30 * 1024 * 1024, files: 1 },
  });
  app.addHook('onRequest',async (request,reply) => {
    if (!foreignHostOnThisComputer(request)) return;
    return reply.code(421).send({error:'FOREIGN_HOST',message:'Сервер отвечает на этом компьютере только по адресу 127.0.0.1 или localhost.'});
  });
  app.addHook('onSend',async (_request,reply) => {
    reply.header('Cache-Control','no-store');
    reply.header('X-Content-Type-Options','nosniff');
    reply.header('X-Frame-Options','DENY');
    reply.header('Referrer-Policy','no-referrer');
    reply.header('Cross-Origin-Resource-Policy','same-origin');
  });
  const presence = createPresence();
  const deps = createAppDeps(db, options, appVersion, presence);
  const { identity, authEvent, auth, membership, requirePermission, requireCampaignCreator } = deps;
  app.setErrorHandler((error,request,reply) => {
    const e = error as Error & {statusCode?:number;validation?:unknown;code?:string};
    if (e.validation) {
      const {message,field} = describeValidation(e.validation);
      const route = request.routeOptions.url;
      if (route === '/auth/login' || route === '/auth/register') authEvent(request,route === '/auth/login' ? 'login_failed' : 'register_failed',message);
      return reply.code(400).send({error:'INVALID_REQUEST',message,...(field ? {field} : {})});
    }
    if (e.code === '23505') return reply.code(409).send({error:'CONFLICT',message:'Запись уже существует.'});
    const status = e.statusCode && e.statusCode >= 400 && e.statusCode < 500 ? e.statusCode : 500;
    if (status === 500) request.log.error({name:e.name,code:e.code},'Request failed');
    const own = e as Error & {errorCode?:string;details?:unknown};
    if (status === 500) return reply.code(500).send({error:'INTERNAL_ERROR',message:'Внутренняя ошибка сервера.'});
    return reply.code(status).send({error:own.errorCode ?? 'REQUEST_REJECTED',message:e.message,...(own.details !== undefined ? {details:own.details} : {})});
  });
  registerAuthRoutes(app, deps);
  registerHostRoutes(app, deps);
  registerCampaignRoutes(app, deps);
  registerMemberRoutes(app, deps);
  await app.register(characterImportRoutes, {
    db,
    auth,
    membership,
    requirePermission,
  });
  const campaignEvents = createCampaignEvents();
  await app.register(characterRoutes, {
    db,
    auth,
    membership,
    requirePermission,
    events: campaignEvents,
  });
  await app.register(minigameRoutes, { db, auth, membership });
  await app.register(noteRoutes, {
    db,
    auth,
    membership,
  });
  app.addHook('onResponse', async (request, reply) => {
    if (reply.statusCode >= 300) return;
    const found = eventForRequest(request.method, request.url);
    if (found) campaignEvents.emit(found.campaignId, found.event);
  });
  await app.register(tabletopRoutes, {
    db,
    auth,
    membership,
    presence,
    events: campaignEvents,
    ...(options.reactionWindowMs ? { reactionWindowMs: options.reactionWindowMs } : {}),
    ...(options.mods ? { mods: options.mods } : {}),
  });
  await app.register(assetRoutes, {
    db,
    auth,
    membership,
  });
  await app.register(objectFileRoutes, {
    db,
    auth,
    membership,
  });
  await app.register(spellRoutes, {
    db,
    auth,
    membership,
    requirePermission,
  });
  await app.register(spellTemplateRoutes, { db, auth, membership, requirePermission });
  await app.register(rulesRoutes, {
    db,
    auth,
    membership,
  });
  await app.register(updateRoutes, { appVersion, updateDir });
  if (clientDistDir && existsSync(path.join(clientDistDir, 'phone.html'))) {
    // index:false: /phone/ gets its own small phone.html below, served with no-store so a phone browser never keeps a stale copy across updates.
    await app.register(fastifyStatic, { root: clientDistDir, prefix: '/phone/', decorateReply: false, index: false, wildcard: true });
    const indexHtml = () => import('node:fs/promises').then(fs => fs.readFile(path.join(clientDistDir, 'phone.html'), 'utf8'));
    app.get('/phone', async (_request, reply) => reply.redirect('/phone/'));
    app.get('/phone/', async (_request, reply) => reply.type('text/html').send(await indexHtml()));
  }
  await app.register(transferRoutes, {
    db,
    auth,
    membership,
    identity,
    requireCampaignCreator,
  });
  return app;
}
