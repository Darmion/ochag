import { placementsAllied } from '../../../campaign/factions.ts';
import { type AutoOption, BUFF_VALUE, CONTROL_VALUE } from '../planner.ts';
import { feetBetween } from '../../scene/board.ts';
import type { Queryable } from '../../../db.ts';
import type { TurnBoard, TurnInput, PostMovePosition } from './types.ts';
import type { HealChoice } from './heal.ts';

export async function planSupport(
  q: Queryable, { campaignId }: TurnInput, { scene, placements, npc, alive, options }: TurnBoard, { here, sees }: PostMovePosition,
  { friends, friendsDead, allowed }: HealChoice,
) {
  let supportPlan: { option: AutoOption; targetId: string; value: number; name: string } | null = null;
  for (const option of options.filter(entry => entry.kind === 'support' && allowed(entry))) {
    for (const friend of friends.filter(entry => !friendsDead.has(entry.character_id))) {
      const self = friend.id === npc.id;
      if (!self && (feetBetween(scene, here, friend) > option.reach || !sees(friend))) continue;
      const effects = (await q.query('SELECT effect_code, parameters FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active', [campaignId, friend.character_id])).rows as Array<{ effect_code: string; parameters: any }>;
      let value = 0;
      for (const effect of effects) {
        if (option.support === 'restore' && option.restores?.includes(effect.effect_code)) value = Math.max(value, CONTROL_VALUE[effect.effect_code] ?? 2);
        if (option.support === 'dispel' && effect.parameters?.spellLevel !== undefined) {
          const from = placements.find(entry => entry.character_id === effect.parameters?.sourceCharacterId);
          if (from && !placementsAllied(from, npc)) value = Math.max(value, CONTROL_VALUE[effect.effect_code] ?? 2);
        }
      }
      if (value > 0 && (!supportPlan || value > supportPlan.value)) supportPlan = { option, targetId: friend.character_id, value, name: friend.name };
    }
    if (option.support !== 'dispel') continue;
    for (const foe of alive) {
      if (feetBetween(scene, here, foe) > option.reach || !sees(foe)) continue;
      const effects = (await q.query('SELECT effect_code, parameters FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active', [campaignId, foe.character_id])).rows as Array<{ effect_code: string; parameters: any }>;
      let value = 0;
      for (const effect of effects) {
        if (effect.parameters?.spellLevel === undefined) continue;
        const from = placements.find(entry => entry.character_id === effect.parameters?.sourceCharacterId);
        if (from && placementsAllied(from, npc)) continue;
        value = Math.max(value, (BUFF_VALUE[effect.effect_code] ?? 2) + (effect.parameters?.concentrationOf ? 3 : 0));
      }
      if (value > 0 && (!supportPlan || value > supportPlan.value)) supportPlan = { option, targetId: foe.character_id, value, name: foe.name };
    }
  }
  return supportPlan;
}
