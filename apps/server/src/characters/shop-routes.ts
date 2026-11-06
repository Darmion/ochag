import type { Queryable } from '../db.ts';
import { objectSchema, reject, uuid, type SceneFeatureContext } from '../tabletop/scene-feature.ts';
import { syncItem } from './magic-items.ts';
import { addToWallet, COINS, payFromWallet, priceText, walletTotal, type Wallet } from '../../../../packages/domain/character/coins.ts';
import { SRD_GEAR, SRD_GEAR_BY_INDEX } from '../../../../packages/domain/srd/gear.ts';
import { MAGIC_ITEM_PRICE_GP, magicItemPriceCp } from '../../../../packages/domain/character/magic-items.ts';
import { relationsFor } from '../campaign/factions.ts';

export type ShopContext = SceneFeatureContext & {
  canActAs: (q: Queryable, member: any, userId: string, characterId: string) => Promise<boolean>;
};

const WALLET = `cp, sp, ep, gp, pp`;

async function walletOf(q: Queryable, campaignId: string, characterId: string) {
  const row = (await q.query(`SELECT id, name, kind, owner_user_id, ${WALLET} FROM characters WHERE campaign_id=$1 AND id=$2 FOR UPDATE`, [campaignId, characterId])).rows[0];
  if (!row) reject(404, 'Существо не найдено.');
  return row as { id: string; name: string; kind: string; owner_user_id: string | null } & Wallet;
}

async function saveWallet(q: Queryable, campaignId: string, characterId: string, wallet: Wallet) {
  await q.query(
    `UPDATE characters SET cp=$3, sp=$4, ep=$5, gp=$6, pp=$7, revision=revision+1 WHERE campaign_id=$1 AND id=$2`,
    [campaignId, characterId, ...COINS.map(coin => wallet[coin])],
  );
}

async function priceOf(q: Queryable, campaignId: string, itemId: string, own: number | null): Promise<number | null> {
  if (own !== null && own !== undefined) return own;
  const rarity = (await q.query('SELECT rarity FROM magic_items WHERE campaign_id=$1 AND character_id=$2', [campaignId, itemId])).rows[0]?.rarity;
  return magicItemPriceCp(rarity);
}

const pick = (row: Wallet): Wallet => ({ cp: row.cp, sp: row.sp, ep: row.ep, gp: row.gp, pp: row.pp });

export function registerShopRoutes(ctx: ShopContext) {
  const { app, db, auth, membership, notifyCampaign, canActAs, canManage } = ctx;
  const characterParams = objectSchema({ campaignId: uuid, characterId: uuid });
  const merchantParams = objectSchema({ campaignId: uuid, merchantId: uuid });

  async function assertActor(q: Queryable, member: any, userId: string, characterId: string, verb: string) {
    if (!(await canActAs(q, member, userId, characterId))) reject(403, `${verb} может тот, чьё это существо, или мастер.`);
  }

  async function merchantOf(q: Queryable, campaignId: string, merchantId: string) {
    const merchant = (await q.query('SELECT id, name, merchant FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, merchantId])).rows[0];
    if (!merchant) reject(404, 'Торговца нет.');
    if (!merchant.merchant) reject(400, `«${merchant.name}» не торгует.`);
    return merchant as { id: string; name: string };
  }

  async function assertTrades(q: Queryable, campaignId: string, merchant: { id: string; name: string }, customerId: string) {
    if ((await relationsFor(q, campaignId, [merchant.id, customerId])).restricted(merchant.id, customerId, 'no-trade')) {
      reject(403, `«${merchant.name}» не торгует с вашей фракцией.`);
    }
  }

  const RARITY_PRICES = Object.entries(MAGIC_ITEM_PRICE_GP)
    .filter(([, gold]) => gold !== null)
    .map(([rarity, gold]) => `WHEN '${rarity}' THEN ${Number(gold) * 100}`).join(' ');
  const PRICED = `COALESCE(c.price_cp, CASE m.rarity ${RARITY_PRICES} END)`;

  async function assertMerchantKeeper(q: Queryable, member: any, userId: string) {
    if (!(await canManage(q, member, userId))) reject(403, 'Товары и цены лавки ставит мастер.');
  }

  function announce(campaignId: string, characterIds: string[], title: string, detail: string) {
    for (const characterId of characterIds) void notifyCampaign(campaignId, { type: 'character', characterId });
    void notifyCampaign(campaignId, { type: 'characters' });
    void notifyCampaign(campaignId, { type: 'notice', title, detail, tone: 'info' });
  }

  app.get('/srd/gear', async request => {
    await auth(request);
    return { gear: SRD_GEAR };
  });

  app.post<{ Params: { campaignId: string; characterId: string }; Body: { srdIndex: string } }>(
    '/campaigns/:campaignId/characters/:characterId/gear',
    { schema: { params: characterParams, body: objectSchema({ srdIndex: { type: 'string', maxLength: 80 } }) } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const gear = SRD_GEAR_BY_INDEX.get(request.body.srdIndex);
      if (!gear) reject(400, 'Такого снаряжения в справочнике нет.');
      const item = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const holder = await walletOf(q, campaignId, characterId);
        await assertActor(q, member, userId, characterId, 'Добавлять снаряжение');
        return (
          await q.query(
            `INSERT INTO characters (campaign_id, owner_user_id, name, kind, size, container_id, price_cp, weight_lb)
             VALUES ($1,$2,$3,'object','tiny',$4,$5,$6) RETURNING id, name, price_cp, weight_lb::float8 AS weight_lb`,
            [campaignId, holder.owner_user_id, gear.nameRu, holder.id, gear.priceCp, gear.weightLb],
          )
        ).rows[0];
      });
      void notifyCampaign(campaignId, { type: 'character', characterId });
      void notifyCampaign(campaignId, { type: 'characters' });
      return reply.code(201).send({ item });
    },
  );

  app.post<{ Params: { campaignId: string; characterId: string }; Body: { toCharacterId: string; amountCp: number } }>(
    '/campaigns/:campaignId/characters/:characterId/coins/give',
    {
      schema: {
        params: characterParams,
        body: objectSchema({ toCharacterId: uuid, amountCp: { type: 'integer', minimum: 1, maximum: 1_000_000_000 } }),
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const { toCharacterId, amountCp } = request.body;
      if (toCharacterId === characterId) reject(400, 'Самому себе деньги не передают.');
      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await assertActor(q, member, userId, characterId, 'Отдать деньги');
        const giver = await walletOf(q, campaignId, characterId);
        const taker = await walletOf(q, campaignId, toCharacterId);
        if (taker.kind === 'object') reject(400, 'Деньги отдают существу.');
        const paid = payFromWallet(pick(giver), amountCp);
        if (!paid) reject(400, `У «${giver.name}» нет ${priceText(amountCp)}.`);
        await saveWallet(q, campaignId, giver.id, paid);
        await saveWallet(q, campaignId, taker.id, addToWallet(pick(taker), amountCp));
        return { from: giver.name, to: taker.name };
      });
      announce(campaignId, [characterId, toCharacterId], 'Деньги переданы', `${result.from} → ${result.to}: ${priceText(amountCp)}.`);
      return { given: amountCp };
    },
  );

  app.get<{ Params: { campaignId: string; merchantId: string } }>(
    '/campaigns/:campaignId/characters/:merchantId/shop',
    { schema: { params: merchantParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId, merchantId } = request.params;
      const member = await membership(db, campaignId, userId);
      const merchant = await merchantOf(db, campaignId, merchantId);
      const keeper = await canManage(db, member, userId);
      const goods = (
        await db.query(
          `SELECT c.id, c.name, ${PRICED} AS price_cp, c.price_cp IS NULL AS default_price, c.weight_lb::float8 AS weight_lb,
                  c.image_asset_id, m.rarity
           FROM characters c LEFT JOIN magic_items m ON m.campaign_id=c.campaign_id AND m.character_id=c.id
           WHERE c.campaign_id=$1 AND c.container_id=$2 AND c.kind='object' AND ($3 OR ${PRICED} IS NOT NULL)
           ORDER BY c.name, c.id`,
          [campaignId, merchantId, keeper],
        )
      ).rows;
      return { merchant, goods, canManage: keeper };
    },
  );

  app.post<{ Params: { campaignId: string; merchantId: string }; Body: { itemId: string; buyerId: string } }>(
    '/campaigns/:campaignId/characters/:merchantId/buy',
    { schema: { params: merchantParams, body: objectSchema({ itemId: uuid, buyerId: uuid }) } },
    async request => {
      const userId = await auth(request);
      const { campaignId, merchantId } = request.params;
      const { itemId, buyerId } = request.body;
      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const merchant = await merchantOf(q, campaignId, merchantId);
        await assertActor(q, member, userId, buyerId, 'Покупать');
        await assertTrades(q, campaignId, merchant, buyerId);
        const buyer = await walletOf(q, campaignId, buyerId);
        if (buyer.kind === 'object') reject(400, 'Покупает существо.');
        const item = (
          await q.query(
            `SELECT id, name, price_cp FROM characters WHERE campaign_id=$1 AND id=$2 AND container_id=$3 AND kind='object' FOR UPDATE`,
            [campaignId, itemId, merchantId],
          )
        ).rows[0];
        if (item) item.price_cp = await priceOf(q, campaignId, item.id, item.price_cp);
        if (!item || item.price_cp === null) reject(400, 'Этого у торговца нет — или уже купили.');
        const paid = payFromWallet(pick(buyer), item.price_cp);
        if (!paid) reject(400, `Не хватает денег: «${item.name}» стоит ${priceText(item.price_cp)}, у ${buyer.name} — ${priceText(walletTotal(pick(buyer)))}.`);
        await saveWallet(q, campaignId, buyer.id, paid);
        await q.query(
          'UPDATE characters SET container_id=$3, owner_user_id=$4, revision=revision+1 WHERE campaign_id=$1 AND id=$2',
          [campaignId, item.id, buyer.id, buyer.owner_user_id],
        );
        await syncItem(q, campaignId, item.id);
        return { buyer: buyer.name, merchant: merchant.name, item: item.name, price: item.price_cp as number };
      });
      announce(campaignId, [buyerId, merchantId], `${result.buyer} покупает`, `«${result.item}» у «${result.merchant}» за ${priceText(result.price)}.`);
      return { bought: result.item, priceCp: result.price };
    },
  );

  app.post<{ Params: { campaignId: string; merchantId: string }; Body: { itemId: string; sellerId: string } }>(
    '/campaigns/:campaignId/characters/:merchantId/sell',
    { schema: { params: merchantParams, body: objectSchema({ itemId: uuid, sellerId: uuid }) } },
    async request => {
      const userId = await auth(request);
      const { campaignId, merchantId } = request.params;
      const { itemId, sellerId } = request.body;
      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const merchant = await merchantOf(q, campaignId, merchantId);
        await assertActor(q, member, userId, sellerId, 'Продавать');
        await assertTrades(q, campaignId, merchant, sellerId);
        const seller = await walletOf(q, campaignId, sellerId);
        const item = (
          await q.query(
            `SELECT id, name, price_cp FROM characters WHERE campaign_id=$1 AND id=$2 AND container_id=$3 AND kind='object' FOR UPDATE`,
            [campaignId, itemId, sellerId],
          )
        ).rows[0];
        if (!item) reject(400, `Продать можно то, что лежит в инвентаре у ${seller.name}.`);
        item.price_cp = await priceOf(q, campaignId, item.id, item.price_cp);
        if (item.price_cp === null) reject(400, `У «${item.name}» нет цены — торговец не знает, сколько дать.`);
        const income = Math.floor(item.price_cp / 2);
        await saveWallet(q, campaignId, seller.id, addToWallet(pick(seller), income));
        const owner = (await q.query('SELECT owner_user_id FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, merchantId])).rows[0]?.owner_user_id ?? null;
        await q.query(
          'UPDATE characters SET container_id=$3, owner_user_id=$4, revision=revision+1 WHERE campaign_id=$1 AND id=$2',
          [campaignId, item.id, merchantId, owner],
        );
        await syncItem(q, campaignId, item.id);
        return { seller: seller.name, merchant: merchant.name, item: item.name, income };
      });
      announce(campaignId, [sellerId, merchantId], `${result.seller} продаёт`, `«${result.item}» торговцу «${result.merchant}» за ${priceText(result.income)}.`);
      return { sold: result.item, incomeCp: result.income };
    },
  );

  app.get<{ Params: { campaignId: string; merchantId: string; sellerId: string } }>(
    '/campaigns/:campaignId/characters/:merchantId/offers/:sellerId',
    { schema: { params: objectSchema({ campaignId: uuid, merchantId: uuid, sellerId: uuid }) } },
    async request => {
      const userId = await auth(request);
      const { campaignId, merchantId, sellerId } = request.params;
      const member = await membership(db, campaignId, userId);
      const merchant = await merchantOf(db, campaignId, merchantId);
      await assertActor(db, member, userId, sellerId, 'Продавать');
      await assertTrades(db, campaignId, merchant, sellerId);
      const rows = (
        await db.query(
          `SELECT c.id, c.name, ${PRICED} AS price_cp, m.rarity
           FROM characters c LEFT JOIN magic_items m ON m.campaign_id=c.campaign_id AND m.character_id=c.id
           WHERE c.campaign_id=$1 AND c.container_id=$2 AND c.kind='object' ORDER BY c.name, c.id`,
          [campaignId, sellerId],
        )
      ).rows as Array<{ id: string; name: string; price_cp: number | null; rarity: string | null }>;
      return {
        offers: rows.map(row => ({
          id: row.id, name: row.name, rarity: row.rarity,
          priceCp: row.price_cp === null ? null : Number(row.price_cp),
          incomeCp: row.price_cp === null ? null : Math.floor(Number(row.price_cp) / 2),
        })),
      };
    },
  );

  app.post<{ Params: { campaignId: string; merchantId: string }; Body: { name: string; priceCp: number; weightLb?: number | null; text?: string } }>(
    '/campaigns/:campaignId/characters/:merchantId/goods',
    {
      schema: {
        params: merchantParams,
        body: objectSchema({
          name: { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' },
          priceCp: { type: 'integer', minimum: 0, maximum: 1_000_000_000 },
          weightLb: { oneOf: [{ type: 'number', minimum: 0, maximum: 100000 }, { type: 'null' }] },
          text: { type: 'string', maxLength: 2000 },
        }, ['name', 'priceCp']),
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, merchantId } = request.params;
      const { name, priceCp, weightLb, text } = request.body;
      const item = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await assertMerchantKeeper(q, member, userId);
        await merchantOf(q, campaignId, merchantId);
        const owner = (await q.query('SELECT owner_user_id FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, merchantId])).rows[0]?.owner_user_id ?? null;
        const sheetExtra = text?.trim() ? { text: { about: { value: text.trim() } } } : {};
        return (
          await q.query(
            `INSERT INTO characters (campaign_id, owner_user_id, name, kind, size, container_id, price_cp, weight_lb, sheet_extra)
             VALUES ($1,$2,$3,'object','tiny',$4,$5,$6,$7::jsonb) RETURNING id, name, price_cp, weight_lb::float8 AS weight_lb`,
            [campaignId, owner, name.trim(), merchantId, priceCp, weightLb ?? null, JSON.stringify(sheetExtra)],
          )
        ).rows[0];
      });
      void notifyCampaign(campaignId, { type: 'character', characterId: merchantId });
      void notifyCampaign(campaignId, { type: 'characters' });
      return reply.code(201).send({ item });
    },
  );

  app.put<{ Params: { campaignId: string; merchantId: string; itemId: string }; Body: { priceCp: number } }>(
    '/campaigns/:campaignId/characters/:merchantId/goods/:itemId',
    {
      schema: {
        params: objectSchema({ campaignId: uuid, merchantId: uuid, itemId: uuid }),
        body: objectSchema({ priceCp: { type: 'integer', minimum: 0, maximum: 1_000_000_000 } }),
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, merchantId, itemId } = request.params;
      const item = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await assertMerchantKeeper(q, member, userId);
        await merchantOf(q, campaignId, merchantId);
        const updated = (
          await q.query(
            `UPDATE characters SET price_cp=$4, revision=revision+1
             WHERE campaign_id=$1 AND id=$2 AND container_id=$3 AND kind='object' RETURNING id, name, price_cp`,
            [campaignId, itemId, merchantId, request.body.priceCp],
          )
        ).rows[0];
        if (!updated) reject(404, 'Этого товара у торговца нет.');
        return updated;
      });
      void notifyCampaign(campaignId, { type: 'character', characterId: itemId });
      return { item };
    },
  );
}
