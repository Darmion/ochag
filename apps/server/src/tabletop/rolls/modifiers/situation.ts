import type { Queryable } from '../../../db.ts';
import { hasFeat, liveStyle, isPolearm, isHandCrossbow } from '../../../../../../packages/domain/character/feats.ts';
import type { BonusBasis } from '../../../../../../packages/domain/combat/attack-economy.ts';
import { classFeaturesFor } from '../../../../../../packages/domain/character/class-features.ts';
import { characterClassLevels } from '../../../../../../packages/domain/character/classes.ts';
import { loadConditionState } from '../../../rules/conditions.ts';
import { type ConditionState, incapacitatedReason } from '../../../../../../packages/domain/combat/conditions.ts';
import { attackSituation } from '../../combat/attack.ts';
import type { TableContext } from '../../context.ts';
import { notifyCampaign } from '../../live/notify.ts';
import { feetBetween } from '../../scene/board.ts';
import type { Placement } from '../../shared.ts';

export async function inCombat(q: Queryable, campaignId: string, characterId: string): Promise<boolean> {
  return Boolean((
    await q.query(`SELECT 1 FROM initiative_entries ie JOIN scenes s ON s.id = ie.scene_id WHERE ie.campaign_id=$1 AND ie.character_id=$2 AND s.combat_started_at IS NOT NULL LIMIT 1`, [campaignId, characterId])
  ).rows[0]);
}

export async function elusiveTarget(q: Queryable, campaignId: string, targetId: string | null | undefined, state: ConditionState | null): Promise<string | null> {
  if (!targetId) return null;
  const row = (await q.query('SELECT level, class_name FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, targetId])).rows[0];
  if (!row || !classFeaturesFor(characterClassLevels(row).classes).some(feature => feature.id === 'elusive')) return null;
  if (state && incapacitatedReason(state)) return null;
  return 'неуловимость цели';
}

export async function consumeHelp(q: Queryable, campaignId: string, actorId: string): Promise<string | null> {
  const help = (
    await q.query(
      `DELETE FROM character_effects WHERE id = (
           SELECT id FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='helped' AND active AND NOT (parameters ? 'foeId') LIMIT 1
         ) RETURNING parameters`,
      [campaignId, actorId],
    )
  ).rows[0] as { parameters: any } | undefined;
  return help ? `помощь: ${help.parameters?.sourceName ?? 'союзник'}` : null;
}

export function weaponStyles(character: any, weapon: any, options: { power?: boolean; twoHanded?: boolean; using?: string | null; bonusBasis?: BonusBasis | null }) {
  const extra = character.sheet_extra;
  const ranged = weapon?.weapon_kind === 'ranged';
  const properties: string[] = Array.isArray(weapon?.properties) ? weapon.properties.map(String) : [];
  const twoHandedGrip = properties.includes('two-handed') || Boolean(options.twoHanded && weapon?.versatile_formula);
  const reasons: string[] = [];
  let attack = 0;
  let damage = 0;
  if (ranged && liveStyle(extra, 'archery')) {
    attack += 2;
    reasons.push('стрельба +2');
  }
  const dueling = !ranged && !twoHandedGrip && options.using !== 'bonus' && liveStyle(extra, 'dueling');
  if (dueling) damage += 2;
  const greatWeapon = !ranged && twoHandedGrip && liveStyle(extra, 'great-weapon');
  const basis = options.using === 'bonus' ? options.bonusBasis ?? null : null;
  const butt = options.using === 'bonus' && (basis ? basis === 'polearm' : !ranged && isPolearm(weapon) && hasFeat(extra, 'polearm-master'));
  const crossbowBonus = options.using === 'bonus' && (basis ? basis === 'crossbow' : ranged && isHandCrossbow(weapon) && hasFeat(extra, 'crossbow-expert'));
  const offhandNoMod = options.using === 'bonus' && (basis ? basis === 'two-weapon' : !butt && !crossbowBonus) && !liveStyle(extra, 'two-weapon');
  const heavy = properties.includes('heavy') || (!properties.length && !weapon?.srd_index);
  const powerBy = !options.power ? null
    : ranged && hasFeat(extra, 'sharpshooter') ? 'меткий стрелок'
    : !ranged && heavy && hasFeat(extra, 'great-weapon-master') ? 'мастер большого оружия' : null;
  if (powerBy) {
    attack -= 5;
    damage += 10;
    reasons.push(`${powerBy}: −5 к попаданию, +10 к урону`);
  }
  if (butt) reasons.push('мастер древкового оружия: удар древком');
  if (crossbowBonus) reasons.push('эксперт по арбалетам: бонусный выстрел');
  return { attack, damage, reasons, dueling, greatWeapon, offhandNoMod, powerBy, butt };
}

export async function markTurnFlags(q: Queryable, campaignId: string, characterId: string, flags: string[]) {
  if (!flags.length) return;
  await q.query(
    `UPDATE initiative_entries SET turn_flags = ARRAY(SELECT DISTINCT flag FROM unnest(turn_flags || $3::text[]) AS flag)
       WHERE campaign_id=$1 AND character_id=$2 AND is_current`,
    [campaignId, characterId, flags],
  );
}

export function featSituation(character: any, weapon: any, situation: Awaited<ReturnType<typeof attackSituation>>, spell = false): string[] {
  if (!situation) return [];
  const extra = character.sheet_extra;
  const notes: string[] = [];
  const ignoreCover = (who: string) => {
    if (situation.cover !== 'half' && situation.cover !== 'three-quarters') return;
    situation.cover = 'none';
    situation.acBonus = 0;
    notes.push(`${who}: укрытие не мешает`);
  };
  if (!spell && weapon?.weapon_kind === 'ranged' && hasFeat(extra, 'sharpshooter')) {
    if (situation.disadvantages.includes('дальняя дистанция')) {
      situation.disadvantages = situation.disadvantages.filter(reason => reason !== 'дальняя дистанция');
      notes.push('меткий стрелок: дальняя дистанция не мешает');
    }
    ignoreCover('меткий стрелок');
  }
  if (spell && hasFeat(extra, 'spell-sniper')) ignoreCover('снайпер заклинаний');
  if (situation.ranged && hasFeat(extra, 'crossbow-expert') && situation.disadvantages.some(reason => reason.startsWith('враг рядом'))) {
    situation.disadvantages = situation.disadvantages.filter(reason => !reason.startsWith('враг рядом'));
    notes.push('эксперт по арбалетам: враг рядом не мешает');
  }
  return notes;
}

export async function alertTarget(q: Queryable, campaignId: string, targetId: string | null | undefined): Promise<boolean> {
  if (!targetId) return false;
  const row = (await q.query('SELECT sheet_extra FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, targetId])).rows[0];
  return Boolean(row && hasFeat(row.sheet_extra, 'alert'));
}

export const unseenAdvantages = (list: string[], alert: boolean) => (alert ? list.filter(reason => reason !== 'из скрытности') : list);

export async function feralSenses(q: Queryable, campaignId: string, characterId: string): Promise<boolean> {
  const row = (await q.query('SELECT level, class_name FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0];
  return Boolean(row && classFeaturesFor(characterClassLevels(row).classes).some(feature => feature.id === 'feral-senses'));
}

export const unseenDisadvantages = (list: string[], feral: boolean) => (feral ? list.filter(reason => reason !== 'цель скрыта') : list);

export async function breakCamouflage(ctx: TableContext, q: Queryable, campaignId: string, characterId: string): Promise<boolean> {
  const gone = (
    await q.query(`DELETE FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='camouflaged' RETURNING id`, [campaignId, characterId])
  ).rows.length > 0;
  if (gone) void notifyCampaign(ctx, campaignId, { type: 'character', characterId });
  return gone;
}

export async function blindsenseFinds(q: Queryable, campaignId: string, scene: any, listener: Placement, hidden: Placement): Promise<boolean> {
  const row = (await q.query('SELECT level, class_name FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, listener.character_id])).rows[0];
  if (!row || !classFeaturesFor(characterClassLevels(row).classes).some(feature => feature.id === 'blindsense')) return false;
  if ((await loadConditionState(q, campaignId, listener.character_id)).codes.has('deafened')) return false;
  return feetBetween(scene, listener, hidden) <= 10;
}

export async function savageAttackerFor(q: Queryable, campaignId: string, character: any, sceneId: string | null): Promise<boolean> {
  if (!hasFeat(character.sheet_extra, 'savage-attacker')) return false;
  const turn = (
    await q.query(
      `SELECT id, is_current, turn_flags FROM initiative_entries WHERE campaign_id=$1 AND character_id=$2 AND ($3::uuid IS NULL OR scene_id=$3)
         ORDER BY is_current DESC, created_at LIMIT 1 FOR UPDATE`,
      [campaignId, character.id, sceneId],
    )
  ).rows[0] as { id: string; is_current: boolean; turn_flags: string[] } | undefined;
  if (turn) {
    if (!turn.is_current || (turn.turn_flags ?? []).includes('savage-attacker')) return false;
    await q.query(`UPDATE initiative_entries SET turn_flags = array_append(turn_flags, 'savage-attacker') WHERE id=$1`, [turn.id]);
  }
  return true;
}
