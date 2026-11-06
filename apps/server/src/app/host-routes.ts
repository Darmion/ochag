import type { FastifyInstance, FastifyRequest } from 'fastify';
import { isLoopback, interfaceNameFor } from '../system/presence.ts';
import { fail } from './errors.ts';
import { obj, uuid, bool } from './schemas.ts';
import type { AppDeps } from './deps.ts';

export function registerHostRoutes(app: FastifyInstance, { db, presence, identity, isHostRequest, openRegistration }: AppDeps) {
  // Loopback only (the Electron host asks over 127.0.0.1), so no token: network players never get this list.
  app.get('/host/connections',{config:{rateLimit:false}},async req=>{
    if (!isHostRequest(req)) return fail(403,'Список подключений доступен только на компьютере, где запущен сервер.');
    const snapshot=presence.snapshot();
    const userIds=[...new Set(snapshot.sessions.map(s=>s.userId))];
    const campaignIds=[...new Set(snapshot.sessions.flatMap(s=>s.live.map(l=>l.campaignId)))];
    const sceneIds=[...new Set(snapshot.sessions.flatMap(s=>s.live.map(l=>l.sceneId)))];
    const users=new Map((userIds.length ? (await db.query(`SELECT u.id,u.display_name,a.username FROM users u
      JOIN accounts a ON a.user_id=u.id WHERE u.id=ANY($1::uuid[])`,[userIds])).rows : []).map(r=>[r.id,r]));
    const campaigns=new Map((campaignIds.length ? (await db.query('SELECT id,name FROM campaigns WHERE id=ANY($1::uuid[])',[campaignIds])).rows : []).map(r=>[r.id,r.name]));
    const scenes=new Map((sceneIds.length ? (await db.query('SELECT id,name FROM scenes WHERE id=ANY($1::uuid[])',[sceneIds])).rows : []).map(r=>[r.id,r.name]));
    return {
      ...await identity(),
      now:Date.now(),
      connections:snapshot.sessions
        .sort((a,b)=>Number(b.online)-Number(a.online) || b.lastSeenAt-a.lastSeenAt)
        .map(s=>({
          userId:s.userId,
          username:users.get(s.userId)?.username ?? '?',
          displayName:users.get(s.userId)?.display_name ?? '?',
          clientAddress:s.remoteAddress,
          fromThisComputer:isLoopback(s.remoteAddress),
          serverAddress:s.localAddress,
          serverPort:s.localPort,
          network:s.network ?? interfaceNameFor(s.localAddress),
          online:s.online,
          firstSeenAt:s.firstSeenAt,
          lastSeenAt:s.lastSeenAt,
          atTable:s.live.map(l=>({campaignName:campaigns.get(l.campaignId) ?? '?',sceneName:scenes.get(l.sceneId) ?? '?'})),
        })),
      events:snapshot.events.map(e=>({...e,network:e.network ?? interfaceNameFor(e.localAddress),fromThisComputer:isLoopback(e.remoteAddress)})),
    };
  });
  const requireHostRequest=(req: FastifyRequest)=>{
    if (!isHostRequest(req)) fail(403,'Доступно только на компьютере, где запущен сервер.');
  };
  app.get('/host/settings',{config:{rateLimit:false}},async req=>{
    requireHostRequest(req);
    return {openRegistration:await openRegistration()};
  });
  app.put<{Body:{openRegistration:boolean}}>('/host/settings',{schema:{body:obj({openRegistration:bool})},config:{rateLimit:false}},async req=>{
    requireHostRequest(req);
    await db.query('UPDATE server_instance SET open_registration=$1',[req.body.openRegistration]);
    return {openRegistration:req.body.openRegistration};
  });
  app.get('/host/accounts',{config:{rateLimit:false}},async req=>{
    requireHostRequest(req);
    const {rows}=await db.query(`SELECT a.user_id AS "userId",a.username,u.display_name AS "displayName",
      a.can_create_campaigns AS "canCreateCampaigns",
      (SELECT count(*)::int FROM campaigns c WHERE c.owner_user_id=a.user_id) AS "ownedCampaigns"
      FROM accounts a JOIN users u ON u.id=a.user_id ORDER BY u.display_name,a.username`);
    return {accounts:rows};
  });
  app.put<{Params:{userId:string};Body:{canCreateCampaigns:boolean}}>('/host/accounts/:userId/can-create-campaigns',{
    schema:{params:obj({userId:uuid}),body:obj({canCreateCampaigns:bool})},config:{rateLimit:false},
  },async req=>{
    requireHostRequest(req);
    const {rows}=await db.query('UPDATE accounts SET can_create_campaigns=$1 WHERE user_id=$2 RETURNING user_id',[req.body.canCreateCampaigns,req.params.userId]);
    if (!rows[0]) return fail(404,'Аккаунт не найден.');
    return {canCreateCampaigns:req.body.canCreateCampaigns};
  });
}
