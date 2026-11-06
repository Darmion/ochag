import type { Queryable } from '../db.ts';
import { objectSchema, reject, uuid, type SceneFeatureContext } from '../tabletop/scene-feature.ts';

export function registerInspirationRoutes(ctx: SceneFeatureContext & {
  isCharacterManager: (q: Queryable, member: any, userId: string) => Promise<boolean>;
  canManageCharacter: (q: Queryable, member: any, userId: string, ownerUserId: string | null, characterId?: string | null) => Promise<boolean>;
}) {
  const { app, db, auth, membership, notifyCampaign, isCharacterManager, canManageCharacter } = ctx;

  app.post<{ Params: { campaignId: string; characterId: string }; Body: { inspired?: boolean; giveTo?: string } }>(
    '/campaigns/:campaignId/characters/:characterId/inspiration',
    {
      schema: {
        params: objectSchema({ campaignId: uuid, characterId: uuid }),
        body: { ...objectSchema({ inspired: { type: 'boolean' }, giveTo: uuid }, []), minProperties: 1, maxProperties: 1 },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const { inspired, giveTo } = request.body;

      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const character = (
          await q.query('SELECT id, name, kind, owner_user_id, inspiration FROM characters WHERE campaign_id=$1 AND id=$2 FOR UPDATE', [campaignId, characterId])
        ).rows[0] as any;
        if (!character) reject(404, 'Персонаж не найден.');
        if (character.kind !== 'character') reject(400, 'Вдохновение бывает у персонажей игроков.');

        if (giveTo === undefined) {
          if (!(await isCharacterManager(q, member, userId))) reject(403, 'Вдохновение дарует мастер.');
          if (character.inspiration === inspired) reject(400, inspired ? `У «${character.name}» уже есть вдохновение.` : `У «${character.name}» нет вдохновения.`);
          await q.query('UPDATE characters SET inspiration=$3, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, characterId, inspired]);
          return { from: null, to: inspired ? character : null, removed: inspired ? null : character };
        }

        if (!(await canManageCharacter(q, member, userId, character.owner_user_id))) reject(403, 'Передать можно своё вдохновение.');
        if (!character.inspiration) reject(400, `У «${character.name}» нет вдохновения.`);
        if (giveTo === characterId) reject(400, 'Передают другому персонажу.');
        const target = (
          await q.query('SELECT id, name, kind, inspiration FROM characters WHERE campaign_id=$1 AND id=$2 FOR UPDATE', [campaignId, giveTo])
        ).rows[0] as any;
        if (!target || target.kind !== 'character') reject(404, 'Передать можно персонажу игрока.');
        if (target.inspiration) reject(400, `У «${target.name}» уже есть вдохновение.`);
        await q.query('UPDATE characters SET inspiration=false, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, characterId]);
        await q.query('UPDATE characters SET inspiration=true, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, giveTo]);
        return { from: character, to: target, removed: null };
      });

      void notifyCampaign(campaignId, { type: 'changed' });
      for (const entry of [result.from, result.to, result.removed]) {
        if (entry) void notifyCampaign(campaignId, { type: 'character', characterId: entry.id });
      }
      if (result.to) {
        void notifyCampaign(campaignId, { type: 'float', characterId: result.to.id, text: 'Вдохновение', tone: 'level' });
        void notifyCampaign(campaignId, {
          type: 'notice', title: 'Вдохновение', tone: 'good',
          detail: result.from ? `${result.from.name} передаёт вдохновение: ${result.to.name}.` : `${result.to.name} получает вдохновение.`,
        });
      }
      return { inspired: Boolean(result.to && result.to.id === characterId), characterId: result.to?.id ?? characterId };
    },
  );
}
