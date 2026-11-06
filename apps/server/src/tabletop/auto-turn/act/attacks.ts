import { bonusUsed } from '../npc.ts';
import { nextVictim } from '../planner.ts';
import type { FeatureCall, NpcClass, TurnRun } from './run.ts';

export async function attackWithWeapons(run: TurnRun, npcClass: NpcClass, featureCall: FeatureCall) {
  const { ctx, campaignId, sceneId, headers, plan, parts, beat } = run;
  const { app, db } = ctx;
  let attack: any = null;
  const attacks: any[] = [];
  let victim: { id: string; name: string } | null = plan.target ? { id: plan.target.character_id, name: plan.target.name } : null;
  let dropped: string | null = null;
  const attackRound = async () => {
    for (const step of plan.sequence.length ? plan.sequence : [{ weapon: plan.weapon, disadvantage: false }]) {
      if (!victim && dropped) victim = await nextVictim(ctx, campaignId, sceneId, plan.npc.character_id, step.weapon, dropped);
      if (!victim) break;
      await beat();
      const response = await app.inject({
        method: 'POST', url: `/campaigns/${campaignId}/rolls/check`, headers,
        payload: {
          characterId: plan.npc.character_id, kind: 'attack', key: step.weapon.id, targetCharacterId: victim.id, sceneId,
          ...(npcClass.has('combat-superiority') ? { precision: true } : {}),
          ...(step.disadvantage ? { advantage: 'disadv' } : {}),
        },
      });
      if (response.statusCode >= 300) {
        if (!attacks.length) run.attackError = response.json()?.message ?? 'Атака не удалась.';
        return false;
      }
      const done = response.json();
      attacks.push({ ...done, victimName: victim.name, weaponName: step.weapon.name });
      if (done.stun && Number(done.damage?.hp?.hp_current ?? 1) > 0) {
        const stun = await app.inject({ method: 'POST', url: `/campaigns/${campaignId}/rolls/${done.stun.rollId}/stunning-strike`, headers });
        if (stun.statusCode < 300) parts.push(`«Ошеломляющий удар» по «${victim.name}»: ${stun.json().stunned ? 'ошеломлён' : 'устоял'}`);
      }
      if (done.maneuver && Number(done.damage?.hp?.hp_current ?? 1) > 0) {
        const known = (done.maneuver.maneuvers ?? []).map((entry: any) => entry.id as string);
        const down = (await db.query(`SELECT 1 FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='prone' AND active`, [campaignId, victim.id])).rows[0];
        const pick = ['trip', 'menacing', 'pushing', 'distracting'].find(id => known.includes(id) && !(id === 'trip' && down));
        if (pick) {
          const used = await app.inject({ method: 'POST', url: `/campaigns/${campaignId}/rolls/${done.maneuver.rollId}/maneuver`, headers, payload: { maneuver: pick } });
          if (used.statusCode < 300) parts.push(`«${used.json().name}» по «${victim.name}»: +${used.json().value}, ${used.json().effect}`);
        }
      }
      if (Number(done.damage?.hp?.hp_current ?? 1) <= 0) {
        dropped = victim.id;
        victim = null;
      }
    }
    return true;
  };
  if (plan.weapon && plan.target) {
    await attackRound();
    if (attacks.length && npcClass.has('action-surge') && (victim || dropped)) {
      const surge = await featureCall('action-surge');
      if (surge.statusCode < 300) {
        parts.push('всплеск действий');
        await attackRound();
      }
    }
    if (attacks.length && npcClass.has('flurry-of-blows') && !(await bonusUsed(ctx, campaignId, sceneId, plan.npc.character_id))) {
      const fist = { id: '', name: '', weapon_kind: 'melee', range_feet: 5, long_range_feet: null, thrown_range_feet: null };
      if (!victim && dropped) victim = await nextVictim(ctx, campaignId, sceneId, plan.npc.character_id, fist, dropped);
      if (victim) {
        await beat();
        const flurry = await featureCall('flurry-of-blows', { targetId: victim.id, ...(npcClass.has('open-hand-technique') ? { technique: 'prone' } : {}) });
        if (flurry.statusCode < 300) parts.push(`«Шквал ударов» по «${victim.name}»: ${(flurry.json().strikes ?? []).map((done: any) => (done?.outcome?.hit ? `попадание${done.damage ? ` ${done.damage.applied}` : ''}` : 'промах')).join(', ')}`);
      }
    }
    if (attacks.length && npcClass.has('frenzy') && !(await bonusUsed(ctx, campaignId, sceneId, plan.npc.character_id))) {
      const rage = (await db.query(`SELECT parameters FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='raging' AND active`, [campaignId, plan.npc.character_id])).rows[0] as any;
      if (!victim && dropped && plan.weapon) victim = await nextVictim(ctx, campaignId, sceneId, plan.npc.character_id, plan.weapon, dropped);
      if (rage?.parameters?.frenzy && victim) {
        await beat();
        const frenzy = await featureCall('frenzy-attack', { targetId: victim.id, ...(plan.weapon?.id ? { weaponId: plan.weapon.id } : {}) });
        if (frenzy.statusCode < 300) {
          const done = frenzy.json().attack;
          parts.push(`бешенство — ещё удар по «${victim.name}»: ${done?.outcome?.hit ? `попадание${done.damage ? ` ${done.damage.applied}` : ''}` : 'промах'}`);
        }
      }
    }
    attack = attacks[0] ?? null;
    if (attacks.length) {
      const hitText = (done: any) => `«${done.victimName}» ${done.outcome?.hit ? `попадание${done.damage ? ` ${done.damage.applied}` : ''}` : 'промах'}`;
      parts.push(new Set(attacks.map(done => done.weaponName)).size === 1
        ? `атакует: ${attacks[0].weaponName} — ${attacks.map(hitText).join(', ')}`
        : `атакует — ${attacks.map(done => `${done.weaponName}: ${hitText(done)}`).join(', ')}`);
    }
  }
  return { attack, attacks };
}
