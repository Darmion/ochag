import type { Queryable } from '../../db.ts';
import { bossProblems, type BossPhase, type BossSettings } from '../../../../../packages/domain/character/class-features.ts';
import { dawnCount } from '../../../../../packages/domain/character/magic-items.ts';

const COPY_FIELDS = [
  'name', 'kind', 'disposition', 'size', 'level', 'owner_user_id', 'shared',
  'model_asset_id', 'image_asset_id', 'image_crop', 'sheet_version',
  'strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma',
  'hp_max', 'armor_class', 'speed_feet', 'sheet_extra', 'damage_threshold',
  'damage_resistances', 'damage_immunities', 'damage_vulnerabilities',
  'spellcasting_ability', 'hit_die', 'challenge_rating', 'xp_award', 'class_name', 'attacks_per_action',
  'cp', 'sp', 'ep', 'gp', 'pp', 'price_cp', 'weight_lb', 'merchant',
  'legendary_actions', 'legendary_options', 'boss_phases',
  'legendary_resistances',
  'spell_save_dc_override', 'spell_attack_override',
] as const;

type SnapshotList = 'effects' | 'resources' | 'spells';

const STATE_COLUMNS = [
  'openable', 'is_open', 'locked', 'lock_dc', 'lock_known', 'break_dc', 'broken',
  'trap_armed', 'trap_detect_dc', 'trap_disarm_dc', 'trap_detected', 'trap_note', 'blocks',
  'light_bright_feet', 'light_dim_feet', 'lit',
  'light_open_flame', 'secret_dc', 'secret_found', 'hazard',
  'light_cone', 'block_kind',
] as const;
const STATE_DEFAULTS: Record<string, unknown> = {
  openable: false, is_open: false, locked: false, lock_known: false, broken: false,
  trap_armed: false, trap_detected: false, blocks: false, lit: true,
  light_open_flame: false, secret_found: false, light_cone: false, block_kind: 'both',
};

const KEY_PREFIX: Record<SnapshotList, string> = { effects: 'effect', resources: 'resource', spells: 'spell' };

export type ObjectSnapshot = {
  version: 1;
  character: Record<(typeof COPY_FIELDS)[number], unknown>;
  effects: Array<{ effect_code: string; parameters: unknown; active: boolean }>;
  resources: Array<{ name: string; max: number; recharge?: string }>;
  skills: Array<{ skill_index: string; proficient: boolean; expertise: boolean }>;
  saves: Array<{ ability: string; proficient: boolean; custom_bonus: number }>;
  spells: Array<{ source: 'srd' | 'custom'; srd_index: string | null; custom_spell_id: string | null; prepared: boolean; granted?: boolean; slotless?: boolean }>;
  spellSlots: Array<{ level: number; max: number }>;
  weapons: Array<{
    name: string; ability: string; proficient: boolean; damage_formula?: string | null; damage_type?: string | null; range_feet?: number;
    weapon_kind?: string; long_range_feet?: number | null; thrown_range_feet?: number | null; versatile_formula?: string | null;
    properties?: unknown; srd_index?: string | null; ammo_name?: string | null;
    attack_bonus?: number; extra_damage_formula?: string | null; extra_damage_type?: string | null;
  }>;
  visibility: Array<{
    field_key: string;
    ref: { list: SnapshotList; index: number } | null;
    mode: 'hidden' | 'allowlist';
    users: string[];
  }>;
  access: Array<{ user_id: string; level: 'denied' | 'edit' }>;
  state?: Record<string, unknown> | null;
  magic?: Record<string, unknown> | null;
  factions?: string[] | null;
};

const MAGIC_COLUMNS = [
  'rarity', 'description', 'requires_attunement', 'charges_max', 'recharge', 'recharge_formula', 'destroy_on_empty', 'bonuses', 'srd_index',
] as const;

export async function snapshotObject(q: Queryable, campaignId: string, characterId: string): Promise<ObjectSnapshot | null> {
  const params = [campaignId, characterId];
  const character = (
    await q.query(
      `SELECT ${COPY_FIELDS.map(field => (field === 'speed_feet' || field === 'weight_lb' ? `${field}::float8 AS ${field}` : field)).join(', ')}
       FROM characters WHERE campaign_id=$1 AND id=$2`,
      params,
    )
  ).rows[0];

  if (!character) return null;

  const rows = async (sql: string) => (await q.query(sql, params)).rows;

  const effects = await rows(
    `SELECT id, effect_code, parameters, active FROM character_effects
     WHERE campaign_id=$1 AND character_id=$2 ORDER BY id`,
  );
  const resources = await rows(
    `SELECT id, name, max, recharge FROM character_resources
     WHERE campaign_id=$1 AND character_id=$2 ORDER BY created_at, id`,
  );
  const spells = await rows(
    `SELECT id, source, srd_index, custom_spell_id, prepared, granted, slotless FROM character_spells
     WHERE campaign_id=$1 AND character_id=$2 ORDER BY created_at, id`,
  );
  const visibility = await rows(
    `SELECT v.field_key, v.mode,
            COALESCE(array_agg(g.user_id::text) FILTER (WHERE g.user_id IS NOT NULL), '{}'::text[]) AS users
     FROM character_field_visibility v
     LEFT JOIN character_field_visibility_grants g
       ON g.campaign_id=v.campaign_id AND g.character_id=v.character_id AND g.field_key=v.field_key
     WHERE v.campaign_id=$1 AND v.character_id=$2
     GROUP BY v.field_key, v.mode
     ORDER BY v.field_key`,
  );

  const indexes: Record<SnapshotList, Map<string, number>> = {
    effects: new Map(effects.map((row, index) => [String(row.id), index])),
    resources: new Map(resources.map((row, index) => [String(row.id), index])),
    spells: new Map(spells.map((row, index) => [String(row.id), index])),
  };

  return {
    version: 1,
    character: character as ObjectSnapshot['character'],
    effects: effects.map(row => ({ effect_code: row.effect_code, parameters: row.parameters, active: row.active })),
    resources: resources.map(row => ({ name: row.name, max: row.max, recharge: row.recharge })),
    skills: (await rows(
      `SELECT skill_index, proficient, expertise FROM character_skills
       WHERE campaign_id=$1 AND character_id=$2 ORDER BY skill_index`,
    )) as ObjectSnapshot['skills'],
    saves: (await rows(
      `SELECT ability, proficient, custom_bonus FROM character_saves
       WHERE campaign_id=$1 AND character_id=$2 ORDER BY ability`,
    )) as ObjectSnapshot['saves'],
    spells: spells.map(row => ({
      source: row.source, srd_index: row.srd_index, custom_spell_id: row.custom_spell_id, prepared: row.prepared,
      granted: row.granted === true, slotless: row.slotless === true,
    })),
    spellSlots: (await rows(
      `SELECT level, max FROM character_spell_slots
       WHERE campaign_id=$1 AND character_id=$2 ORDER BY level`,
    )) as ObjectSnapshot['spellSlots'],
    weapons: (await rows(
      `SELECT w.name, w.ability, w.proficient, w.damage_formula, w.damage_type, w.range_feet,
              w.weapon_kind, w.long_range_feet, w.thrown_range_feet, w.versatile_formula, w.properties, w.srd_index,
              w.attack_bonus, w.extra_damage_formula, w.extra_damage_type, r.name AS ammo_name
       FROM character_weapons w LEFT JOIN character_resources r ON r.id = w.ammo_resource_id
       WHERE w.campaign_id=$1 AND w.character_id=$2 ORDER BY w.name, w.id`,
    )) as ObjectSnapshot['weapons'],
    visibility: visibility.flatMap(row => {
      const key = String(row.field_key);
      const match = /^(effect|resource|spell):(.+)$/.exec(key);
      let ref: ObjectSnapshot['visibility'][number]['ref'] = null;

      if (match) {
        const list = (Object.keys(KEY_PREFIX) as SnapshotList[]).find(name => KEY_PREFIX[name] === match[1])!;
        const index = indexes[list].get(match[2]!);
        if (index === undefined) return [];
        ref = { list, index };
      }

      return [{ field_key: key, ref, mode: row.mode, users: (row.users as string[]).map(String) }];
    }),
    access: (await rows(
      `SELECT user_id, level FROM character_access_grants
       WHERE campaign_id=$1 AND character_id=$2 ORDER BY user_id`,
    )) as ObjectSnapshot['access'],
    state: (await rows(
      `SELECT ${STATE_COLUMNS.join(', ')} FROM object_states WHERE campaign_id=$1 AND character_id=$2`,
    ))[0] ?? null,
    magic: (await rows(
      `SELECT ${MAGIC_COLUMNS.join(', ')} FROM magic_items WHERE campaign_id=$1 AND character_id=$2`,
    ))[0] ?? null,
    factions: (await rows('SELECT factions_explicit FROM characters WHERE campaign_id=$1 AND id=$2'))[0]?.factions_explicit
      ? (await rows('SELECT faction_id FROM faction_members WHERE campaign_id=$1 AND character_id=$2 ORDER BY faction_id')).map(row => String(row.faction_id))
      : null,
  };
}

export async function copyNames(q: Queryable, campaignId: string, name: string, count: number) {
  const base = name.trim().replace(/\s+\d+$/, '').slice(0, 190) || name.trim().slice(0, 190);
  const taken = (
    await q.query(
      `SELECT name FROM characters WHERE campaign_id=$1 AND (name=$2 OR name LIKE $3)`,
      [campaignId, base, `${base.replace(/[\\%_]/g, '\\$&')} %`],
    )
  ).rows.map(row => String(row.name));

  let highest = 0;
  for (const existing of taken) {
    if (existing === base) highest = Math.max(highest, 1);
    const number = existing.slice(base.length).trim();
    if (/^\d{1,6}$/.test(number)) highest = Math.max(highest, Number(number));
  }

  return Array.from({ length: count }, (_, index) => `${base} ${highest + index + 1}`);
}

export async function createFromSnapshot(
  q: Queryable,
  campaignId: string,
  snapshot: ObjectSnapshot,
  name: string,
  createdBy: string,
): Promise<string> {
  const source = snapshot.character as Record<string, any>;

  const members = new Set(
    (await q.query('SELECT user_id FROM campaign_members WHERE campaign_id=$1', [campaignId])).rows.map(row => String(row.user_id)),
  );
  const existingAssets = async (ids: unknown[]) => {
    const wanted = ids.filter((id): id is string => typeof id === 'string');
    if (!wanted.length) return new Set<string>();
    return new Set(
      (await q.query(`SELECT id FROM assets WHERE campaign_id=$1 AND id::text = ANY(string_to_array($2, ','))`, [campaignId, wanted.join(',')]))
        .rows.map(row => String(row.id)),
    );
  };
  const assets = await existingAssets([source.model_asset_id, source.image_asset_id]);
  const ownerUserId = typeof source.owner_user_id === 'string' && members.has(source.owner_user_id) ? source.owner_user_id : null;

  const kind = source.kind === 'character' && !ownerUserId ? 'npc' : source.kind;
  const disposition = kind === 'npc' ? source.disposition ?? 'neutral' : null;
  const hpMax = Math.max(0, Number(source.hp_max) || 0);

  const characterId = (
    await q.query(
      `INSERT INTO characters (
         campaign_id, owner_user_id, name, kind, disposition, size, level, shared,
         model_asset_id, image_asset_id, sheet_version,
         strength, dexterity, constitution, intelligence, wisdom, charisma,
         hp_max, hp_current, hp_temp, armor_class, speed_feet, sheet_extra, damage_threshold,
         damage_resistances, damage_immunities, damage_vulnerabilities, spellcasting_ability, hit_die,
         challenge_rating, xp_award, class_name, attacks_per_action,
         cp, sp, ep, gp, pp, price_cp, weight_lb, merchant, image_crop
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18,0,$19,$20,$21,$22,$23::jsonb,$24::jsonb,$25::jsonb,$26,$27,$28,$29,$30,$31,
               $32,$33,$34,$35,$36,$37,$38,$39,$40::jsonb)
       RETURNING id`,
      [
        campaignId, ownerUserId, name, kind, disposition, source.size ?? 'medium', source.level ?? null,
        source.shared === true,
        assets.has(source.model_asset_id) ? source.model_asset_id : null,
        assets.has(source.image_asset_id) ? source.image_asset_id : null,
        source.sheet_version ?? 1,
        source.strength ?? 10, source.dexterity ?? 10, source.constitution ?? 10,
        source.intelligence ?? 10, source.wisdom ?? 10, source.charisma ?? 10,
        hpMax, source.armor_class ?? 10, source.speed_feet ?? 0,
        JSON.stringify(source.sheet_extra ?? {}),
        source.damage_threshold ?? null,
        JSON.stringify(source.damage_resistances ?? []),
        JSON.stringify(source.damage_immunities ?? []),
        JSON.stringify(source.damage_vulnerabilities ?? []),
        source.spellcasting_ability ?? null,
        [6, 8, 10, 12].includes(source.hit_die) ? source.hit_die : null,
        source.challenge_rating ?? null,
        source.xp_award ?? null,
        typeof source.class_name === 'string' ? source.class_name.slice(0, 100) : null,
        Number.isInteger(source.attacks_per_action) && source.attacks_per_action >= 1 && source.attacks_per_action <= 10 ? source.attacks_per_action : null,
        ...(['cp', 'sp', 'ep', 'gp', 'pp'] as const).map(coin => (Number.isInteger(source[coin]) && source[coin] >= 0 ? source[coin] : 0)),
        Number.isInteger(source.price_cp) && source.price_cp >= 0 ? source.price_cp : null,
        Number.isFinite(source.weight_lb) && source.weight_lb >= 0 ? source.weight_lb : null,
        kind === 'npc' && source.merchant === true,
        assets.has(source.image_asset_id) && source.image_crop && typeof source.image_crop === 'object' ? JSON.stringify(source.image_crop) : null,
      ],
    )
  ).rows[0].id as string;

  const dcOverride = Number.isInteger(source.spell_save_dc_override) && source.spell_save_dc_override >= 1 && source.spell_save_dc_override <= 40 ? source.spell_save_dc_override : null;
  const attackOverride = Number.isInteger(source.spell_attack_override) && source.spell_attack_override >= -10 && source.spell_attack_override <= 30 ? source.spell_attack_override : null;
  if (dcOverride !== null || attackOverride !== null) {
    await q.query('UPDATE characters SET spell_save_dc_override=$3, spell_attack_override=$4 WHERE campaign_id=$1 AND id=$2', [campaignId, characterId, dcOverride, attackOverride]);
  }

  if (kind === 'npc' && (Number(source.legendary_actions) > 0 || Number(source.legendary_resistances) > 0 || (Array.isArray(source.boss_phases) && source.boss_phases.length))) {
    const boss: BossSettings = {
      legendaryActions: Number(source.legendary_actions) || 0,
      legendaryResistances: Number(source.legendary_resistances) || 0,
      options: Array.isArray(source.legendary_options) ? source.legendary_options : [],
      phases: (Array.isArray(source.boss_phases) ? source.boss_phases : []).map((phase: BossPhase) => ({ ...phase, done: false })),
    };
    if (!bossProblems(boss).length) {
      await q.query(
        'UPDATE characters SET legendary_actions=$3, legendary_options=$4::jsonb, boss_phases=$5::jsonb, legendary_resistances=$6 WHERE campaign_id=$1 AND id=$2',
        [campaignId, characterId, boss.legendaryActions, JSON.stringify(boss.options), JSON.stringify(boss.phases), boss.legendaryResistances ?? 0],
      );
    }
  }

  const ids: Record<SnapshotList, Array<string | null>> = { effects: [], resources: [], spells: [] };

  for (const effect of snapshot.effects) {
    ids.effects.push(
      (
        await q.query(
          `INSERT INTO character_effects (campaign_id, character_id, effect_code, parameters, active)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [campaignId, characterId, effect.effect_code, JSON.stringify(effect.parameters ?? {}), effect.active !== false],
        )
      ).rows[0].id,
    );
  }

  for (const resource of snapshot.resources) {
    ids.resources.push(
      (
        await q.query(
          `INSERT INTO character_resources (campaign_id, character_id, name, current, max, recharge)
           VALUES ($1,$2,$3,$4,$4,$5) RETURNING id`,
          [campaignId, characterId, resource.name, resource.max, ['short', 'long'].includes(resource.recharge ?? '') ? resource.recharge : 'none'],
        )
      ).rows[0].id,
    );
  }

  for (const skill of snapshot.skills) {
    await q.query(
      `INSERT INTO character_skills (campaign_id, character_id, skill_index, proficient, expertise)
       VALUES ($1,$2,$3,$4,$5)`,
      [campaignId, characterId, skill.skill_index, skill.proficient, skill.expertise],
    );
  }

  for (const save of snapshot.saves) {
    await q.query(
      `INSERT INTO character_saves (campaign_id, character_id, ability, proficient, custom_bonus)
       VALUES ($1,$2,$3,$4,$5)`,
      [campaignId, characterId, save.ability, save.proficient, save.custom_bonus],
    );
  }

  const customSpells = new Set(
    (
      await q.query(
        `SELECT id FROM campaign_spells WHERE campaign_id=$1 AND id::text = ANY(string_to_array($2, ','))`,
        [campaignId, snapshot.spells.map(spell => spell.custom_spell_id).filter(Boolean).join(',')],
      )
    ).rows.map(row => String(row.id)),
  );

  for (const spell of snapshot.spells) {
    if (spell.source === 'custom' && !customSpells.has(String(spell.custom_spell_id))) {
      ids.spells.push(null);
      continue;
    }

    ids.spells.push(
      (
        await q.query(
          `INSERT INTO character_spells (campaign_id, character_id, source, srd_index, custom_spell_id, prepared, granted, slotless)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [campaignId, characterId, spell.source, spell.srd_index, spell.custom_spell_id, spell.prepared, spell.granted === true, spell.slotless === true],
        )
      ).rows[0].id,
    );
  }

  for (const slot of snapshot.spellSlots) {
    await q.query(
      `INSERT INTO character_spell_slots (campaign_id, character_id, level, current, max)
       VALUES ($1,$2,$3,$4,$4)`,
      [campaignId, characterId, slot.level, slot.max],
    );
  }

  const resourceIdByName = new Map(snapshot.resources.map((resource, index) => [resource.name, ids.resources[index]]));
  for (const weapon of snapshot.weapons) {
    const kind = weapon.weapon_kind === 'ranged' || weapon.weapon_kind === 'melee' ? weapon.weapon_kind : (weapon.range_feet ?? 5) > 10 ? 'ranged' : 'melee';
    await q.query(
      `INSERT INTO character_weapons (
         campaign_id, character_id, name, ability, proficient, damage_formula, damage_type, range_feet,
         weapon_kind, long_range_feet, thrown_range_feet, versatile_formula, properties, srd_index, ammo_resource_id,
         attack_bonus, extra_damage_formula, extra_damage_type
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18)`,
      [
        campaignId, characterId, weapon.name, weapon.ability, weapon.proficient, weapon.damage_formula ?? null, weapon.damage_type ?? null, weapon.range_feet ?? 5,
        kind, weapon.long_range_feet ?? null, weapon.thrown_range_feet ?? null, weapon.versatile_formula ?? null,
        JSON.stringify(Array.isArray(weapon.properties) ? weapon.properties : []), weapon.srd_index ?? null,
        (weapon.ammo_name && resourceIdByName.get(weapon.ammo_name)) ?? null,
        Number.isInteger(weapon.attack_bonus) ? weapon.attack_bonus : 0, weapon.extra_damage_formula ?? null, weapon.extra_damage_type ?? null,
      ],
    );
  }

  for (const setting of snapshot.visibility) {
    let fieldKey = setting.field_key;

    if (setting.ref) {
      const id = ids[setting.ref.list][setting.ref.index];
      if (!id) continue;
      fieldKey = `${KEY_PREFIX[setting.ref.list]}:${id}`;
    }

    await q.query(
      `INSERT INTO character_field_visibility (campaign_id, character_id, field_key, mode)
       VALUES ($1,$2,$3,$4)`,
      [campaignId, characterId, fieldKey, setting.mode],
    );

    for (const user of setting.users) {
      if (!members.has(user)) continue;
      await q.query(
        `INSERT INTO character_field_visibility_grants (campaign_id, character_id, field_key, user_id)
         VALUES ($1,$2,$3,$4)`,
        [campaignId, characterId, fieldKey, user],
      );
    }
  }

  if (snapshot.state) {
    await q.query(
      `INSERT INTO object_states (campaign_id, character_id, ${STATE_COLUMNS.join(', ')})
       VALUES ($1, $2, ${STATE_COLUMNS.map((_, index) => `$${index + 3}`).join(', ')})`,
      [campaignId, characterId, ...STATE_COLUMNS.map(column => {
        const value = snapshot.state![column] ?? STATE_DEFAULTS[column] ?? null;
        return column === 'hazard' && value !== null ? JSON.stringify(value) : value;
      })],
    );
  }

  if (snapshot.magic && kind === 'object') {
    const magic = snapshot.magic;
    const minutes = Number((await q.query('SELECT world_minutes FROM campaigns WHERE id=$1', [campaignId])).rows[0]?.world_minutes ?? 0);
    await q.query(
      `INSERT INTO magic_items (campaign_id, character_id, ${MAGIC_COLUMNS.join(', ')}, charges_current, recharged_dawn)
       VALUES ($1, $2, ${MAGIC_COLUMNS.map((_, index) => `$${index + 3}`).join(', ')}, $${MAGIC_COLUMNS.length + 3}, $${MAGIC_COLUMNS.length + 4})`,
      [
        campaignId, characterId, ...MAGIC_COLUMNS.map(column => (column === 'bonuses' ? JSON.stringify(magic.bonuses ?? {}) : magic[column] ?? null)),
        magic.charges_max ?? null, dawnCount(minutes),
      ],
    );
  }

  for (const grant of snapshot.access) {
    if (!members.has(grant.user_id)) continue;
    await q.query(
      `INSERT INTO character_access_grants (campaign_id, character_id, user_id, level, granted_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [campaignId, characterId, grant.user_id, grant.level, createdBy],
    );
  }

  if (Array.isArray(snapshot.factions) && kind !== 'object') {
    const wanted = snapshot.factions.filter(id => typeof id === 'string');
    const found = (
      await q.query('SELECT id FROM factions WHERE campaign_id=$1 AND id::text = ANY($2::text[])', [campaignId, wanted])
    ).rows.map(row => String(row.id));
    if (found.length || !wanted.length) {
      await q.query('UPDATE characters SET factions_explicit=true WHERE campaign_id=$1 AND id=$2', [campaignId, characterId]);
      for (const factionId of found) {
        await q.query('INSERT INTO faction_members (campaign_id, faction_id, character_id) VALUES ($1,$2,$3)', [campaignId, factionId, characterId]);
      }
    }
  }

  return characterId;
}
