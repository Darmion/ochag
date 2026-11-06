import type { Queryable } from '../../../db.ts';
import { type PathResult, shortestPath, positionOf } from '../../../../../../packages/domain/map/pathfinding.ts';
import { speedFrom } from '../../../../../../packages/domain/spells/spell-mods.ts';
import { loadConditionState } from '../../../rules/conditions.ts';
import { effectiveSpeed, conditionState } from '../../../../../../packages/domain/combat/conditions.ts';
import type { TableContext } from '../../context.ts';
import { notifyCampaign } from '../../live/notify.ts';
import { campaignFlag } from '../../rolls/dice.ts';
import { formatFeet } from '../board.ts';
import { reject } from '../../shared.ts';
import { spellModsFor } from '../../spells/rules.ts';
import { diagonalRule, movementGrid } from './grid.ts';
import { flightSpeed, classSpeedBonus } from './speed.ts';
import { dragFactor } from './grapple-fear.ts';

export async function movementRules(q: Queryable, campaignId: string, scene: any, characterId: string, speedFeet?: number) {
  const own = (await q.query('SELECT speed_feet::float8 AS speed_feet, size, kind, disposition FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0];
  const classBonus = await classSpeedBonus(q, campaignId, characterId);
  const slow = Number((
    await q.query(`SELECT COALESCE(SUM((parameters->>'feet')::float8), 0) AS feet FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='slowed' AND active`, [campaignId, characterId])
  ).rows[0]?.feet ?? 0);
  const walk = speedFeet ?? Number(own?.speed_feet ?? 0);
  const flying = await flightSpeed(q, campaignId, characterId, walk);
  const stride = (await q.query(`SELECT 1 FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='longstrider' AND active LIMIT 1`, [campaignId, characterId])).rows[0] ? 10 : 0;
  const tempo = new Set((await q.query(
    `SELECT effect_code FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code IN ('hasted', 'slow_spell', 'stupor', 'lethargic')`, [campaignId, characterId],
  )).rows.map(row => row.effect_code as string));
  const templatedSpeed = speedFrom(await spellModsFor(q, campaignId, characterId), Math.max(0, (flying ?? walk) + classBonus.feet + stride - slow));
  const plain = templatedSpeed.feet;
  const base = tempo.has('stupor') || tempo.has('lethargic') ? 0 : tempo.has('hasted') && !tempo.has('slow_spell') ? plain * 2 : tempo.has('slow_spell') && !tempo.has('hasted') ? Math.floor(plain / 2) : plain;
  const speed = effectiveSpeed(base, await loadConditionState(q, campaignId, characterId));
  if (slow > 0) speed.reasons.push(slow >= 1000 ? 'скорость 0: «Часовой»' : `скорость −${slow} фт.: замедлен`);
  if (stride) speed.reasons.push('скорость +10 фт.: «Скороход»');
  speed.reasons.push(...templatedSpeed.reasons);
  if (tempo.has('stupor')) speed.reasons.push('скорость 0: «Гипнотический узор»');
  else if (tempo.has('lethargic')) speed.reasons.push('скорость 0: вялость после «Ускорения»');
  else if (tempo.has('hasted') && !tempo.has('slow_spell')) speed.reasons.push('скорость вдвое: «Ускорение»');
  else if (tempo.has('slow_spell') && !tempo.has('hasted')) speed.reasons.push('скорость вдвое меньше: «Замедление»');
  speed.reasons.push(...classBonus.reasons);
  const rule = await diagonalRule(q, campaignId);
  const grid = await movementGrid(q, campaignId, scene, placement => placement.character_id === characterId, own?.size ?? null, rule, Boolean(own));
  const feetPerCell = scene.feet_per_unit * (speed.crawling ? 2 : 1);
  const routes = new Map<string, PathResult | null>();
  const route = (from: { x: number; z: number }, to: { x: number; z: number }, diagonalsBefore: number) => {
    const id = `${from.x}:${from.z}>${to.x}:${to.z}@${diagonalsBefore % 2}`;
    if (!routes.has(id)) routes.set(id, shortestPath({ ...grid, diagonalsBefore }, positionOf(grid, from.x, from.z), positionOf(grid, to.x, to.z)));
    return routes.get(id)!;
  };
  const cost = (from: { x: number; z: number }, to: { x: number; z: number }, diagonalsBefore = 0) => {
    if (from.x === to.x && from.z === to.z) return 0;
    const found = route(from, to, diagonalsBefore);
    return found ? found.cost * feetPerCell : Infinity;
  };
  const diagonals = (from: { x: number; z: number }, to: { x: number; z: number }, diagonalsBefore = 0) =>
    from.x === to.x && from.z === to.z ? 0 : route(from, to, diagonalsBefore)?.diagonals ?? 0;
  return { speed, cost, diagonals, grid, feetPerCell };
}

export async function gmFreeMove(q: Queryable, campaignId: string) {
  return (await campaignFlag(q, campaignId, 'gm_free_move')) === true;
}

export async function movementState(q: Queryable, campaignId: string, scene: any, characterId: string, lock: boolean) {
  const limit = (
    await q.query(`SELECT value FROM campaign_rules WHERE campaign_id=$1 AND kind='flag' AND key='movement_limit'`, [campaignId])
  ).rows[0];
  if (limit && limit.value !== true) return null;

  const entries = (
    await q.query(
      `SELECT ie.id, ie.character_id, ie.name, ie.is_current, ie.moved_feet::float8 AS moved_feet, ie.moved_diagonals, ie.dashes,
                c.speed_feet::float8 AS speed_feet, c.size
         FROM initiative_entries ie
         LEFT JOIN characters c ON c.campaign_id = ie.campaign_id AND c.id = ie.character_id
         WHERE ie.campaign_id=$1 AND ie.scene_id=$2
         ${lock ? 'FOR UPDATE OF ie' : ''}`,
      [campaignId, scene.id],
    )
  ).rows;

  const current = entries.find(entry => entry.is_current);
  const mine = entries.find(entry => entry.character_id === characterId);
  if (!current || !mine) return null;

  const rules = await movementRules(q, campaignId, scene, characterId, Number(mine.speed_feet ?? 0));
  const { speed } = rules;
  const budget = speed.feet * (1 + mine.dashes);
  const before = Number(mine.moved_diagonals ?? 0);
  const factor = await dragFactor(q, campaignId, scene, characterId, mine.size);
  const cost = (from: { x: number; z: number }, to: { x: number; z: number }) => rules.cost(from, to, before) * factor;
  const diagonals = (from: { x: number; z: number }, to: { x: number; z: number }) => rules.diagonals(from, to, before);
  return {
    current, mine, speed, budget, left: budget - Number(mine.moved_feet), cost, diagonals,
    grid: { ...rules.grid, diagonalsBefore: before }, feetPerCell: rules.feetPerCell * factor,
  };
}

export async function spendMovement(
  ctx: TableContext, q: Queryable, campaignId: string, scene: any, characterId: string,
  from: { x: number; z: number }, to: { x: number; z: number },
): Promise<number> {
  if (from.x === to.x && from.z === to.z) return 0;

  const state = await movementState(q, campaignId, scene, characterId, true);
  if (!state) return 0;
  const { current, mine, speed, budget, left } = state;

  if (!mine.is_current) reject(400, `Сейчас ход «${current.name}» — двигаться можно в свой ход.`);
  if (speed.feet <= 0) reject(400, `${mine.name} не может двигаться: ${speed.reasons.join(', ') || 'скорость 0'}.`);

  const cost = state.cost(from, to);
  if (!Number.isFinite(cost)) reject(400, 'Туда не пройти — путь перегорожен стенами или преградами и в обход тоже.');
  if (cost > left + 1e-9) {
    reject(400, `Не хватает скорости: путь стоит ${formatFeet(cost)} фут., осталось ${formatFeet(Math.max(0, left))} из ${formatFeet(budget)}.`);
  }

  await q.query('UPDATE initiative_entries SET moved_feet=moved_feet+$2, moved_diagonals=moved_diagonals+$3 WHERE id=$1', [mine.id, cost, state.diagonals(from, to)]);
  void notifyCampaign(ctx, campaignId, { type: 'initiative', sceneId: scene.id });
  return cost;
}

export async function spendClimb(ctx: TableContext, q: Queryable, campaignId: string, characterId: string, feet: number, gm: boolean, flySpeed: number): Promise<number> {
  if (feet <= 0) return 0;
  const entry = (
    await q.query(
      `SELECT ie.id, ie.is_current, ie.moved_feet::float8 AS moved_feet, ie.dashes, ie.scene_id,
                c.speed_feet::float8 AS speed_feet,
                EXISTS (SELECT 1 FROM initiative_entries x WHERE x.campaign_id=ie.campaign_id AND x.scene_id=ie.scene_id AND x.is_current) AS in_combat
         FROM initiative_entries ie
         JOIN characters c ON c.campaign_id = ie.campaign_id AND c.id = ie.character_id
         WHERE ie.campaign_id=$1 AND ie.character_id=$2
         ORDER BY ie.is_current DESC
         LIMIT 1
         FOR UPDATE OF ie`,
      [campaignId, characterId],
    )
  ).rows[0];
  if (!entry || !entry.in_combat) return 0;
  if (gm && (await gmFreeMove(q, campaignId))) return 0;
  if (!entry.is_current) reject(400, 'В бою набрать или сбросить высоту можно в свой ход.');
  const walk = Number(entry.speed_feet ?? 0);
  const flying = await flightSpeed(q, campaignId, characterId, walk);
  const base = (flying ?? Math.max(walk, flySpeed)) + (await classSpeedBonus(q, campaignId, characterId)).feet;
  const speed = effectiveSpeed(base, await loadConditionState(q, campaignId, characterId)).feet;
  const left = speed * (1 + entry.dashes) - Number(entry.moved_feet);
  if (feet > left + 1e-9) reject(400, `Подняться или спуститься на ${feet} фут. — нужно столько же движения, осталось ${Math.max(0, left)}.`);
  await q.query('UPDATE initiative_entries SET moved_feet=moved_feet+$2 WHERE id=$1', [entry.id, feet]);
  void notifyCampaign(ctx, campaignId, { type: 'initiative', sceneId: entry.scene_id });
  return feet;
}

export async function spendStandUp(ctx: TableContext, q: Queryable, campaignId: string, characterId: string, halfSpeed: number): Promise<'free' | 'spent'> {
  const entry = (
    await q.query(
      `SELECT ie.id, ie.is_current, ie.moved_feet::float8 AS moved_feet, ie.dashes, ie.scene_id,
                c.speed_feet::float8 AS speed_feet,
                EXISTS (SELECT 1 FROM initiative_entries x WHERE x.campaign_id=ie.campaign_id AND x.scene_id=ie.scene_id AND x.is_current) AS in_combat
         FROM initiative_entries ie
         JOIN characters c ON c.campaign_id = ie.campaign_id AND c.id = ie.character_id
         WHERE ie.campaign_id=$1 AND ie.character_id=$2
         ORDER BY ie.is_current DESC
         LIMIT 1
         FOR UPDATE OF ie`,
      [campaignId, characterId],
    )
  ).rows[0];
  if (!entry || !entry.in_combat) return 'free';
  if (!entry.is_current) reject(400, 'В бою встать можно в свой ход.');
  const speed = effectiveSpeed(Number(entry.speed_feet ?? 0) + (await classSpeedBonus(q, campaignId, characterId)).feet, conditionState([])).feet;
  const left = speed * (1 + entry.dashes) - Number(entry.moved_feet);
  if (halfSpeed > left + 1e-9) reject(400, `Чтобы встать, нужно ${halfSpeed} фут. движения, осталось ${Math.max(0, left)}.`);
  await q.query('UPDATE initiative_entries SET moved_feet=moved_feet+$2 WHERE id=$1', [entry.id, halfSpeed]);
  void notifyCampaign(ctx, campaignId, { type: 'initiative', sceneId: entry.scene_id });
  return 'spent';
}
