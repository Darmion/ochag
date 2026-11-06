import type { FastifyInstance } from 'fastify';
import { hashPassword, verifyPassword, tokenHash } from '../system/security.ts';
import { interfaceNameFor } from '../system/presence.ts';
import { fromInternet, peerOf } from '../system/network.ts';
import { addressOf } from '../system/rate-keys.ts';
import { fail } from './errors.ts';
import { obj, loginFields, normalizeLogin } from './schemas.ts';
import type { AppDeps } from './deps.ts';

const WRONG_LOGIN = 'Неверный логин или пароль. Проверьте раскладку клавиатуры и Caps Lock; если вы здесь впервые — зарегистрируйтесь по приглашению мастера.';

const FAILED_LOGIN_LIMIT = 20;
const FAILED_LOGIN_WINDOW_MS = 15 * 60_000;
const FAILED_LOGIN_TRACKED = 5000;

type Channel = 'internet' | 'home';

// Counts failed logins per login name from other computers: a password guessed from many addresses still runs into it. Internet and home network count apart, so guessing from the internet never locks out players at the table.
function failedLogins() {
  const failures = new Map<string, {count: number; resetAt: number}>();
  const key = (channel: Channel, username: string) => `${channel}:${username}`;
  return {
    blockedUntil(channel: Channel, username: string, now = Date.now()) {
      const entry = failures.get(key(channel, username));
      return entry && entry.resetAt > now && entry.count >= FAILED_LOGIN_LIMIT ? entry.resetAt : null;
    },
    failed(channel: Channel, username: string, now = Date.now()) {
      const entry = failures.get(key(channel, username));
      if (entry && entry.resetAt > now) entry.count += 1;
      else failures.set(key(channel, username), {count: 1, resetAt: now + FAILED_LOGIN_WINDOW_MS});
      if (failures.size > FAILED_LOGIN_TRACKED) for (const [name, value] of failures) if (value.resetAt <= now) failures.delete(name);
      if (failures.size > FAILED_LOGIN_TRACKED) failures.delete(failures.keys().next().value!);
    },
    succeeded(channels: Channel[], username: string) { for (const channel of channels) failures.delete(key(channel, username)); },
  };
}

export function registerAuthRoutes(app: FastifyInstance, { db, options, appVersion, presence, identity, authEvent, auth, isHostRequest, registrationFor, mayCreateCampaigns, session }: AppDeps) {
  const logins = failedLogins();
  let dummyHash: Promise<string> | undefined;
  const byAddress = {max: 10, timeWindow: '1 minute', keyGenerator: addressOf};
  app.get('/health',async req=>{
    await db.query('SELECT 1');
    const {serverId, hostName} = await identity();
    return { status: 'ok', apiVersion: 15, appVersion, serverId, hostName: fromInternet(req) ? null : hostName, registration: await registrationFor(req) };
  });
  app.post<{Body:{username:string;password:string;displayName?:string;inviteCode?:string}}>('/auth/register',{
    schema:{body:obj({...loginFields,displayName:{type:'string',maxLength:100},inviteCode:{type:'string',pattern:'^[A-Za-z0-9_-]{43}$'}},['username','password'])},
    config:{rateLimit:byAddress},
  },async(req,reply)=>{
    const {password}=req.body, username=normalizeLogin(req.body.username);
    const inviteOnly=await registrationFor(req) === 'invite';
    if (inviteOnly) {
      const code=req.body.inviteCode;
      const invite=code ? (await db.query('SELECT 1 FROM campaign_invites WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now()',[tokenHash(code)])).rows[0] : null;
      if (!invite) {
        authEvent(req,'register_failed',code ? 'Приглашение недействительно.' : 'Без приглашения (через интернет).');
        return fail(403,code
          ? 'Приглашение не подходит: его нет на этом сервере, оно уже использовано или истекло. Попросите мастера создать новое.'
          : 'Через интернет на этом сервере регистрируются только по приглашению мастера: вставьте его текст целиком в поле «Приглашение от мастера» и зарегистрируйтесь снова.');
      }
    }
    const displayName=req.body.displayName?.trim() || req.body.username.trim();
    const taken=await db.query('SELECT 1 FROM accounts WHERE username=$1',[username]);
    if (taken.rows[0]) {
      authEvent(req,'register_failed','Логин уже занят.');
      return fail(409,`Логин «${username}» уже занят на этом сервере. Войдите с ним или выберите другой.`);
    }
    const hash=await hashPassword(password);
    const result=await db.transaction(async q=>{
      // An invite opens registration for one player: it is spent here, or one shared invite would let anyone make any number of accounts.
      const invite=inviteOnly
        ? (await q.query('SELECT campaign_id FROM campaign_invites WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() FOR UPDATE',[tokenHash(req.body.inviteCode!)])).rows[0]
          ?? fail(403,'Приглашение не подходит: его уже использовали или оно истекло. Попросите мастера создать новое.')
        : null;
      const {rows}=await q.query('INSERT INTO users(display_name) VALUES($1) RETURNING id,display_name',[displayName]);
      const user=rows[0]!;
      await q.query('INSERT INTO accounts(user_id,username,password_hash) VALUES($1,$2,$3)',[user.id,username,hash]);
      if (invite) {
        await q.query('INSERT INTO campaign_members(campaign_id,user_id) VALUES($1,$2)',[invite.campaign_id,user.id]);
        await q.query('UPDATE campaign_invites SET used_by=$1,used_at=now() WHERE token_hash=$2',[user.id,tokenHash(req.body.inviteCode!)]);
      }
      return {user:{id:user.id,displayName:user.display_name,username},...await session(q,user.id),...(invite ? {joinedCampaignId:invite.campaign_id as string} : {})};
    });
    authEvent(req,'register','Аккаунт создан.');
    return reply.code(201).send(result);
  });
  app.post<{Body:{username:string;password:string}}>('/auth/login',{
    schema:{body:obj(loginFields)},config:{rateLimit:byAddress},
  },async req=>{
    const username=normalizeLogin(req.body.username);
    const remote=!isHostRequest(req);
    // From the internet both failures read and take the same: a stranger can't learn which login names exist.
    const hidden=fromInternet(req);
    const channel: Channel=hidden ? 'internet' : 'home';
    const blockedUntil=remote ? logins.blockedUntil(channel,username) : null;
    if (blockedUntil) {
      authEvent(req,'login_failed','Слишком много неудачных попыток.');
      const minutes=Math.max(1,Math.ceil((blockedUntil-Date.now())/60_000));
      return fail(429,`Слишком много неудачных попыток войти в «${username}». Подождите ${minutes} мин. и попробуйте снова.`);
    }
    const {rows}=await db.query(`SELECT a.user_id,a.username,a.password_hash,u.display_name
      FROM accounts a JOIN users u ON u.id=a.user_id WHERE a.username=$1`,[username]);
    const account=rows[0];
    if (!account) {
      if (hidden) await verifyPassword(req.body.password,await (dummyHash ??= hashPassword('ochag-no-such-account')));
      authEvent(req,'login_failed','Нет такого аккаунта.');
      if (remote) logins.failed(channel,username);
      return fail(401,hidden ? WRONG_LOGIN : `На этом сервере нет аккаунта «${username}». Аккаунты у каждого сервера свои — зарегистрируйтесь здесь или проверьте адрес сервера.`);
    }
    if (!await verifyPassword(req.body.password,account.password_hash)) {
      authEvent(req,'login_failed','Неверный пароль.');
      if (remote) logins.failed(channel,username);
      return fail(401,hidden ? WRONG_LOGIN : `Неверный пароль для «${username}». Проверьте раскладку клавиатуры и Caps Lock.`);
    }
    logins.succeeded(remote ? [channel] : ['internet','home'],username);
    authEvent(req,'login','Вход выполнен.');
    return {user:{id:account.user_id,username:account.username,displayName:account.display_name},...await session(db,account.user_id)};
  });
  app.post('/auth/logout',async(req,reply)=>{
    await auth(req);
    const hash=tokenHash(req.headers.authorization!.slice(7));
    await db.query('DELETE FROM auth_sessions WHERE token_hash=$1',[hash]);
    presence.forget(hash);
    return reply.code(204).send();
  });
  app.get('/mods',async req=>{
    await auth(req);
    const host=isHostRequest(req);
    return {mods:(options.mods?.list ?? []).map(mod=>({id:mod.id,name:mod.name,version:mod.version,description:mod.description,author:mod.author,bundled:mod.bundled,status:mod.status,error:mod.error,changes:mod.changes,translations:mod.translations,...(host?{folder:mod.folder}:{})})),canInstall:host};
  });
  app.get('/me',async req=>{
    const id=await auth(req);
    const {rows}=await db.query('SELECT u.id,u.display_name AS "displayName",a.username FROM users u JOIN accounts a ON a.user_id=u.id WHERE u.id=$1',[id]);
    const peer=peerOf(req);
    return {...rows[0],isServerHost:isHostRequest(req),canCreateCampaigns:await mayCreateCampaigns(req,id),connection:{clientAddress:peer.remoteAddress,serverAddress:peer.localAddress,serverPort:peer.localPort,network:peer.network ?? interfaceNameFor(peer.localAddress),internet:fromInternet(req)}};
  });
}
