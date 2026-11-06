import { shieldMasterBonus, hasEvasion, shieldMasterDodge } from '../../rules/class-features.ts';
import type { LegendaryOption } from '../../../../../packages/domain/character/class-features.ts';
import { pathBlocked } from '../../../../../packages/domain/map/blockers.ts';
import { reachablePositions, positionOf, centerOf } from '../../../../../packages/domain/map/pathfinding.ts';
import { deadCreatures } from '../combat/loot-routes.ts';
import { placementFactions, placementsHostile, placementsAllied, relationsFor } from '../../campaign/factions.ts';
import { type MultiattackStep, legendaryAttack, legendaryArea, legendaryMove, type LegendaryArea } from '../../../../../packages/domain/combat/multiattack.ts';
import type { Notice } from '../scene/scene-triggers.ts';
import { addCondition, loadConditionState } from '../../rules/conditions.ts';
import { incapacitatedReason } from '../../../../../packages/domain/combat/conditions.ts';
import { insertChatMessage } from '../../campaign/chat-routes.ts';
import { parseFormula, rollDice } from '../../../../../packages/domain/dice/dice.ts';
import { occupiedCells } from '../../../../../packages/domain/map/footprint.ts';

import { type AutoOption, autoOptions, averageDamage } from './planner.ts';
import { weaponReaches } from '../combat/attack.ts';
import { announceHpChange, applyHpChange } from '../combat/hp.ts';
import type { TableContext } from '../context.ts';
import { notify, notifyCampaign } from '../live/notify.ts';
import { rollSaveAgainst } from '../rolls/checks.ts';
import { campaignFlag, insertRoll, rollDie } from '../rolls/dice.ts';
import { rollCheckAs } from '../rolls/roll-check.ts';
import { feetBetween, getScene } from '../scene/board.ts';
import { creatureCells, diagonalRule, movementGrid, movementRules } from '../scene/movement.ts';
import { loadPlacements } from '../scene/placements.ts';
import type { Placement } from '../shared.ts';

export async function legendaryPlan(ctx: TableContext, campaignId: string, sceneId: string, bossId: string, step: MultiattackStep, preferred: string[], weapons: AutoOption[]) {
  const { db } = ctx;
  const scene = await getScene(db, campaignId, sceneId, false);
  const placements = await loadPlacements(db, campaignId, sceneId);
  const boss = placements.find(entry => entry.character_id === bossId && !entry.parent_object_id);
  if (!boss || !placementFactions(boss).length) return null;
  const foes = placements.filter(entry => !entry.parent_object_id && placementsHostile(entry, boss));
  const fallen = await deadCreatures(db, campaignId, foes.map(entry => entry.character_id));
  const hp = new Map(
    (await db.query('SELECT id, hp_current FROM characters WHERE campaign_id=$1 AND id = ANY($2::uuid[])', [campaignId, foes.map(entry => entry.character_id)]))
      .rows.map(row => [row.id as string, Number(row.hp_current ?? 0)]),
  );
  const walls = (await movementGrid(db, campaignId, scene, entry => entry.character_id === bossId, boss.size, await diagonalRule(db, campaignId))).edges;
  const alive = foes
    .filter(entry => !fallen.has(entry.character_id) && (hp.get(entry.character_id) ?? 0) > 0)
    .filter(entry => !pathBlocked({ x: boss.world_x, z: boss.world_z }, { x: entry.world_x, z: entry.world_z }, walls))
    .sort((a, b) => {
      const rank = (entry: Placement) => (preferred.includes(entry.character_id) ? preferred.indexOf(entry.character_id) : preferred.length);
      return rank(a) - rank(b) || feetBetween(scene, boss, a) - feetBetween(scene, boss, b);
    });
  const candidates = step.weaponId
    ? weapons.filter(option => option.id === step.weaponId)
    : [...weapons].sort((a, b) => b.expected - a.expected);
  for (const target of alive) {
    const weapon = candidates.find(option => weaponReaches(option.weapon, feetBetween(scene, boss, target), step.mode));
    if (weapon) return { weapon, target };
  }
  return null;
}

export async function legendaryStrike(
  ctx: TableContext, campaignId: string, sceneId: string, bossId: string, option: LegendaryOption, preferred: string[],
): Promise<{ summary: string; attacks?: any[]; targets?: any[]; moved?: unknown } | null> {
  const { db } = ctx;
  const weapons = (await autoOptions(db, campaignId, bossId)).filter(entry => entry.kind === 'weapon');
  const step = legendaryAttack(option, weapons.map(entry => ({ id: entry.id, name: entry.name, kind: entry.weapon.weapon_kind === 'ranged' ? 'ranged' : 'melee' })));
  if (!step || !weapons.length) {
    const area = legendaryArea(option);
    if (area) return legendaryBlast(ctx, campaignId, sceneId, bossId, option, area);
    const move = legendaryMove(option);
    if (move) return legendaryStep(ctx, campaignId, sceneId, bossId, move.fraction, preferred, weapons);
    return null;
  }
  const owner = (await db.query('SELECT owner_user_id FROM campaigns WHERE id=$1', [campaignId])).rows[0]?.owner_user_id as string;
  const attacks: any[] = [];
  let wanted = preferred;
  for (let index = 0; index < step.count; index += 1) {
    const plan = await legendaryPlan(ctx, campaignId, sceneId, bossId, step, wanted, weapons);
    if (!plan) break;
    const done = await rollCheckAs(ctx, owner, campaignId, {
      characterId: bossId, kind: 'attack', key: plan.weapon.id, targetCharacterId: plan.target.character_id, sceneId,
    }, { free: true });
    attacks.push({ ...done, victimName: plan.target.name, weaponName: plan.weapon.name });
    wanted = [plan.target.character_id, ...wanted];
  }
  const summary = attacks.length
    ? attacks.map(done => `${done.weaponName} → «${done.victimName}»: ${(done as any).outcome?.hit ? `попадание${(done as any).damage ? ` ${(done as any).damage.applied}` : ''}` : 'промах'}`).join(', ')
    : 'никого в досягаемости';
  return { summary, attacks };
}

export async function legendaryBlast(ctx: TableContext, campaignId: string, sceneId: string, bossId: string, option: LegendaryOption, area: LegendaryArea) {
  const { db } = ctx;
  const owner = (await db.query('SELECT owner_user_id FROM campaigns WHERE id=$1', [campaignId])).rows[0]?.owner_user_id as string;
  const changes: Array<{ id: string; change: any }> = [];
  const short = ({ strength: 'СИЛ', dexterity: 'ЛОВ', constitution: 'ТЕЛ', intelligence: 'ИНТ', wisdom: 'МДР', charisma: 'ХАР' } as Record<string, string>)[area.ability];
  const result = await db.transaction(async q => {
    const scene = await getScene(q, campaignId, sceneId, false);
    const placements = await loadPlacements(q, campaignId, sceneId);
    const boss = placements.find(entry => entry.character_id === bossId && !entry.parent_object_id);
    if (!boss) return null;
    const caught = placements.filter(entry => !entry.parent_object_id && entry.kind !== 'object' && entry.character_id !== bossId && feetBetween(scene, boss, entry) <= area.radiusFeet);
    const fallen = await deadCreatures(q, campaignId, caught.map(entry => entry.character_id));
    const parsed = area.damage ? parseFormula(area.damage) : null;
    const rolled = parsed ? rollDice(parsed, rollDie) : null;
    const targets: Array<{ id: string; name: string; applied: number; dropped: boolean }> = [];
    const parts: string[] = [];
    for (const victim of caught) {
      if (fallen.has(victim.character_id)) continue;
      const lone = caught.filter(entry => !fallen.has(entry.character_id)).length === 1 && area.ability === 'dexterity';
      const save = await rollSaveAgainst(
        ctx, q, campaignId, owner, victim.character_id, area.ability, area.dc, `Спасбросок ${short} (СЛ ${area.dc}) против «${option.name}» — ${victim.name}`.slice(0, 100), false,
        lone ? await shieldMasterBonus(q, campaignId, victim.character_id) : null,
      );
      const evades = area.ability === 'dexterity' && area.half && (await hasEvasion(q, campaignId, victim.character_id));
      const full = rolled ? Math.max(0, rolled.total) : 0;
      const shielded = save.success && !evades && area.ability === 'dexterity' && area.half && full > 0 && (await shieldMasterDodge(q, campaignId, victim.character_id));
      const amount = evades ? (save.success ? 0 : Math.floor(full / 2)) : shielded ? 0 : save.success ? (area.half ? Math.floor(full / 2) : 0) : full;
      let applied = 0;
      let dropped = false;
      if (amount > 0) {
        const change = await applyHpChange(ctx, q, campaignId, owner, victim.character_id, { mode: 'damage', amount, damageType: area.damageType, critical: false });
        changes.push({ id: victim.character_id, change });
        applied = change.applied;
        dropped = change.dropped;
      }
      if (!save.success && area.prone) await addCondition(q, campaignId, victim.character_id, 'prone', { source: 'apply', sourceCharacterId: bossId, sourceName: option.name });
      targets.push({ id: victim.character_id, name: victim.name, applied, dropped });
      parts.push(`«${victim.name}» ${save.success ? 'устоял' : 'провал'}${applied ? `, ${applied} урона` : ''}${!save.success && area.prone ? ', сбит с ног' : ''}`);
    }
    if (rolled) {
      await insertRoll(
        q, campaignId, owner, bossId, `${option.name} — ${boss.name}`.slice(0, 100), area.damage!.slice(0, 20), rolled.results, parsed!.modifier, rolled.total, false, null,
        { kind: 'damage', damageType: area.damageType, dc: area.dc, targets },
      );
    }
    return { summary: parts.length ? parts.join(', ') : `никого в ${area.radiusFeet} фт.`, targets };
  });
  void notifyCampaign(ctx, campaignId, { type: 'rolls' });
  for (const entry of changes) announceHpChange(ctx, campaignId, entry.id, 'damage', entry.change);
  if (result?.targets.length) {
    void notifyCampaign(ctx, campaignId, { type: 'changed' });
    void notify(ctx, campaignId, sceneId);
  }
  return result;
}

export async function legendaryStep(ctx: TableContext, campaignId: string, sceneId: string, bossId: string, fraction: number, preferred: string[], weapons: AutoOption[]) {
  const { db, triggers } = ctx;
  const owner = (await db.query('SELECT owner_user_id FROM campaigns WHERE id=$1', [campaignId])).rows[0]?.owner_user_id as string;
  let notices: Notice[] = [];
  const result = await db.transaction(async q => {
    const scene: any = await getScene(q, campaignId, sceneId, true);
    const placements = await loadPlacements(q, campaignId, sceneId);
    const boss = placements.find(entry => entry.character_id === bossId && !entry.parent_object_id);
    if (!boss || !placementFactions(boss).length) return null;
    const foes = placements.filter(entry => !entry.parent_object_id && placementsHostile(entry, boss));
    const fallen = await deadCreatures(q, campaignId, foes.map(entry => entry.character_id));
    const alive = foes.filter(entry => !fallen.has(entry.character_id))
      .sort((a, b) => {
        const rank = (entry: Placement) => (preferred.includes(entry.character_id) ? preferred.indexOf(entry.character_id) : preferred.length);
        return rank(a) - rank(b) || feetBetween(scene, boss, a) - feetBetween(scene, boss, b);
      });
    const target = alive[0];
    if (!target) return { summary: 'врагов нет', moved: null };
    const reach = Math.max(5, ...weapons.filter(entry => entry.weapon.weapon_kind !== 'ranged').map(entry => entry.reach));
    if (feetBetween(scene, boss, target) <= reach) return { summary: `уже рядом с «${target.name}»`, moved: null };
    const rules = await movementRules(q, campaignId, scene, bossId);
    const budget = rules.speed.feet * fraction;
    if (budget <= 0) return { summary: 'не может двигаться', moved: null };
    const grid = rules.grid;
    const occupied = (await creatureCells(q, campaignId, scene, boss.id)) ?? new Set<string>();
    const from = { x: boss.world_x, z: boss.world_z };
    let best: { to: { x: number; z: number }; strike: boolean; distance: number; cost: number } | null = null;
    for (const [, { cell, cost }] of reachablePositions(grid, positionOf(grid, from.x, from.z), budget / rules.feetPerCell)) {
      if (cost === 0) continue;
      const to = centerOf(grid, cell);
      if (occupiedCells(scene, to.x, to.z, grid.size).some(part => occupied.has(`${part.col}:${part.row}`))) continue;
      const distance = feetBetween(scene, { ...boss, world_x: to.x, world_z: to.z }, target);
      const strike = distance <= reach && !pathBlocked(to, { x: target.world_x, z: target.world_z }, grid.edges);
      const better = !best || (strike && !best.strike)
        || (strike === best.strike && (strike ? cost < best.cost - 1e-9 : distance < best.distance - 1e-9 || (Math.abs(distance - best.distance) < 1e-9 && cost < best.cost)));
      if (better) best = { to, strike, distance, cost };
    }
    if (!best || best.distance >= feetBetween(scene, boss, target) - 1e-9) return { summary: 'некуда подойти', moved: null };
    await q.query('UPDATE scene_objects SET x=$3, z=$4, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, boss.id, best.to.x, best.to.z]);
    await q.query('UPDATE scenes SET revision=revision+1 WHERE id=$1', [sceneId]);
    notices = await triggers.fireEnter(q, campaignId, scene, owner, { characterId: bossId, name: boss.name, size: boss.size }, from, best.to);
    return { summary: `подходит к «${target.name}»${best.strike ? ' — теперь достаёт' : ''}`, moved: { from, to: best.to } };
  });
  if (result?.moved) void notify(ctx, campaignId, sceneId);
  triggers.send(campaignId, notices);
  return result;
}

export async function legendaryValue(ctx: TableContext, campaignId: string, sceneId: string, bossId: string, option: LegendaryOption, foes: string[], weapons: AutoOption[]) {
  const { db } = ctx;
  const kinds = weapons.map(entry => ({ id: entry.id, name: entry.name, kind: (entry.weapon.weapon_kind === 'ranged' ? 'ranged' : 'melee') as 'ranged' | 'melee' }));
  const step = legendaryAttack(option, kinds);
  if (step && weapons.length) {
    const plan = await legendaryPlan(ctx, campaignId, sceneId, bossId, step, foes, weapons);
    return plan ? step.count * Math.max(0.1, plan.weapon.expected) : null;
  }
  const area = legendaryArea(option);
  if (area) {
    const scene = await getScene(db, campaignId, sceneId, false);
    const placements = await loadPlacements(db, campaignId, sceneId);
    const boss = placements.find(entry => entry.character_id === bossId && !entry.parent_object_id);
    if (!boss || !placementFactions(boss).length) return null;
    const near = placements.filter(entry => !entry.parent_object_id && entry.kind !== 'object' && entry.character_id !== bossId && feetBetween(scene, boss, entry) <= area.radiusFeet);
    const fallen = await deadCreatures(db, campaignId, near.map(entry => entry.character_id));
    const living = near.filter(entry => !fallen.has(entry.character_id));
    if (living.some(entry => placementsAllied(entry, boss))) return null;
    const enemies = living.filter(entry => placementsHostile(entry, boss)).length;
    return enemies ? enemies * (averageDamage(area.damage) * 0.6 + (area.prone ? 1 : 0)) : null;
  }
  if (legendaryMove(option)) {
    const attack = await Promise.all((weapons.length ? [{ weaponId: null, mode: 'any' as const, count: 1 }] : []).map(entry => legendaryPlan(ctx, campaignId, sceneId, bossId, entry, foes, weapons)));
    return weapons.length && !attack.some(Boolean) ? 0.05 : null;
  }
  return null;
}

export async function autoLegendary(ctx: TableContext, campaignId: string, sceneId: string, endedIds: string[], startedIds: string[] = []) {
  const { db } = ctx;
  if (!endedIds.length || (await campaignFlag(db, campaignId, 'auto_legendary')) === false) return;
  const bosses = (
    await db.query(
      `SELECT ie.id AS entry_id, ie.legendary_used, c.id, c.name, c.kind, c.disposition, c.legendary_actions, c.legendary_options, c.hp_current
         FROM initiative_entries ie JOIN characters c ON c.campaign_id = ie.campaign_id AND c.id = ie.character_id
         WHERE ie.campaign_id=$1 AND ie.scene_id=$2 AND (NOT ie.is_current OR c.id = ANY($3::uuid[])) AND c.kind='npc'
           AND c.legendary_actions > 0 AND ie.legendary_used < c.legendary_actions`,
      [campaignId, sceneId, startedIds],
    )
  ).rows as any[];
  if (!bosses.length) return;
  const sides = await relationsFor(db, campaignId, [...endedIds, ...bosses.map(boss => boss.id as string)]);
  for (const boss of bosses) {
    if (endedIds.includes(boss.id) || Number(boss.hp_current ?? 0) <= 0) continue;
    const foes = endedIds.filter(id => sides.enemies(id, boss.id));
    if (!sides.factionsOf(boss.id).length || !foes.length) continue;
    if (incapacitatedReason(await loadConditionState(db, campaignId, boss.id))) continue;
    const left = Number(boss.legendary_actions) - Number(boss.legendary_used ?? 0);
    const weapons = (await autoOptions(db, campaignId, boss.id)).filter(entry => entry.kind === 'weapon');
    const valued: Array<{ option: LegendaryOption; value: number }> = [];
    for (const option of (boss.legendary_options ?? []) as LegendaryOption[]) {
      if (option.cost > left) continue;
      const value = await legendaryValue(ctx, campaignId, sceneId, boss.id, option, foes, weapons);
      if (value !== null) valued.push({ option, value });
    }
    const choices = valued.sort((a, b) => b.value / b.option.cost - a.value / a.option.cost || b.value - a.value || a.option.cost - b.option.cost);
    for (const choice of choices) {
      const message = await db.transaction(async q => {
        const spent = (
          await q.query(
            `UPDATE initiative_entries ie SET legendary_used = legendary_used + $2
               FROM characters c WHERE ie.id=$1 AND c.campaign_id = ie.campaign_id AND c.id = ie.character_id
                 AND ie.legendary_used + $2 <= c.legendary_actions RETURNING ie.id`,
            [boss.entry_id, choice.option.cost],
          )
        ).rows[0];
        if (!spent) return null;
        const owner = (await q.query('SELECT owner_user_id FROM campaigns WHERE id=$1', [campaignId])).rows[0]?.owner_user_id as string;
        const cost = choice.option.cost > 1 ? ` (стоит ${choice.option.cost})` : '';
        return insertChatMessage(q, campaignId, owner, {
          characterId: boss.id, body: `Легендарное действие: ${choice.option.name}${cost}${choice.option.text ? ` — ${choice.option.text}` : ''}`,
        });
      });
      if (!message) break;
      void notifyCampaign(ctx, campaignId, { type: 'initiative', sceneId });
      void notifyCampaign(ctx, campaignId, { type: 'chat', message });
      void notifyCampaign(ctx, campaignId, { type: 'float', characterId: boss.id, text: choice.option.name, tone: 'crit' });
      const strike = await legendaryStrike(ctx, campaignId, sceneId, boss.id, choice.option, foes);
      void notifyCampaign(ctx, campaignId, { type: 'notice', title: `${boss.name}: «${choice.option.name}»`, detail: `Легендарное действие — ${strike?.summary ?? 'никого в досягаемости'}.`, tone: 'info' });
      if (startedIds.includes(boss.id)) await db.query('UPDATE initiative_entries SET legendary_used=0 WHERE id=$1', [boss.entry_id]);
      break;
    }
  }
}
