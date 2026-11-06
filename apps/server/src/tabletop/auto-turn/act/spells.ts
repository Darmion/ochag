import { CONDITION_LABELS } from '../../../../../../packages/domain/combat/conditions.ts';
import { type AutoOption, pauseMs } from '../planner.ts';
import { notify } from '../../live/notify.ts';
import type { Placement } from '../../shared.ts';
import type { TurnRun } from './run.ts';

export async function castPlannedSpells(run: TurnRun) {
  const { ctx, campaignId, sceneId, headers, pace, plan, parts, beat } = run;
  const { app } = ctx;
  const slotOf = (option: AutoOption) => (option.pact ? { pact: true } : option.slotLevel && option.slotLevel !== option.level ? { slotLevel: option.slotLevel } : {});
  const castSpell = async (option: AutoOption, payload: Record<string, unknown>) => {
    await beat();
    const response = await app.inject({
      method: 'POST', url: `/campaigns/${campaignId}/characters/${plan.npc.character_id}/spells/${option.id}/cast`, headers,
      payload: { sceneId, ...slotOf(option), ...payload },
    });
    if (response.statusCode >= 300) {
      run.attackError = response.json()?.message ?? 'Заклинание не удалось.';
      return null;
    }
    return response.json();
  };
  const heal = async (planned: { option: AutoOption; patient: Placement } | null) => {
    if (!planned) return null;
    const done = await castSpell(planned.option, { targetIds: [planned.patient.character_id] });
    if (done) {
      const healed = (done.targets ?? []).find((entry: any) => entry.characterId === planned.patient.character_id)?.healed;
      parts.push(done.pending ? `лечит «${planned.patient.name}» («${planned.option.name}») — ждём ответа на «Контрзаклинание»` : `лечит «${planned.patient.name}» («${planned.option.name}»)${healed ? `: +${healed} хит.` : ''}`);
    }
    return done;
  };
  const bonusHeal = await heal(plan.bonusHeal);
  const actionHeal = await heal(plan.actionHeal);
  let areaCast: any = null;
  if (plan.area) {
    const { option, placement } = plan.area;
    const made = await app.inject({
      method: 'POST', url: `/campaigns/${campaignId}/scenes/${sceneId}/templates`, headers,
      payload: {
        shape: placement.shape, x: placement.x, z: placement.z, direction: placement.direction, sizeFeet: placement.sizeFeet,
        ...(placement.widthFeet ? { widthFeet: placement.widthFeet } : {}), label: `${option.name} — ${plan.npc.name}`.slice(0, 100),
      },
    });
    if (made.statusCode < 300) {
      const templateId = made.json().id as string;
      void notify(ctx, campaignId, sceneId);
      await pauseMs(pace.step);
      run.acted = false;
      areaCast = await castSpell(option, { templateId });
      if (areaCast && !areaCast.pending) {
        await app.inject({ method: 'DELETE', url: `/campaigns/${campaignId}/scenes/${sceneId}/templates/${templateId}`, headers });
      }
      if (areaCast) {
        const hits = (areaCast.targets ?? []).filter((entry: any) => entry.damage > 0).map((entry: any) => `«${entry.name}» ${entry.damage}`);
        parts.push(areaCast.pending
          ? `творит «${option.name}» на область — ждём ответа на «Контрзаклинание»`
          : `творит «${option.name}» на область: задето ${(areaCast.targets ?? []).length}${hits.length ? ` — ${hits.join(', ')}` : ''}`);
      }
    } else run.attackError = made.json()?.message ?? 'Область не поставить.';
  }
  let supportCast: any = null;
  if (plan.support) {
    supportCast = await castSpell(plan.support.option, { targetIds: [plan.support.targetId] });
    if (supportCast) {
      const effects = (supportCast.targets ?? []).find((entry: any) => entry.characterId === plan.support!.targetId)?.effects ?? [];
      parts.push(supportCast.pending
        ? `творит «${plan.support.option.name}» — ждём ответа на «Контрзаклинание»`
        : `творит «${plan.support.option.name}» на «${plan.support.name}»${effects.length ? `: ${effects.join(', ')}` : ''}`);
    }
  }
  let controlCast: any = null;
  if (plan.control) {
    const { option, targetId, placement } = plan.control;
    if (placement) {
      const made = await app.inject({
        method: 'POST', url: `/campaigns/${campaignId}/scenes/${sceneId}/templates`, headers,
        payload: {
          shape: placement.shape, x: placement.x, z: placement.z, direction: placement.direction, sizeFeet: placement.sizeFeet,
          ...(placement.widthFeet ? { widthFeet: placement.widthFeet } : {}), label: `${option.name} — ${plan.npc.name}`.slice(0, 100),
        },
      });
      if (made.statusCode < 300) {
        const templateId = made.json().id as string;
        void notify(ctx, campaignId, sceneId);
        await pauseMs(pace.step);
        run.acted = false;
        controlCast = await castSpell(option, { templateId });
        if (controlCast && !controlCast.pending) await app.inject({ method: 'DELETE', url: `/campaigns/${campaignId}/scenes/${sceneId}/templates/${templateId}`, headers });
      } else run.attackError = made.json()?.message ?? 'Область не поставить.';
    } else if (targetId) {
      controlCast = await castSpell(option, { targetIds: [targetId] });
    }
    if (controlCast) {
      const struck = (controlCast.targets ?? []).filter((entry: any) => entry.condition).map((entry: any) => `«${entry.name}»`);
      parts.push(controlCast.pending
        ? `творит «${option.name}» — ждём ответа на «Контрзаклинание»`
        : `творит «${option.name}»: ${struck.length ? `${CONDITION_LABELS[option.condition!] ?? option.condition} — ${struck.join(', ')}` : 'никто не поддался'}`);
    }
  }
  return { bonusHeal, actionHeal, areaCast, supportCast, controlCast };
}
