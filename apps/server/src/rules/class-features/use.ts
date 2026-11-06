import { loadEffects } from '../conditions.ts';
import { objectSchema, uuid, reject } from '../../tabletop/scene-feature.ts';
import { type ClassFeature } from '../../../../../packages/domain/character/class-features.ts';

import { conditionState, incapacitatedReason } from '../../../../../packages/domain/combat/conditions.ts';

import { type ClassFeatureContext, type HpResult } from '../class-features.ts';
import { loadActor, openHand, requireFeature } from './helpers.ts';
import { FEATURE_ACTIONS } from './classes/index.ts';
import type { FeatureAfter, FeatureUseBody } from './classes/types.ts';

export function registerFeatureUseRoutes(ctx: ClassFeatureContext) {
  const { announceHpChange, app, auth, canManage, db, notifyCampaign } = ctx;

  app.post<{
    Params: { campaignId: string; characterId: string; feature: string };
    Body: FeatureUseBody | undefined;
  }>(
    '/campaigns/:campaignId/characters/:characterId/features/:feature',
    {
      schema: {
        params: objectSchema({
          campaignId: uuid, characterId: uuid,
          feature: {
            type: 'string',
            enum: Object.keys(FEATURE_ACTIONS),
          },
        }),
        body: {
          type: 'object', additionalProperties: false,
          properties: {
            sceneId: uuid, targetId: uuid, mode: { type: 'string', enum: ['dash', 'disengage', 'to-points', 'to-slot', 'fear', 'charm'] },
            slotLevel: { type: 'integer', minimum: 1, maximum: 9 },
            amount: { type: 'integer', minimum: 1, maximum: 200 }, cure: { type: 'boolean' }, beast: { type: 'string', maxLength: 64 },
            slots: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'integer', minimum: 1, maximum: 9 } },
            frenzy: { type: 'boolean' }, technique: { type: 'string', enum: ['prone', 'push', 'no-reactions'] }, weaponId: uuid,
            spell: { type: 'string', minLength: 1, maxLength: 200 },
            heals: {
              type: 'array', minItems: 1, maxItems: 12,
              items: objectSchema({ targetId: uuid, amount: { type: 'integer', minimum: 1, maximum: 200 } }, ['targetId', 'amount']),
            },
          },
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId, feature } = request.params;
      const sceneId = request.body?.sceneId ?? null;
      const targetId = request.body?.targetId ?? null;
      const changed: Array<{ characterId: string; change: HpResult }> = [];
      const after: FeatureAfter = { floatOn: null, flurry: null, frenzyStrike: null, volley: null };
      const healed: Array<{ characterId: string; change: HpResult }> = [];

      const result = await db.transaction(async q => {
        const { member, row, classes } = await loadActor(ctx, q, campaignId, characterId, userId, true);
        const enforce = !(await canManage(q, member, userId));
        requireFeature(row, classes, feature === 'end-rage' ? 'rage' : feature === 'end-wild-shape' ? 'wild-shape' : feature === 'frenzy-attack' ? 'frenzy'
          : feature === 'volley' || feature === 'whirlwind' ? 'hunter-multiattack' : feature as ClassFeature['id']);
        const state = conditionState((await loadEffects(q, campaignId, characterId)).map(effect => effect.effect_code));
        if (feature !== 'end-rage') {
          const unable = incapacitatedReason(state);
          if (unable) reject(400, `${row.name} не может действовать: ${unable}.`);
        }

        const action = FEATURE_ACTIONS[feature];
        if (!action) reject(400, 'Такого умения нет.');
        return action({ ctx, q, userId, campaignId, characterId, feature, request, sceneId, targetId, member, row, classes, enforce, state, changed, healed, after });
      });

      void notifyCampaign(campaignId, { type: 'character', characterId });
      void notifyCampaign(campaignId, { type: 'changed' });
      if (result.economyScene) void notifyCampaign(campaignId, { type: 'initiative', sceneId: result.economyScene });
      if (result.float) void notifyCampaign(campaignId, { type: 'float', characterId: after.floatOn ?? characterId, text: result.float, tone: feature === 'rage' ? 'crit' : 'info' });
      if (after.floatOn) void notifyCampaign(campaignId, { type: 'character', characterId: after.floatOn });
      if (changed.length) void notifyCampaign(campaignId, { type: 'rolls' });
      for (const entry of changed) {
        if (entry.change) announceHpChange(campaignId, entry.characterId, 'damage', entry.change);
        else void notifyCampaign(campaignId, { type: 'character', characterId: entry.characterId });
      }
      for (const entry of healed) announceHpChange(campaignId, entry.characterId, 'heal', entry.change);
      if (feature === 'wild-shape' || feature === 'end-wild-shape') void notifyCampaign(campaignId, { type: 'characters' });
      let strikes: any[] = [];
      if (after.flurry && ctx.unarmedStrike) {
        const plan = after.flurry as { targetId: string; die: number; sceneId: string | null; openHand: { id: string; name: string; current: boolean; dc: number } | null };
        const techniques: string[] = [];
        for (let index = 0; index < 2; index += 1) {
          const done = await ctx.unarmedStrike(campaignId, plan.sceneId, characterId, plan.targetId, userId, plan.die);
          strikes.push(done);
          if (Number(done?.damage?.hp?.hp_current ?? 1) <= 0) break;
          if (plan.openHand && done?.outcome?.hit) {
            const effect = await db.transaction(q => openHand(ctx, q, campaignId, userId, plan.openHand!, plan.targetId, plan.sceneId, request.body!.technique!));
            if (effect) techniques.push(effect);
            void notifyCampaign(campaignId, { type: 'character', characterId: plan.targetId });
            if (plan.sceneId) void notifyCampaign(campaignId, { type: 'changed' });
          }
        }
        const text = strikes.map(done => (done?.outcome?.hit ? `попадание${done.damage ? ` ${done.damage.applied}` : ''}` : 'промах')).join(', ');
        const quivering = strikes[strikes.length - 1]?.quivering ?? null;
        return {
          feature, message: `${result.message} ${text}${techniques.length ? `; техника открытой ладони: ${techniques.join(', ')}` : ''}.`, strikes,
          ...(techniques.length ? { techniques } : {}), ...(quivering ? { quivering } : {}),
        };
      }
      if (after.volley && ctx.weaponAttack) {
        const plan = after.volley as { targets: Array<{ id: string; name: string }>; weaponId: string | null; sceneId: string };
        const attacks: any[] = [];
        const parts: string[] = [];
        for (const target of plan.targets) {
          try {
            const done = await ctx.weaponAttack(campaignId, plan.sceneId, characterId, plan.weaponId, target.id, userId);
            attacks.push(done);
            parts.push(`${target.name} — ${done?.outcome?.hit ? `попадание${done.damage ? ` ${done.damage.applied}` : ''}` : 'промах'}`);
          } catch (cause) {
            parts.push(`${target.name} — ${cause instanceof Error ? cause.message.replace(/\.$/, '') : 'не достать'}`);
          }
        }
        return { feature, message: `${result.message} ${parts.join('; ')}.`, attacks };
      }
      if (after.frenzyStrike && ctx.weaponAttack) {
        const plan = after.frenzyStrike as { targetId: string; weaponId: string | null; sceneId: string | null };
        const done = await ctx.weaponAttack(campaignId, plan.sceneId, characterId, plan.weaponId, plan.targetId, userId);
        const text = done?.outcome?.hit ? `попадание${done.damage ? ` ${done.damage.applied}` : ''}` : 'промах';
        return { feature, message: `${result.message} ${text}.`, attack: done };
      }
      if (result.heal) {
        void notifyCampaign(campaignId, { type: 'rolls' });
        announceHpChange(campaignId, characterId, 'heal', result.heal);
      }
      return { feature, message: result.message, ...(result.heal ? { healed: result.heal.applied } : {}) };
    },
  );
}
