import { deadCreatures } from '../../combat/loot-routes.ts';
import { placementsAllied } from '../../../campaign/factions.ts';
import type { AutoOption } from '../planner.ts';
import { feetBetween } from '../../scene/board.ts';
import type { Queryable } from '../../../db.ts';
import type { TurnBoard, TurnInput, PostMovePosition } from './types.ts';

export async function planHealing(q: Queryable, { campaignId }: TurnInput, { scene, placements, npc, options }: TurnBoard, { here, sees }: PostMovePosition) {
  const friends = placements.filter(entry => !entry.parent_object_id && placementsAllied(entry, npc));
  const friendsDead = await deadCreatures(q, campaignId, friends.map(entry => entry.character_id));
  const health = new Map(
    (await q.query('SELECT id, hp_current, hp_max FROM characters WHERE campaign_id=$1 AND id = ANY($2::uuid[])', [campaignId, friends.map(entry => entry.character_id)]))
      .rows.map(row => [row.id as string, { hp: Number(row.hp_current ?? 0), max: Math.max(1, Number(row.hp_max ?? 1)) }]),
  );
  const wounded = friends
    .filter(entry => !friendsDead.has(entry.character_id) && health.has(entry.character_id))
    .map(entry => ({ entry, ratio: health.get(entry.character_id)!.hp / health.get(entry.character_id)!.max }))
    .sort((a, b) => a.ratio - b.ratio);
  const healFor = (bonus: boolean, limit: number) => {
    for (const option of options.filter(entry => entry.kind === 'heal' && entry.bonus === bonus)) {
      const patient = wounded.find(({ entry, ratio }) => ratio <= limit
        && (entry.id === npc.id || (feetBetween(scene, here, entry) <= option.reach && sees(entry))));
      if (patient) return { option, patient: patient.entry };
    }
    return null;
  };
  const bonusHeal = healFor(true, 0.5);
  const leveledBonus = Boolean(bonusHeal && (bonusHeal.option.level ?? 0) > 0);
  const allowed = (option: AutoOption) => !(leveledBonus && option.kind !== 'weapon' && (option.level ?? 0) > 0);
  const actionHeal = bonusHeal ? null : healFor(false, 0.25);
  return { friends, friendsDead, bonusHeal, actionHeal, allowed };
}

export type HealChoice = Awaited<ReturnType<typeof planHealing>>;
