import type { FastifyRequest } from 'fastify';
import os from 'node:os';
import type { ServerOptions } from 'node:https';
import type { Database, Queryable } from '../db.ts';
import { newToken, tokenHash } from '../system/security.ts';
import { cleanAddress, isLoopback, type Presence } from '../system/presence.ts';
import { fromInternet, peerOf, viaTunnel } from '../system/network.ts';
import type { LoadedMods } from '../system/mods.ts';
import { fail } from './errors.ts';

export type AppOptions = {logger?: boolean; https?: ServerOptions; rateMax?: number; appVersion?: string; updateDir?: string | null; clientDistDir?: string | null; reactionWindowMs?: number; mods?: LoadedMods};

export function createAppDeps(db: Database, options: AppOptions, appVersion: string, presence: Presence) {
  let serverId: string | undefined;
  const identity = async () => {
    serverId ??= (await db.query('SELECT id FROM server_instance')).rows[0]?.id as string;
    return {serverId,hostName:os.hostname()};
  };
  const authEvent = (req: FastifyRequest,kind: Parameters<typeof presence.event>[0],reason: string) => {
    const body = req.body as {username?: unknown} | undefined;
    presence.event(kind,typeof body?.username === 'string' ? body.username.trim() : '',reason,peerOf(req));
  };
  async function auth(req: FastifyRequest) {
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '')?.[1];
    if (!token) return fail(401,'Требуется вход.');
    const hash = tokenHash(token);
    const {rows} = await db.query('SELECT user_id FROM auth_sessions WHERE token_hash=$1 AND expires_at>now()',[hash]);
    if (!rows[0]) return fail(401,'Сессия недействительна или истекла. Войдите заново.');
    presence.touch(hash,rows[0].user_id,peerOf(req));
    return rows[0].user_id as string;
  }
  const isHostRequest = (req: FastifyRequest) => !viaTunnel(req) && isLoopback(cleanAddress(req.socket.remoteAddress));
  const openRegistration = async () => (await db.query('SELECT open_registration FROM server_instance')).rows[0]?.open_registration === true;
  const registrationFor = async (req: FastifyRequest): Promise<'open' | 'invite'> => (fromInternet(req) && !(await openRegistration()) ? 'invite' : 'open');
  async function mayCreateCampaigns(req: FastifyRequest,userId: string) {
    if (isHostRequest(req)) return true;
    const {rows}=await db.query('SELECT can_create_campaigns FROM accounts WHERE user_id=$1',[userId]);
    return rows[0]?.can_create_campaigns === true;
  }
  async function requireCampaignCreator(req: FastifyRequest,userId: string) {
    if (!await mayCreateCampaigns(req,userId)) fail(403,'Создавать кампании на этом сервере может хозяин сервера или тот, кому он это разрешил.');
  }
  async function membership(q: Queryable,campaignId:string,userId:string,lock=false) {
    // Lock campaign first: grants, revocations and guarded mutations serialize.
    if (lock) await q.query('SELECT id FROM campaigns WHERE id=$1 FOR UPDATE',[campaignId]);
    const {rows} = await q.query(`SELECT c.owner_user_id,m.* FROM campaigns c
      JOIN campaign_members m ON m.campaign_id=c.id WHERE c.id=$1 AND m.user_id=$2`,[campaignId,userId]);
    if (!rows[0]) return fail(404,'Кампания не найдена.');
    return rows[0];
  }
  function ownerOnly(member: any,userId:string) {
    if (member.owner_user_id !== userId) fail(403,'Только главный мастер может изменять полномочия и приглашать участников.');
  }
  async function requirePermission(q:Queryable,member:any,userId:string,permission:string) {
    if (member.owner_user_id===userId || member.is_full_gm) return;
    const {rows}=await q.query('SELECT 1 FROM member_permissions WHERE campaign_id=$1 AND user_id=$2 AND permission=$3',[member.campaign_id,userId,permission]);
    if (!rows[0]) fail(403,'Недостаточно прав.');
  }
  async function session(q:Queryable,userId:string) {
    const token=newToken();
    const {rows}=await q.query(`INSERT INTO auth_sessions(token_hash,user_id,expires_at)
      VALUES($1,$2,now()+interval '12 hours') RETURNING expires_at`,[tokenHash(token),userId]);
    return {token,expiresAt:rows[0]!.expires_at};
  }
  return { db, options, appVersion, presence, identity, authEvent, auth, isHostRequest, openRegistration, registrationFor, mayCreateCampaigns, requireCampaignCreator, membership, ownerOnly, requirePermission, session };
}

export type AppDeps = ReturnType<typeof createAppDeps>;
