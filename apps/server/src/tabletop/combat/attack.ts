import type { Queryable } from '../../db.ts';
import { classFeaturesFor, divineStrikeDice, classLevelOf, supremeSneakApplies, knownFavoredEnemies, PROTECTION_FROM_EVIL_TYPES } from '../../../../../packages/domain/character/class-features.ts';
import { deadCreatures } from './loot-routes.ts';
import { characterClassLevels, attacksForClasses } from '../../../../../packages/domain/character/classes.ts';
import { rangeBand, type WeaponRanges, type Cover, COVER_AC } from '../../../../../packages/domain/combat/targeting.ts';
import { placementFactions, placementsAllied, placementsHostile } from '../../campaign/factions.ts';
import { rollMods } from '../../../../../packages/domain/spells/spell-mods.ts';
import { loadConditionState } from '../../rules/conditions.ts';
import { conditionState, attackOutcome, incapacitatedReason } from '../../../../../packages/domain/combat/conditions.ts';
import { abilityModifier } from '../../../../../packages/domain/dice/dice.ts';

import { averageDamage } from '../auto-turn/planner.ts';
import { hasClassFeature, protectedFromEvil } from './auras.ts';
import { wallCover } from './cover.ts';
import { sceneSight, type SceneSight, seesCreature } from './sight.ts';
import type { TableContext } from '../context.ts';
import { campaignFlag, rollDie } from '../rolls/dice.ts';
import { rollCheckAs } from '../rolls/roll-check.ts';
import { feetBetween, getScene } from '../scene/board.ts';
import { loadPlacements } from '../scene/placements.ts';
import { type Placement, reject } from '../shared.ts';
import { creatureTypeOf, spellModsFor } from '../spells/rules.ts';

export type WeaponEnchant = { shillelagh: string | null; bonus: number; die?: number | null };
export const ABILITY_TOKENS: Record<string, string> = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha' };

export function weaponReaches(weapon: any, distance: number, mode: 'melee' | 'ranged' | 'any') {
  const band = rangeBand(weaponRanges(weapon), distance);
  if (!band.ok) return false;
  if (mode === 'melee') return weapon.weapon_kind !== 'ranged' && distance <= Number(weapon.range_feet ?? 5);
  if (mode === 'ranged') return weapon.weapon_kind === 'ranged' || Boolean(weapon.thrown_range_feet);
  return true;
}

export async function unarmedStrike(ctx: TableContext, campaignId: string, sceneId: string | null, characterId: string, targetId: string, userId: string, die: number) {
  const { db } = ctx;
  const formula = `1d${die}+@mod`;
  const weaponId = await db.transaction(async q => {
    const found = (
      await q.query(`SELECT id, damage_formula FROM character_weapons WHERE campaign_id=$1 AND character_id=$2 AND name='Безоружный удар' LIMIT 1`, [campaignId, characterId])
    ).rows[0] as { id: string; damage_formula: string } | undefined;
    if (found) {
      if (found.damage_formula !== formula) await q.query('UPDATE character_weapons SET damage_formula=$2 WHERE id=$1', [found.id, formula]);
      return found.id;
    }
    return (
      await q.query(
        `INSERT INTO character_weapons (campaign_id, character_id, name, ability, proficient, damage_formula, damage_type, range_feet, weapon_kind, properties)
           VALUES ($1,$2,'Безоружный удар','finesse',true,$3,'bludgeoning',5,'melee','[]'::jsonb) RETURNING id`,
        [campaignId, characterId, formula],
      )
    ).rows[0].id as string;
  });
  return rollCheckAs(ctx, userId, campaignId, { characterId, kind: 'attack', key: weaponId, targetCharacterId: targetId, ...(sceneId ? { sceneId } : {}) }, { free: true });
}

export async function divineStrikeFor(q: Queryable, campaignId: string, character: any, sceneId: string | null): Promise<number> {
  const classes = characterClassLevels(character).classes;
  if (!classFeaturesFor(classes).some(feature => feature.id === 'divine-strike')) return 0;
  const turn = (
    await q.query(
      `SELECT id, is_current, turn_flags FROM initiative_entries WHERE campaign_id=$1 AND character_id=$2 AND ($3::uuid IS NULL OR scene_id=$3)
         ORDER BY is_current DESC, created_at LIMIT 1 FOR UPDATE`,
      [campaignId, character.id, sceneId],
    )
  ).rows[0] as { id: string; is_current: boolean; turn_flags: string[] } | undefined;
  if (turn) {
    if (!turn.is_current || (turn.turn_flags ?? []).includes('divine-strike')) return 0;
    await q.query(`UPDATE initiative_entries SET turn_flags = array_append(turn_flags, 'divine-strike') WHERE id=$1`, [turn.id]);
  }
  return divineStrikeDice(classLevelOf(classes, 'cleric', character.level));
}
export async function supremeSneak(q: Queryable, campaignId: string, characterId: string) {
  if (!(await hasClassFeature(q, campaignId, characterId, 'supreme-sneak'))) return false;
  const entry = (
    await q.query('SELECT moved_feet::float8 AS moved FROM initiative_entries WHERE campaign_id=$1 AND character_id=$2 AND is_current LIMIT 1', [campaignId, characterId])
  ).rows[0] as { moved: number } | undefined;
  if (!entry) return true;
  const speed = Number((await q.query('SELECT speed_feet::float8 AS speed FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0]?.speed ?? 30);
  return supremeSneakApplies(Number(entry.moved ?? 0), speed);
}
export async function foeSlayerBonus(q: Queryable, campaignId: string, attacker: any, targetId: string): Promise<number> {
  const row = (await q.query('SELECT level, class_name, sheet_extra, wisdom FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, attacker.id])).rows[0] as any;
  if (!row || !classFeaturesFor(characterClassLevels(row).classes).some(feature => feature.id === 'foe-slayer')) return 0;
  const type = await creatureTypeOf(q, campaignId, targetId);
  if (!type || !knownFavoredEnemies(row.sheet_extra).includes(type)) return 0;
  const turn = (
    await q.query(`SELECT id, turn_flags FROM initiative_entries WHERE campaign_id=$1 AND character_id=$2 AND is_current LIMIT 1`, [campaignId, attacker.id])
  ).rows[0] as { id: string; turn_flags: string[] } | undefined;
  if (turn) {
    if ((turn.turn_flags ?? []).includes('foe-slayer')) return 0;
    await q.query(`UPDATE initiative_entries SET turn_flags = array_append(turn_flags, 'foe-slayer') WHERE id=$1`, [turn.id]);
  }
  return Math.max(0, abilityModifier(Number(row.wisdom ?? 10)));
}

export async function attackMarks<S extends ReturnType<typeof conditionState>>(
  q: Queryable, campaignId: string, attackerId: string, targetId: string, target: S | null,
) {
  const effects = (
    await q.query(
      `SELECT id, character_id, effect_code, parameters FROM character_effects
         WHERE campaign_id=$1 AND active AND ((character_id=$2 AND effect_code IN ('guided', 'outlined', 'reckless', 'blurred')) OR (character_id=$3 AND effect_code IN ('mocked', 'helped', 'true_strike')))`,
      [campaignId, targetId, attackerId],
    )
  ).rows as Array<{ id: string; character_id: string; effect_code: string; parameters: any }>;
  const advantages: string[] = [];
  const disadvantages: string[] = [];
  const spent: string[] = [];
  let state = target;
  if (attackerId !== targetId && (await protectedFromEvil(q, campaignId, targetId))) {
    const type = await creatureTypeOf(q, campaignId, attackerId);
    if (type && (PROTECTION_FROM_EVIL_TYPES as readonly string[]).includes(type)) disadvantages.push('защита от добра и зла');
  }
  for (const effect of effects) {
    if (effect.effect_code === 'guided') {
      if (effect.parameters?.notBy === attackerId) continue;
      advantages.push(effect.parameters?.notBy ? 'цель отвлечена' : 'цель подсвечена');
      spent.push(effect.id);
    } else if (effect.effect_code === 'outlined') {
      advantages.push('цель очерчена светом');
      if (state?.codes.has('invisible')) state = { ...conditionState([...state.codes].filter(code => code !== 'invisible')), exhaustion: state.exhaustion } as S;
    } else if (effect.effect_code === 'mocked') {
      disadvantages.push('осмеян');
      spent.push(effect.id);
    } else if (effect.effect_code === 'reckless') {
      advantages.push('цель атакует безрассудно');
    } else if (effect.effect_code === 'blurred') {
      const truesight = (await q.query(`SELECT 1 FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code='truesight' LIMIT 1`, [campaignId, attackerId])).rows[0];
      if (!truesight) disadvantages.push('размытый образ');
    } else if (effect.effect_code === 'true_strike' && effect.parameters?.targetId === targetId) {
      advantages.push('меткий удар');
      spent.push(effect.id);
    } else if (effect.effect_code === 'helped' && effect.parameters?.foeId === targetId) {
      advantages.push(`помощь: ${effect.parameters?.sourceName ?? 'союзник'}`);
      spent.push(effect.id);
    }
  }
  const ownMods = rollMods(await spellModsFor(q, campaignId, attackerId), 'attack', null, null, false);
  const againstMods = attackerId === targetId ? null : rollMods(await spellModsFor(q, campaignId, targetId), 'attack', null, null, true);
  advantages.push(...ownMods.advantages, ...(againstMods?.advantages ?? []));
  disadvantages.push(...ownMods.disadvantages, ...(againstMods?.disadvantages ?? []));
  spent.push(...ownMods.spentRuling, ...(againstMods?.spentRuling ?? []));
  return {
    advantages, disadvantages, target: state,
    consume: async () => {
      if (spent.length) await q.query('DELETE FROM character_effects WHERE id = ANY($1::uuid[])', [spent]);
    },
  };
}

export async function weaponEnchantment(q: Queryable, campaignId: string, characterId: string, weaponId: string): Promise<WeaponEnchant> {
  const rows = (await q.query(
    `SELECT effect_code, parameters FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code IN ('shillelagh', 'magic_weapon') AND parameters->>'weaponId' = $3`,
    [campaignId, characterId, weaponId],
  )).rows as Array<{ effect_code: string; parameters: any }>;
  const club = rows.find(row => row.effect_code === 'shillelagh');
  return {
    shillelagh: club && club.parameters?.ability !== null ? String(club.parameters?.ability ?? 'wisdom') : null,
    die: club ? Number(club.parameters?.die ?? 8) || null : null,
    bonus: Math.max(0, ...rows.filter(row => row.effect_code === 'magic_weapon').map(row => Number(row.parameters?.bonus ?? 1))),
  };
}

export function weaponDamageText(text: string, check: { ability: string; enchant: WeaponEnchant }) {
  let formula = String(text).replace(/@mod\b/g, `@${ABILITY_TOKENS[check.ability] ?? 'str'}`);
  if (check.enchant.die) formula = formula.replace(/(\d*)d\d+/, `$1d${check.enchant.die}`);
  if (check.enchant.bonus) formula = `${formula}+${check.enchant.bonus}`;
  return formula;
}

export async function enchantedWeapon(q: Queryable, campaignId: string, characterId: string, index: string, spellName: string) {
  const weapons = (await q.query(
    `SELECT id, name, srd_index, damage_formula, COALESCE(attack_bonus, 0) AS attack_bonus FROM character_weapons WHERE campaign_id=$1 AND character_id=$2`,
    [campaignId, characterId],
  )).rows as Array<{ id: string; name: string; srd_index: string | null; damage_formula: string | null; attack_bonus: number }>;
  if (index === 'shillelagh') {
    const club = weapons.find(weapon => weapon.srd_index === 'club' || weapon.srd_index === 'quarterstaff' || /дубин|посох|club|quarterstaff/i.test(weapon.name));
    if (!club) reject(400, `«${spellName}»: нужна дубинка или боевой посох в оружии.`);
    return club!;
  }
  const plain = weapons.filter(weapon => Number(weapon.attack_bonus) === 0 && weapon.name !== 'Безоружный удар')
    .sort((a, b) => averageDamage(b.damage_formula) - averageDamage(a.damage_formula))[0];
  if (!plain) reject(400, `«${spellName}»: у цели нет немагического оружия.`);
  return plain!;
}

export async function mirrorStrike(q: Queryable, campaignId: string, targetId: string, attackerId: string, kept: number, total: number, critAt: number) {
  const effect = (await q.query(
    `SELECT id, parameters FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code='mirror_images' LIMIT 1`, [campaignId, targetId],
  )).rows[0] as { id: string; parameters: any } | undefined;
  const count = Number(effect?.parameters?.images ?? 0);
  if (!effect || count <= 0) return null;
  const unfooled = (await q.query(`SELECT 1 FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code IN ('truesight', 'blinded') LIMIT 1`, [campaignId, attackerId])).rows[0];
  if (unfooled) return null;
  const die = rollDie(20);
  const need = count >= 3 ? 6 : count === 2 ? 8 : 11;
  if (die < need) return { redirected: false, reason: `зеркальные отражения: к20 ${die} (нужно ${need}) — удар в настоящего`, view: null };
  const dexterity = Number((await q.query('SELECT dexterity FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, targetId])).rows[0]?.dexterity ?? 10);
  const imageAc = 10 + abilityModifier(dexterity);
  const struck = attackOutcome(kept, total, imageAc, false, critAt).hit;
  const left = struck ? count - 1 : count;
  if (struck && left <= 0) await q.query('DELETE FROM character_effects WHERE id=$1', [effect.id]);
  else if (struck) await q.query('UPDATE character_effects SET parameters=$2::jsonb WHERE id=$1', [effect.id, JSON.stringify({ ...effect.parameters, images: left })]);
  return {
    redirected: true,
    reason: `зеркальные отражения: к20 ${die} — удар в двойника (КД ${imageAc}), ${struck ? (left ? `разбит, осталось ${left}` : 'разбит последний') : 'мимо'}`,
    view: { die, struck, left },
  };
}

export function weaponRanges(weapon: any): WeaponRanges {
  const ranged = weapon.weapon_kind === 'ranged';
  return {
    kind: ranged ? 'ranged' : 'melee',
    reach: Number(weapon.range_feet ?? 5),
    normal: ranged ? Number(weapon.range_feet ?? 80) : weapon.thrown_range_feet === null || weapon.thrown_range_feet === undefined ? null : Number(weapon.thrown_range_feet),
    long: weapon.long_range_feet === null || weapon.long_range_feet === undefined ? null : Number(weapon.long_range_feet),
  };
}

export async function allyNearTarget(q: Queryable, campaignId: string, sceneId: string, attackerId: string, targetId: string) {
  const scene = (await q.query('SELECT id, width_cells, height_cells, feet_per_unit FROM scenes WHERE campaign_id=$1 AND id=$2', [campaignId, sceneId])).rows[0];
  if (!scene) return false;
  const placements = await loadPlacements(q, campaignId, sceneId);
  const pick = (id: string) => placements.find(entry => entry.character_id === id && !entry.parent_object_id);
  const attacker = pick(attackerId);
  const target = pick(targetId);
  if (!attacker || !target || !placementFactions(attacker).length || placementsAllied(target, attacker)) return false;
  const near = placements.filter(entry =>
    !entry.parent_object_id && entry.character_id !== attackerId && entry.character_id !== targetId && placementsAllied(entry, attacker) && feetBetween(scene, entry, target) <= 5);
  const fallen = await deadCreatures(q, campaignId, near.map(entry => entry.character_id));
  for (const entry of near) {
    if (fallen.has(entry.character_id)) continue;
    if (incapacitatedReason(await loadConditionState(q, campaignId, entry.character_id))) continue;
    return true;
  }
  return false;
}

export async function flankingAdvantage(q: Queryable, campaignId: string, scene: any, placements: Placement[], attacker: Placement, target: Placement) {
  if (!placementFactions(attacker).length) return null;
  const toward = (from: Placement, to: Placement) => ({ x: to.world_x - from.world_x, z: to.world_z - from.world_z });
  const attackerVector = toward(target, attacker);
  const magAttacker = Math.hypot(attackerVector.x, attackerVector.z);
  if (magAttacker === 0) return null;
  const allies = placements.filter(entry =>
    entry.id !== attacker.id && entry.id !== target.id && !entry.parent_object_id && placementsAllied(entry, attacker) && feetBetween(scene, entry, target) <= 5);
  if (!allies.length) return null;
  const fallen = await deadCreatures(q, campaignId, allies.map(entry => entry.character_id));
  for (const ally of allies) {
    if (fallen.has(ally.character_id)) continue;
    if (incapacitatedReason(await loadConditionState(q, campaignId, ally.character_id))) continue;
    const allyVector = toward(target, ally);
    const magAlly = Math.hypot(allyVector.x, allyVector.z);
    if (magAlly === 0) continue;
    const cos = (attackerVector.x * allyVector.x + attackerVector.z * allyVector.z) / (magAttacker * magAlly);
    if (cos <= 0) return `фланкирование с «${ally.name}»`;
  }
  return null;
}

export async function attackSituation(
  q: Queryable, campaignId: string, sceneId: string, attackerId: string, targetId: string,
  mode: { kind: 'weapon'; name: string; ranges: WeaponRanges; ignoreRange?: boolean } | { kind: 'spell'; name: string; ranged: boolean; rangeFeet: number | null; rangeOnly?: boolean },
) {
  const scene = (await q.query('SELECT id, width_cells, height_cells, feet_per_unit FROM scenes WHERE campaign_id=$1 AND id=$2', [campaignId, sceneId])).rows[0] as any;
  if (!scene) return null;
  const placements = await loadPlacements(q, campaignId, sceneId);
  const pick = (id: string) => placements.find(entry => entry.character_id === id && !entry.parent_object_id) ?? placements.find(entry => entry.character_id === id);
  const attacker = pick(attackerId);
  const target = pick(targetId);
  if (!attacker || !target || attacker.id === target.id) return null;

  const distance = feetBetween(scene, attacker, target);
  const disadvantages: string[] = [];
  const enforceRange = (await campaignFlag(q, campaignId, 'reach_limit')) !== false;
  let ranged: boolean;
  if (mode.kind === 'weapon') {
    const band = mode.ignoreRange ? { ok: true as const, ranged: false, long: false } : rangeBand(mode.ranges, distance);
    if (!band.ok) {
      if (enforceRange) reject(400, `«${target.name}» вне досягаемости: ${mode.name} — ${band.limit} фут. Подойдите ближе или поправьте дальность оружия в листе.`);
      ranged = mode.ranges.kind === 'ranged';
    } else {
      ranged = band.ranged;
      if (band.long) disadvantages.push('дальняя дистанция');
    }
  } else {
    ranged = mode.ranged;
    if (mode.rangeFeet !== null && distance > mode.rangeFeet && enforceRange) {
      reject(400, `«${target.name}» дальше дистанции заклинания «${mode.name}» — ${mode.rangeFeet} фут.`);
    }
    if (mode.rangeOnly) {
      if ((await wallCover(q, campaignId, sceneId, scene, placements, attacker, target, false)) === 'total') {
        reject(400, `«${target.name}» за стеной (полное укрытие) — его не выбрать целью.`);
      }
      return { distance, ranged, disadvantages, advantages: [] as string[], cover: 'none' as Cover, acBonus: 0 };
    }
  }

  if (ranged && placementFactions(attacker).length) {
    const near = placements.filter(entry =>
      entry.id !== attacker.id && !entry.parent_object_id && placementsHostile(entry, attacker) && feetBetween(scene, attacker, entry) <= 5);
    const fallen = await deadCreatures(q, campaignId, near.map(entry => entry.character_id));
    let sight: SceneSight | null = null;
    for (const entry of near) {
      if (fallen.has(entry.character_id)) continue;
      if (incapacitatedReason(await loadConditionState(q, campaignId, entry.character_id))) continue;
      sight ??= await sceneSight(q, campaignId, await getScene(q, campaignId, sceneId, false), placements);
      if (!(await seesCreature(q, campaignId, sight, entry, attacker))) continue;
      disadvantages.push(`враг рядом: ${entry.name}`);
      break;
    }
  }

  let cover: Cover = 'none';
  const opportune = mode.kind === 'weapon' && mode.ignoreRange === true;
  if (!opportune) {
    const coverRule = (await campaignFlag(q, campaignId, 'cover')) !== false;
    const computed = await wallCover(q, campaignId, sceneId, scene, placements, attacker, target, coverRule);
    if (computed === 'total') reject(400, `«${target.name}» за полным укрытием — его не выбрать целью.`);
    cover = coverRule ? computed : 'none';
  }

  const advantages: string[] = [];
  if (!ranged && distance <= 5 && (await campaignFlag(q, campaignId, 'flanking')) === true) {
    const flanked = await flankingAdvantage(q, campaignId, scene, placements, attacker, target);
    if (flanked) advantages.push(flanked);
  }
  return { distance, ranged, disadvantages, advantages, cover, acBonus: COVER_AC[cover] };
}

export function attacksPerActionOf(row: { attacks_per_action?: number | null; class_name?: string | null; sheet_extra?: unknown; level?: number | null }) {
  return row.attacks_per_action ?? attacksForClasses(characterClassLevels(row).classes);
}

export async function attacksPerActionFor(q: Queryable, campaignId: string, characterId: string) {
  const row = (
    await q.query('SELECT attacks_per_action, class_name, sheet_extra, level FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])
  ).rows[0] as any;
  return row ? attacksPerActionOf(row) : 1;
}
