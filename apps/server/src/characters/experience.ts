import type { Queryable } from '../db.ts';
import { objectSchema, reject, uuid, type SceneFeatureContext } from '../tabletop/scene-feature.ts';
import { abilityModifier } from '../../../../packages/domain/dice/dice.ts';
import { relationsOf } from '../campaign/factions.ts';
import { guessHitDie } from '../../../../packages/domain/character/rest.ts';
import { advanceClassText, characterClassLevels, characterClassText, hitDieForClass } from '../../../../packages/domain/character/classes.ts';
import { applyClassSlots } from './class-slots.ts';
import { experienceFor, levelForExperience, levelUpHitPoints, splitExperience } from '../../../../packages/domain/character/experience.ts';

export type ExperienceAward = {
  characterId: string;
  name: string;
  amount: number;
  experience: number;
  level: number;
  leveledUp: boolean;
  readyLevel: number | null;
  hpGain: number;
  slotsUpdated: boolean;
};

export type ExperienceEvent = { reason: string; awards: ExperienceAward[] };

type Context = {
  campaignFlag: (q: Queryable, campaignId: string, key: string) => Promise<boolean | null>;
};

export function createExperience({ campaignFlag }: Context) {
  async function grant(q: Queryable, campaignId: string, characterId: string, amount: number): Promise<ExperienceAward | null> {
    const row = (
      await q.query(
        `SELECT id, name, kind, level, experience, constitution, hp_current, hp_max, hit_die, sheet_extra, class_name
         FROM characters WHERE campaign_id=$1 AND id=$2 FOR UPDATE`,
        [campaignId, characterId],
      )
    ).rows[0] as any;
    if (!row || row.kind === 'object') return null;

    const experience = Math.min(10_000_000, row.experience + Math.max(0, amount));
    const current = row.level ?? 1;
    const reached = Math.max(current, levelForExperience(experience));
    const auto = (await campaignFlag(q, campaignId, 'auto_level')) !== false;
    const choices = row.kind === 'character' && (await campaignFlag(q, campaignId, 'level_choices')) !== false;
    let level = row.level;
    let hpGain = 0;
    let className: string | null = row.class_name;
    if (reached > current && auto && !choices) {
      const parsed = characterClassLevels(row);
      const die = parsed.multiclass ? hitDieForClass(parsed.classes[0]!.id) : row.hit_die ?? guessHitDie(characterClassText(row));
      hpGain = levelUpHitPoints(die, abilityModifier(row.constitution), reached - current);
      if (parsed.multiclass) {
        let text = characterClassText(row);
        for (let step = current; step < reached; step += 1) text = advanceClassText(text, step, parsed.classes[0]!.id);
        className = text;
      }
      level = reached;
    }

    await q.query(
      `UPDATE characters SET experience=$3, level=$4, hp_max=hp_max+$5,
         hp_current = CASE WHEN hp_current > 0 THEN hp_current + $5 ELSE hp_current END,
         class_name=$6, revision=revision+1
       WHERE campaign_id=$1 AND id=$2`,
      [campaignId, characterId, experience, level, hpGain, className],
    );
    const slotsUpdated = (level ?? 1) > current ? Boolean((await applyClassSlots(q, campaignId, characterId))?.slots) : false;

    return {
      characterId, name: row.name, amount, experience, level: level ?? 1,
      leveledUp: hpGain > 0 || (level ?? 1) > current,
      readyLevel: (!auto || choices) && reached > current && (level ?? 1) < reached ? reached : null,
      hpGain,
      slotsUpdated,
    };
  }

  async function awardForDefeat(q: Queryable, campaignId: string, npcId: string): Promise<ExperienceEvent | null> {
    const npc = (
      await q.query(
        `SELECT id, name, kind, disposition, factions_explicit, xp_award, challenge_rating FROM characters
         WHERE campaign_id=$1 AND id=$2 AND kind='npc' AND NOT xp_awarded
         FOR UPDATE`,
        [campaignId, npcId],
      )
    ).rows[0] as any;
    if (!npc) return null;
    const total = experienceFor(npc);
    if (total <= 0) return null;

    const present = (
      await q.query(
        `SELECT DISTINCT c.id, c.name, c.kind, c.disposition, c.factions_explicit FROM scene_objects mine
         JOIN scene_objects p ON p.campaign_id=mine.campaign_id AND p.scene_id=mine.scene_id
         JOIN characters c ON c.campaign_id=p.campaign_id AND c.id=p.character_id
         WHERE mine.campaign_id=$1 AND mine.character_id=$2 AND c.kind='character'
           AND NOT EXISTS (
             SELECT 1 FROM character_effects e
             WHERE e.campaign_id=c.campaign_id AND e.character_id=c.id AND e.active AND (e.effect_code='dead' OR e.effect_code='exhaustion_6')
           )
         ORDER BY c.name`,
        [campaignId, npcId],
      )
    ).rows as Array<{ id: string; name: string; kind: string; disposition: string | null; factions_explicit: boolean }>;
    const relations = await relationsOf(q, campaignId, [npc, ...present]);
    const enemies = present.filter(member => relations.enemies(member.id, npcId));
    const party = enemies.length ? enemies : present.filter(member => !relations.allies(member.id, npcId));
    const share = splitExperience(total, party.length);
    if (!share) return null;
    await q.query('UPDATE characters SET xp_awarded=true WHERE campaign_id=$1 AND id=$2', [campaignId, npcId]);

    const awards: ExperienceAward[] = [];
    for (const member of party) {
      const award = await grant(q, campaignId, member.id, share);
      if (award) awards.push(award);
    }
    return { reason: `${npc.name} повержен — ${total} опыта`, awards };
  }

  return { grant, awardForDefeat };
}

export type Experience = ReturnType<typeof createExperience>;

export function announceExperience(
  notifyCampaign: (campaignId: string, message: Record<string, unknown>) => Promise<void>,
  campaignId: string,
  event: ExperienceEvent,
) {
  void notifyCampaign(campaignId, { type: 'experience', reason: event.reason, awards: event.awards });
  void notifyCampaign(campaignId, { type: 'changed' });
  for (const award of event.awards) void notifyCampaign(campaignId, { type: 'character', characterId: award.characterId });
}

export function registerExperienceRoutes(ctx: SceneFeatureContext & {
  experience: Experience;
  isCharacterManager: (q: Queryable, member: any, userId: string) => Promise<boolean>;
}) {
  const { app, db, auth, membership, notifyCampaign, experience, isCharacterManager } = ctx;

  app.post<{ Params: { campaignId: string }; Body: { characterIds: string[]; amount: number; split?: boolean; reason?: string } }>(
    '/campaigns/:campaignId/experience',
    {
      schema: {
        params: objectSchema({ campaignId: uuid }),
        body: objectSchema({
          characterIds: { type: 'array', minItems: 1, maxItems: 30, uniqueItems: true, items: uuid },
          amount: { type: 'integer', minimum: 1, maximum: 1000000 },
          split: { type: 'boolean' },
          reason: { type: 'string', maxLength: 200 },
        }, ['characterIds', 'amount']),
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const { characterIds, amount, split, reason } = request.body;

      const event = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        if (!(await isCharacterManager(q, member, userId))) reject(403, 'Опыт выдаёт мастер.');
        const known = (
          await q.query(`SELECT id FROM characters WHERE campaign_id=$1 AND id = ANY($2::uuid[]) AND kind <> 'object'`, [campaignId, characterIds])
        ).rows.map(row => row.id as string);
        if (known.length !== characterIds.length) reject(404, 'Не все получатели найдены (опыт получают существа).');
        const share = split ? splitExperience(amount, characterIds.length) : amount;
        if (!share) reject(400, 'Опыта слишком мало, чтобы поделить.');
        const awards: ExperienceAward[] = [];
        for (const id of characterIds) {
          const award = await experience.grant(q, campaignId, id, share);
          if (award) awards.push(award);
        }
        return { reason: reason?.trim() || 'Награда мастера', awards };
      });

      announceExperience(notifyCampaign, campaignId, event);
      return reply.code(201).send(event);
    },
  );
}
