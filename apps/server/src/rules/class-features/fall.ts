import type { Queryable } from '../../db.ts';
import { loadEffects, addCondition } from '../conditions.ts';
import { objectSchema, reject } from '../../tabletop/scene-feature.ts';
import { characterClassLevels } from '../../../../../packages/domain/character/classes.ts';
import { fallDamageDice, classFeaturesFor, slowFallReduction, classLevelOf } from '../../../../../packages/domain/character/class-features.ts';
import { rollDice } from '../../../../../packages/domain/dice/dice.ts';
import { incapacitatedReason, conditionState } from '../../../../../packages/domain/combat/conditions.ts';

import { CHARACTER_COLUMNS, type ClassFeatureContext, type HpResult, useReaction } from '../class-features.ts';
import { characterParams } from './helpers.ts';

export async function fallOn(ctx: ClassFeatureContext, q: Queryable, campaignId: string, userId: string, row: any, feet: number, hidden: boolean) {
  const { applyHpChange, insertRoll, rollDie } = ctx;
  const characterId = row.id as string;
  const dice = fallDamageDice(feet);
  if (!dice) return { message: `${row.name}: падение с ${feet} фут. — без урона.`, change: null as HpResult | null, prone: false, slowFall: 0 };
  const rolled = rollDice({ count: dice, sides: 6, modifier: 0 }, rollDie);
  const classes = characterClassLevels(row).classes;
  const effects = await loadEffects(q, campaignId, characterId);
  const able = row.kind !== 'object' && !incapacitatedReason(conditionState(effects.map(effect => effect.effect_code)));
  const slowFall = able && classFeaturesFor(classes).some(feature => feature.id === 'slow-fall') && (await useReaction(q, campaignId, characterId))
    ? slowFallReduction(classLevelOf(classes, 'monk', row.level)) : 0;
  const amount = Math.max(0, rolled.total - slowFall);
  const change = amount > 0 ? await applyHpChange(q, campaignId, userId, characterId, { mode: 'damage', amount, damageType: 'bludgeoning', critical: false }) : null;
  await insertRoll(
    q, campaignId, userId, characterId, `Падение с ${feet} фут. — ${row.name}`.slice(0, 100), `${dice}d6`, rolled.results, 0, rolled.total, hidden, null,
    {
      kind: 'damage', target: { id: characterId, name: row.name }, damageType: 'bludgeoning', applied: change?.applied ?? 0, dropped: change?.dropped ?? false,
      ...(slowFall ? { reasons: [`медленное падение −${slowFall}`] } : {}),
    },
  );
  const prone = row.kind !== 'object' && amount > 0 && !change?.blocked
    && !conditionState((await loadEffects(q, campaignId, characterId)).map(effect => effect.effect_code)).codes.has('dead');
  if (prone) await addCondition(q, campaignId, characterId, 'prone', { source: 'fall', sourceName: 'Падение' });
  const parts = [
    `${row.name}: падение с ${feet} фут. — ${dice}к6 = ${rolled.total}`,
    ...(slowFall ? [`«Медленное падение» −${slowFall}`] : []),
    change ? `урон ${change.applied}` : 'без урона',
    ...(prone ? ['лежит ничком'] : []),
  ];
  return { message: `${parts.join(', ')}.`, change, prone, slowFall };
}

export function registerFallRoutes(ctx: ClassFeatureContext) {
  const { announceHpChange, app, auth, canManageCharacter, db, membership, notifyCampaign } = ctx;

  app.post<{ Params: { campaignId: string; characterId: string }; Body: { feet: number; hidden?: boolean } }>(
    '/campaigns/:campaignId/characters/:characterId/fall',
    { schema: { params: characterParams, body: objectSchema({ feet: { type: 'integer', minimum: 1, maximum: 1000 }, hidden: { type: 'boolean' } }, ['feet']) } },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const { feet } = request.body;
      const hidden = request.body.hidden === true;
      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const row = (await q.query(`SELECT ${CHARACTER_COLUMNS} FROM characters WHERE campaign_id=$1 AND id=$2 FOR UPDATE`, [campaignId, characterId])).rows[0] as any;
        if (!row) reject(404, 'Существо не найдено.');
        if (!(await canManageCharacter(q, member, userId, row.owner_user_id, row.id))) reject(403, 'Падением распоряжается мастер или хозяин существа.');
        return fallOn(ctx, q, campaignId, userId, row, feet, hidden);
      });
      if (result.change) announceHpChange(campaignId, characterId, 'damage', result.change);
      void notifyCampaign(campaignId, { type: 'rolls' });
      void notifyCampaign(campaignId, { type: 'character', characterId });
      void notifyCampaign(campaignId, { type: 'changed' });
      return { message: result.message, applied: result.change?.applied ?? 0, prone: result.prone, ...(result.slowFall ? { slowFall: result.slowFall } : {}) };
    },
  );
}
