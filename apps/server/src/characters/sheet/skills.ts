import { findSrdSkill, srdSkills } from '../../rules/srd-data.ts';

import { characterAccessLevel, requireCharacterAccess } from './access.ts';
import { characterParams, type CharacterParams, reject, uuid } from './shared.ts';
import { loadVisibleSet } from './visibility.ts';
import type { RouteContext } from '../../system/route-context.ts';

type CharacterSkillParams = CharacterParams & { skillIndex: string };

export const characterSkillParams = {
  type: 'object', required: ['campaignId', 'characterId', 'skillIndex'], additionalProperties: false,
  properties: { campaignId: uuid, characterId: uuid, skillIndex: { type: 'string', minLength: 1, maxLength: 100 } },
};

export function registerSkillRoutes(ctx: RouteContext) {
  const { app, auth, db, membership } = ctx;

  app.get<{ Params: CharacterParams }>(
    '/campaigns/:campaignId/characters/:characterId/skills',
    { schema: { params: characterParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;

      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId);
        const privileged = await characterAccessLevel(ctx, q, campaignId, characterId, userId, member);

        const rows = (
          await q.query(
            'SELECT skill_index, proficient, expertise FROM character_skills WHERE campaign_id=$1 AND character_id=$2',
            [campaignId, characterId],
          )
        ).rows;
        const byIndex = new Map(rows.map(r => [r.skill_index, r]));
        const hidden = privileged ? null : await loadVisibleSet(q, campaignId, characterId, 'skill', userId);

        const skills = srdSkills
          .filter(skill => !hidden?.has(`skill:${skill.index}`))
          .map(skill => ({
            index: skill.index,
            proficient: byIndex.get(skill.index)?.proficient ?? false,
            expertise: byIndex.get(skill.index)?.expertise ?? false,
          }));

        return { skills };
      });
    },
  );

  app.put<{ Params: CharacterSkillParams; Body: { proficient: boolean; expertise: boolean } }>(
    '/campaigns/:campaignId/characters/:characterId/skills/:skillIndex',
    {
      schema: {
        params: characterSkillParams,
        body: {
          type: 'object', required: ['proficient', 'expertise'], additionalProperties: false,
          properties: { proficient: { type: 'boolean' }, expertise: { type: 'boolean' } },
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId, skillIndex } = request.params;
      if (!findSrdSkill(skillIndex)) reject(404, 'Навык не найден.');
      const { proficient, expertise } = request.body;

      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        await requireCharacterAccess(ctx, q, campaignId, characterId, userId, member);

        const { rows } = await q.query(
          `INSERT INTO character_skills (campaign_id, character_id, skill_index, proficient, expertise)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (campaign_id, character_id, skill_index) DO UPDATE SET
             proficient=$4, expertise=$5
           RETURNING skill_index, proficient, expertise`,
          [campaignId, characterId, skillIndex, proficient, expertise && proficient],
        );

        return rows[0];
      });
    },
  );
}
