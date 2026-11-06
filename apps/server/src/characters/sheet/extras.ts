import type { Queryable } from '../../db.ts';

import { WEAPON_COLUMNS } from './weapons.ts';
import { classView, experienceView, hitDiceView } from './views.ts';

export async function loadExtras(q: Queryable, campaignId: string, characterId: string) {
  const effects = (
    await q.query(
      `SELECT id, effect_code, parameters, active FROM character_effects
       WHERE campaign_id=$1 AND character_id=$2
       ORDER BY effect_code`,
      [campaignId, characterId],
    )
  ).rows;

  const resources = (
    await q.query(
      `SELECT id, name, current, max, recharge FROM character_resources
       WHERE campaign_id=$1 AND character_id=$2
       ORDER BY name`,
      [campaignId, characterId],
    )
  ).rows;

  const weapons = (
    await q.query(
      `SELECT ${WEAPON_COLUMNS} FROM character_weapons
       WHERE campaign_id=$1 AND character_id=$2
       ORDER BY name`,
      [campaignId, characterId],
    )
  ).rows;

  return { effects, resources, weapons };
}

export async function attachExtras(q: Queryable, campaignId: string, characterId: string, character: any) {
  const extras = await loadExtras(q, campaignId, characterId);
  return {
    ...character, ...extras, hit_dice: hitDiceView(character), experience_info: experienceView(character), class_info: classView(character),
    hiddenFields: [], privileged: true,
  };
}
