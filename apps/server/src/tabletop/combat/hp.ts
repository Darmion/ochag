import type { Queryable } from '../../db.ts';
import { revertWildShape, bossPhaseNotices, classResourceOf, shieldMasterBonus, hasEvasion, shieldMasterDodge } from '../../rules/class-features.ts';
import { hasFeat } from '../../../../../packages/domain/character/feats.ts';
import { classFeaturesFor, RAGE_RESISTANCES, knownFiendishResilience, emptyBodyResists, knownDefensiveTactics, INITIATIVE_REFILLS, RELENTLESS_RAGE_MAX, relentlessRageDc } from '../../../../../packages/domain/character/class-features.ts';
import { type ExperienceEvent, announceExperience } from '../../characters/experience.ts';
import { characterClassLevels } from '../../../../../packages/domain/character/classes.ts';
import { damageDefense } from '../../../../../packages/domain/spells/spell-mods.ts';
import { recordCombatEvent } from './combat-events.ts';
import { touches as templateTouches } from '../scene/scene-templates.ts';
import { type Notice as ConditionNotice, loadConditionState, addCondition } from '../../rules/conditions.ts';
import { raceResistances, hasRaceTrait, characterRace } from '../../../../../packages/domain/character/races.ts';
import { parseExpression, rollExpression } from '../../../../../packages/domain/dice/expression.ts';

import { areaCoverBonus, areaCovers } from './cover.ts';
import { type TableContext, withTable } from '../context.ts';
import { notifyCampaign, notifyManagers } from '../live/notify.ts';
import { rollSaveAgainst } from '../rolls/checks.ts';
import { insertRoll, rollDie } from '../rolls/dice.ts';
import { getScene } from '../scene/board.ts';
import { loadPlacements } from '../scene/placements.ts';
import { reject } from '../shared.ts';
import { spellModsFor } from '../spells/rules.ts';

export type HpChangeResult = {
  row: any; applied: number; blocked: 'immune' | 'threshold' | 'dead' | 'no_healing' | null; modified: 'resisted' | 'vulnerable' | null;
  notices: ConditionNotice[]; name: string; experience: ExperienceEvent | null; dropped: boolean;
};

export async function applyHpChange(
  ctx: TableContext, q: Queryable, campaignId: string, userId: string, characterId: string,
  change: { mode: 'damage' | 'heal'; amount: number; damageType: string | null; critical: boolean; ignoreResistance?: boolean; ignoreImmunity?: boolean; sourceId?: string | null; magical?: boolean; bond?: boolean },
  depth = 0,
): Promise<HpChangeResult> {
  const { conditionEngine, experience } = ctx;
  const character = (
    await q.query(
      `SELECT id, name, kind, owner_user_id, hp_current, hp_max, hp_temp, damage_threshold,
                damage_resistances, damage_immunities, damage_vulnerabilities, boss_phases,
                level, class_name, sheet_extra, charisma
         FROM characters WHERE campaign_id=$1 AND id=$2 FOR UPDATE`,
      [campaignId, characterId],
    )
  ).rows[0] as any;
  if (!character) reject(404, 'Персонаж не найден.');

  const { mode, damageType } = change;
  let amount = Math.max(0, change.amount);
  let blocked: 'immune' | 'threshold' | 'dead' | 'no_healing' | null = null;
  let modified: 'resisted' | 'vulnerable' | null = null;
  const targetState = await loadConditionState(q, campaignId, characterId);
  const list = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);

  const templatedDefense = mode === 'damage' && targetState.codes.has('spell_mod')
    ? damageDefense(await spellModsFor(q, campaignId, characterId), damageType, Boolean(change.magical)) : null;
  if (mode === 'damage') {
    const immune = (!change.ignoreImmunity && Boolean(templatedDefense?.immune)) || !change.ignoreImmunity && damageType !== null && (
      list(character.damage_immunities).includes(damageType) ||
      (character.kind === 'object' && OBJECT_IMMUNITIES.has(damageType)) ||
      (damageType === 'poison' && character.kind !== 'object' && classFeaturesFor(characterClassLevels(character).classes).some(feature => feature.id === 'purity-of-body' || feature.id === 'natures-ward'))
    );
    if (immune) {
      blocked = 'immune';
    } else {
      const raging = targetState.codes.has('raging') && damageType !== null && RAGE_RESISTANCES.includes(damageType);
      const fiendish = damageType !== null && character.kind !== 'object' && knownFiendishResilience(character.sheet_extra).includes(damageType)
        && classFeaturesFor(characterClassLevels(character).classes).some(feature => feature.id === 'fiendish-resilience');
      const emptyBody = targetState.codes.has('empty_body') && emptyBodyResists(damageType);
      const warded = damageType !== null && targetState.codes.has('energy_ward') && Boolean((await q.query(
        `SELECT 1 FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code='energy_ward' AND parameters->>'damageType' = $3 LIMIT 1`,
        [campaignId, characterId, damageType],
      )).rows[0]);
      const stoneskin = targetState.codes.has('stoneskin') && !change.magical && damageType !== null && ['bludgeoning', 'piercing', 'slashing'].includes(damageType);
      const bonded = targetState.codes.has('warding_bond');
      const resisted = !change.ignoreResistance && (targetState.codes.has('petrified') || raging || fiendish || emptyBody || warded || stoneskin || bonded || Boolean(templatedDefense?.resisted) || (damageType !== null && (
        list(character.damage_resistances).includes(damageType) || (character.kind !== 'object' && raceResistances(character).includes(damageType))
      )));
      const vulnerable = Boolean(templatedDefense?.vulnerable) || (damageType !== null && list(character.damage_vulnerabilities).includes(damageType));
      if (resisted) amount = Math.floor(amount / 2);
      if (character.kind !== 'object' && damageType !== null && ['bludgeoning', 'piercing', 'slashing'].includes(damageType) && hasFeat(character.sheet_extra, 'heavy-armor-master')) {
        amount = Math.max(0, amount - 3);
      }
      if (vulnerable) amount *= 2;
      modified = resisted && !vulnerable ? 'resisted' : vulnerable && !resisted ? 'vulnerable' : null;
      if (character.damage_threshold !== null && amount < character.damage_threshold) blocked = 'threshold';
    }
    if (blocked) amount = 0;
    if (amount > 0 && targetState.codes.has('raging')) await keepRage(q, campaignId, characterId);
  } else if (targetState.codes.has('dead')) {
    amount = 0;
    blocked = 'dead';
  } else if (targetState.codes.has('no_healing')) {
    amount = 0;
    blocked = 'no_healing';
  }

  let hpCurrent = character.hp_current;
  let hpTemp = character.hp_temp;
  let toHp = 0;
  if (mode === 'damage') {
    const fromTemp = Math.min(hpTemp, amount);
    hpTemp -= fromTemp;
    toHp = amount - fromTemp;
    hpCurrent = Math.max(0, hpCurrent - toHp);
  } else {
    const ceiling = targetState.exhaustion >= 4 ? Math.floor(character.hp_max / 2) : character.hp_max;
    hpCurrent = Math.max(hpCurrent, Math.min(ceiling, hpCurrent + amount));
  }

  const heldNotices: ConditionNotice[] = [];
  if (mode === 'damage' && hpCurrent === 0 && character.hp_current > 0 && character.kind !== 'object'
    && !targetState.codes.has('wild_shape') && !targetState.codes.has('dead') && toHp - character.hp_current < character.hp_max) {
    const held = await holdOnAtZero(ctx, q, campaignId, userId, character, targetState.codes.has('raging'));
    if (held) {
      hpCurrent = 1;
      heldNotices.push(held);
    }
  }

  if (mode === 'damage' && hpCurrent === 0 && character.hp_current > 0 && targetState.codes.has('wild_shape')) {
    const overflow = Math.max(0, toHp - character.hp_current);
    const back = await revertWildShape(q, campaignId, characterId, 0);
    const notice = { title: `${character.name} снова в своём облике`, detail: `${back?.beastName ?? 'Зверь'} повержен${overflow ? ` — ${overflow} урона переходит` : ''}.`, characterId };
    if (overflow > 0) {
      const rest = await applyHpChange(ctx, q, campaignId, userId, characterId, { mode: 'damage', amount: overflow, damageType: null, critical: change.critical }, depth + 1);
      return { ...rest, applied: amount, blocked, modified, notices: [notice, ...rest.notices] };
    }
    const row = (await q.query('SELECT id, hp_current, hp_temp, revision FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0];
    return { row, applied: amount, blocked, modified, notices: [notice], name: character.name as string, experience: null, dropped: false };
  }

  const row = (
    await q.query(
      `UPDATE characters SET hp_current=$1, hp_temp=$2, revision=revision+1
         WHERE campaign_id=$3 AND id=$4
         RETURNING id, hp_current, hp_temp, revision`,
      [hpCurrent, hpTemp, campaignId, characterId],
    )
  ).rows[0];

  const slayer = mode === 'damage' && change.sourceId && targetState.codes.has('concentration')
    && hasFeat((await q.query('SELECT sheet_extra FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, change.sourceId])).rows[0]?.sheet_extra, 'mage-slayer');
  const notices = await conditionEngine.afterHpChange(q, campaignId, userId, character, {
    mode, before: character.hp_current, after: hpCurrent, amount, toHp, critical: change.critical,
    ...(slayer ? { concentrationDisadvantages: ['убийца магов'] } : {}),
  });
  notices.unshift(...heldNotices);
  if (mode === 'damage') notices.push(...await bossPhaseNotices(q, campaignId, character, character.hp_current, hpCurrent));
  let experienceEvent: ExperienceEvent | null = null;
  if (mode === 'damage' && character.kind === 'npc' && character.hp_current > 0 && hpCurrent === 0) {
    experienceEvent = await experience.awardForDefeat(q, campaignId, characterId);
  }
  const dropped = mode === 'damage' && character.hp_current > 0 && hpCurrent === 0;
  if (mode === 'damage' && character.kind === 'object' && change.amount > 0 && blocked !== 'immune') {
    notices.push(...await hazardBlast(ctx, q, campaignId, userId, characterId, character.name, damageType, depth));
  }
  if (mode === 'damage' && amount > 0 && !change.bond && depth < 4 && targetState.codes.has('warding_bond')) {
    const bonds = (await q.query(
      `SELECT DISTINCT parameters->>'sourceCharacterId' AS caster FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code='warding_bond'`,
      [campaignId, characterId],
    )).rows.map(entry => entry.caster as string | null).filter((caster): caster is string => Boolean(caster) && caster !== characterId);
    for (const caster of bonds) {
      const echo = await applyHpChange(ctx, q, campaignId, userId, caster, { mode: 'damage', amount, damageType: null, critical: false, bond: true }, depth + 1);
      notices.push({ title: `«Охраняющая связь»: ${echo.name}`, detail: `Тот же урон — ${echo.applied}.`, characterId: caster }, ...echo.notices);
      if (echo.row?.hp_current === 0) {
        await q.query(`DELETE FROM character_effects WHERE campaign_id=$1 AND effect_code='warding_bond' AND parameters->>'sourceCharacterId' = $2`, [campaignId, caster]);
      }
    }
  }
  return { row, applied: amount, blocked, modified, notices, name: character.name as string, experience: experienceEvent, dropped };
}

export async function hunterTactic(q: Queryable, campaignId: string, characterId: string, tactic: string): Promise<boolean> {
  const row = (await q.query('SELECT level, class_name, sheet_extra FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0] as any;
  return Boolean(row) && knownDefensiveTactics(row.sheet_extra).includes(tactic)
    && classFeaturesFor(characterClassLevels(row).classes).some(feature => feature.id === 'defensive-tactics');
}
export async function multiattackGuard(q: Queryable, campaignId: string, targetId: string, attackerId: string): Promise<number> {
  const row = (await q.query(
    `SELECT 1 FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='multiattack_defense' AND active AND parameters->>'from' = $3 LIMIT 1`,
    [campaignId, targetId, attackerId],
  )).rows[0];
  return row ? 4 : 0;
}
export async function guardAfterHit(q: Queryable, campaignId: string, sceneId: string | null, targetId: string, attackerId: string) {
  if (!(await hunterTactic(q, campaignId, targetId, 'multiattack-defense')) || await multiattackGuard(q, campaignId, targetId, attackerId)) return;
  const current = sceneId
    ? (await q.query(
      'SELECT character_id FROM initiative_entries WHERE campaign_id=$1 AND scene_id=$2 AND is_current ORDER BY (character_id = $3) DESC LIMIT 1',
      [campaignId, sceneId, attackerId],
    )).rows[0]?.character_id as string | undefined
    : undefined;
  await addCondition(q, campaignId, targetId, 'multiattack_defense', {
    source: 'feature', sourceName: 'Защита от мультиатаки', from: attackerId, expires: { at: 'end', of: current ?? attackerId },
  });
}

export async function keepRage(q: Queryable, campaignId: string, characterId: string) {
  await q.query(
    `UPDATE character_effects SET parameters = COALESCE(parameters, '{}'::jsonb) || '{"kept": true}'::jsonb
       WHERE campaign_id=$1 AND character_id=$2 AND effect_code='raging' AND active`,
    [campaignId, characterId],
  );
}

export async function initiativeRefill(q: Queryable, campaignId: string, character: any): Promise<string[]> {
  const features = classFeaturesFor(characterClassLevels(character).classes);
  const notes: string[] = [];
  for (const refill of INITIATIVE_REFILLS) {
    if (!features.some(feature => feature.id === refill.feature)) continue;
    const resource = await classResourceOf(q, campaignId, character, refill.resource, false);
    if (!resource?.id || Number(resource.current) > 0) continue;
    await q.query('UPDATE character_resources SET current=LEAST(max, $2) WHERE id=$1', [resource.id, refill.amount]);
    notes.push(refill.note);
  }
  return notes;
}
export const withNotes = (outcome: any, notes: string[]) => (
  notes.length ? { kind: 'initiative', advantage: outcome?.advantage ?? 'none', ...(outcome ?? {}), reasons: [...(outcome?.reasons ?? []), ...notes] } : outcome
);

export async function holdOnAtZero(ctx: TableContext, q: Queryable, campaignId: string, userId: string, character: any, raging: boolean): Promise<ConditionNotice | null> {
  const ward = (await q.query(
    `DELETE FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code='death_ward' RETURNING id`, [campaignId, character.id],
  )).rows[0];
  if (ward) return { title: `${character.name}: «Защита от смерти»`, detail: 'Хиты упали бы до 0 — остаётся 1 хит, защита кончилась.', characterId: character.id };
  const classes = characterClassLevels(character).classes;
  if (raging && classFeaturesFor(classes).some(feature => feature.id === 'relentless-rage')) {
    const resource = await classResourceOf(q, campaignId, character, 'Непреклонная ярость', true);
    const left = resource ? Number(resource.current) : RELENTLESS_RAGE_MAX;
    const dc = relentlessRageDc(RELENTLESS_RAGE_MAX - left);
    if (resource && left > 0) await q.query('UPDATE character_resources SET current=current-1 WHERE id=$1', [resource.id]);
    const save = await rollSaveAgainst(ctx, q, campaignId, userId, character.id, 'constitution', dc, `Непреклонная ярость (СЛ ${dc}) — ${character.name}`.slice(0, 100), false);
    if (save.success) {
      return { title: `${character.name}: «Непреклонная ярость»`, detail: `Спасбросок ТЕЛ ${save.total} против СЛ ${dc} — держится на 1 хите. Следующий раз до отдыха — СЛ ${dc + 5}.`, characterId: character.id };
    }
  }
  if (hasRaceTrait(characterRace(character), 'relentless-endurance')) {
    const name = 'Непоколебимость';
    let row = (await q.query('SELECT id, current FROM character_resources WHERE campaign_id=$1 AND character_id=$2 AND name=$3 FOR UPDATE', [campaignId, character.id, name])).rows[0] as any;
    if (!row) {
      row = (await q.query(`INSERT INTO character_resources (campaign_id, character_id, name, current, max, recharge) VALUES ($1,$2,$3,1,1,'long') RETURNING id, current`, [campaignId, character.id, name])).rows[0];
    }
    if (Number(row.current) > 0) {
      await q.query('UPDATE character_resources SET current=current-1 WHERE id=$1', [row.id]);
      return { title: `${character.name}: «Непоколебимость»`, detail: 'Полуорк не падает: 1 хит. Снова — после долгого отдыха.', characterId: character.id };
    }
  }
  return null;
}

export async function hazardBlast(
  ctx: TableContext, q: Queryable, campaignId: string, userId: string, objectId: string, name: string, damageType: string | null, depth: number,
): Promise<ConditionNotice[]> {
  if (depth > 3) return [];
  const row = (await q.query('SELECT hazard FROM object_states WHERE campaign_id=$1 AND character_id=$2 FOR UPDATE', [campaignId, objectId])).rows[0];
  const hazard = row?.hazard as {
    types?: string[]; radiusFeet: number; formula: string; damageType: string; save?: string | null; dc?: number | null;
    halfOnSuccess?: boolean; message?: string | null;
  } | null;
  if (!hazard) return [];
  if (hazard.types?.length && (!damageType || !hazard.types.includes(damageType))) return [];
  await q.query('UPDATE object_states SET hazard=NULL, broken=true, locked=false WHERE campaign_id=$1 AND character_id=$2', [campaignId, objectId]);

  const where = (await q.query('SELECT scene_id FROM scene_objects WHERE campaign_id=$1 AND character_id=$2 LIMIT 1', [campaignId, objectId])).rows[0];
  if (!where) return [{ title: name, detail: hazard.message || 'Срабатывает, но никого рядом нет.' }];
  const scene = await getScene(q, campaignId, where.scene_id, false);
  const placements = await loadPlacements(q, campaignId, scene.id);
  const self = placements.find(placement => placement.character_id === objectId)!;
  const area = { shape: 'circle' as const, x: self.world_x, z: self.world_z, direction: 0, size: hazard.radiusFeet / scene.feet_per_unit };
  const covers = await areaCovers(q, campaignId, scene, { x: self.world_x, z: self.world_z }, placements);
  const caught = placements.filter(placement =>
    placement.id !== self.id && !placement.parent_object_id && covers.get(placement.character_id) !== 'total'
    && templateTouches(area, scene, { world_x: placement.world_x, world_z: placement.world_z, size: placement.size }));

  const parsed = parseExpression(hazard.formula);
  if (!parsed.ok) return [{ title: name, detail: 'Формула урона неразборчива.' }];
  const rolled = rollExpression(parsed.expression, rollDie, {});
  if (!rolled.ok) return [];
  await insertRoll(q, campaignId, userId, null, `Взрыв: ${name}`.slice(0, 100), hazard.formula.slice(0, 20), rolled.dice, rolled.modifier, rolled.total, false, rolled.groups);

  const parts: string[] = [];
  const notices: ConditionNotice[] = [];
  for (const victim of caught) {
    let amount = rolled.total;
    let saved = '';
    if (victim.kind !== 'object' && hazard.save && hazard.dc) {
      const lone = caught.filter(entry => entry.kind !== 'object').length === 1 && hazard.save === 'dexterity';
      const save = await rollSaveAgainst(
        ctx, q, campaignId, userId, victim.character_id, hazard.save, hazard.dc, `Спасбросок: ${name} — ${victim.name}`, false,
        areaCoverBonus(covers.get(victim.character_id), hazard.save) ?? (lone ? await shieldMasterBonus(q, campaignId, victim.character_id) : null),
      );
      const evades = hazard.save === 'dexterity' && hazard.halfOnSuccess !== false && (await hasEvasion(q, campaignId, victim.character_id));
      const shielded = save.success && !evades && hazard.save === 'dexterity' && hazard.halfOnSuccess !== false && (await shieldMasterDodge(q, campaignId, victim.character_id));
      if (save.success) {
        amount = hazard.halfOnSuccess === false || evades || shielded ? 0 : Math.floor(amount / 2);
        saved = shielded ? ', мастер щита' : ', спасбросок';
      } else if (evades) {
        amount = Math.floor(amount / 2);
        saved = ', увёртливость';
      }
    }
    if (amount <= 0) {
      parts.push(`${victim.name} — увернулся`);
      continue;
    }
    const hurt = await applyHpChange(ctx, q, campaignId, userId, victim.character_id, { mode: 'damage', amount, damageType: hazard.damageType, critical: false }, depth + 1);
    await recordCombatEvent(q, campaignId, { targetId: victim.character_id, kind: 'damage', amount: hurt.applied, dropped: hurt.dropped, source: 'hazard' });
    parts.push(`${victim.name} — ${hurt.applied}${saved}`);
    notices.push({ title: `${victim.name}: ${hurt.applied} урона`, detail: `${name} задевает.`, characterId: victim.character_id }, ...hurt.notices);
  }
  return [{ title: name, detail: `${hazard.message ? `${hazard.message} ` : ''}Урон ${rolled.total}: ${parts.join('; ') || 'никого рядом'}.` }, ...notices];
}

export function announceHpChange(
  ctx: TableContext, campaignId: string, characterId: string, mode: 'damage' | 'heal',
  change: {
    applied: number; blocked: string | null; modified?: string | null; critical?: boolean; notices: ConditionNotice[];
    experience?: ExperienceEvent | null;
  },
) {
  void notifyCampaign(ctx, campaignId, { type: 'changed' });
  void notifyCampaign(ctx, campaignId, { type: 'character', characterId });
  void notifyCampaign(ctx, campaignId, {
    type: 'hp', characterId, mode, amount: change.applied, blocked: change.blocked,
    modified: change.modified ?? null, critical: change.critical === true,
  });
  announceConditionNotices(ctx, campaignId, change.notices);
  if (change.experience) announceExperience(withTable(ctx, notifyCampaign), campaignId, change.experience);
}

export function announceConditionNotices(ctx: TableContext, campaignId: string, notices: ConditionNotice[]) {
  for (const notice of notices) {
    const message = { type: 'notice', title: notice.title, detail: notice.detail };
    void (notice.secret ? notifyManagers(ctx, campaignId, message) : notifyCampaign(ctx, campaignId, message));
    if (notice.characterId) void notifyCampaign(ctx, campaignId, { type: 'character', characterId: notice.characterId });
  }
}
export const OBJECT_IMMUNITIES = new Set<string>(['poison', 'psychic']);
