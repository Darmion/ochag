import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {buildApp} from '../../src/app.ts';
import type {Database} from '../../src/db.ts';
import {newToken,tokenHash} from '../../src/system/security.ts';

// Real PostgreSQL engine compiled to WASM, in memory; never touches a user's DB.
test('API and migrations against embedded PostgreSQL',async t=>{
  const pg=new PGlite();
  t.after(()=>pg.close());
  // The role must exist (bare, no password) before migrations 3+ GRANT to it — as in scripts/migrate.ts.
  await pg.exec(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='ttrpg_app') THEN
      CREATE ROLE ttrpg_app LOGIN;
    END IF;
  END $$;`);
  for (const file of [
  '001_foundation.sql',
  '002_accounts.sql',
  '003_import_preview.sql',
  '004_feet.sql',
  '005_shared_tabletop.sql',
  '006_scene_media.sql',
  '007_scene_objects.sql',
  '008_vision_geometry.sql',
  '009_combat.sql',
  '010_effects_resources.sql',
  '011_campaign_notes.sql',
  '012_object_animations.sql',
  '013_spells_skills.sql',
  '014_character_visibility.sql',
  '015_character_access_and_spell_review.sql',
  '016_character_saves.sql',
  '017_open_logins_and_server_identity.sql',
  '018_campaign_creators.sql',
  '019_shared_control.sql',
  '020_character_removal.sql',
  '021_campaign_rules.sql',
  '022_character_level.sql',
  '023_spell_slots.sql',
  '024_upcast_and_weapons.sql',
  '025_unified_objects.sql',
  '026_scene_drawings.sql',
  '027_scene_pins.sql',
  '028_campaign_audio.sql',
  '029_composite_rolls.sql',
  '030_encounters.sql',
  '031_scene_counters.sql',
  '032_playlists.sql',
  '033_inventory.sql',
  '034_object_states.sql',
  '035_blocking_objects.sql',
  '036_lighting.sql',
  '037_damage_threshold.sql',
  '038_movement.sql',
  '039_area_templates.sql',
  '040_triggers.sql',
  '041_conditions.sql',
  '042_weapon_damage.sql',
  '043_spell_targets.sql',
  '044_rest.sql',
  '045_experience.sql',
  '046_inspiration.sql',
  '047_quests.sql',
  '048_action_economy.sql',
  '049_classes.sql',
  '050_weapon_ranges.sql',
  '051_combat_summary.sql',
  '052_world_time.sql',
  '053_stealth_secrets.sql',
  '054_handouts.sql',
  '055_dialogues.sql',
  '056_chat.sql',
  '057_money.sql',
  '058_hazards.sql',
  '059_mood_music.sql',
  '060_chronicle.sql',
  '061_bestiary.sql',
  '062_roll_tables.sql',
  '063_class_features_bosses.sql',
  '064_magic_items.sql',
  '065_spell_zones.sql',
  '066_roll_applications.sql',
  '067_long_rest_daily.sql',
  '068_multiclass.sql',
  '069_combat_leftovers.sql',
  '070_map_tweaks.sql',
  '071_walls_and_steps.sql',
  '072_auto_reactions.sql',
  '073_scene_rest.sql',
  '074_light_cone.sql',
  '075_auto_counterspell.sql',
  '076_combat_events.sql',
  '077_more_reactions.sql',
  '078_deflect_missiles.sql',
  '079_uncanny_dodge.sql',
  '080_colossus_slayer.sql',
  '081_more_maneuvers.sql',
  '082_legendary_resistance.sql',
  '083_doors_windows.sql',
  '084_reaction_attacks.sql',
  '085_open_registration.sql',
  '086_campaign_art.sql',
  '087_drop_spell_translations.sql',
  '088_scene_music.sql',
  '089_scene_grid.sql',
  '090_campaign_appearance.sql',
  '091_scene_ambience.sql',
  '092_blocker_kind.sql',
  '093_image_crops.sql',
  '094_factions.sql',
  '095_round20.sql',
  '096_round21.sql',
  '097_zone_height.sql',
]) {
      await pg.exec(await readFile(new URL(`../../../../db/migrations/${file}`,import.meta.url),'utf8'));
      if(file==='001_foundation.sql') await pg.exec(`BEGIN;
        INSERT INTO users(id,display_name) VALUES('11111111-1111-4111-8111-111111111111','Legacy user');
        INSERT INTO campaigns(id,name,owner_user_id) VALUES('22222222-2222-4222-8222-222222222222','Legacy campaign','11111111-1111-4111-8111-111111111111');
        INSERT INTO campaign_members(campaign_id,user_id) VALUES('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111');
        INSERT INTO characters(campaign_id,name,hp_current) VALUES('22222222-2222-4222-8222-222222222222','Legacy character',52);
        COMMIT;`);
    }
  // provision_runtime.sql grants on tables from every migration, so it runs after all of them.
  await pg.query(
    "SELECT set_config('ttrpg.app_password', $1, false)",
    ['test-runtime-password-123456789'],
  );
  await pg.exec(
    await readFile(
      new URL('../../../../db/provision_runtime.sql', import.meta.url),
      'utf8',
    ),
  );
  await pg.exec(await readFile(new URL('../../../../db/tests/001_integrity.sql',import.meta.url),'utf8'));
  const db:Database={
    query:async(sql,values)=>pg.query(sql,values),
    transaction:fn=>pg.transaction(q=>fn({query:async(sql,values)=>q.query(sql,values)})),
  };
  const app=await buildApp(db); t.after(()=>app.close());
  const password='Local test password 123!';
  const request=async(method:any,url:string,token?:string,payload?:any)=>app.inject({method,url,
    ...(token?{headers:{authorization:`Bearer ${token}`}}:{}),...(payload!==undefined?{payload}:{})});
  const register=async(username:string)=>{
    const response=await request('POST','/auth/register',undefined,{username,password,displayName:username});
    assert.equal(response.statusCode,201,response.body);return response.json();
  };
  const owner=await register('owner_test'),player=await register('player_test'),outsider=await register('outsider_test');
  let campaignId:string;
  await t.test('both migrations apply and SQL integrity tests run',async()=>{
    assert.deepEqual((await pg.query('SELECT version FROM schema_migrations ORDER BY version')).rows,Array.from({length:97},(_,index)=>({version:index+1})));
  });
  await t.test('migration 2 preserves existing characters and campaigns',async()=>{
    assert.deepEqual((await pg.query("SELECT name,hp_current FROM characters WHERE name='Legacy character'")).rows,[{name:'Legacy character',hp_current:52}]);
    assert.equal((await pg.query("SELECT name FROM campaigns WHERE name='Legacy campaign'")).rows.length,1);
  });
  await t.test('credentials are hashed and session token is not stored in plaintext',async()=>{
    const account:any=(await pg.query('SELECT password_hash FROM accounts WHERE user_id=$1',[owner.user.id])).rows[0];
    assert.notEqual(account.password_hash,password);assert.match(account.password_hash,/^scrypt-v1\$/);
    const stored:any=(await pg.query('SELECT token_hash FROM auth_sessions WHERE user_id=$1',[owner.user.id])).rows[0];
    assert.equal(stored.token_hash,tokenHash(owner.token)); assert.notEqual(stored.token_hash,owner.token);
  });
  await t.test('duplicate login ignores case and rolls back the extra user',async()=>{
    const before=(await pg.query('SELECT count(*) AS n FROM users')).rows;
    assert.equal((await request('POST','/auth/register',undefined,{username:'OWNER_TEST',password,displayName:'Duplicate'})).statusCode,409);
    assert.deepEqual((await pg.query('SELECT count(*) AS n FROM users')).rows,before);
  });
  await t.test('login rejects wrong password and accepts normalized username',async()=>{
    assert.equal((await request('POST','/auth/login',undefined,{username:'owner_test',password:'wrong password 123'})).statusCode,401);
    const response=await request('POST','/auth/login',undefined,{username:'OWNER_TEST',password});
    assert.equal(response.statusCode,200); assert.equal(response.json().user.id,owner.user.id);
  });
  await t.test('anonymous access and invalid request fields are rejected',async()=>{
    assert.equal((await request('GET','/campaigns')).statusCode,401);
    assert.equal((await request('POST','/campaigns',owner.token,{name:'Test',owner_user_id:player.user.id})).statusCode,400);
    assert.equal((await request('POST','/campaigns',owner.token,{name:'   '})).statusCode,400);
  });
  await t.test('campaign creation atomically inserts its owner membership',async()=>{
    const response=await request('POST','/campaigns',owner.token,{name:'Session test'});
    assert.equal(response.statusCode,201,response.body);campaignId=response.json().id;
    assert.equal(response.json().owner_user_id,owner.user.id);
    assert.equal((await request('GET',`/campaigns/${campaignId}`,owner.token)).statusCode,200);
  });
  const path=()=>`/campaigns/${campaignId}`;
  const visionPath=()=>`${path()}/members/${player.user.id}/vision`;
  const rightsPath=()=>`${path()}/members/${player.user.id}/permissions`;
  await t.test('non-members cannot discover or modify the campaign',async()=>{
    assert.equal((await request('GET',path(),outsider.token)).statusCode,404);
    assert.equal((await request('GET','/campaigns',outsider.token)).json().campaigns.length,0);
    assert.equal((await request('PUT',rightsPath(),outsider.token,{isFullGm:true,permissions:[]})).statusCode,404);
  });
  await t.test('an invitation adds an ordinary player and is usable once',async()=>{
    const response=await request('POST',`${path()}/invites`,owner.token);
    assert.equal(response.statusCode,201);const code=response.json().code;
    assert.equal((await request('POST','/campaigns/join',player.token,{code})).statusCode,201);
    assert.equal((await request('POST','/campaigns/join',outsider.token,{code})).statusCode,404);
    const me=(await request('GET',path(),player.token)).json().me;
    assert.equal(me.is_full_gm,false);assert.deepEqual(me.permissions,[]);
  });
  await t.test('players cannot grant permissions, invite or alter visibility',async()=>{
    assert.equal((await request('PUT',rightsPath(),player.token,{isFullGm:true,permissions:[]})).statusCode,403);
    assert.equal((await request('POST',`${path()}/invites`,player.token)).statusCode,403);
    assert.equal((await request('PATCH',visionPath(),player.token,{mayChooseAlliedVision:true,fogDisabledByGm:true})).statusCode,403);
    assert.equal((await request('PUT',`${path()}/me/vision`,player.token,{mode:'allies'})).statusCode,403);
  });
  await t.test('owner grants allied-vision choice, player selects it',async()=>{
    assert.equal((await request('PATCH',visionPath(),owner.token,{mayChooseAlliedVision:true,fogDisabledByGm:false})).statusCode,200);
    assert.equal((await request('PUT',`${path()}/me/vision`,player.token,{mode:'allies'})).statusCode,200);
  });
  await t.test('granular vision permission works without granting role management',async()=>{
    assert.equal((await request('PUT',rightsPath(),owner.token,{isFullGm:false,permissions:['vision.manage']})).statusCode,200);
    assert.equal((await request('PATCH',visionPath(),player.token,{mayChooseAlliedVision:false,fogDisabledByGm:false})).statusCode,200);
    assert.equal((await request('PUT',rightsPath(),player.token,{isFullGm:true,permissions:[]})).statusCode,403);
  });
  await t.test('full GM can manage vision but cannot appoint other GMs',async()=>{
    assert.equal((await request('PUT',rightsPath(),owner.token,{isFullGm:true,permissions:[]})).statusCode,200);
    assert.equal((await request('PATCH',visionPath(),player.token,{mayChooseAlliedVision:true,fogDisabledByGm:false})).statusCode,200);
    assert.equal((await request('PUT',rightsPath(),player.token,{isFullGm:true,permissions:[]})).statusCode,403);
  });
  await t.test('revoking GM rights takes effect on the next request',async()=>{
    assert.equal((await request('PUT',rightsPath(),owner.token,{isFullGm:false,permissions:[]})).statusCode,200);
    assert.equal((await request('PATCH',visionPath(),player.token,{mayChooseAlliedVision:true,fogDisabledByGm:true})).statusCode,403);
  });
  await t.test('unknown grants and cross-campaign targets are rejected',async()=>{
    assert.equal((await request('PUT',rightsPath(),owner.token,{isFullGm:false,permissions:['root']})).statusCode,400);
    assert.equal((await request('PUT',`${path()}/members/${outsider.user.id}/permissions`,owner.token,{isFullGm:true,permissions:[]})).statusCode,404);
    assert.equal((await request('PUT',`${path()}/members/${owner.user.id}/permissions`,owner.token,{isFullGm:false,permissions:[]})).statusCode,400);
  });
  await t.test('expired invitations are rejected',async()=>{
    const code=(await request('POST',`${path()}/invites`,owner.token)).json().code;
    await pg.query("UPDATE campaign_invites SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[tokenHash(code)]);
    assert.equal((await request('POST','/campaigns/join',outsider.token,{code})).statusCode,404);
  });
  await t.test('concurrent invitation redemption has a single winner',async()=>{
    const c=(await request('POST','/campaigns',owner.token,{name:'Concurrent test'})).json().id;
    const code=(await request('POST',`/campaigns/${c}/invites`,owner.token)).json().code;
    const results=await Promise.all([player,outsider].map(user=>request('POST','/campaigns/join',user.token,{code})));
    assert.deepEqual(results.map(r=>r.statusCode).sort(),[201,404]);
  });
  await t.test('expired sessions are rejected; logout revokes only its token',async()=>{
    const login=(await request('POST','/auth/login',undefined,{username:'owner_test',password})).json();
    await pg.query("UPDATE auth_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[tokenHash(login.token)]);
    assert.equal((await request('GET','/me',login.token)).statusCode,401);
    assert.equal((await request('POST','/auth/logout',owner.token)).statusCode,204);
    assert.equal((await request('GET','/me',owner.token)).statusCode,401);
    assert.equal((await request('GET','/me',player.token)).statusCode,200);
  });
  await t.test('runtime database role supports API and cannot change schema',async()=>{
    await pg.query("SELECT set_config('ttrpg.app_password',$1,false)",['test-runtime-password-123456789']);
    await pg.exec(await readFile(new URL('../../../../db/provision_runtime.sql',import.meta.url),'utf8'));
    await pg.exec('SET ROLE ttrpg_app');
    try {
      const user=await register('limited_role_test');
      const response=await request('POST','/campaigns',user.token,{name:'Limited role campaign'});
      assert.equal(response.statusCode,201,response.body);
      const id=response.json().id;
      const invitation=await request('POST',`/campaigns/${id}/invites`,user.token);
      assert.equal(invitation.statusCode,201,invitation.body);
      assert.equal((await request('POST','/campaigns/join',player.token,{code:invitation.json().code})).statusCode,201);
      const change=await request('PUT',`/campaigns/${id}/members/${player.user.id}/permissions`,user.token,{isFullGm:false,permissions:['vision.manage']});
      assert.equal(change.statusCode,200,change.body);
      assert.equal((await request('GET','/me',user.token)).statusCode,200);
      await assert.rejects(()=>pg.exec('DROP TABLE accounts'),(e:any)=>e.code==='42501');
      await assert.rejects(()=>pg.exec("UPDATE schema_migrations SET version=99"),(e:any)=>e.code==='42501');
    } finally {await pg.exec('RESET ROLE');}
  });
  await t.test('HTTP listener answers real requests on localhost',async()=>{
    const address=await app.listen({host:'127.0.0.1',port:0});
    const response=await fetch(`${address}/me`,{headers:{authorization:`Bearer ${player.token}`}});
    assert.equal(response.status,200); assert.equal((await response.json()).id,player.user.id);
  });
  await t.test('registration has no login/password composition rules',async()=>{
    const response=await request('POST','/auth/register',undefined,{username:'  Вася Пупкин ',password:'1'});
    assert.equal(response.statusCode,201,response.body);
    assert.equal(response.json().user.username,'вася пупкин');
    assert.equal(response.json().user.displayName,'Вася Пупкин');
    assert.equal((await request('POST','/auth/login',undefined,{username:'ВАСЯ ПУПКИН',password:'1'})).statusCode,200);
  });
  await t.test('validation and auth errors name the actual problem',async()=>{
    const missing=await request('POST','/auth/register',undefined,{password:'x'});
    assert.equal(missing.statusCode,400); assert.equal(missing.json().field,'username'); assert.match(missing.json().message,/Логин/);
    const blank=await request('POST','/auth/register',undefined,{username:'   ',password:'x'});
    assert.equal(blank.statusCode,400); assert.match(blank.json().message,/Логин/);
    const taken=await request('POST','/auth/register',undefined,{username:'Owner_Test',password:'x'});
    assert.equal(taken.statusCode,409); assert.match(taken.json().message,/уже занят/);
    const unknown=await request('POST','/auth/login',undefined,{username:'nobody_here',password:'x'});
    assert.equal(unknown.statusCode,401); assert.match(unknown.json().message,/нет аккаунта «nobody_here»/);
    const wrong=await request('POST','/auth/login',undefined,{username:'owner_test',password:'x'});
    assert.equal(wrong.statusCode,401); assert.match(wrong.json().message,/Неверный пароль/);
  });
  await t.test('invite errors distinguish a foreign server from a used or expired code',async()=>{
    const foreign=await request('POST','/campaigns/join',outsider.token,{code:'A'.repeat(43)});
    assert.equal(foreign.statusCode,404); assert.match(foreign.json().message,/подключены к серверу/);
    const ownerToken=(await request('POST','/auth/login',undefined,{username:'owner_test',password})).json().token;
    const code=(await request('POST',`${path()}/invites`,ownerToken)).json().code;
    const again=await request('POST','/campaigns/join',player.token,{code});
    assert.equal(again.statusCode,200); assert.equal(again.json().alreadyMember,true); assert.equal(again.json().campaignId,campaignId);
    assert.equal((await pg.query<any>('SELECT used_at FROM campaign_invites WHERE token_hash=$1',[tokenHash(code)])).rows[0].used_at,null);
    const fresh=(await request('POST',`${path()}/invites`,ownerToken)).json().code;
    await pg.query("UPDATE campaign_invites SET expires_at=now()-interval '1 minute' WHERE token_hash=$1",[tokenHash(fresh)]);
    const expired=await request('POST','/campaigns/join',outsider.token,{code:fresh});
    assert.equal(expired.statusCode,404); assert.match(expired.json().message,/истёк/);
  });
  await t.test('health exposes a stable server identity',async()=>{
    const first=(await request('GET','/health')).json(), second=(await request('GET','/health')).json();
    assert.match(first.serverId,/^[0-9a-f-]{36}$/); assert.equal(first.serverId,second.serverId);
    assert.equal(typeof first.hostName,'string'); assert.equal(first.apiVersion,15);
  });
  await t.test('host sees connected players and recent login attempts',async()=>{
    const me=(await request('GET','/me',player.token)).json();
    assert.equal(me.connection.clientAddress,'127.0.0.1');
    const list=await request('GET','/host/connections');
    assert.equal(list.statusCode,200,list.body);
    const body=list.json();
    const entry=body.connections.find((c:any)=>c.userId===player.user.id);
    assert.ok(entry,'player is listed'); assert.equal(entry.username,'player_test'); assert.equal(entry.online,true); assert.equal(entry.fromThisComputer,true);
    assert.ok(body.events.some((e:any)=>e.kind==='login_failed' && e.username==='nobody_here'));
    const remote=await app.inject({method:'GET',url:'/host/connections',remoteAddress:'26.10.20.30'});
    assert.equal(remote.statusCode,403);
  });
  await t.test('only the server host or an allowed account creates campaigns',async()=>{
    const remote=(method:any,url:string,token:string,payload?:any)=>app.inject({method,url,remoteAddress:'26.10.20.30',headers:{authorization:`Bearer ${token}`},...(payload!==undefined?{payload}:{})});
    const guest=(await request('POST','/auth/register',undefined,{username:'guest_creator',password:'x'})).json();
    const denied=await remote('POST','/campaigns',guest.token,{name:'Remote campaign'});
    assert.equal(denied.statusCode,403); assert.match(denied.json().message,/хозяин сервера/);
    const me=(await remote('GET','/me',guest.token)).json();
    assert.equal(me.isServerHost,false); assert.equal(me.canCreateCampaigns,false);
    assert.equal((await request('GET','/me',guest.token)).json().isServerHost,true);
    assert.equal((await app.inject({method:'GET',url:'/host/accounts',remoteAddress:'26.10.20.30'})).statusCode,403);
    const accounts=(await request('GET','/host/accounts')).json().accounts;
    assert.ok(accounts.some((a:any)=>a.username==='guest_creator' && a.canCreateCampaigns===false));
    assert.equal((await request('PUT',`/host/accounts/${guest.user.id}/can-create-campaigns`,undefined,{canCreateCampaigns:true})).statusCode,200);
    assert.equal((await remote('POST','/campaigns',guest.token,{name:'Remote campaign'})).statusCode,201);
    assert.equal((await remote('GET','/me',guest.token)).json().canCreateCampaigns,true);
  });
  await t.test('players see members of their campaigns and who is online',async()=>{
    const list=(await request('GET','/campaigns/online',player.token)).json();
    const self=list.players.find((p:any)=>p.userId===player.user.id);
    assert.ok(self && self.online,'the asking player is online');
    assert.ok(list.players.some((p:any)=>p.userId===owner.user.id));
    assert.ok(!list.players.some((p:any)=>p.username==='guest_creator'),'no strangers from other campaigns');
    assert.ok(list.players.every((p:any)=>!('clientAddress' in p)),'no IP addresses for players');
  });
  await t.test('request rate limit is active',async()=>{
    const limited=await buildApp(db,{rateMax:2});
    try {
      assert.equal((await limited.inject('/health')).statusCode,200);
      assert.equal((await limited.inject('/health')).statusCode,200);
      assert.equal((await limited.inject('/health')).statusCode,429);
    } finally {await limited.close();}
  });
  await t.test('with a token the limit counts per session, not per address',async()=>{
    const session=async(userId:string)=>{
      const token=newToken();
      await pg.query("INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '1 hour')",[tokenHash(token),userId]);
      return {token};
    };
    const first=await session(player.user.id),second=await session(outsider.user.id);
    const limited=await buildApp(db,{rateMax:2});
    try {
      const get=(token:string)=>limited.inject({method:'GET',url:'/me',headers:{authorization:`Bearer ${token}`}});
      assert.equal((await get(first.token)).statusCode,200);
      assert.equal((await get(first.token)).statusCode,200);
      assert.equal((await get(first.token)).statusCode,429);
      assert.equal((await get(second.token)).statusCode,200,'another session from the same address still gets through');
    } finally {await limited.close();}
  });
});
