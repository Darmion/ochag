import type { Queryable } from '../db.ts';
import { catalogEntry, stackable, unitPrice, unitWeight } from '../../../../packages/domain/character/inventory.ts';
import { gearAcValue } from './inventory-state.ts';
import { createFromSnapshot, type ObjectSnapshot } from '../tabletop/scene/object-copies.ts';
import { objectSchema, reject, uuid, type SceneFeatureContext } from '../tabletop/scene-feature.ts';
import { abilityFromDice, buildCharacter, HERO_ABILITIES, type BuildInput } from '../../../../packages/domain/character/character-builder.ts';
import { srdSpellList } from '../rules/srd-spells.ts';
import {
  ARMOR, DRAGON_ANCESTRIES, EXPLORER_PACK, FIGHTING_STYLES, POINT_BUY_BUDGET, POINT_BUY_COST, SRD_BACKGROUNDS, SRD_CLASSES, STANDARD_ARRAY,
} from '../../../../packages/domain/srd/heroes.ts';
import { CLASS_LABELS } from '../../../../packages/domain/character/classes.ts';
import { heroRaces } from '../../../../packages/domain/character/races.ts';
import { SRD_GEAR_BY_INDEX } from '../../../../packages/domain/srd/gear.ts';
import { findSrdWeapon } from '../../../../packages/domain/srd/weapons.ts';

export type HeroContext = SceneFeatureContext & {
  rollDie: (sides: number) => number;
  insertRoll: (
    q: Queryable, campaignId: string, userId: string, characterId: string | null, label: string | null, formula: string,
    results: number[], modifier: number, total: number, hidden: boolean, breakdown?: unknown[] | null, outcome?: Record<string, unknown> | null,
  ) => Promise<any>;
};

const ROLL_LABEL = 'Характеристики: 4к6 без меньшей ×6';

const gearName = (index: string) => SRD_GEAR_BY_INDEX.get(index)?.nameRu ?? index;

// The kit goes into the bag as stacks; weapons become items tied to their attacks; armour, shield, the first weapon and the ammo are worn.
async function packHeroKit(q: Queryable, campaignId: string, heroId: string, ownerId: string, kit: string[], weaponOrder: string[], builtAc: number) {
  const insert = async (entry: NonNullable<ReturnType<typeof catalogEntry>>, quantity: number) => (await q.query(
    `INSERT INTO characters (campaign_id, owner_user_id, name, kind, size, container_id, price_cp, weight_lb, quantity, item_category, item_srd)
     VALUES ($1,$2,$3,'object','tiny',$4,$5,$6,$7,$8,$9) RETURNING id`,
    [campaignId, ownerId, entry.nameRu, heroId, unitPrice(entry) === null ? null : Math.round(unitPrice(entry)!), unitWeight(entry), quantity, entry.category, entry.ref],
  )).rows[0].id as string;
  const counts = new Map<string, number>();
  for (const index of kit) counts.set(index, (counts.get(index) ?? 0) + 1);
  const made: Array<{ id: string; ref: string; category: string }> = [];
  for (const [index, count] of counts) {
    const entry = catalogEntry(`gear:${index}`);
    if (!entry) continue;
    if (entry.pack > 1 || stackable({ name: entry.nameRu, srd: entry.ref, category: entry.category })) made.push({ id: await insert(entry, entry.pack * count), ref: entry.ref, category: entry.category });
    else for (let copy = 0; copy < count; copy += 1) made.push({ id: await insert(entry, 1), ref: entry.ref, category: entry.category });
  }
  const rows = (await q.query('SELECT id, srd_index FROM character_weapons WHERE campaign_id=$1 AND character_id=$2 AND srd_index IS NOT NULL', [campaignId, heroId])).rows;
  const attacks = weaponOrder.flatMap(index => {
    const at = rows.findIndex(row => row.srd_index === index);
    return at < 0 ? [] : rows.splice(at, 1);
  });
  const weapons: Array<{ id: string; hands: number }> = [];
  for (const attack of attacks) {
    const entry = catalogEntry(`weapon:${attack.srd_index}`);
    if (!entry) continue;
    const itemId = await insert(entry, 1);
    await q.query('UPDATE character_weapons SET source_item_id=$2, source_auto=true WHERE id=$1', [attack.id, itemId]);
    weapons.push({ id: itemId, hands: entry.weapon?.properties.includes('two-handed') ? 2 : 1 });
  }
  const wear = async (itemId: string, slot: string) => q.query('UPDATE characters SET equipped_slot=$3 WHERE campaign_id=$1 AND id=$2', [campaignId, itemId, slot]);
  const armor = made.find(item => item.category === 'armor');
  const shield = made.find(item => item.category === 'shield');
  const ammo = made.find(item => item.category === 'ammo');
  if (armor) await wear(armor.id, 'body');
  const main = weapons[0];
  if (main) await wear(main.id, 'main_hand');
  if (shield && (!main || main.hands === 1)) await wear(shield.id, 'off_hand');
  if (ammo) await wear(ammo.id, 'ammo');
  const holder = (await q.query('SELECT id, kind, ac_mode, armor_class, dexterity, constitution, wisdom, class_name, sheet_extra, level FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, heroId])).rows[0];
  if (holder && await gearAcValue(q, campaignId, holder) === builtAc) await q.query(`UPDATE characters SET ac_mode='gear' WHERE campaign_id=$1 AND id=$2`, [campaignId, heroId]);
}

function weaponView(weapon: { name: string; ability: string; proficient: boolean; damage_formula: string | null; attack_bonus: number }, mods: Record<string, number> | undefined) {
  if (!mods) return { name: weapon.name, toHit: null, damage: weapon.damage_formula };
  const mod = weapon.ability === 'finesse' ? Math.max(mods.strength ?? 0, mods.dexterity ?? 0) : mods[weapon.ability] ?? 0;
  const toHit = mod + (weapon.proficient ? 2 : 0) + weapon.attack_bonus;
  const match = /^(\d+d\d+)\+@mod((?:[+-]\d+)*)$/.exec(weapon.damage_formula ?? '');
  let damage = weapon.damage_formula;
  if (match) {
    const extra = (match[2]!.match(/[+-]\d+/g) ?? []).reduce((sum, part) => sum + Number(part), 0);
    const total = mod + extra;
    damage = `${match[1]}${total > 0 ? `+${total}` : total < 0 ? `−${-total}` : ''}`;
  }
  return { name: weapon.name, toHit, damage };
}
const stringList = { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 64 } };

export function registerHeroRoutes(ctx: HeroContext) {
  const { app, db, auth, membership, notifyCampaign, rollDie, insertRoll } = ctx;
  const campaignParams = objectSchema({ campaignId: uuid });

  app.get('/srd/heroes', async request => {
    await auth(request);
    return {
      races: heroRaces(),
      classes: SRD_CLASSES.map(entry => ({
        ...entry,
        nameRu: CLASS_LABELS[entry.id],
        resources: entry.resources.map(resource => ({ name: resource.name, recharge: resource.recharge })),
        kits: entry.kits.map(kit => ({
          ...kit,
          weaponNames: kit.weapons.map(index => findSrdWeapon(index)?.nameRu ?? index),
          armorName: kit.armor ? gearName(kit.armor) : null,
          gearNames: kit.gear.map(gearName),
        })),
      })),
      backgrounds: SRD_BACKGROUNDS.map(entry => ({ ...entry, gearNames: entry.gear.map(gearName) })),
      fightingStyles: FIGHTING_STYLES,
      ancestries: DRAGON_ANCESTRIES,
      standardArray: STANDARD_ARRAY,
      pointBuy: { cost: POINT_BUY_COST, budget: POINT_BUY_BUDGET },
      explorerPack: EXPLORER_PACK.map(gearName),
      armor: ARMOR,
    };
  });

  app.post<{ Params: { campaignId: string } }>(
    '/campaigns/:campaignId/characters/ability-roll',
    { schema: { params: campaignParams } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const result = await db.transaction(async q => {
        await membership(q, campaignId, userId, true);
        const dice = Array.from({ length: 24 }, () => rollDie(6));
        const sets = Array.from({ length: 6 }, (_, index) => dice.slice(index * 4, index * 4 + 4));
        const values = sets.map(abilityFromDice);
        const roll = await insertRoll(
          q, campaignId, userId, null, ROLL_LABEL, '6x4d6', dice, 0, values.reduce((sum, value) => sum + value, 0), false, null,
          { kind: 'abilities', values },
        );
        return { rollId: roll.id as string, sets: sets.map((set, index) => ({ dice: set, value: values[index] })), values };
      });
      void notifyCampaign(campaignId, { type: 'rolls' });
      return reply.code(201).send(result);
    },
  );

  app.post<{ Params: { campaignId: string }; Body: BuildInput & { rollId?: string; dryRun?: boolean } }>(
    '/campaigns/:campaignId/characters/build',
    {
      schema: {
        params: campaignParams,
        body: objectSchema({
          name: { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' },
          race: { type: 'string', maxLength: 32 },
          subrace: { oneOf: [{ type: 'string', maxLength: 32 }, { type: 'null' }] },
          raceName: { oneOf: [{ type: 'string', maxLength: 40 }, { type: 'null' }] },
          ancestry: { oneOf: [{ type: 'string', maxLength: 32 }, { type: 'null' }] },
          flexible: stringList,
          className: { type: 'string', maxLength: 32 },
          method: { type: 'string', enum: ['free', 'standard', 'pointbuy', 'roll'] },
          abilities: objectSchema(Object.fromEntries(HERO_ABILITIES.map(ability => [ability, { type: 'integer', minimum: 1, maximum: 20 }]))),
          rollId: uuid,
          background: { type: 'string', maxLength: 32 },
          classSkills: stringList,
          backgroundSkills: stringList,
          raceSkills: stringList,
          expertise: stringList,
          fightingStyle: { oneOf: [{ type: 'string', maxLength: 32 }, { type: 'null' }] },
          kit: { type: 'string', maxLength: 32 },
          cantrips: stringList,
          spells: stringList,
          raceCantrip: { oneOf: [{ type: 'string', maxLength: 64 }, { type: 'null' }] },
          dryRun: { type: 'boolean' },
        }, ['name', 'race', 'className', 'method', 'abilities', 'background', 'classSkills', 'kit']),
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const input = request.body;

      const created = await db.transaction(async q => {
        await membership(q, campaignId, userId, true);

        let rolled: number[] | undefined;
        if (input.method === 'roll') {
          if (!input.rollId) reject(400, 'Сначала бросьте кости характеристик.');
          const roll = (
            await q.query('SELECT dice_results FROM roll_log WHERE campaign_id=$1 AND id=$2 AND user_id=$3 AND label=$4', [campaignId, input.rollId, userId, ROLL_LABEL])
          ).rows[0];
          if (!roll) reject(400, 'Это не ваш бросок характеристик.');
          const used = (await q.query(`SELECT 1 FROM characters WHERE campaign_id=$1 AND sheet_extra->'builder'->>'abilityRollId' = $2`, [campaignId, input.rollId])).rows[0];
          if (used) reject(400, 'По этому броску персонаж уже создан — бросьте заново.');
          const dice = roll.dice_results as number[];
          rolled = Array.from({ length: 6 }, (_, index) => abilityFromDice(dice.slice(index * 4, index * 4 + 4)));
        }

        const built = buildCharacter({ ...input, rolled }, srdSpellList());
        if (input.dryRun) {
          return {
            preview: {
              problems: built.problems,
              summary: built.summary ?? null,
              skills: built.sheet?.skills ?? [],
              weapons: (built.sheet?.weapons ?? []).map(weapon => weaponView(weapon, built.summary?.mods)),
              resources: built.sheet?.resources ?? [],
              spells: (built.sheet?.spells ?? []).map(spell => spell.srd_index),
              items: (built.items ?? []).map(gearName),
            },
          };
        }
        if (built.problems.length || !built.sheet) reject(400, built.problems.slice(0, 5).join(' '));
        const sheet = built.sheet;
        const character = { ...sheet.character, owner_user_id: userId } as Record<string, unknown>;
        if (input.method === 'roll') {
          const extra = character.sheet_extra as Record<string, any>;
          extra.builder = { ...extra.builder, abilityRollId: input.rollId };
        }
        const snapshot: ObjectSnapshot = {
          version: 1,
          character: character as ObjectSnapshot['character'],
          effects: [],
          resources: sheet.resources,
          skills: sheet.skills,
          saves: sheet.saves,
          spells: sheet.spells,
          spellSlots: sheet.spellSlots,
          weapons: sheet.weapons,
          visibility: [],
          access: [],
          state: null,
        };
        const id = await createFromSnapshot(q, campaignId, snapshot, String(character.name), userId);
        const weaponOrder = (sheet.weapons ?? []).map((weapon: any) => weapon.srd_index).filter((index: unknown): index is string => typeof index === 'string');
        await packHeroKit(q, campaignId, id, userId, built.items ?? [], weaponOrder, Number(character.armor_class));
        return { id, name: String(character.name), summary: built.summary };
      });

      if ('preview' in created) return reply.code(200).send(created.preview);
      void notifyCampaign(campaignId, { type: 'characters' });
      void notifyCampaign(campaignId, { type: 'changed' });
      return reply.code(201).send({ character: { id: created.id, name: created.name }, summary: created.summary });
    },
  );
}
