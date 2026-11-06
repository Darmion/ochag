import { autoOpening, autoWildShape, bonusUsed, cunningRetreat, npcFeatures } from './npc.ts';
import { AUTO_PACES, AUTO_TARGETS, type AutoPace, type AutoTarget, glideMs, pauseMs } from './planner.ts';
import { settleOpportunities } from '../combat/opportunity.ts';
import type { TableContext } from '../context.ts';
import { notify } from '../live/notify.ts';
import { reject, sceneParams, type SceneParams } from '../shared.ts';
import type { TurnInput, TurnLog } from './plan/types.ts';
import { planTurn } from './plan/turn.ts';
import type { TurnRun } from './act/run.ts';
import { useFeaturesBeforeStrike } from './act/features.ts';
import { castPlannedSpells } from './act/spells.ts';
import { attackWithWeapons } from './act/attacks.ts';
import { castStrikeSpell } from './act/strike-spell.ts';


export function registerAutoTurnRoutes(ctx: TableContext) {
  const { app, auth, db, triggers } = ctx;

  app.post<{ Params: SceneParams; Body: { advance?: boolean; target?: AutoTarget; pace?: AutoPace } | undefined }>(
    '/campaigns/:campaignId/scenes/:sceneId/initiative/auto',
    { schema: { params: sceneParams } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, sceneId } = request.params;
      const advance = request.body?.advance !== false;
      if (request.body?.advance !== undefined && typeof request.body.advance !== 'boolean') reject(400, 'advance — да или нет.');
      const targetMode: AutoTarget = request.body?.target ?? 'nearest';
      if (!AUTO_TARGETS.includes(targetMode)) reject(400, 'target — nearest, weakest или threat.');
      const paceName = request.body?.pace ?? 'fast';
      if (!Object.hasOwn(AUTO_PACES, paceName)) reject(400, 'pace — fast, normal или slow.');
      const pace = AUTO_PACES[paceName];

      const headers = { authorization: request.headers.authorization ?? '' };
      const shapedNow = await autoWildShape(ctx, campaignId, sceneId, headers);
      const opening = await autoOpening(ctx, campaignId, sceneId, headers);
      const input: TurnInput = { campaignId, sceneId, userId, targetMode, shapedNow, opening };
      const turn: TurnLog = { notices: [], provoked: [], entryId: '' };
      const plan = await db.transaction(q => planTurn(ctx, q, input, turn));
      const { notices, provoked, entryId: autoEntryId } = turn;

      if (plan.moved || plan.fled) void notify(ctx, campaignId, sceneId);
      triggers.send(campaignId, notices);
      await settleOpportunities(ctx, campaignId, provoked);
      const run: TurnRun = {
        ctx, campaignId, sceneId, headers, pace, plan, parts: [], attackError: null, acted: false,
        beat: async () => {
          if (run.acted) await pauseMs(pace.step);
          run.acted = true;
        },
      };
      const { parts, beat } = run;
      const walked = plan.moved ?? plan.fled;
      if (walked) {
        await pauseMs(pace.move ? glideMs(walked.from, walked.to) + pace.move : 0);
        run.acted = true;
      }

      if (shapedNow) parts.push(`оборачивается: ${shapedNow}`);
      if (opening.flew !== null) parts.push(`взлетает (высота ${opening.flew} фут.)`);
      if (opening.descended !== null) parts.push(`снижается до ${opening.descended} фут.`);
      const npcClass = await npcFeatures(ctx, campaignId, sceneId, plan.npc.character_id);
      const featureCall = (id: string, body: Record<string, unknown> = {}) => app.inject({
        method: 'POST', url: `/campaigns/${campaignId}/characters/${plan.npc.character_id}/features/${id}`, headers, payload: { sceneId, ...body },
      });
      const scared = await useFeaturesBeforeStrike(run, npcClass, featureCall, input);
      const reason = scared ? null : plan.reason;
      const { bonusHeal, actionHeal, areaCast, supportCast, controlCast } = await castPlannedSpells(run);
      const { attack, attacks } = await attackWithWeapons(run, npcClass, featureCall);
      const { cast, castText } = await castStrikeSpell(run, npcClass);
      if (attacks.length && npcClass.has('cunning-action') && !(await bonusUsed(ctx, campaignId, sceneId, plan.npc.character_id))) {
        await beat();
        const retreat = await cunningRetreat(ctx, campaignId, sceneId, userId, plan.npc.character_id, autoEntryId, headers);
        if (retreat) {
          parts.push(`Отход бонусным действием — отходит от «${retreat}»`);
          void notify(ctx, campaignId, sceneId);
        }
      }
      let advanced = false;
      if (advance) {
        if (run.acted) await pauseMs(pace.end);
        const response = await app.inject({ method: 'POST', url: `/campaigns/${campaignId}/scenes/${sceneId}/initiative/advance`, headers, payload: { entryId: autoEntryId } });
        advanced = response.statusCode < 300;
      }

      const { attackError } = run;
      const summary = [
        plan.moved ? `${plan.npc.name} идёт к «${plan.target?.name}»` : null,
        ...parts,
        castText,
        attackError ?? reason,
      ].filter(Boolean).join('; ');
      return reply.send({
        npc: { id: plan.npc.character_id, name: plan.npc.name },
        target: plan.target ? { id: plan.target.character_id, name: plan.target.name } : null,
        moved: plan.moved, weapon: plan.weapon ? { id: plan.weapon.id, name: plan.weapon.name } : null,
        spell: plan.spell ? { id: plan.spell.id, name: plan.spell.name } : null, cast,
        area: plan.area ? { spell: plan.area.option.name, shape: plan.area.placement.shape, enemies: plan.area.placement.enemies } : null, areaCast,
        heal: bonusHeal ?? actionHeal ?? null,
        support: plan.support ? { spell: plan.support.option.name, targetId: plan.support.targetId } : null, supportCast,
        control: plan.control ? { spell: plan.control.option.name, condition: plan.control.option.condition, targetId: plan.control.targetId } : null, controlCast,
        attack, attacks, attackError, reason, advanced, summary, targetMode, fled: plan.fled,
      });
    },
  );
}
