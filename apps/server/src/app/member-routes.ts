import type { FastifyInstance } from 'fastify';
import { newToken, tokenHash } from '../system/security.ts';
import { fail } from './errors.ts';
import { permissions, obj, uuid, bool, type CampaignParams } from './schemas.ts';
import type { AppDeps } from './deps.ts';

export function registerMemberRoutes(app: FastifyInstance, { db, auth, membership, ownerOnly, requirePermission }: AppDeps) {
  app.get<{Params:CampaignParams}>('/campaigns/:campaignId/members',{schema:{params:obj({campaignId:uuid})}},async req=>{
    const userId=await auth(req),id=req.params.campaignId;
    const me=await membership(db,id,userId); ownerOnly(me,userId);
    const {rows}=await db.query(`SELECT m.*,u.display_name,
      ARRAY(SELECT permission FROM member_permissions p WHERE p.campaign_id=m.campaign_id AND p.user_id=m.user_id ORDER BY permission) AS permissions
      FROM campaign_members m JOIN users u ON u.id=m.user_id WHERE m.campaign_id=$1 ORDER BY u.display_name,u.id`,[id]);
    return {members:rows};
  });
  // Open to every member, unlike /members: display names only.
  app.get<{Params:CampaignParams}>('/campaigns/:campaignId/members/roster',{schema:{params:obj({campaignId:uuid})}},async req=>{
    const userId=await auth(req),id=req.params.campaignId;
    await membership(db,id,userId);
    const {rows}=await db.query(`SELECT m.user_id,u.display_name
      FROM campaign_members m JOIN users u ON u.id=m.user_id WHERE m.campaign_id=$1 ORDER BY u.display_name,u.id`,[id]);
    return {members:rows.map(r=>({userId:r.user_id,displayName:r.display_name}))};
  });
  app.post<{Params:CampaignParams}>('/campaigns/:campaignId/invites',{schema:{params:obj({campaignId:uuid})}},async(req,reply)=>{
    const userId=await auth(req),id=req.params.campaignId;
    const result=await db.transaction(async q=>{
      ownerOnly(await membership(q,id,userId,true),userId);
      const code=newToken();
      const {rows}=await q.query(`INSERT INTO campaign_invites(token_hash,campaign_id,created_by,expires_at)
        VALUES($1,$2,$3,now()+interval '24 hours') RETURNING expires_at`,[tokenHash(code),id,userId]);
      return {code,expiresAt:rows[0]!.expires_at};
    });
    return reply.code(201).send(result);
  });
  app.post<{Body:{code:string}}>('/campaigns/join',{schema:{body:obj({code:{type:'string',pattern:'^[A-Za-z0-9_-]{43}$'}})}},async(req,reply)=>{
    const userId=await auth(req);
    const result=await db.transaction(async q=>{
      const hash=tokenHash(req.body.code);
      const {rows}=await q.query('SELECT *,expires_at<=now() AS expired FROM campaign_invites WHERE token_hash=$1 FOR UPDATE',[hash]);
      const invite=rows[0];
      if(!invite) return fail(404,'На этом сервере нет такого приглашения. Проверьте, что вы подключены к серверу того мастера, который его создал (адрес указан в приглашении).');
      if(invite.used_at && invite.used_by!==userId) return fail(404,'Это приглашение уже использовано другим игроком. Попросите мастера создать новое — у каждого игрока своё.');
      if(invite.expired && !invite.used_at) return fail(404,'Срок приглашения истёк (действует 24 часа). Попросите мастера создать новое.');
      const existing=await q.query('SELECT 1 FROM campaign_members WHERE campaign_id=$1 AND user_id=$2',[invite.campaign_id,userId]);
      if(existing.rows[0]) return {campaignId:invite.campaign_id,alreadyMember:true};
      await q.query('INSERT INTO campaign_members(campaign_id,user_id) VALUES($1,$2)',[invite.campaign_id,userId]);
      await q.query('UPDATE campaign_invites SET used_by=$1,used_at=now() WHERE token_hash=$2',[userId,hash]);
      return {campaignId:invite.campaign_id,alreadyMember:false};
    });
    return reply.code(result.alreadyMember?200:201).send(result);
  });
  app.put<{Params:CampaignParams & {userId:string};Body:{isFullGm:boolean;permissions:string[]}}>(
    '/campaigns/:campaignId/members/:userId/permissions',{
      schema:{params:obj({campaignId:uuid,userId:uuid}),body:obj({isFullGm:bool,permissions:{type:'array',items:{type:'string',enum:permissions},uniqueItems:true,maxItems:5}})},
    },async req=>{
      const actor=await auth(req), {campaignId,userId}=req.params;
      return db.transaction(async q=>{
        const me=await membership(q,campaignId,actor,true); ownerOnly(me,actor);
        if(userId===me.owner_user_id) return fail(400,'Права главного мастера определяются владением кампанией.');
        await membership(q,campaignId,userId);
        await q.query('UPDATE campaign_members SET is_full_gm=$1 WHERE campaign_id=$2 AND user_id=$3',[req.body.isFullGm,campaignId,userId]);
        await q.query('DELETE FROM member_permissions WHERE campaign_id=$1 AND user_id=$2',[campaignId,userId]);
        for(const code of req.body.permissions) await q.query('INSERT INTO member_permissions(campaign_id,user_id,permission) VALUES($1,$2,$3)',[campaignId,userId,code]);
        return {isFullGm:req.body.isFullGm,permissions:req.body.permissions};
      });
    });
  app.patch<{Params:CampaignParams & {userId:string};Body:{mayChooseAlliedVision:boolean;fogDisabledByGm:boolean}}>(
    '/campaigns/:campaignId/members/:userId/vision',{
      schema:{params:obj({campaignId:uuid,userId:uuid}),body:obj({mayChooseAlliedVision:bool,fogDisabledByGm:bool})},
    },async req=>{
      const actor=await auth(req),{campaignId,userId}=req.params;
      return db.transaction(async q=>{
        const me=await membership(q,campaignId,actor,true); await requirePermission(q,me,actor,'vision.manage');
        await membership(q,campaignId,userId);
        await q.query('UPDATE campaign_members SET may_choose_allied_vision=$1,fog_disabled_by_gm=$2 WHERE campaign_id=$3 AND user_id=$4',
          [req.body.mayChooseAlliedVision,req.body.fogDisabledByGm,campaignId,userId]);
        return {updated:true};
      });
    });
  app.put<{Params:CampaignParams;Body:{mode:'own'|'allies'}}>(
    '/campaigns/:campaignId/me/vision',{schema:{params:obj({campaignId:uuid}),body:obj({mode:{type:'string',enum:['own','allies']}})}},async req=>{
      const actor=await auth(req),id=req.params.campaignId;
      return db.transaction(async q=>{
        const me=await membership(q,id,actor,true);
        if(req.body.mode==='allies' && !me.may_choose_allied_vision) return fail(403,'Мастер не разрешил общее зрение.');
        await q.query('UPDATE campaign_members SET selected_vision=$1 WHERE campaign_id=$2 AND user_id=$3',[req.body.mode,id,actor]);
        return {mode:req.body.mode};
      });
    });
}
