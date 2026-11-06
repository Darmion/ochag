import { findSrdSpell } from '../rules/srd-data.ts';
import { applyRefEverywhere, SPELL_REF } from '../characters/spell-refs.ts';

import { reject, uuid } from '../characters/sheet/shared.ts';
import type { RouteContext } from '../system/route-context.ts';

export function registerSpellRefRoutes(ctx: RouteContext) {
  const { app, auth, db, membership } = ctx;

  app.put<{ Params: { campaignId: string; ref: string }; Body: { source: 'srd' | 'custom' | 'skip'; srdIndex?: string; customSpellId?: string } }>(
    '/campaigns/:campaignId/spell-refs/:ref',
    {
      schema: {
        params: { type: 'object', required: ['campaignId', 'ref'], additionalProperties: false, properties: { campaignId: uuid, ref: { type: 'string', pattern: SPELL_REF.source } } },
        body: {
          type: 'object', required: ['source'], additionalProperties: false,
          properties: { source: { type: 'string', enum: ['srd', 'custom', 'skip'] }, srdIndex: { type: 'string', minLength: 1, maxLength: 100 }, customSpellId: uuid },
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, ref } = request.params;
      const { source, srdIndex, customSpellId } = request.body;
      if (source === 'srd' && (!srdIndex || !findSrdSpell(srdIndex))) reject(400, 'Заклинание SRD не найдено.');
      if (source === 'custom' && !customSpellId) reject(400, 'Укажите заклинание кампании.');
      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const gm = member.owner_user_id === userId || member.is_full_gm;
        if (source === 'custom') {
          const custom = (await q.query('SELECT status FROM campaign_spells WHERE campaign_id=$1 AND id=$2', [campaignId, customSpellId])).rows[0];
          if (!custom) reject(404, 'Заклинание кампании не найдено.');
          if (custom.status !== 'approved') reject(400, 'Заклинание кампании ещё не одобрено мастером.');
        }
        const existing = (await q.query('SELECT mapped_by FROM campaign_spell_refs WHERE campaign_id=$1 AND ref=$2 FOR UPDATE', [campaignId, ref])).rows[0];
        if (existing && existing.mapped_by !== userId && !gm) reject(403, 'Это сопоставление сделал другой участник — поменять его может мастер.');
        await q.query(
          `INSERT INTO campaign_spell_refs (campaign_id, ref, source, srd_index, custom_spell_id, mapped_by)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (campaign_id, ref) DO UPDATE SET source=EXCLUDED.source, srd_index=EXCLUDED.srd_index,
             custom_spell_id=EXCLUDED.custom_spell_id, mapped_by=EXCLUDED.mapped_by, mapped_at=now()`,
          [campaignId, ref, source, source === 'srd' ? srdIndex : null, source === 'custom' ? customSpellId : null, userId],
        );
        const added = source === 'skip'
          ? 0
          : await applyRefEverywhere(q, campaignId, ref, { source, srdIndex: source === 'srd' ? srdIndex! : null, customSpellId: source === 'custom' ? customSpellId! : null });
        return { ref, source, added };
      });
    },
  );
}
