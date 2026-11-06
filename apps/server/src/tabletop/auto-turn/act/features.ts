import { autoIntimidate, bonusUsed } from '../npc.ts';
import type { FeatureCall, NpcClass, TurnRun } from './run.ts';
import type { TurnInput } from '../plan/types.ts';

export async function useFeaturesBeforeStrike(run: TurnRun, npcClass: NpcClass, featureCall: FeatureCall, { shapedNow, opening }: TurnInput) {
  const { ctx, campaignId, sceneId, plan, parts } = run;
  if (plan.weapon && plan.weapon.weapon_kind !== 'ranged' && npcClass.has('rage') && !npcClass.raging && !(await bonusUsed(ctx, campaignId, sceneId, plan.npc.character_id))) {
    if ((await featureCall('rage', npcClass.has('frenzy') ? { frenzy: true } : {})).statusCode < 300) parts.push(npcClass.has('frenzy') ? 'впадает в ярость (бешенство)' : 'впадает в ярость');
  }
  if (plan.weapon && plan.weapon.weapon_kind !== 'ranged' && plan.weapon.ability === 'strength' && npcClass.has('reckless-attack')
    && (npcClass.raging || parts.some(part => part.startsWith('впадает в ярость')))) {
    if ((await featureCall('reckless-attack')).statusCode < 300) parts.push('атакует безрассудно');
  }
  if (npcClass.has('second-wind') && npcClass.hp <= npcClass.hpMax / 2 && !(await bonusUsed(ctx, campaignId, sceneId, plan.npc.character_id))) {
    const wind = await featureCall('second-wind');
    if (wind.statusCode < 300) parts.push(`второе дыхание: +${wind.json().healed ?? 0} хит.`);
  }
  let scared: string | null = null;
  if (!plan.weapon && !plan.spell && !plan.area && !plan.control && !plan.support && !plan.actionHeal && !plan.fled && !shapedNow && !opening.aura
    && npcClass.has('intimidating-presence')) {
    scared = await autoIntimidate(ctx, campaignId, sceneId, plan.npc.character_id, featureCall);
    if (scared) parts.push(`«Пугающее присутствие» на «${scared}»`);
  }
  return scared;
}
