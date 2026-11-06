import type { Queryable } from '../../db.ts';
import { objectSchema, reject, uuid, type SceneFeatureContext } from '../scene-feature.ts';
import { syncItem } from '../../characters/magic-items.ts';
import { loadConditionState } from '../../rules/conditions.ts';
import { incapacitatedReason } from '../../../../../packages/domain/combat/conditions.ts';
import { COINS, EMPTY_WALLET, splitWallet, walletText, walletTotal, type Wallet } from '../../../../../packages/domain/character/coins.ts';
import { relationsOf } from '../../campaign/factions.ts';

type Rights = { sceneManager: boolean; characterManager: boolean; editGrants: Set<string> };

export type LootContext = SceneFeatureContext & {
  rightsOf: (q: Queryable, member: any, userId: string) => Promise<Rights>;
  withinFeet: (q: Queryable, campaignId: string, sceneId: string, aId: string, bId: string, feet: number) => Promise<boolean | null>;
};

export async function deadCreatures(q: Queryable, campaignId: string, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const rows = (
    await q.query(
      `SELECT DISTINCT character_id FROM character_effects
       WHERE campaign_id=$1 AND character_id = ANY($2::uuid[]) AND active AND effect_code IN ('dead', 'exhaustion_6')`,
      [campaignId, ids],
    )
  ).rows;
  return new Set(rows.map(row => row.character_id as string));
}

export function registerLootRoutes(ctx: LootContext) {
  const { app, db, auth, membership, notifyCampaign, rightsOf, withinFeet } = ctx;
  const params = objectSchema({ campaignId: uuid, sceneId: uuid, corpseId: uuid });

  async function prepare(q: Queryable, campaignId: string, sceneId: string, corpseId: string, looterId: string, userId: string) {
    const member = await membership(q, campaignId, userId, true);
    const rights = await rightsOf(q, member, userId);
    const manager = rights.sceneManager;

    const onScene = (
      await q.query(
        `SELECT c.id, c.name, c.kind, c.owner_user_id FROM scene_objects p
         JOIN characters c ON c.campaign_id=p.campaign_id AND c.id=p.character_id
         WHERE p.campaign_id=$1 AND p.scene_id=$2 AND c.id = ANY($3::uuid[]) AND p.parent_object_id IS NULL`,
        [campaignId, sceneId, [corpseId, looterId]],
      )
    ).rows as Array<{ id: string; name: string; kind: string; owner_user_id: string | null }>;
    const corpse = onScene.find(row => row.id === corpseId);
    const looter = onScene.find(row => row.id === looterId);
    if (!corpse) reject(404, 'Павшего нет на этой сцене.');
    if (!looter) reject(404, 'Того, кто обыскивает, нет на этой сцене.');
    if (corpse.kind !== 'npc' || !(await deadCreatures(q, campaignId, [corpse.id])).has(corpse.id)) {
      reject(400, `Обыскать можно павшего: «${corpse.name}» жив.`);
    }
    if (looter.kind === 'object') reject(400, 'Обыскивает существо, не предмет.');
    const controlsLooter = manager || rights.characterManager || looter.owner_user_id === userId || rights.editGrants.has(looter.id);
    if (!controlsLooter) reject(403, 'Обыскивать можно своим персонажем.');
    const helpless = incapacitatedReason(await loadConditionState(q, campaignId, looter.id));
    if (helpless) reject(400, `${looter.name} не может обыскивать: ${helpless}.`);
    if (!manager && (await withinFeet(q, campaignId, sceneId, looter.id, corpse.id, 5)) !== true) {
      reject(400, `${looter.name} слишком далеко — подойдите к «${corpse.name}» вплотную.`);
    }
    return { corpse, looter };
  }

  // FOR UPDATE when taking, otherwise two simultaneous «Take all» would both get the same coins.
  async function purseOf(q: Queryable, campaignId: string, corpseId: string, lock: boolean): Promise<Wallet> {
    const row = (
      await q.query(`SELECT cp, sp, ep, gp, pp FROM characters WHERE campaign_id=$1 AND id=$2${lock ? ' FOR UPDATE' : ''}`, [campaignId, corpseId])
    ).rows[0];
    return { cp: row.cp, sp: row.sp, ep: row.ep, gp: row.gp, pp: row.pp };
  }

  async function alliesOf(q: Queryable, campaignId: string, sceneId: string, looterId: string) {
    const rows = (
      await q.query(
        `SELECT DISTINCT c.id, c.name, c.kind, c.disposition, c.factions_explicit FROM scene_objects p
         JOIN characters c ON c.campaign_id=p.campaign_id AND c.id=p.character_id
         WHERE p.campaign_id=$1 AND p.scene_id=$2 AND p.parent_object_id IS NULL AND (c.kind='character' OR c.id=$3)
         ORDER BY c.name`,
        [campaignId, sceneId, looterId],
      )
    ).rows as Array<{ id: string; name: string; kind: string; disposition: string | null; factions_explicit: boolean }>;
    const relations = await relationsOf(q, campaignId, rows);
    const dead = await deadCreatures(q, campaignId, rows.map(row => row.id));
    return rows
      .filter(row => row.id !== looterId && row.kind === 'character' && !dead.has(row.id) && relations.factionsOf(looterId).length > 0 && relations.allies(looterId, row.id))
      .map(row => ({ id: row.id, name: row.name }));
  }

  async function contentsOf(q: Queryable, campaignId: string, corpseId: string) {
    return (
      await q.query(
        `SELECT c.id, c.name, c.size, c.image_asset_id,
                (SELECT count(*)::int FROM characters inner_c
                 WHERE inner_c.campaign_id = c.campaign_id AND inner_c.container_id = c.id) AS contents_count
         FROM characters c
         WHERE c.campaign_id=$1 AND c.container_id=$2 AND c.kind='object'
         ORDER BY c.name, c.id`,
        [campaignId, corpseId],
      )
    ).rows;
  }

  app.get<{ Params: { campaignId: string; sceneId: string; corpseId: string }; Querystring: { looterId: string } }>(
    '/campaigns/:campaignId/scenes/:sceneId/loot/:corpseId',
    { schema: { params, querystring: objectSchema({ looterId: uuid }) } },
    async request => {
      const userId = await auth(request);
      const { campaignId, sceneId, corpseId } = request.params;
      return db.transaction(async q => {
        const { corpse } = await prepare(q, campaignId, sceneId, corpseId, request.query.looterId, userId);
        return {
          corpse: { id: corpse.id, name: corpse.name },
          items: await contentsOf(q, campaignId, corpse.id),
          coins: await purseOf(q, campaignId, corpse.id, false),
        };
      });
    },
  );

  app.post<{ Params: { campaignId: string; sceneId: string; corpseId: string }; Body: { looterId: string; itemIds?: string[]; coins?: boolean; share?: boolean } }>(
    '/campaigns/:campaignId/scenes/:sceneId/loot/:corpseId',
    {
      schema: {
        params,
        body: objectSchema({
          looterId: uuid,
          itemIds: { type: 'array', maxItems: 100, uniqueItems: true, items: uuid },
          coins: { type: 'boolean' },
          share: { type: 'boolean' },
        }, ['looterId']),
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, sceneId, corpseId } = request.params;
      const { looterId, itemIds } = request.body;
      const wantsCoins = request.body.coins ?? !itemIds;

      const result = await db.transaction(async q => {
        const { corpse, looter } = await prepare(q, campaignId, sceneId, corpseId, looterId, userId);
        const items = await contentsOf(q, campaignId, corpse.id);
        const wanted = itemIds ? items.filter(item => itemIds.includes(item.id)) : items;
        if (itemIds && wanted.length !== itemIds.length) reject(404, 'Этого при павшем нет — может, уже взяли.');
        const purse = wantsCoins ? await purseOf(q, campaignId, corpse.id, true) : EMPTY_WALLET;
        const hasCoins = walletTotal(purse) > 0;
        if (!wanted.length && !hasCoins) {
          reject(400, wantsCoins && itemIds?.length === 0 ? `Денег при «${corpse.name}» нет — может, уже взяли.` : `При «${corpse.name}» ничего нет.`);
        }

        if (wanted.length) {
          await q.query(
            `UPDATE characters SET container_id=$3, owner_user_id=$4, revision=revision+1
             WHERE campaign_id=$1 AND id = ANY($2::uuid[])`,
            [campaignId, wanted.map(item => item.id), looter.id, looter.owner_user_id],
          );
          for (const item of wanted) await syncItem(q, campaignId, item.id);
        }
        const shares: Array<{ id: string; name: string; coins: Wallet }> = [];
        if (hasCoins) {
          const takers = [{ id: looter.id, name: looter.name }, ...(request.body.share ? await alliesOf(q, campaignId, sceneId, looter.id) : [])];
          const split = splitWallet(purse, takers.length);
          for (const [index, taker] of takers.entries()) {
            const coins = split[index]!;
            if (!walletTotal(coins)) continue;
            await q.query(
              `UPDATE characters SET cp=cp+$3, sp=sp+$4, ep=ep+$5, gp=gp+$6, pp=pp+$7, revision=revision+1
               WHERE campaign_id=$1 AND id=$2`,
              [campaignId, taker.id, ...COINS.map(coin => coins[coin])],
            );
            shares.push({ ...taker, coins });
          }
          await q.query(
            `UPDATE characters SET cp=0, sp=0, ep=0, gp=0, pp=0, revision=revision+1 WHERE campaign_id=$1 AND id=$2`,
            [campaignId, corpse.id],
          );
        }
        return {
          corpse: { id: corpse.id, name: corpse.name },
          looter: { id: looter.id, name: looter.name },
          taken: wanted.map(item => ({ id: item.id, name: item.name })),
          coins: purse,
          ...(shares.length > 1 ? { shares } : {}),
          left: items.length - wanted.length,
        };
      });

      void notifyCampaign(campaignId, { type: 'changed' });
      void notifyCampaign(campaignId, { type: 'character', characterId: result.looter.id });
      for (const share of result.shares ?? []) {
        if (share.id !== result.looter.id) void notifyCampaign(campaignId, { type: 'character', characterId: share.id });
      }
      void notifyCampaign(campaignId, { type: 'character', characterId: result.corpse.id });
      const what = [...result.taken.map(item => item.name), walletText(result.coins)].filter(Boolean).join(', ');
      const split = result.shares ? ` Деньги поровну: ${result.shares.map(share => `${share.name} — ${walletText(share.coins)}`).join('; ')}.` : '';
      void notifyCampaign(campaignId, {
        type: 'notice', title: 'Добыча', tone: 'info',
        detail: `${result.looter.name} обыскивает «${result.corpse.name}»: ${what}.${split}`,
      });
      return result;
    },
  );
}
