import type { Queryable } from '../db.ts';
import { findSrdSpell, srdSpellName } from '../rules/srd-data.ts';
import { reject } from '../characters/sheet/shared.ts';
import { purgeObject } from '../tabletop/scene/objects/remove.ts';
import { findSrdMagicItem, type ItemSpell } from '../../../../packages/domain/character/magic-items.ts';
import { itemSpellId, itemSpellLevels, parseItemSpellId, type ItemSpellLevel } from '../../../../packages/domain/character/item-spells.ts';

export type ItemSpellEntry = {
  id: string; itemId: string; itemName: string; spell: string; level: number; levels: ItemSpellLevel[];
  charges: { current: number; max: number } | null; dc: number | null; attack: number | null; scroll: boolean;
};

type ItemRow = {
  id: string; name: string; srd_index: string | null; spell_index: string | null; applied: { characterId?: string } | null;
  charges_current: number | null; charges_max: number | null; destroy_on_empty: boolean;
};

// The spells a creature can cast from what it carries: worn or held items that work for it, and scrolls it has.
export async function loadItemSpells(q: Queryable, campaignId: string, characterId: string): Promise<ItemSpellEntry[]> {
  const rows = (await q.query(
    `SELECT c.id, c.name, m.srd_index, m.spell_index, m.applied, m.charges_current, m.charges_max, m.destroy_on_empty
     FROM characters c JOIN magic_items m ON m.campaign_id = c.campaign_id AND m.character_id = c.id
     WHERE c.campaign_id=$1 AND c.container_id=$2 AND NOT m.destroyed ORDER BY c.name, c.id`,
    [campaignId, characterId],
  )).rows as ItemRow[];
  return rows.flatMap(row => entriesOf(row, characterId));
}

function entriesOf(row: ItemRow, characterId: string): ItemSpellEntry[] {
  const item = findSrdMagicItem(row.srd_index);
  const charges = row.charges_max === null ? null : { current: Number(row.charges_current ?? 0), max: Number(row.charges_max) };
  if (item?.use?.kind === 'scroll') {
    const spell = row.spell_index ? findSrdSpell(row.spell_index) : null;
    if (!spell) return [];
    return [{
      id: itemSpellId(row.id, spell.index), itemId: row.id, itemName: row.name, spell: spell.index, level: spell.level,
      levels: [{ level: Math.max(spell.level, item.use.level), cost: 0 }], charges: null, dc: item.use.dc, attack: item.use.attack, scroll: true,
    }];
  }
  if (!item?.castable?.length || row.applied?.characterId !== characterId) return [];
  return item.castable.flatMap((cast: ItemSpell) => {
    const spell = findSrdSpell(cast.spell);
    if (!spell) return [];
    return [{
      id: itemSpellId(row.id, cast.spell), itemId: row.id, itemName: row.name, spell: cast.spell, level: spell.level,
      levels: itemSpellLevels(cast, spell.level, charges ? charges.current : null), charges, dc: cast.dc ?? null, attack: cast.attack ?? null, scroll: false,
    }];
  });
}

export type ItemCastPlan = {
  itemId: string; itemName: string; spell: string; level: number; cost: number; dc: number | null; attack: number | null;
  scroll: boolean; destroyOnEmpty: boolean; charges: { current: number; max: number } | null;
};

// What casting this spell from the item takes; the chosen level must be one the charges pay for.
export async function itemCastPlan(q: Queryable, campaignId: string, characterId: string, spellId: string, chosenLevel: number | undefined): Promise<ItemCastPlan | null> {
  const parsed = parseItemSpellId(spellId);
  if (!parsed) return null;
  const row = (await q.query(
    `SELECT c.id, c.name, m.srd_index, m.spell_index, m.applied, m.charges_current, m.charges_max, m.destroy_on_empty
     FROM characters c JOIN magic_items m ON m.campaign_id = c.campaign_id AND m.character_id = c.id
     WHERE c.campaign_id=$1 AND c.id=$2 AND c.container_id=$3 AND NOT m.destroyed FOR UPDATE OF m`,
    [campaignId, parsed.itemId, characterId],
  )).rows[0] as ItemRow | undefined;
  if (!row) reject(404, 'Предмета с этим заклинанием у персонажа нет.');
  const entry = entriesOf(row!, characterId).find(candidate => candidate.spell === parsed.spell);
  if (!entry) {
    const item = findSrdMagicItem(row!.srd_index);
    reject(400, item?.castable?.some(cast => cast.spell === parsed.spell)
      ? `«${row!.name}» сейчас не действует: его нужно надеть или взять в руку${item.attunement ? ' и настроиться' : ''}.`
      : `«${row!.name}» не сотворяет «${srdSpellName(parsed.spell)}».`);
  }
  if (!entry!.levels.length) reject(400, `В «${row!.name}» не хватает зарядов на «${srdSpellName(parsed.spell)}».`);
  const choice = chosenLevel === undefined ? entry!.levels[0]! : entry!.levels.find(option => option.level === chosenLevel);
  if (!choice) {
    reject(400, `«${srdSpellName(parsed.spell)}» из «${row!.name}» — на уровне ${entry!.levels.map(option => `${option.level} (${option.cost} зар.)`).join(', ')}.`);
  }
  return {
    itemId: row!.id, itemName: row!.name, spell: parsed.spell, level: choice!.level, cost: choice!.cost, dc: entry!.dc, attack: entry!.attack,
    scroll: entry!.scroll, destroyOnEmpty: row!.destroy_on_empty === true, charges: entry!.charges,
  };
}

// The cast has gone through: take the charges (the last one may destroy the item) or use the scroll up.
export async function spendItemCast(q: Queryable, campaignId: string, plan: ItemCastPlan, rollDie: (sides: number) => number) {
  if (plan.scroll) {
    await purgeObject(q, campaignId, plan.itemId);
    return { item: plan.itemName, left: null as number | null, used: true, destroyed: false, die: null as number | null };
  }
  if (!plan.cost || !plan.charges) return { item: plan.itemName, left: plan.charges?.current ?? null, used: false, destroyed: false, die: null };
  const left = plan.charges.current - plan.cost;
  const die = left === 0 && plan.destroyOnEmpty ? rollDie(20) : null;
  await q.query(
    'UPDATE magic_items SET charges_current=$3, destroyed=destroyed OR $4 WHERE campaign_id=$1 AND character_id=$2',
    [campaignId, plan.itemId, left, die === 1],
  );
  return { item: plan.itemName, left, used: false, destroyed: die === 1, die };
}
