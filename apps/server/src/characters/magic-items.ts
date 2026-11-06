import type { Queryable } from '../db.ts';
import { insertChatMessage } from '../campaign/chat-routes.ts';
import { objectSchema, reject, uuid, type SceneFeatureContext } from '../tabletop/scene-feature.ts';
import { parseFormula, rollDice } from '../../../../packages/domain/dice/dice.ts';
import { magicItemPriceCp,
  ABILITIES, ATTUNEMENT_LIMIT, DAMAGE_TYPES, RARITIES, RARITY_LABELS, RECHARGE_LABELS, SRD_MAGIC_ITEMS,
  applyBonuses, bonusProblems, bonusText, dawnCount, itemActive, revertBonuses,
  type AppliedBonuses, type MagicBonuses, type Recharge, type SheetNumbers,
} from '../../../../packages/domain/character/magic-items.ts';

const ABILITY_COLUMNS = ABILITIES.join(', ');

async function loadSheet(q: Queryable, campaignId: string, characterId: string) {
  const row = (
    await q.query(
      `SELECT armor_class, speed_feet::float8 AS speed_feet, ${ABILITY_COLUMNS}, damage_resistances, hp_max, hp_current, level
       FROM characters WHERE campaign_id=$1 AND id=$2 FOR UPDATE`,
      [campaignId, characterId],
    )
  ).rows[0] as any;
  if (!row) return null;
  return {
    armorClass: Number(row.armor_class), speed: Number(row.speed_feet ?? 0),
    abilities: Object.fromEntries(ABILITIES.map(ability => [ability, Number(row[ability])])) as SheetNumbers['abilities'],
    resistances: Array.isArray(row.damage_resistances) ? row.damage_resistances.map(String) : [],
    hpMax: Number(row.hp_max), hpCurrent: Number(row.hp_current), level: row.level ?? null,
  } satisfies SheetNumbers;
}

async function saveSheet(q: Queryable, campaignId: string, characterId: string, sheet: SheetNumbers) {
  await q.query(
    `UPDATE characters SET armor_class=$3, speed_feet=$4, strength=$5, dexterity=$6, constitution=$7, intelligence=$8, wisdom=$9, charisma=$10,
       damage_resistances=$11::jsonb, hp_max=$12, hp_current=$13, revision=revision+1
     WHERE campaign_id=$1 AND id=$2`,
    [
      campaignId, characterId, sheet.armorClass, sheet.speed, ...ABILITIES.map(ability => sheet.abilities[ability]),
      JSON.stringify(sheet.resistances), sheet.hpMax, sheet.hpCurrent,
    ],
  );
}

async function shiftSaves(q: Queryable, campaignId: string, characterId: string, delta: number) {
  if (!delta) return;
  for (const ability of ABILITIES) {
    await q.query(
      `INSERT INTO character_saves (campaign_id, character_id, ability, proficient, custom_bonus) VALUES ($1,$2,$3,false,$4)
       ON CONFLICT (campaign_id, character_id, ability) DO UPDATE SET custom_bonus = character_saves.custom_bonus + $4`,
      [campaignId, characterId, ability, delta],
    );
  }
}

async function revertApplied(q: Queryable, campaignId: string, applied: AppliedBonuses | null) {
  if (!applied?.characterId) return;
  const sheet = await loadSheet(q, campaignId, applied.characterId);
  if (!sheet) return;
  await saveSheet(q, campaignId, applied.characterId, revertBonuses(sheet, applied));
  await shiftSaves(q, campaignId, applied.characterId, -(applied.saves ?? 0));
}

export async function syncItem(q: Queryable, campaignId: string, itemId: string): Promise<string[]> {
  const item = (
    await q.query(
      `SELECT m.*, c.container_id, h.kind AS holder_kind
       FROM magic_items m
       JOIN characters c ON c.campaign_id = m.campaign_id AND c.id = m.character_id
       LEFT JOIN characters h ON h.campaign_id = c.campaign_id AND h.id = c.container_id
       WHERE m.campaign_id=$1 AND m.character_id=$2 FOR UPDATE OF m`,
      [campaignId, itemId],
    )
  ).rows[0] as any;
  if (!item) return [];
  const holderId: string | null = item.container_id ?? null;
  const holderIsCreature = item.holder_kind === 'character' || item.holder_kind === 'npc';
  const previous = item.applied as AppliedBonuses | null;
  const touched = new Set<string>();

  let equipped = item.equipped === true;
  let attunedTo: string | null = item.attuned_to ?? null;
  if (!holderIsCreature || (previous?.characterId && previous.characterId !== holderId)) equipped = false;
  if (attunedTo && attunedTo !== holderId) attunedTo = null;

  if (previous?.characterId) {
    await revertApplied(q, campaignId, previous);
    touched.add(previous.characterId);
  }
  let applied: AppliedBonuses | null = null;
  const active = itemActive({
    destroyed: item.destroyed === true, equipped, requiresAttunement: item.requires_attunement === true, attunedTo, holderId, holderIsCreature,
  });
  if (active && holderId) {
    const sheet = await loadSheet(q, campaignId, holderId);
    if (sheet) {
      const result = applyBonuses(sheet, (item.bonuses ?? {}) as MagicBonuses, holderId);
      applied = result.applied;
      await saveSheet(q, campaignId, holderId, result.sheet);
      await shiftSaves(q, campaignId, holderId, applied.saves);
      touched.add(holderId);
    }
  }
  await q.query(
    'UPDATE magic_items SET equipped=$3, attuned_to=$4, applied=$5::jsonb WHERE campaign_id=$1 AND character_id=$2',
    [campaignId, itemId, equipped, attunedTo, applied ? JSON.stringify(applied) : null],
  );
  return [...touched];
}

export async function releaseMagic(q: Queryable, campaignId: string, characterId: string) {
  const own = (await q.query('SELECT applied FROM magic_items WHERE campaign_id=$1 AND character_id=$2 FOR UPDATE', [campaignId, characterId])).rows[0];
  if (own) {
    await revertApplied(q, campaignId, own.applied);
    await q.query('DELETE FROM magic_items WHERE campaign_id=$1 AND character_id=$2', [campaignId, characterId]);
  }
  await q.query(
    `UPDATE magic_items SET applied=NULL, equipped=false, attuned_to=NULL
     WHERE campaign_id=$1 AND (attuned_to=$2 OR applied->>'characterId' = $2::text)`,
    [campaignId, characterId],
  );
}

function rechargeAmount(formula: string | null, rollDie: (sides: number) => number, missing: number) {
  const parsed = formula ? parseFormula(formula) : null;
  if (!parsed) return { gained: missing, dice: [] as number[] };
  const rolled = rollDice(parsed, rollDie);
  return { gained: Math.max(0, Math.min(missing, rolled.total)), dice: rolled.results, total: rolled.total };
}

export async function rechargeOnRest(q: Queryable, campaignId: string, characterId: string, kinds: string[], rollDie: (sides: number) => number) {
  const rows = (
    await q.query(
      `SELECT m.character_id, c.name, m.charges_current, m.charges_max, m.recharge_formula
       FROM magic_items m JOIN characters c ON c.campaign_id = m.campaign_id AND c.id = m.character_id
       WHERE m.campaign_id=$1 AND c.container_id=$2 AND m.recharge = ANY($3::text[]) AND NOT m.destroyed
         AND m.charges_max IS NOT NULL AND m.charges_current < m.charges_max
       FOR UPDATE OF m`,
      [campaignId, characterId, kinds],
    )
  ).rows as any[];
  const names: string[] = [];
  for (const row of rows) {
    const { gained } = rechargeAmount(row.recharge_formula, rollDie, row.charges_max - row.charges_current);
    if (!gained) continue;
    await q.query('UPDATE magic_items SET charges_current=charges_current+$3 WHERE campaign_id=$1 AND character_id=$2', [campaignId, row.character_id, gained]);
    names.push(`${row.name}: заряды ${row.charges_current + gained}/${row.charges_max}`);
  }
  return names;
}

type MagicRow = {
  character_id: string; rarity: string; description: string; requires_attunement: boolean; attuned_to: string | null;
  equipped: boolean; charges_max: number | null; charges_current: number | null; recharge: Recharge | null;
  recharge_formula: string | null; destroy_on_empty: boolean; destroyed: boolean; recharged_dawn: number;
  bonuses: MagicBonuses; applied: AppliedBonuses | null; srd_index: string | null;
};

export function magicView(row: MagicRow, holderId: string | null) {
  return {
    rarity: row.rarity,
    rarityLabel: RARITY_LABELS[row.rarity as keyof typeof RARITY_LABELS] ?? row.rarity,
    description: row.description,
    requiresAttunement: row.requires_attunement,
    attuned: Boolean(holderId && row.attuned_to === holderId),
    equipped: row.equipped,
    active: Boolean(row.applied && row.applied.characterId === holderId),
    charges: row.charges_max === null ? null : {
      current: row.charges_current ?? 0, max: row.charges_max, recharge: row.recharge,
      rechargeLabel: row.recharge ? RECHARGE_LABELS[row.recharge] : null, formula: row.recharge_formula, destroyOnEmpty: row.destroy_on_empty,
    },
    destroyed: row.destroyed,
    bonuses: row.bonuses ?? {},
    bonusText: bonusText(row.bonuses ?? {}),
    srdIndex: row.srd_index,
  };
}

export type MagicItemsContext = SceneFeatureContext & {
  rollDie: (sides: number) => number;
  insertRoll: (
    q: Queryable, campaignId: string, userId: string, characterId: string | null, label: string | null, formula: string,
    results: number[], modifier: number, total: number, hidden: boolean, breakdown?: unknown[] | null, outcome?: Record<string, unknown> | null,
  ) => Promise<any>;
  canManageCharacter: (q: Queryable, member: any, userId: string, ownerUserId: string | null, characterId?: string | null) => Promise<boolean>;
  isCharacterManager: (q: Queryable, member: any, userId: string) => Promise<boolean>;
};

const bonusesSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    armorClass: { type: 'integer', minimum: -5, maximum: 10 },
    saves: { type: 'integer', minimum: -5, maximum: 10 },
    abilities: {
      type: 'object', additionalProperties: false,
      properties: Object.fromEntries(ABILITIES.map(ability => [ability, { type: 'integer', minimum: 1, maximum: 30 }])),
    },
    speed: { type: 'integer', minimum: -30, maximum: 120 },
    resistances: { type: 'array', maxItems: 13, uniqueItems: true, items: { type: 'string', enum: [...DAMAGE_TYPES] } },
  },
};

type MagicBody = {
  rarity?: string; description?: string; requiresAttunement?: boolean; chargesMax?: number | null; chargesCurrent?: number | null;
  recharge?: Recharge | null; rechargeFormula?: string | null; destroyOnEmpty?: boolean; destroyed?: boolean; bonuses?: MagicBonuses;
};

export function registerMagicItemRoutes(ctx: MagicItemsContext) {
  const { app, db, auth, membership, canManage, notifyCampaign, rollDie, insertRoll, canManageCharacter, isCharacterManager } = ctx;
  const characterParams = objectSchema({ campaignId: uuid, characterId: uuid });

  async function isGm(q: Queryable, member: any, userId: string) {
    return (await isCharacterManager(q, member, userId)) || (await canManage(q, member, userId));
  }

  async function loadItem(q: Queryable, campaignId: string, itemId: string) {
    const row = (
      await q.query(
        `SELECT c.id, c.name, c.kind, c.container_id, c.owner_user_id,
                h.id AS holder_id, h.name AS holder_name, h.kind AS holder_kind, h.owner_user_id AS holder_owner
         FROM characters c LEFT JOIN characters h ON h.campaign_id = c.campaign_id AND h.id = c.container_id
         WHERE c.campaign_id=$1 AND c.id=$2`,
        [campaignId, itemId],
      )
    ).rows[0] as any;
    if (!row) reject(404, 'Предмет не найден.');
    if (row.kind !== 'object') reject(400, 'Магическим бывает только предмет (объект), не существо.');
    const magic = (await q.query('SELECT * FROM magic_items WHERE campaign_id=$1 AND character_id=$2 FOR UPDATE', [campaignId, itemId])).rows[0] as MagicRow | undefined;
    return { row, magic };
  }

  async function requireHolder(q: Queryable, member: any, userId: string, row: any) {
    if (!row.holder_id || (row.holder_kind !== 'character' && row.holder_kind !== 'npc')) reject(400, `«${row.name}» ни у кого не лежит — его нужно взять.`);
    if (!(await canManageCharacter(q, member, userId, row.holder_owner)) && !(await isGm(q, member, userId))) {
      reject(403, 'Распоряжается предметом тот, у чьего персонажа он лежит, или мастер.');
    }
  }

  async function dawnRecharge(q: Queryable, campaignId: string, userId: string, magic: MagicRow, name: string, holderId: string | null) {
    if (magic.recharge !== 'dawn' || magic.destroyed || magic.charges_max === null) return null;
    const minutes = Number((await q.query('SELECT world_minutes FROM campaigns WHERE id=$1', [campaignId])).rows[0]?.world_minutes ?? 0);
    const dawns = dawnCount(minutes);
    if (dawns <= magic.recharged_dawn) return null;
    let current = magic.charges_current ?? 0;
    let gainedTotal = 0;
    for (let i = 0; i < Math.min(10, dawns - magic.recharged_dawn) && current < magic.charges_max; i++) {
      const { gained, dice, total } = rechargeAmount(magic.recharge_formula, rollDie, magic.charges_max - current);
      current += gained;
      gainedTotal += gained;
      if (dice.length) {
        await insertRoll(
          q, campaignId, userId, holderId, `На рассвете: ${name}`.slice(0, 100), magic.recharge_formula!.slice(0, 20), dice,
          parseFormula(magic.recharge_formula!)!.modifier, total ?? gained, false, null, { kind: 'recharge', current, max: magic.charges_max },
        );
      }
    }
    await q.query('UPDATE magic_items SET charges_current=$3, recharged_dawn=$4 WHERE campaign_id=$1 AND character_id=$2', [campaignId, magic.character_id, current, dawns]);
    magic.charges_current = current;
    magic.recharged_dawn = dawns;
    return gainedTotal ? { name, gained: gainedTotal, current, max: magic.charges_max } : null;
  }

  app.get('/srd/magic-items', async request => {
    await auth(request);
    return { items: SRD_MAGIC_ITEMS, attribution: 'System Reference Document 5.1, Wizards of the Coast, CC-BY-4.0' };
  });

  app.get<{ Params: { campaignId: string; characterId: string } }>(
    '/campaigns/:campaignId/characters/:characterId/items',
    { schema: { params: characterParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const holder = (await q.query('SELECT id, name, kind, owner_user_id FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0] as any;
        if (!holder) reject(404, 'Существо не найдено.');
        if (!(await canManageCharacter(q, member, userId, holder.owner_user_id))) reject(403, 'Вещи видит тот, чей это персонаж, или мастер.');
        const rows = (
          await q.query(
            `SELECT c.id, c.name, c.image_asset_id, c.price_cp, c.weight_lb::float8 AS weight_lb,
                    (SELECT count(*)::int FROM characters inner_c WHERE inner_c.campaign_id = c.campaign_id AND inner_c.container_id = c.id) AS contents_count
             FROM characters c WHERE c.campaign_id=$1 AND c.container_id=$2 ORDER BY c.name, c.id`,
            [campaignId, characterId],
          )
        ).rows as any[];
        const magicRows = (
          await q.query('SELECT * FROM magic_items WHERE campaign_id=$1 AND character_id = ANY($2::uuid[]) FOR UPDATE', [campaignId, rows.map(row => row.id)])
        ).rows as MagicRow[];
        const byId = new Map(magicRows.map(row => [row.character_id, row]));
        const recharged = [];
        for (const row of rows) {
          const magic = byId.get(row.id);
          if (magic) {
            const result = await dawnRecharge(q, campaignId, userId, magic, row.name, characterId);
            if (result) recharged.push(result);
          }
        }
        const attunedCount = Number((await q.query('SELECT count(*)::int AS n FROM magic_items WHERE campaign_id=$1 AND attuned_to=$2', [campaignId, characterId])).rows[0].n);
        const fromItems = magicRows.filter(row => row.applied?.characterId === characterId).map(row => bonusText(row.bonuses ?? {})).filter(Boolean);
        return {
          items: rows.map(row => ({ ...row, magic: byId.has(row.id) ? magicView(byId.get(row.id)!, characterId) : null })),
          attunedCount, attunementLimit: ATTUNEMENT_LIMIT, fromItems, recharged, gm: await isGm(q, member, userId),
        };
      });
      if (result.recharged.length) void notifyCampaign(campaignId, { type: 'rolls' });
      return result;
    },
  );

  app.post<{ Params: { campaignId: string; characterId: string }; Body: { srdIndex: string } }>(
    '/campaigns/:campaignId/characters/:characterId/items',
    { schema: { params: characterParams, body: objectSchema({ srdIndex: { type: 'string', minLength: 1, maxLength: 64 } }) } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const preset = SRD_MAGIC_ITEMS.find(item => item.index === request.body.srdIndex);
      if (!preset) reject(404, 'Такого предмета в списке нет.');
      const item = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        if (!(await isGm(q, member, userId))) reject(403, 'Магические предметы дарит мастер.');
        const holder = (await q.query('SELECT id, kind, owner_user_id FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0] as any;
        if (!holder || holder.kind === 'object') reject(400, 'Подарить можно существу.');
        const created = (
          await q.query(
            `INSERT INTO characters (campaign_id, owner_user_id, name, kind, size, container_id, sheet_extra, price_cp)
             VALUES ($1,$2,$3,'object','tiny',$4,$5::jsonb,$6) RETURNING id, name, price_cp`,
            [campaignId, holder.owner_user_id, preset.nameRu, characterId, JSON.stringify({ srdMagicItem: preset.index }), magicItemPriceCp(preset.rarity)],
          )
        ).rows[0];
        const minutes = Number((await q.query('SELECT world_minutes FROM campaigns WHERE id=$1', [campaignId])).rows[0]?.world_minutes ?? 0);
        await q.query(
          `INSERT INTO magic_items (campaign_id, character_id, rarity, description, requires_attunement, charges_max, charges_current,
             recharge, recharge_formula, destroy_on_empty, recharged_dawn, bonuses, srd_index)
           VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11::jsonb,$12)`,
          [
            campaignId, created.id, preset.rarity, preset.description, preset.attunement, preset.charges?.max ?? null,
            preset.charges?.recharge ?? null, preset.charges?.formula ?? null, preset.charges?.destroyOnEmpty === true,
            dawnCount(minutes), JSON.stringify(preset.bonuses ?? {}), preset.index,
          ],
        );
        return created;
      });
      void notifyCampaign(campaignId, { type: 'changed' });
      void notifyCampaign(campaignId, { type: 'character', characterId });
      return reply.code(201).send({ item });
    },
  );

  app.put<{ Params: { campaignId: string; characterId: string }; Body: MagicBody }>(
    '/campaigns/:campaignId/characters/:characterId/magic',
    {
      schema: {
        params: characterParams,
        body: {
          type: 'object', additionalProperties: false,
          properties: {
            rarity: { type: 'string', enum: [...RARITIES] },
            description: { type: 'string', maxLength: 2000 },
            requiresAttunement: { type: 'boolean' },
            chargesMax: { oneOf: [{ type: 'integer', minimum: 1, maximum: 100 }, { type: 'null' }] },
            chargesCurrent: { oneOf: [{ type: 'integer', minimum: 0, maximum: 100 }, { type: 'null' }] },
            recharge: { oneOf: [{ type: 'string', enum: ['dawn', 'short', 'long'] }, { type: 'null' }] },
            rechargeFormula: { oneOf: [{ type: 'string', minLength: 1, maxLength: 20 }, { type: 'null' }] },
            destroyOnEmpty: { type: 'boolean' },
            destroyed: { type: 'boolean' },
            bonuses: bonusesSchema,
          },
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const body = request.body;
      if (body.bonuses) {
        const problems = bonusProblems(body.bonuses);
        if (problems.length) reject(400, problems.join(' '));
      }
      if (body.rechargeFormula && !parseFormula(body.rechargeFormula)) reject(400, `Формула восстановления «${body.rechargeFormula}» — нужно вида 1d6+1.`);

      const { view, touched, holderId } = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        if (!(await isGm(q, member, userId))) reject(403, 'Свойства магических предметов задаёт мастер.');
        const { row, magic } = await loadItem(q, campaignId, characterId);
        const chargesMax = body.chargesMax !== undefined ? body.chargesMax : magic?.charges_max ?? null;
        let chargesCurrent = body.chargesCurrent !== undefined ? body.chargesCurrent : magic ? magic.charges_current : chargesMax;
        if (chargesMax === null) chargesCurrent = null;
        else chargesCurrent = Math.min(chargesMax, chargesCurrent ?? chargesMax);
        const minutes = Number((await q.query('SELECT world_minutes FROM campaigns WHERE id=$1', [campaignId])).rows[0]?.world_minutes ?? 0);
        await q.query(
          `INSERT INTO magic_items (campaign_id, character_id, rarity, description, requires_attunement, charges_max, charges_current,
             recharge, recharge_formula, destroy_on_empty, destroyed, recharged_dawn, bonuses)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
           ON CONFLICT (campaign_id, character_id) DO UPDATE SET
             rarity=EXCLUDED.rarity, description=EXCLUDED.description, requires_attunement=EXCLUDED.requires_attunement,
             charges_max=EXCLUDED.charges_max, charges_current=EXCLUDED.charges_current, recharge=EXCLUDED.recharge,
             recharge_formula=EXCLUDED.recharge_formula, destroy_on_empty=EXCLUDED.destroy_on_empty, destroyed=EXCLUDED.destroyed,
             bonuses=EXCLUDED.bonuses`,
          [
            campaignId, characterId, body.rarity ?? magic?.rarity ?? 'uncommon', body.description ?? magic?.description ?? '',
            body.requiresAttunement ?? magic?.requires_attunement ?? false, chargesMax, chargesCurrent,
            chargesMax === null ? null : body.recharge !== undefined ? body.recharge : magic?.recharge ?? null,
            chargesMax === null ? null : body.rechargeFormula !== undefined ? body.rechargeFormula : magic?.recharge_formula ?? null,
            body.destroyOnEmpty ?? magic?.destroy_on_empty ?? false, body.destroyed ?? magic?.destroyed ?? false,
            magic?.recharged_dawn ?? dawnCount(minutes), JSON.stringify(body.bonuses ?? magic?.bonuses ?? {}),
          ],
        );
        const touched = await syncItem(q, campaignId, characterId);
        const fresh = (await q.query('SELECT * FROM magic_items WHERE campaign_id=$1 AND character_id=$2', [campaignId, characterId])).rows[0] as MagicRow;
        return { view: magicView(fresh, row.holder_id ?? null), touched, holderId: row.holder_id as string | null };
      });
      for (const id of new Set([...touched, ...(holderId ? [holderId] : [])])) void notifyCampaign(campaignId, { type: 'character', characterId: id });
      void notifyCampaign(campaignId, { type: 'changed' });
      return { magic: view };
    },
  );

  app.delete<{ Params: { campaignId: string; characterId: string } }>(
    '/campaigns/:campaignId/characters/:characterId/magic',
    { schema: { params: characterParams } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const touched = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        if (!(await isGm(q, member, userId))) reject(403, 'Свойства магических предметов задаёт мастер.');
        const { magic } = await loadItem(q, campaignId, characterId);
        if (!magic) reject(404, 'Предмет и так обычный.');
        const holder = magic.applied?.characterId ?? null;
        await releaseMagic(q, campaignId, characterId);
        return holder ? [holder] : [];
      });
      for (const id of touched) void notifyCampaign(campaignId, { type: 'character', characterId: id });
      void notifyCampaign(campaignId, { type: 'changed' });
      return reply.code(204).send();
    },
  );

  async function toggle(request: any, kind: 'equip' | 'attune') {
    const userId = await auth(request);
    const { campaignId, characterId } = request.params;
    const value = kind === 'equip' ? request.body.equipped === true : request.body.attuned === true;
    const result = await db.transaction(async q => {
      const member = await membership(q, campaignId, userId, true);
      const { row, magic } = await loadItem(q, campaignId, characterId);
      if (!magic) reject(400, `«${row.name}» — обычный предмет: надевать незачем.`);
      await requireHolder(q, member, userId, row);
      if (magic.destroyed) reject(400, `«${row.name}» уничтожен.`);
      if (kind === 'equip') {
        await q.query('UPDATE magic_items SET equipped=$3 WHERE campaign_id=$1 AND character_id=$2', [campaignId, characterId, value]);
      } else {
        if (!magic.requires_attunement) reject(400, `«${row.name}» не требует настройки.`);
        if (value) {
          if (magic.attuned_to === row.holder_id) reject(400, `${row.holder_name} уже настроен на «${row.name}».`);
          const count = Number((await q.query('SELECT count(*)::int AS n FROM magic_items WHERE campaign_id=$1 AND attuned_to=$2', [campaignId, row.holder_id])).rows[0].n);
          if (count >= ATTUNEMENT_LIMIT) reject(400, `${row.holder_name} уже настроен на ${ATTUNEMENT_LIMIT} предмета — больше нельзя. Сначала прервите настройку на другом.`);
          const fighting = (
            await q.query(
              `SELECT 1 FROM initiative_entries ie WHERE ie.campaign_id=$1 AND ie.character_id=$2
                 AND EXISTS (SELECT 1 FROM initiative_entries x WHERE x.campaign_id=ie.campaign_id AND x.scene_id=ie.scene_id AND x.is_current)`,
              [campaignId, row.holder_id],
            )
          ).rows[0];
          if (fighting) reject(400, 'Настройка — на коротком отдыхе с предметом, не в бою.');
        }
        await q.query('UPDATE magic_items SET attuned_to=$3 WHERE campaign_id=$1 AND character_id=$2', [campaignId, characterId, value ? row.holder_id : null]);
      }
      const touched = await syncItem(q, campaignId, characterId);
      const fresh = (await q.query('SELECT * FROM magic_items WHERE campaign_id=$1 AND character_id=$2', [campaignId, characterId])).rows[0] as MagicRow;
      return { view: magicView(fresh, row.holder_id), touched, holderId: row.holder_id as string, name: row.name as string, holderName: row.holder_name as string };
    });
    for (const id of new Set([...result.touched, result.holderId])) void notifyCampaign(campaignId, { type: 'character', characterId: id });
    void notifyCampaign(campaignId, { type: 'changed' });
    const verb = kind === 'equip' ? (value ? 'надевает' : 'снимает') : (value ? 'настраивается на' : 'прерывает настройку на');
    return { magic: result.view, message: `${result.holderName} ${verb} «${result.name}»${result.view.active ? `: ${result.view.bonusText || 'действует'}` : ''}.` };
  }

  app.post('/campaigns/:campaignId/characters/:characterId/equip', {
    schema: { params: characterParams, body: objectSchema({ equipped: { type: 'boolean' } }) },
  }, request => toggle(request, 'equip'));

  app.post('/campaigns/:campaignId/characters/:characterId/attune', {
    schema: { params: characterParams, body: objectSchema({ attuned: { type: 'boolean' } }) },
  }, request => toggle(request, 'attune'));

  app.post<{ Params: { campaignId: string; characterId: string }; Body: { spend?: number; set?: number } }>(
    '/campaigns/:campaignId/characters/:characterId/charges',
    {
      schema: {
        params: characterParams,
        body: { type: 'object', additionalProperties: false, properties: { spend: { type: 'integer', minimum: 1, maximum: 20 }, set: { type: 'integer', minimum: 0, maximum: 100 } } },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const { spend, set } = request.body;
      if ((spend === undefined) === (set === undefined)) reject(400, 'Укажите spend (потратить) или set (задать).');

      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const { row, magic } = await loadItem(q, campaignId, characterId);
        if (!magic || magic.charges_max === null) reject(400, `У «${row.name}» нет зарядов.`);
        if (set !== undefined) {
          if (!(await isGm(q, member, userId))) reject(403, 'Заряды задаёт мастер.');
          const value = Math.min(magic.charges_max!, set);
          await q.query('UPDATE magic_items SET charges_current=$3 WHERE campaign_id=$1 AND character_id=$2', [campaignId, characterId, value]);
          return { current: value, max: magic.charges_max!, name: row.name as string, holderId: row.holder_id as string | null, destroyed: false, message: null, chat: null };
        }
        await requireHolder(q, member, userId, row);
        if (magic.destroyed) reject(400, `«${row.name}» уничтожен.`);
        if (magic.requires_attunement && magic.attuned_to !== row.holder_id) reject(400, `Сначала настройтесь на «${row.name}»: без настройки его свойства не действуют.`);
        await dawnRecharge(q, campaignId, userId, magic, row.name, row.holder_id);
        const current = magic.charges_current ?? 0;
        if (current < spend!) reject(400, `У «${row.name}» ${current} из ${magic.charges_max} зарядов — на ${spend} не хватит.`);
        const left = current - spend!;
        await q.query('UPDATE magic_items SET charges_current=$3 WHERE campaign_id=$1 AND character_id=$2', [campaignId, characterId, left]);
        let destroyed = false;
        let tail = '';
        if (left === 0 && magic.destroy_on_empty) {
          const die = rollDie(20);
          destroyed = die === 1;
          await insertRoll(
            q, campaignId, userId, row.holder_id, `Последний заряд: ${row.name}`.slice(0, 100), '1d20', [die], 0, die, false, null,
            { kind: 'last-charge', destroyed },
          );
          if (destroyed) {
            await q.query('UPDATE magic_items SET destroyed=true WHERE campaign_id=$1 AND character_id=$2', [campaignId, characterId]);
            await syncItem(q, campaignId, characterId);
            tail = ` Последний заряд — к20: 1, «${row.name}» рассыпается в прах!`;
          } else {
            tail = ` Последний заряд — к20: ${die}, уцелел.`;
          }
        }
        const word = spend === 1 ? 'заряд' : spend! < 5 ? 'заряда' : 'зарядов';
        const message = `${row.holder_name}: «${row.name}» — ${spend} ${word} (осталось ${left}/${magic.charges_max}).${tail}`;
        const chat = await insertChatMessage(q, campaignId, userId, { characterId: row.holder_id, body: message });
        return { current: left, max: magic.charges_max!, name: row.name as string, holderId: row.holder_id as string | null, destroyed, message, chat };
      });
      if (result.chat) void notifyCampaign(campaignId, { type: 'chat', message: result.chat });
      void notifyCampaign(campaignId, { type: 'rolls' });
      if (result.holderId) void notifyCampaign(campaignId, { type: 'character', characterId: result.holderId });
      return { current: result.current, max: result.max, destroyed: result.destroyed, message: result.message };
    },
  );
}
