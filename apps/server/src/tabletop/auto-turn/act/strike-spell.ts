import { knownMetamagic } from '../../../../../../packages/domain/character/class-features.ts';
import { bonusUsed } from '../npc.ts';
import type { NpcClass, TurnRun } from './run.ts';

export async function castStrikeSpell(run: TurnRun, npcClass: NpcClass) {
  const { ctx, campaignId, sceneId, headers, plan, parts, beat } = run;
  const { app, db } = ctx;
  let cast: any = null;
  if (plan.spell && plan.target) {
    const spell = plan.spell;
    const slot = spell.pact ? { pact: true } : spell.slotLevel && spell.slotLevel !== spell.level ? { slotLevel: spell.slotLevel } : {};
    await beat();
    const response = await app.inject({
      method: 'POST', url: `/campaigns/${campaignId}/characters/${plan.npc.character_id}/spells/${spell.id}/cast`, headers,
      payload: { targetIds: [plan.target.character_id], sceneId, ...slot },
    });
    if (response.statusCode < 300) cast = response.json();
    else run.attackError = response.json()?.message ?? 'Заклинание не удалось.';
  }
  if (cast && !cast.pending && plan.spell && plan.spell.level === 0 && plan.target && npcClass.has('metamagic')
    && !(await bonusUsed(ctx, campaignId, sceneId, plan.npc.character_id))) {
    const own = (await db.query('SELECT sheet_extra FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, plan.npc.character_id])).rows[0] as any;
    const standing = Number((await db.query('SELECT hp_current FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, plan.target.character_id])).rows[0]?.hp_current ?? 0) > 0;
    if (standing && knownMetamagic(own?.sheet_extra).includes('quickened')) {
      await beat();
      const again = await app.inject({
        method: 'POST', url: `/campaigns/${campaignId}/characters/${plan.npc.character_id}/spells/${plan.spell.id}/cast`, headers,
        payload: { targetIds: [plan.target.character_id], sceneId, metamagic: 'quickened' },
      });
      if (again.statusCode < 300) {
        const hit = (again.json().targets ?? []).find((entry: any) => entry.characterId === plan.target?.character_id);
        parts.push(`«Ускоренное заклинание»: ещё «${plan.spell.name}» по «${plan.target.name}»${hit?.attack ? `: ${hit.attack.hit ? 'попадание' : 'промах'}` : ''}${hit?.damage ? ` — ${hit.damage} урона` : ''}`);
      }
    }
  }
  const castText = (() => {
    if (!cast || !plan.spell) return null;
    if (cast.pending) return `творит «${plan.spell.name}» по «${plan.target?.name}» — ждём ответа на «Контрзаклинание»`;
    const hit = (cast.targets ?? []).find((entry: any) => entry.characterId === plan.target?.character_id);
    const how = hit?.attack ? (hit.attack.hit ? 'попадание' : 'промах') : hit?.save ? (hit.save.success ? 'спасся' : 'не спасся') : null;
    return `творит «${plan.spell.name}» по «${plan.target?.name}»${how ? `: ${how}` : ''}${hit?.damage ? ` — ${hit.damage} урона` : ''}`;
  })();
  return { cast, castText };
}
