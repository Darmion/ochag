import type { Queryable } from '../db.ts';
import { objectSchema, reject, uuid } from '../tabletop/scene-feature.ts';
import { canHandle, canOpen, controls, loadTree, type InventoryContext, type Node, type Rights } from './inventory-routes.ts';
import { syncItem } from './magic-items.ts';
import { purgeObject } from '../tabletop/scene/objects/remove.ts';
import {
  ITEM_COLUMNS, asItem, itemLeftHolder, loadHeldItems, magicArmorBonus, proficientWith, refreshGearAc, wornArmorInCombat, type ItemRow,
} from './inventory-state.ts';
import { COINS, payFromWallet, priceText, walletTotal, type Wallet } from '../../../../packages/domain/character/coins.ts';
import { characterClassLevels } from '../../../../packages/domain/character/classes.ts';
import { knownFightingStyles } from '../../../../packages/domain/character/feats.ts';
import { magicUseLabel } from '../../../../packages/domain/character/magic-items.ts';
import { srdWeaponFields } from '../../../../packages/domain/srd/weapons.ts';
import {
  EQUIP_SLOTS, ITEM_CATEGORIES, WEAR_FAMILIES, carriedWeight, catalogByName, catalogEntry, encumbrance, gearArmorClass, handsNeeded, isContainer,
  itemCategory, itemSlots, normalizeDoll, planEquip, srdArmorOf, srdWeaponOf, stackable, unitPrice, unitWeight,
  type EquipSlot, type InventoryItem,
} from '../../../../packages/domain/character/inventory.ts';

export type ItemContext = InventoryContext & {
  campaignFlag: (q: Queryable, campaignId: string, key: string) => Promise<boolean | null>;
};

async function flag(ctx: ItemContext, q: Queryable, campaignId: string, key: string) {
  return (await ctx.campaignFlag(q, campaignId, key)) === true;
}

function managerOf(rights: Rights) {
  return rights.sceneManager || rights.characterManager;
}

function holderOf(tree: Map<string, Node>, item: Node) {
  const holder = item.container_id ? tree.get(item.container_id) : undefined;
  return holder && holder.kind !== 'object' ? holder : null;
}

async function inCombat(q: Queryable, campaignId: string, characterId: string) {
  return Boolean((await q.query(
    `SELECT 1 FROM initiative_entries ie WHERE ie.campaign_id=$1 AND ie.character_id=$2
       AND EXISTS (SELECT 1 FROM initiative_entries x WHERE x.campaign_id=ie.campaign_id AND x.scene_id=ie.scene_id AND x.is_current) LIMIT 1`,
    [campaignId, characterId],
  )).rows[0]);
}

async function linkWeapon(q: Queryable, campaignId: string, holderId: string, item: InventoryItem) {
  if (itemCategory(item) !== 'weapon') return;
  const linked = (await q.query('SELECT id FROM character_weapons WHERE campaign_id=$1 AND character_id=$2 AND source_item_id=$3', [campaignId, holderId, item.id])).rows[0];
  if (linked) return;
  const weapon = srdWeaponOf(item);
  const same = (
    await q.query(
      `SELECT id FROM character_weapons WHERE campaign_id=$1 AND character_id=$2 AND source_item_id IS NULL
         AND (lower(name)=lower($3) OR ($4::text IS NOT NULL AND srd_index=$4)) ORDER BY id LIMIT 1`,
      [campaignId, holderId, item.name, weapon?.index ?? null],
    )
  ).rows[0];
  if (same) {
    await q.query('UPDATE character_weapons SET source_item_id=$2 WHERE id=$1', [same.id, item.id]);
    return;
  }
  if (!weapon) return;
  const holder = (await q.query('SELECT class_name, sheet_extra, level FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, holderId])).rows[0];
  const proficient = holder ? proficientWith(characterClassLevels(holder).classes, weapon) : false;
  const fields = srdWeaponFields(weapon);
  await q.query(
    `INSERT INTO character_weapons (
       campaign_id, character_id, name, ability, proficient, damage_formula, damage_type, range_feet,
       weapon_kind, long_range_feet, thrown_range_feet, versatile_formula, properties, srd_index, source_item_id, source_auto
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,true)`,
    [campaignId, holderId, item.name, fields.ability, proficient, fields.damageFormula, fields.damageType, fields.rangeFeet, fields.weaponKind,
      fields.longRangeFeet, fields.thrownRangeFeet, fields.versatileFormula, JSON.stringify(fields.properties), fields.srdIndex, item.id],
  );
}

async function syncMagicSlot(q: Queryable, campaignId: string, itemId: string, equipped: boolean) {
  const magic = (await q.query('UPDATE magic_items SET equipped=$3 WHERE campaign_id=$1 AND character_id=$2 RETURNING character_id', [campaignId, itemId, equipped])).rows[0];
  return magic ? syncItem(q, campaignId, itemId) : [];
}

type StackKey = { name: string; srd: string | null; priceCp: number | null; weightLb: number | null; category: string | null; wear: string | null; image: string | null };

function stackKey(row: ItemRow): StackKey {
  return {
    name: row.name, srd: row.item_srd ?? null, priceCp: row.price_cp ?? null, weightLb: row.weight_lb === null || row.weight_lb === undefined ? null : Number(row.weight_lb),
    category: row.item_category ?? null, wear: row.item_wear ?? null, image: row.image_asset_id ?? null,
  };
}

function sameStack(row: ItemRow, item: StackKey) {
  const key = stackKey(row);
  return row.equipped_slot === null && row.infinite !== true && !row.item_note
    && key.name === item.name && key.srd === item.srd && key.priceCp === item.priceCp && key.weightLb === item.weightLb
    && key.category === item.category && key.wear === item.wear && key.image === item.image;
}

async function plainStacks(q: Queryable, campaignId: string, containerId: string, exceptId: string | null) {
  return (await q.query(
    `SELECT ${ITEM_COLUMNS} FROM characters c WHERE c.campaign_id=$1 AND c.container_id=$2 AND c.kind='object' AND c.id IS DISTINCT FROM $3::uuid
       AND NOT EXISTS (SELECT 1 FROM magic_items m WHERE m.campaign_id=c.campaign_id AND m.character_id=c.id)
       AND NOT EXISTS (SELECT 1 FROM characters inner_c WHERE inner_c.campaign_id=c.campaign_id AND inner_c.container_id=c.id)
     FOR UPDATE`,
    [campaignId, containerId, exceptId],
  )).rows;
}

const STACK_LIMIT = 1_000_000;

const itemParams = objectSchema({ campaignId: uuid, characterId: uuid });
const nullableNumber = (max: number) => ({ oneOf: [{ type: 'number', minimum: 0, maximum: max }, { type: 'null' }] });

export function registerItemRoutes(ctx: ItemContext) {
  const { app, db, auth, membership, notifyCampaign, rightsOf } = ctx;

  async function access(q: Queryable, campaignId: string, userId: string, write: boolean) {
    const member = await membership(q, campaignId, userId, write);
    const rights = await rightsOf(q, member, userId);
    const tree = await loadTree(q, campaignId);
    return { member, rights, tree, manager: managerOf(rights) };
  }

  async function holderView(q: Queryable, campaignId: string, holderId: string, userId: string, rights: Rights, tree: Map<string, Node>) {
    const holder = (
      await q.query(
        `SELECT id, name, kind, size, owner_user_id, strength, dexterity, constitution, wisdom, armor_class, ac_mode, image_asset_id, image_crop,
                doll, class_name, sheet_extra, level, cp, sp, ep, gp, pp
         FROM characters WHERE campaign_id=$1 AND id=$2`,
        [campaignId, holderId],
      )
    ).rows[0] as ItemRow;
    const rows = await loadHeldItems(q, campaignId, holderId);
    const items = rows.map(asItem);
    const magic = new Map(
      (await q.query(
        `SELECT character_id, rarity, requires_attunement, attuned_to, equipped, destroyed, charges_current, charges_max, srd_index FROM magic_items
         WHERE campaign_id=$1 AND character_id = ANY($2::uuid[])`,
        [campaignId, items.map(item => item.id)],
      )).rows.map(row => [row.character_id as string, row]),
    );
    const weapons = (await q.query('SELECT id, name, source_item_id FROM character_weapons WHERE campaign_id=$1 AND character_id=$2', [campaignId, holderId])).rows;
    const coins = COINS.reduce((sum, coin) => sum + Math.max(0, Number(holder[coin] ?? 0)), 0);
    const weight = carriedWeight(holderId, items, coins);
    const load = encumbrance(weight.pounds, weight.unknown, Number(holder.strength ?? 10), holder.size ?? null);
    const worn = items.filter(item => item.containerId === holderId && item.slot);
    const gearAc = gearArmorClass({
      worn, dexterity: Number(holder.dexterity), constitution: Number(holder.constitution), wisdom: Number(holder.wisdom),
      classes: characterClassLevels(holder).classes, defenseStyle: knownFightingStyles(holder.sheet_extra).ids.includes('defense'),
    });
    const magicAc = await magicArmorBonus(q, campaignId, holderId);
    const node = tree.get(holderId)!;
    const editable = controls(rights, userId, node) || managerOf(rights);
    return {
      holder: {
        id: holder.id, name: holder.name, kind: holder.kind, size: holder.size, strength: Number(holder.strength ?? 10),
        armorClass: Number(holder.armor_class), acMode: holder.ac_mode, imageAssetId: holder.image_asset_id, imageCrop: holder.image_crop,
        doll: normalizeDoll(holder.doll, holder.kind), wallet: Object.fromEntries(COINS.map(coin => [coin, Number(holder[coin] ?? 0)])),
      },
      items: rows.map((row, index) => {
        const item = items[index]!;
        const info = magic.get(item.id);
        const armor = srdArmorOf(item);
        const weapon = srdWeaponOf(item);
        return {
          ...item, srd: item.srd ?? catalogByName(item.name)?.ref ?? null, category: itemCategory(item), storedCategory: row.item_category ?? null, note: row.item_note ?? null,
          imageAssetId: row.image_asset_id ?? null, depth: Number(row.depth), slots: itemSlots(item),
          container: isContainer(item) || items.some(inner => inner.containerId === item.id),
          hands: handsNeeded(item), stackable: stackable(item), versatile: Boolean(weapon?.properties.includes('versatile')),
          armor: armor ? { kind: armor.kind, ac: armor.ac, dex: armor.dex, strength: armor.strength ?? null, stealth: armor.stealth === true } : null,
          weapon: weapon ? { damage: weapon.damage, damageType: weapon.damageType, properties: weapon.properties, range: weapon.range ?? null } : null,
          attackId: weapons.find(entry => entry.source_item_id === item.id)?.id ?? null,
          magic: info ? {
            rarity: info.rarity, requiresAttunement: info.requires_attunement === true, attuned: info.attuned_to === holderId, equipped: info.equipped === true,
            destroyed: info.destroyed === true, charges: info.charges_max ? { current: Number(info.charges_current), max: Number(info.charges_max) } : null,
            useLabel: info.destroyed ? null : magicUseLabel(info.srd_index),
          } : null,
        };
      }),
      weight: { ...load, coinsLb: Math.round(coins / 50 * 100) / 100 },
      gearAc: { value: gearAc.value + magicAc, parts: magicAc ? [...gearAc.parts, `магия ${magicAc > 0 ? '+' : '−'}${Math.abs(magicAc)}`] : gearAc.parts },
      editable,
      manager: managerOf(rights),
    };
  }

  app.get<{ Params: { campaignId: string; characterId: string } }>(
    '/campaigns/:campaignId/characters/:characterId/inventory',
    { schema: { params: itemParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      return db.transaction(async q => {
        const { rights, tree } = await access(q, campaignId, userId, false);
        const holder = tree.get(characterId);
        if (!holder) reject(404, 'Существо не найдено.');
        if (!canOpen(tree, rights, userId, holder)) reject(403, 'Заглянуть в вещи может тот, кто управляет этим существом.');
        const view = await holderView(q, campaignId, characterId, userId, rights, tree);
        return {
          ...view,
          rules: {
            encumbrance: await flag(ctx, q, campaignId, 'encumbrance'),
            encumbranceSpeed: await flag(ctx, q, campaignId, 'encumbrance_speed'),
            ammoUse: await flag(ctx, q, campaignId, 'ammo_use'),
          },
        };
      });
    },
  );

  app.post<{
    Params: { campaignId: string; characterId: string };
    Body: {
      ref?: string; quantity: number; buy?: boolean; containerId?: string;
      custom?: { name: string; category?: string; weightLb?: number | null; priceCp?: number | null; wear?: string | null; note?: string | null; infinite?: boolean };
    };
  }>(
    '/campaigns/:campaignId/characters/:characterId/inventory',
    {
      schema: {
        params: itemParams,
        body: objectSchema({
          ref: { type: 'string', pattern: '^(gear|weapon):[a-z0-9-]{1,80}$' },
          quantity: { type: 'integer', minimum: 1, maximum: 10000 },
          buy: { type: 'boolean' },
          containerId: uuid,
          custom: objectSchema({
            name: { type: 'string', minLength: 1, maxLength: 100 },
            category: { type: 'string', enum: ITEM_CATEGORIES },
            weightLb: nullableNumber(100000),
            priceCp: { oneOf: [{ type: 'integer', minimum: 0, maximum: 100000000 }, { type: 'null' }] },
            wear: { oneOf: [{ type: 'string', enum: WEAR_FAMILIES }, { type: 'null' }] },
            note: { oneOf: [{ type: 'string', maxLength: 2000 }, { type: 'null' }] },
            infinite: { type: 'boolean' },
          }, ['name']),
        }, ['quantity']),
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const { ref, quantity, buy, containerId, custom } = request.body;
      if (Boolean(ref) === Boolean(custom)) reject(400, 'Укажите предмет из справочника или свой предмет.');
      const result = await db.transaction(async q => {
        const { rights, tree, manager } = await access(q, campaignId, userId, true);
        const holderNode = tree.get(characterId);
        if (!holderNode || holderNode.kind === 'object') reject(404, 'Существо не найдено.');
        if (!controls(rights, userId, holderNode) && !manager) reject(403, 'Добавлять вещи может тот, чей это герой, или мастер.');
        const into = containerId ? tree.get(containerId) : holderNode;
        if (!into) reject(404, 'Контейнер не найден.');
        if (into.id !== characterId) {
          let at: Node | undefined = into;
          for (let guard = 0; at && at.id !== characterId && guard < 10; guard += 1) at = at.container_id ? tree.get(at.container_id) : undefined;
          if (!at) reject(400, 'Класть можно в сумки этого героя.');
        }
        if (custom?.infinite && !manager) reject(403, '«Бесконечный» отмечает мастер.');

        const entry = ref ? catalogEntry(ref) : null;
        if (ref && !entry) reject(400, 'Такого предмета в справочнике нет.');
        const units = entry ? quantity * entry.pack : quantity;
        const total = entry ? (entry.priceCp === null ? null : entry.priceCp * quantity) : custom!.priceCp == null ? null : custom!.priceCp * quantity;
        const holder = (await q.query(`SELECT owner_user_id, cp, sp, ep, gp, pp FROM characters WHERE campaign_id=$1 AND id=$2 FOR UPDATE`, [campaignId, characterId])).rows[0] as ItemRow;
        const name = entry ? entry.nameRu : custom!.name.trim();
        const priceCp = entry ? (unitPrice(entry) === null ? null : Math.round(unitPrice(entry)!)) : custom!.priceCp ?? null;
        const weightLb = entry ? unitWeight(entry) : custom!.weightLb ?? null;
        const srd = entry ? entry.ref : null;
        const category = entry ? entry.category : custom!.category ?? null;
        const piece: StackKey = { name, srd, priceCp, weightLb, category, wear: custom?.wear ?? null, image: null };
        const existing = !custom?.infinite && !custom?.note && stackable({ name, srd, category: category as never })
          ? (await plainStacks(q, campaignId, into.id, null)).find(row => sameStack(row, piece)) ?? null
          : null;
        if (existing && Number(existing.quantity) + units > STACK_LIMIT) reject(400, `В стопке не может быть больше ${STACK_LIMIT} шт.`);

        let wallet: Wallet | null = null;
        if (buy) {
          if (total === null) reject(400, 'У предмета нет цены — его можно только взять бесплатно.');
          const current = Object.fromEntries(COINS.map(coin => [coin, Number(holder[coin] ?? 0)])) as Wallet;
          wallet = payFromWallet(current, total);
          if (!wallet) reject(400, `Не хватает денег: нужно ${priceText(total)}, в кошельке ${priceText(walletTotal(current))}.`);
          await q.query('UPDATE characters SET cp=$3, sp=$4, ep=$5, gp=$6, pp=$7, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, characterId, ...COINS.map(coin => wallet![coin])]);
        }
        const paid = buy ? total : null;
        if (existing) {
          await q.query('UPDATE characters SET quantity=quantity+$3, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, existing.id, units]);
          return { itemId: existing.id as string, name, added: units, total: Number(existing.quantity) + units, merged: true, paid, wallet };
        }
        const inserted = (
          await q.query(
            `INSERT INTO characters (campaign_id, owner_user_id, name, kind, size, container_id, price_cp, weight_lb, quantity, item_category, item_srd, item_wear, infinite, item_note)
             VALUES ($1,$2,$3,'object','tiny',$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
            [campaignId, holder.owner_user_id, name, into.id, priceCp, weightLb, units, entry ? entry.category : custom!.category ?? null, srd,
              custom?.wear ?? null, custom?.infinite === true, custom?.note?.trim() || null],
          )
        ).rows[0];
        return { itemId: inserted.id as string, name, added: units, total: units, merged: false, paid, wallet };
      });
      void notifyCampaign(campaignId, { type: 'character', characterId });
      void notifyCampaign(campaignId, { type: 'characters' });
      return reply.code(201).send(result);
    },
  );

  async function itemAccess(q: Queryable, campaignId: string, itemId: string, userId: string) {
    const scope = await access(q, campaignId, userId, true);
    const item = scope.tree.get(itemId);
    if (!item || item.kind !== 'object') reject(404, 'Предмет не найден.');
    if (!canHandle(scope.tree, scope.rights, userId, item)) reject(403, 'Распоряжаться можно своим предметом или тем, что лежит в доступном вам контейнере.');
    const row = (await q.query(`SELECT ${ITEM_COLUMNS} FROM characters c WHERE c.campaign_id=$1 AND c.id=$2 FOR UPDATE`, [campaignId, itemId])).rows[0] as ItemRow;
    return { ...scope, node: item, row, item: asItem(row) };
  }

  app.patch<{
    Params: { campaignId: string; characterId: string };
    Body: { name?: string; quantity?: number; category?: string | null; weightLb?: number | null; priceCp?: number | null; wear?: string | null; note?: string | null; infinite?: boolean; grip?: 'one' | 'two' | null };
  }>(
    '/campaigns/:campaignId/characters/:characterId/item',
    {
      schema: {
        params: itemParams,
        body: {
          ...objectSchema({
            name: { type: 'string', minLength: 1, maxLength: 100 },
            quantity: { type: 'integer', minimum: 1, maximum: 1000000 },
            category: { oneOf: [{ type: 'string', enum: ITEM_CATEGORIES }, { type: 'null' }] },
            weightLb: nullableNumber(100000),
            priceCp: { oneOf: [{ type: 'integer', minimum: 0, maximum: 100000000 }, { type: 'null' }] },
            wear: { oneOf: [{ type: 'string', enum: WEAR_FAMILIES }, { type: 'null' }] },
            note: { oneOf: [{ type: 'string', maxLength: 2000 }, { type: 'null' }] },
            infinite: { type: 'boolean' },
            grip: { oneOf: [{ type: 'string', enum: ['one', 'two'] }, { type: 'null' }] },
          }, []),
          minProperties: 1,
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const body = request.body;
      const result = await db.transaction(async q => {
        const { manager, row, item } = await itemAccess(q, campaignId, characterId, userId);
        if (body.infinite !== undefined && !manager) reject(403, '«Бесконечный» отмечает мастер.');
        const set: string[] = [];
        const values: unknown[] = [campaignId, characterId];
        const put = (column: string, value: unknown) => {
          values.push(value);
          set.push(`${column}=$${values.length}`);
        };
        if (body.name !== undefined) put('name', body.name.trim());
        if (body.quantity !== undefined) put('quantity', body.quantity);
        if (body.category !== undefined) put('item_category', body.category);
        if (body.weightLb !== undefined) put('weight_lb', body.weightLb);
        if (body.priceCp !== undefined) put('price_cp', body.priceCp);
        if (body.wear !== undefined) put('item_wear', body.wear);
        if (body.note !== undefined) put('item_note', body.note?.trim() || null);
        if (body.infinite !== undefined) put('infinite', body.infinite);
        if (body.grip !== undefined) {
          if (body.grip === 'two' && row.equipped_slot && !srdWeaponOf(item)?.properties.includes('versatile')) reject(400, 'Двумя руками держат универсальное оружие.');
          put('item_grip', body.grip);
        }
        await q.query(`UPDATE characters SET ${set.join(', ')}, revision=revision+1 WHERE campaign_id=$1 AND id=$2`, values);
        const holderId = row.container_id as string | null;
        const touched = new Set<string>(holderId ? [holderId] : []);
        if (holderId && row.equipped_slot) {
          const fresh = asItem((await q.query(`SELECT ${ITEM_COLUMNS} FROM characters c WHERE c.campaign_id=$1 AND c.id=$2`, [campaignId, characterId])).rows[0]);
          const worn = (await q.query(`SELECT ${ITEM_COLUMNS} FROM characters c WHERE c.campaign_id=$1 AND c.container_id=$2 AND c.equipped_slot IS NOT NULL`, [campaignId, holderId])).rows.map(asItem);
          const plan = planEquip(fresh, worn, row.equipped_slot);
          if ('error' in plan || plan.displaced.length) {
            await q.query('UPDATE characters SET equipped_slot=NULL WHERE campaign_id=$1 AND id=$2', [campaignId, characterId]);
            for (const id of await syncMagicSlot(q, campaignId, characterId, false)) touched.add(id);
          }
        }
        if (holderId) await refreshGearAc(q, campaignId, holderId);
        return { holderId, touched: [...touched] };
      });
      for (const id of result.touched.length ? result.touched : [characterId]) void notifyCampaign(campaignId, { type: 'character', characterId: id });
      return { ok: true };
    },
  );

  app.post<{ Params: { campaignId: string; characterId: string }; Body: { slot: EquipSlot | null; grip?: 'one' | 'two' } }>(
    '/campaigns/:campaignId/characters/:characterId/equip-slot',
    {
      schema: {
        params: itemParams,
        body: objectSchema({ slot: { oneOf: [{ type: 'string', enum: EQUIP_SLOTS }, { type: 'null' }] }, grip: { type: 'string', enum: ['one', 'two'] } }, ['slot']),
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const { slot, grip } = request.body;
      const result = await db.transaction(async q => {
        const { rights, tree, manager, node, row, item } = await itemAccess(q, campaignId, characterId, userId);
        const holder = holderOf(tree, node);
        if (!holder) reject(400, 'Надеть можно то, что лежит у героя при себе, не в сумке.');
        if (!controls(rights, userId, holder) && !manager) reject(403, 'Надевать и снимать может тот, чей это герой, или мастер.');
        const worn = (await q.query(`SELECT ${ITEM_COLUMNS} FROM characters c WHERE c.campaign_id=$1 AND c.container_id=$2 AND c.equipped_slot IS NOT NULL FOR UPDATE`, [campaignId, holder.id])).rows.map(asItem);
        const changed: string[] = [];
        const armorish = (entry: InventoryItem) => itemCategory(entry) === 'armor';
        if (slot === null) {
          if (row.equipped_slot && armorish(item) && !manager && await inCombat(q, campaignId, holder.id)) reject(400, 'Доспех в бою не снять: на это уходят минуты.');
          await q.query('UPDATE characters SET equipped_slot=NULL, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, item.id]);
          changed.push(item.id);
        } else {
          const wanted = { ...item, grip: grip ?? item.grip };
          if (grip === 'two' && !srdWeaponOf(item)?.properties.includes('versatile') && handsNeeded({ ...item, grip: null }) === 1) reject(400, 'Двумя руками держат универсальное оружие.');
          const plan = planEquip(wanted, worn, slot);
          if ('error' in plan) reject(400, plan.error);
          if ((armorish(item) || plan.displaced.some(armorish)) && !manager && await inCombat(q, campaignId, holder.id)) {
            reject(400, 'Доспех в бою не надеть и не снять: на это уходят минуты.');
          }
          for (const other of plan.displaced) {
            await q.query('UPDATE characters SET equipped_slot=NULL, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, other.id]);
            changed.push(other.id);
          }
          await q.query('UPDATE characters SET equipped_slot=$3, item_grip=$4, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, item.id, plan.slot, wanted.grip ?? null]);
          changed.push(item.id);
          if (plan.slot === 'main_hand' || plan.slot === 'off_hand') await linkWeapon(q, campaignId, holder.id, item);
        }
        const touched = new Set<string>([holder.id]);
        for (const id of changed) {
          const now = (await q.query('SELECT equipped_slot FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, id])).rows[0];
          for (const other of await syncMagicSlot(q, campaignId, id, Boolean(now?.equipped_slot))) touched.add(other);
        }
        const armorClass = await refreshGearAc(q, campaignId, holder.id);
        return { holderId: holder.id, changed, touched: [...touched], armorClass };
      });
      for (const id of result.touched) void notifyCampaign(campaignId, { type: 'character', characterId: id });
      void notifyCampaign(campaignId, { type: 'changed' });
      return { changed: result.changed, armorClass: result.armorClass };
    },
  );

  app.post<{ Params: { campaignId: string; characterId: string }; Body: { count?: number } }>(
    '/campaigns/:campaignId/characters/:characterId/use',
    { schema: { params: itemParams, body: objectSchema({ count: { type: 'integer', minimum: 1, maximum: 1000 } }, []) } },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const count = request.body?.count ?? 1;
      const result = await db.transaction(async q => {
        const { row, item } = await itemAccess(q, campaignId, characterId, userId);
        if (item.infinite) return { left: item.quantity, holderId: row.container_id, gone: false, infinite: true };
        if (count > item.quantity) reject(400, `Есть только ${item.quantity}.`);
        const left = item.quantity - count;
        if (left <= 0) {
          await purgeObject(q, campaignId, item.id);
          if (row.container_id) await refreshGearAc(q, campaignId, row.container_id);
          return { left: 0, holderId: row.container_id, gone: true, infinite: false };
        }
        await q.query('UPDATE characters SET quantity=$3, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, item.id, left]);
        return { left, holderId: row.container_id, gone: false, infinite: false };
      });
      if (result.holderId) void notifyCampaign(campaignId, { type: 'character', characterId: result.holderId });
      void notifyCampaign(campaignId, { type: 'changed' });
      return { left: result.left, gone: result.gone, infinite: result.infinite };
    },
  );

  async function splitOff(q: Queryable, campaignId: string, row: ItemRow, count: number) {
    const inserted = (
      await q.query(
        `INSERT INTO characters (campaign_id, owner_user_id, name, kind, size, container_id, price_cp, weight_lb, quantity, item_category, item_srd,
                                 item_wear, item_grip, infinite, item_note, image_asset_id, model_asset_id)
         SELECT campaign_id, owner_user_id, name, kind, size, container_id, price_cp, weight_lb, $3, item_category, item_srd,
                item_wear, item_grip, infinite, item_note, image_asset_id, model_asset_id
         FROM characters WHERE campaign_id=$1 AND id=$2 RETURNING id`,
        [campaignId, row.id, count],
      )
    ).rows[0];
    await q.query('UPDATE characters SET quantity=quantity-$3, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, row.id, count]);
    return inserted.id as string;
  }

  app.post<{ Params: { campaignId: string; characterId: string }; Body: { count: number } }>(
    '/campaigns/:campaignId/characters/:characterId/split',
    { schema: { params: itemParams, body: objectSchema({ count: { type: 'integer', minimum: 1, maximum: 1000000 } }) } },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const result = await db.transaction(async q => {
        const { row, item } = await itemAccess(q, campaignId, characterId, userId);
        if ((await q.query('SELECT 1 FROM magic_items WHERE campaign_id=$1 AND character_id=$2', [campaignId, item.id])).rows[0]) reject(400, 'Магический предмет не делится.');
        if (request.body.count >= item.quantity) reject(400, `Отделить можно меньше, чем есть (${item.quantity}).`);
        return { itemId: await splitOff(q, campaignId, row, request.body.count), holderId: row.container_id as string | null };
      });
      if (result.holderId) void notifyCampaign(campaignId, { type: 'character', characterId: result.holderId });
      return { itemId: result.itemId };
    },
  );

  app.post<{ Params: { campaignId: string; characterId: string }; Body: { toCharacterId: string; count?: number } }>(
    '/campaigns/:campaignId/characters/:characterId/give',
    { schema: { params: itemParams, body: objectSchema({ toCharacterId: uuid, count: { type: 'integer', minimum: 1, maximum: 1000000 } }, ['toCharacterId']) } },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const { toCharacterId, count } = request.body;
      const result = await db.transaction(async q => {
        const { tree, row, item, manager } = await itemAccess(q, campaignId, characterId, userId);
        const target = tree.get(toCharacterId);
        if (!target || target.kind === 'object') reject(404, 'Получатель не найден: передать можно существу.');
        if (target.id === row.container_id) reject(400, 'Предмет уже у него.');
        const from = row.container_id as string | null;
        const amount = count ?? item.quantity;
        if (amount > item.quantity) reject(400, `Есть только ${item.quantity}.`);
        const isMagic = Boolean((await q.query('SELECT 1 FROM magic_items WHERE campaign_id=$1 AND character_id=$2', [campaignId, item.id])).rows[0]);
        if (isMagic && amount < item.quantity) reject(400, 'Магический предмет не делится — передайте его целиком.');
        const armorInFight = manager ? null : await wornArmorInCombat(q, campaignId, [item.id]);
        if (armorInFight) reject(400, `«${armorInFight}» надет: доспех в бою не снять — на это уходят минуты.`);
        const movingId = amount < item.quantity ? await splitOff(q, campaignId, row, amount) : item.id;
        const owner = target.owner_user_id ?? row.owner_user_id;
        await q.query('UPDATE characters SET equipped_slot=NULL, container_id=$3, owner_user_id=$4, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, movingId, target.id, owner]);
        const touched = new Set<string>([target.id, ...(from ? [from] : [])]);
        for (const id of await syncItem(q, campaignId, movingId)) touched.add(id);
        await itemLeftHolder(q, campaignId, movingId, from);
        const moved = (await q.query(`SELECT ${ITEM_COLUMNS} FROM characters c WHERE c.campaign_id=$1 AND c.id=$2`, [campaignId, movingId])).rows[0] as ItemRow;
        const hasContents = Boolean((await q.query('SELECT 1 FROM characters WHERE campaign_id=$1 AND container_id=$2 LIMIT 1', [campaignId, movingId])).rows[0]);
        if (!isMagic && !hasContents && moved.infinite !== true && !moved.item_note && stackable(asItem(moved))) {
          const stack = (await plainStacks(q, campaignId, target.id, movingId)).find(other => sameStack(other, stackKey(moved)));
          if (stack && Number(stack.quantity) + amount <= STACK_LIMIT) {
            await q.query('UPDATE characters SET quantity=quantity+$3, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, stack.id, amount]);
            await purgeObject(q, campaignId, movingId);
          }
        }
        return { touched: [...touched], name: item.name, amount };
      });
      for (const id of result.touched) void notifyCampaign(campaignId, { type: 'character', characterId: id });
      void notifyCampaign(campaignId, { type: 'changed' });
      return { name: result.name, amount: result.amount };
    },
  );

  app.put<{ Params: { campaignId: string; characterId: string }; Body: { doll: unknown } }>(
    '/campaigns/:campaignId/characters/:characterId/doll',
    { schema: { params: itemParams, body: objectSchema({ doll: { type: 'object' } }) } },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const doll = await db.transaction(async q => {
        const { rights, tree, manager } = await access(q, campaignId, userId, true);
        const holder = tree.get(characterId);
        if (!holder) reject(404, 'Существо не найдено.');
        if (!controls(rights, userId, holder) && !manager) reject(403, 'Куклу настраивает тот, чей это герой, или мастер.');
        const clean = normalizeDoll(request.body.doll, holder.kind);
        await q.query('UPDATE characters SET doll=$3::jsonb, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, characterId, JSON.stringify(clean)]);
        return clean;
      });
      void notifyCampaign(campaignId, { type: 'character', characterId });
      return { doll };
    },
  );

  app.put<{ Params: { campaignId: string; characterId: string }; Body: { mode: 'manual' | 'gear' } }>(
    '/campaigns/:campaignId/characters/:characterId/ac-mode',
    { schema: { params: itemParams, body: objectSchema({ mode: { type: 'string', enum: ['manual', 'gear'] } }) } },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const result = await db.transaction(async q => {
        const { rights, tree, manager } = await access(q, campaignId, userId, true);
        const holder = tree.get(characterId);
        if (!holder || holder.kind === 'object') reject(404, 'Существо не найдено.');
        if (!controls(rights, userId, holder) && !manager) reject(403, 'Как считать КД, решает тот, чей это герой, или мастер.');
        await q.query('UPDATE characters SET ac_mode=$3, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, characterId, request.body.mode]);
        const armorClass = await refreshGearAc(q, campaignId, characterId);
        return { mode: request.body.mode, armorClass };
      });
      void notifyCampaign(campaignId, { type: 'character', characterId });
      void notifyCampaign(campaignId, { type: 'changed' });
      return result;
    },
  );
}
