import { pathBlocked } from '../../../../../../packages/domain/map/blockers.ts';
import { deadCreatures } from '../../combat/loot-routes.ts';
import { placementFactions, placementsHostile, placementsRestricted } from '../../../campaign/factions.ts';
import { loadConditionState } from '../../../rules/conditions.ts';
import { incapacitatedReason } from '../../../../../../packages/domain/combat/conditions.ts';
import { dreadSource, fleeFrom } from '../npc.ts';
import { type AutoOption, autoOptions, NO_ACTION } from '../planner.ts';
import { INITIATIVE_ORDER } from '../../combat/initiative.ts';
import type { TableContext } from '../../context.ts';
import { getScene } from '../../scene/board.ts';
import { fearSourceInSight } from '../../scene/movement.ts';
import { loadPlacements } from '../../scene/placements.ts';
import { canManage, type Placement, reject } from '../../shared.ts';
import type { Queryable } from '../../../db.ts';
import type { TurnBoard, TurnInput, TurnLog, PostMovePosition } from './types.ts';
import { chooseTarget } from './target.ts';
import { approachTarget } from './approach.ts';
import { planHealing } from './heal.ts';
import { planStrike } from './strike.ts';
import { planArea } from './area.ts';
import { planControl } from './control.ts';
import { planSupport } from './support.ts';

export async function planTurn(ctx: TableContext, q: Queryable, input: TurnInput, turn: TurnLog) {
  const { membership } = ctx;
  const { campaignId, sceneId, userId, shapedNow, opening } = input;
  const member = await membership(q, campaignId, userId, true);
  if (!(await canManage(q, member, userId))) reject(403, 'Ход НПС ведёт мастер сцен.');
  const scene: any = await getScene(q, campaignId, sceneId, true);
  const current = (
    await q.query(
      `SELECT ie.id, ie.character_id, ie.name FROM initiative_entries ie
       LEFT JOIN characters c ON c.campaign_id = ie.campaign_id AND c.id = ie.character_id
       WHERE ie.campaign_id=$1 AND ie.scene_id=$2 AND ie.is_current
       ORDER BY (c.kind = 'npc') DESC, ${INITIATIVE_ORDER} LIMIT 1`,
      [campaignId, sceneId],
    )
  ).rows[0] as any;
  if (!current?.character_id) reject(400, 'Сейчас ничей ход или ход записи без существа.');
  turn.entryId = current.id;
  const placements = await loadPlacements(q, campaignId, sceneId);
  const npc = placements.find(entry => entry.character_id === current.character_id && !entry.parent_object_id);
  if (!npc || npc.kind !== 'npc') reject(400, '«Авто-ход» — для НПС; персонажи игроков ходят сами.');
  if (!placementFactions(npc).length) reject(400, `«${npc.name}» нейтрален — ни на кого не нападает.`);
  const npcState = await loadConditionState(q, campaignId, npc.character_id);
  const unable = incapacitatedReason(npcState);
  if (unable) return { ...NO_ACTION, npc, reason: `${npc.name} ${unable}` };
  if (npcState.codes.has('turned')) {
    const source = await dreadSource(q, campaignId, npc.character_id, 'turned', placements);
    const fled = source ? await fleeFrom(ctx, q, campaignId, userId, scene, npc, source, true) : null;
    if (fled) {
      turn.notices = fled.notices;
      turn.provoked = fled.provoked;
    }
    return {
      ...NO_ACTION, npc, fled: fled ? { from: fled.from, to: fled.to, dashed: fled.dashed, from_name: fled.from_name } : null,
      reason: fled ? `${npc.name} изгнан — бежит от «${fled.from_name}»${fled.dashed ? ' (Рывок)' : ''}` : `${npc.name} изгнан — бежать некуда`,
    };
  }

  const enemies = placements.filter(entry => !entry.parent_object_id && entry.id !== npc.id && placementsHostile(entry, npc) && !placementsRestricted(entry, npc, 'no-auto-attack'));
  const fallen = await deadCreatures(q, campaignId, enemies.map(entry => entry.character_id));
  const alive = enemies.filter(entry => !fallen.has(entry.character_id));
  if (!alive.length) return { ...NO_ACTION, npc, reason: 'врагов на сцене нет' };
  const holding = npcState.codes.has('concentration');
  const options = (await autoOptions(q, campaignId, npc.character_id)).filter(option => !(holding && option.concentration));
  const strikes = options.filter(option => option.kind === 'weapon' || option.kind === 'spell');
  const preferred = strikes.reduce<AutoOption | null>((best, option) => (!best || option.expected > best.expected ? option : best), null);
  const reach = preferred ? preferred.reach : Math.max(5, ...options.filter(option => option.kind === 'control' && !option.area).map(option => option.reach));

  const board: TurnBoard = { scene, placements, npc, npcState, alive, fallen, holding, options, strikes, reach };
  const aim = await chooseTarget(q, input, board);
  const { pathGrid, target } = aim;
  const { moved, position } = await approachTarget(ctx, q, input, turn, board, aim);

  const here = { ...npc, world_x: position.x, world_z: position.z };
  const sees = (other: Placement) => !pathBlocked(position, { x: other.world_x, z: other.world_z }, pathGrid.edges);
  const afterMove: PostMovePosition = { position, here, sees };

  const healing = await planHealing(q, input, board, afterMove);
  const { bonusHeal, actionHeal } = healing;
  const { perAction, sequence, usable } = await planStrike(q, input, board, aim, afterMove, healing);
  const { bodies, areaPlan } = planArea(board, aim, afterMove, healing);
  const areaWins = Boolean(areaPlan && (!usable || areaPlan.option.expected * areaPlan.placement.enemies.length > usable.expected + 1e-9));
  const controlPlan = await planControl(q, input, board, aim, afterMove, healing, bodies);
  const best = Math.max(usable?.expected ?? 0, areaPlan ? areaPlan.option.expected * areaPlan.placement.enemies.length : 0);
  const controlWins = Boolean(controlPlan && !actionHeal && controlPlan.value > best + 1e-9);
  const supportPlan = await planSupport(q, input, board, afterMove, healing);
  const supportWins = Boolean(supportPlan && !actionHeal && supportPlan.value > Math.max(best, controlWins ? controlPlan!.value : 0) + 1e-9);
  const chosen = actionHeal || controlWins || supportWins ? null : areaWins ? null : usable;
  if (shapedNow) return { ...NO_ACTION, npc, target, moved, reason: `${npc.name} оборачивается: ${shapedNow}` };
  if (opening.aura) return { ...NO_ACTION, npc, target, moved, reason: `${npc.name} ${opening.aura}` };
  if (!chosen && !areaWins && !controlWins && !supportWins && !actionHeal && !bonusHeal && npcState.codes.has('frightened')) {
    const source = await dreadSource(q, campaignId, npc.character_id, 'frightened', placements);
    if (source && (await fearSourceInSight(q, campaignId, npc.character_id, [source.character_id], npcState.codes.has('blinded')))) {
      const fled = await fleeFrom(ctx, q, campaignId, userId, scene, here, source, true);
      if (fled) {
        turn.notices = [...turn.notices, ...fled.notices];
        turn.provoked = [...turn.provoked, ...fled.provoked];
        return {
          ...NO_ACTION, npc, moved, fled: { from: fled.from, to: fled.to, dashed: fled.dashed, from_name: fled.from_name },
          reason: `${npc.name} испуган — бежит от «${fled.from_name}»${fled.dashed ? ' (Рывок)' : ''}`,
        };
      }
    }
  }
  return {
    npc, target, moved, fled: null,
    weapon: chosen?.kind === 'weapon' ? chosen.weapon : null, spell: chosen?.kind === 'spell' ? chosen : null,
    area: !actionHeal && !controlWins && !supportWins && areaWins ? areaPlan : null,
    control: controlWins && !supportWins ? controlPlan : null,
    support: supportWins ? supportPlan : null,
    bonusHeal, actionHeal,
    perAction,
    sequence: chosen?.kind === 'weapon' ? sequence.map(entry => ({ weapon: entry.weapon, disadvantage: entry.disadvantage })) : [],
    reason: chosen || actionHeal || areaWins || controlWins || supportWins ? null : options.length ? `${target.name} вне досягаемости` : 'у НПС нет оружия и заклинаний с уроном в листе',
  };
}
