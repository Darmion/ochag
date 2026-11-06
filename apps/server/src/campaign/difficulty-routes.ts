import type { Queryable } from '../db.ts';
import { objectSchema, reject, uuid } from '../tabletop/scene-feature.ts';
import type { EncounterContext } from './encounter-routes.ts';
import { encounterDifficulty } from '../../../../packages/domain/combat/encounter-difficulty.ts';
import { challengeExperience, experienceFor, levelForExperience } from '../../../../packages/domain/character/experience.ts';
import { findMonster } from '../../../../packages/domain/world/bestiary.ts';
import { relationsOf } from './factions.ts';

export function registerDifficultyRoutes(context: EncounterContext) {
  const { app, db, auth, membership, getScene, isCharacterManager } = context;

  async function party(q: Queryable, campaignId: string, sceneId: string | undefined) {
    const columns = 'c.id, c.name, c.level, c.experience';
    const alive = `NOT EXISTS (SELECT 1 FROM character_effects e WHERE e.campaign_id=c.campaign_id AND e.character_id=c.id AND e.active AND e.effect_code='dead')`;
    let rows: any[] = [];
    if (sceneId) {
      rows = (
        await q.query(
          `SELECT DISTINCT ${columns} FROM scene_objects p JOIN characters c ON c.campaign_id=p.campaign_id AND c.id=p.character_id
           WHERE p.campaign_id=$1 AND p.scene_id=$2 AND p.parent_object_id IS NULL AND c.kind='character' AND ${alive}`,
          [campaignId, sceneId],
        )
      ).rows;
    }
    if (!rows.length) {
      rows = (await q.query(`SELECT ${columns} FROM characters c WHERE c.campaign_id=$1 AND c.kind='character' AND ${alive} ORDER BY c.name`, [campaignId])).rows;
    }
    return rows.map(row => ({
      id: row.id as string,
      name: row.name as string,
      level: typeof row.level === 'number' ? row.level : levelForExperience(Number(row.experience ?? 0)),
    }));
  }

  app.post<{ Params: { campaignId: string }; Body: { sceneId?: string; monsters?: Array<{ index: string; count: number }>; encounterId?: string } }>(
    '/campaigns/:campaignId/difficulty',
    {
      schema: {
        params: objectSchema({ campaignId: uuid }),
        body: objectSchema({
          sceneId: uuid,
          encounterId: uuid,
          monsters: {
            type: 'array', maxItems: 12,
            items: objectSchema({ index: { type: 'string', minLength: 1, maxLength: 64 }, count: { type: 'integer', minimum: 1, maximum: 20 } }),
          },
        }, []),
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const { sceneId, monsters: picks, encounterId } = request.body;

      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        if (!(await isCharacterManager(q, member, userId))) reject(403, 'Сложность встречи видит мастер.');
        if (sceneId) await getScene(q, campaignId, sceneId);

        let foes: Array<{ name: string; xp: number }> = [];
        if (picks) {
          for (const pick of picks) {
            const monster = findMonster(pick.index);
            if (!monster) reject(400, `В бестиарии нет «${pick.index}».`);
            for (let i = 0; i < pick.count; i += 1) foes.push({ name: monster.nameRu, xp: challengeExperience(monster.cr) ?? 0 });
          }
        } else if (encounterId) {
          const encounter = (await q.query('SELECT members FROM campaign_encounters WHERE campaign_id=$1 AND id=$2', [campaignId, encounterId])).rows[0];
          if (!encounter) reject(404, 'Встреча не найдена.');
          foes = (encounter.members as any[])
            .filter(entry => entry.snapshot?.character?.kind === 'npc' && (entry.snapshot.character.disposition ?? 'hostile') === 'hostile')
            .map(entry => ({ name: String(entry.snapshot.character.name), xp: experienceFor(entry.snapshot.character) }));
        } else if (sceneId) {
          const rows = (
            await q.query(
              `SELECT DISTINCT c.id, c.name, c.kind, c.disposition, c.factions_explicit, c.xp_award, c.challenge_rating::float8 AS challenge_rating
               FROM scene_objects p JOIN characters c ON c.campaign_id=p.campaign_id AND c.id=p.character_id
               WHERE p.campaign_id=$1 AND p.scene_id=$2 AND p.parent_object_id IS NULL AND c.kind='npc' AND c.hp_current > 0
                 AND NOT EXISTS (SELECT 1 FROM character_effects e WHERE e.campaign_id=c.campaign_id AND e.character_id=c.id AND e.active AND e.effect_code='dead')`,
              [campaignId, sceneId],
            )
          ).rows as any[];
          const relations = await relationsOf(q, campaignId, rows);
          foes = rows.filter(row => relations.withParty(row.id) === 'enemy').map(row => ({ name: row.name as string, xp: experienceFor(row) }));
        } else {
          reject(400, 'Укажите сцену, состав из бестиария или встречу.');
        }

        const heroes = await party(q, campaignId, sceneId);
        return {
          party: heroes,
          foes,
          ...encounterDifficulty(heroes.map(hero => hero.level), foes.map(foe => foe.xp)),
        };
      });
    },
  );
}
