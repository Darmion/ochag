import type { FastifyInstance } from 'fastify';
import { fail } from './errors.ts';
import { obj, uuid, shortText, type CampaignParams } from './schemas.ts';
import type { AppDeps } from './deps.ts';

export function registerCampaignRoutes(app: FastifyInstance, { db, presence, auth, requireCampaignCreator, membership, ownerOnly }: AppDeps) {
  app.post<{Body:{name:string}}>('/campaigns',{schema:{body:obj({name:shortText(200)})}},async(req,reply)=>{
    const userId=await auth(req);
    await requireCampaignCreator(req,userId);
    const campaign=await db.transaction(async q=>{
      const {rows}=await q.query('INSERT INTO campaigns(name,owner_user_id) VALUES($1,$2) RETURNING id,name,owner_user_id',[req.body.name.trim(),userId]);
      await q.query('INSERT INTO campaign_members(campaign_id,user_id) VALUES($1,$2)',[rows[0]!.id,userId]);
      return rows[0];
    });
    return reply.code(201).send(campaign);
  });
  app.get('/campaigns/online',async req=>{
    const userId=await auth(req);
    const {rows}=await db.query(`SELECT other.user_id,u.display_name,a.username,c.id AS campaign_id,c.name AS campaign_name,c.owner_user_id
      FROM campaign_members mine
      JOIN campaign_members other ON other.campaign_id=mine.campaign_id
      JOIN campaigns c ON c.id=mine.campaign_id
      JOIN users u ON u.id=other.user_id
      JOIN accounts a ON a.user_id=other.user_id
      WHERE mine.user_id=$1
      ORDER BY u.display_name,c.name`,[userId]);
    const sharedCampaigns=new Set(rows.map(r=>r.campaign_id as string));
    const snapshot=presence.snapshot();
    const sceneIds=[...new Set(snapshot.sessions.flatMap(s=>s.live.filter(l=>sharedCampaigns.has(l.campaignId)).map(l=>l.sceneId)))];
    const scenes=new Map((sceneIds.length ? (await db.query('SELECT id,name FROM scenes WHERE id=ANY($1::uuid[])',[sceneIds])).rows : []).map(r=>[r.id,r.name]));
    const campaignNames=new Map(rows.map(r=>[r.campaign_id as string,r.campaign_name as string]));
    type OnlinePlayer={userId:string;displayName:string;username:string;online:boolean;lastSeenAt:number|null;campaigns:{name:string;isGm:boolean}[];atTable:{campaignName:string;sceneName:string}[]};
    const players=new Map<string,OnlinePlayer>();
    for (const r of rows) {
      const entry:OnlinePlayer=players.get(r.user_id) ?? {userId:r.user_id,displayName:r.display_name,username:r.username,online:false,lastSeenAt:null,campaigns:[],atTable:[]};
      entry.campaigns.push({name:r.campaign_name,isGm:r.owner_user_id===r.user_id});
      players.set(r.user_id,entry);
    }
    for (const session of snapshot.sessions) {
      const entry=players.get(session.userId);
      if (!entry) continue;
      entry.online ||= session.online;
      entry.lastSeenAt=Math.max(entry.lastSeenAt ?? 0,session.lastSeenAt);
      for (const live of session.live) {
        if (sharedCampaigns.has(live.campaignId)) entry.atTable.push({campaignName:campaignNames.get(live.campaignId) ?? '?',sceneName:scenes.get(live.sceneId) ?? '?'});
      }
    }
    return {now:Date.now(),players:[...players.values()].sort((a,b)=>Number(b.online)-Number(a.online) || a.displayName.localeCompare(b.displayName))};
  });
  app.get('/campaigns',async req=>{
    const userId=await auth(req);
    const {rows}=await db.query(`SELECT c.id,c.name,c.owner_user_id,c.avatar_asset_id,c.banner_asset_id,c.avatar_crop,c.banner_crop,m.is_full_gm FROM campaigns c
      JOIN campaign_members m ON m.campaign_id=c.id WHERE m.user_id=$1 ORDER BY c.created_at,c.id`,[userId]);
    return {campaigns:rows};
  });
  app.get<{Params:CampaignParams}>('/campaigns/:campaignId',{schema:{params:obj({campaignId:uuid})}},async req=>{
    const userId=await auth(req), id=req.params.campaignId;
    const me=await membership(db,id,userId);
    const {rows}=await db.query('SELECT permission FROM member_permissions WHERE campaign_id=$1 AND user_id=$2 ORDER BY permission',[id,userId]);
    const campaign=(await db.query('SELECT id,name,owner_user_id,rules_base,fog_enabled,avatar_asset_id,banner_asset_id,avatar_crop,banner_crop FROM campaigns WHERE id=$1',[id])).rows[0];
    return {campaign,me:{...me,permissions:rows.map(r=>r.permission)}};
  });
  type Crop={x:number;y:number;zoom:number};
  app.put<{Params:CampaignParams;Body:{avatarAssetId?:string|null;bannerAssetId?:string|null;avatarCrop?:Crop|null;bannerCrop?:Crop|null}}>(
    '/campaigns/:campaignId/appearance',
    {schema:{
      params:obj({campaignId:uuid}),
      body:{...obj({
        avatarAssetId:{oneOf:[uuid,{type:'null'}]},
        bannerAssetId:{oneOf:[uuid,{type:'null'}]},
        avatarCrop:{oneOf:[{type:'object',additionalProperties:false,required:['x','y','zoom'],properties:{x:{type:'number',minimum:0,maximum:100},y:{type:'number',minimum:0,maximum:100},zoom:{type:'number',minimum:1,maximum:5}}},{type:'null'}]},
        bannerCrop:{oneOf:[{type:'object',additionalProperties:false,required:['x','y','zoom'],properties:{x:{type:'number',minimum:0,maximum:100},y:{type:'number',minimum:0,maximum:100},zoom:{type:'number',minimum:1,maximum:5}}},{type:'null'}]},
      },[]),minProperties:1},
    }},
    async req=>{
      const userId=await auth(req),id=req.params.campaignId;
      return db.transaction(async q=>{
        const member=await membership(q,id,userId,true); ownerOnly(member,userId);
        const verify=async(assetId:string|undefined|null,kind:'campaign_avatar'|'campaign_banner')=>{
          if (!assetId) return;
          const asset=(await q.query('SELECT 1 FROM assets WHERE campaign_id=$1 AND id=$2 AND kind=$3',[id,assetId,kind])).rows[0];
          if (!asset) fail(400,kind==='campaign_avatar'?'Выберите аватар этой кампании.':'Выберите баннер этой кампании.');
        };
        await verify(req.body.avatarAssetId,'campaign_avatar');
        await verify(req.body.bannerAssetId,'campaign_banner');
        const {rows}=await q.query(`UPDATE campaigns SET
          avatar_asset_id=CASE WHEN $2 THEN $3::uuid ELSE avatar_asset_id END,
          banner_asset_id=CASE WHEN $4 THEN $5::uuid ELSE banner_asset_id END,
          avatar_crop=CASE WHEN $6 THEN $7::jsonb WHEN $2 THEN NULL ELSE avatar_crop END,
          banner_crop=CASE WHEN $8 THEN $9::jsonb WHEN $4 THEN NULL ELSE banner_crop END
          WHERE id=$1 RETURNING avatar_asset_id,banner_asset_id,avatar_crop,banner_crop`,[
          id,
          req.body.avatarAssetId!==undefined,req.body.avatarAssetId??null,
          req.body.bannerAssetId!==undefined,req.body.bannerAssetId??null,
          req.body.avatarCrop!==undefined,req.body.avatarCrop?JSON.stringify(req.body.avatarCrop):null,
          req.body.bannerCrop!==undefined,req.body.bannerCrop?JSON.stringify(req.body.bannerCrop):null,
        ]);
        return rows[0];
      });
    },
  );
  app.get<{Params:CampaignParams}>('/campaigns/:campaignId/overview',{schema:{params:obj({campaignId:uuid})}},async req=>{
    const userId=await auth(req),id=req.params.campaignId;
    const member=await membership(db,id,userId);
    const maySeeHidden=member.owner_user_id===userId || member.is_full_gm===true;
    const {rows}=await db.query(`SELECT c.world_minutes,
      (SELECT count(*)::int FROM campaign_members m WHERE m.campaign_id=c.id) AS members,
      (SELECT count(*)::int FROM characters x WHERE x.campaign_id=c.id AND x.kind='character') AS heroes,
      (SELECT count(*)::int FROM characters x WHERE x.campaign_id=c.id AND x.kind='npc') AS npcs,
      (SELECT count(*)::int FROM characters x WHERE x.campaign_id=c.id AND x.kind='object') AS objects,
      (SELECT count(*)::int FROM scenes s WHERE s.campaign_id=c.id) AS scenes,
      (SELECT count(*)::int FROM campaign_rules r WHERE r.campaign_id=c.id) AS rules,
      (SELECT count(*)::int FROM campaign_quests q WHERE q.campaign_id=c.id AND q.status='active' AND ($2 OR NOT q.hidden)) AS active_quests
      FROM campaigns c WHERE c.id=$1`,[id,maySeeHidden]);
    const row=rows[0];
    return {overview:{
      members:Number(row.members),heroes:Number(row.heroes),npcs:Number(row.npcs),objects:Number(row.objects),
      scenes:Number(row.scenes),rules:Number(row.rules),activeQuests:Number(row.active_quests),worldMinutes:Number(row.world_minutes),
    }};
  });
}
