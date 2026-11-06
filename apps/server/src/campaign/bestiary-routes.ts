import type { Queryable } from '../db.ts';
import { copyNames, createFromSnapshot, type ObjectSnapshot } from '../tabletop/scene/object-copies.ts';
import { freeSpotsAround, insertPlacement, startOf, type EncounterContext } from './encounter-routes.ts';
import { bumpScene, objectSchema, reject, uuid } from '../tabletop/scene-feature.ts';
import { footprintCells, occupiedCells } from '../../../../packages/domain/map/footprint.ts';
import {
  MONSTER_ATTRIBUTION, SRD_MONSTERS, attackBonusOf, attackText, challengeText, findMonster, monsterProficiency,
  monsterSheet, monsterTexts, rollHitPoints, type SrdMonster,
} from '../../../../packages/domain/world/bestiary.ts';
import { challengeExperience } from '../../../../packages/domain/character/experience.ts';

export type BestiaryContext = EncounterContext & {
  rollDie: (sides: number) => number;
};

type Pick = { index: string; count: number };

const MAX_TOTAL = 30;

const picksSchema = {
  type: 'array', minItems: 1, maxItems: 12,
  items: objectSchema({
    index: { type: 'string', minLength: 1, maxLength: 64 },
    count: { type: 'integer', minimum: 1, maximum: 20 },
  }),
};

function monstersOf(picks: Pick[]) {
  const chosen = picks.map(pick => {
    const monster = findMonster(pick.index);
    if (!monster) reject(400, `В бестиарии нет «${pick.index}».`);
    return { monster, count: pick.count };
  });
  if (chosen.reduce((sum, entry) => sum + entry.count, 0) > MAX_TOTAL) reject(400, `За раз — не больше ${MAX_TOTAL} существ.`);
  return chosen;
}

export function monsterSnapshot(monster: SrdMonster, hpMax: number, disposition = 'hostile'): ObjectSnapshot {
  const sheet = monsterSheet(monster, hpMax);
  return {
    version: 1,
    character: { ...sheet.character, disposition } as unknown as ObjectSnapshot['character'],
    effects: [],
    resources: [],
    skills: sheet.skills,
    saves: sheet.saves,
    spells: sheet.spells,
    spellSlots: sheet.spellSlots,
    weapons: sheet.weapons,
    visibility: [],
    access: [],
    state: null,
  };
}

async function namesFor(q: Queryable, campaignId: string, name: string, count: number) {
  if (count === 1) {
    const taken = (await q.query('SELECT 1 FROM characters WHERE campaign_id=$1 AND (name=$2 OR name LIKE $3) LIMIT 1', [campaignId, name, `${name} %`])).rows[0];
    if (!taken) return [name];
  }
  return copyNames(q, campaignId, name, count);
}

export function registerBestiaryRoutes(context: BestiaryContext) {
  const { app, db, auth, membership, getScene, notifyCampaign, loadPlacements, isCharacterManager, rollDie } = context;

  async function requireManager(q: Queryable, campaignId: string, userId: string) {
    const member = await membership(q, campaignId, userId, true);
    if (!(await isCharacterManager(q, member, userId))) reject(403, 'Существ из бестиария добавляет мастер (или участник с правом на персонажей).');
  }

  app.get('/srd/monsters', async request => {
    await auth(request);
    return {
      attribution: MONSTER_ATTRIBUTION,
      monsters: SRD_MONSTERS.map(monster => ({
        ...monster,
        crText: challengeText(monster.cr),
        xp: challengeExperience(monster.cr),
        proficiency: monsterProficiency(monster),
        texts: monsterTexts(monster),
        attackLines: monster.attacks.map(attackText),
        attackBonuses: monster.attacks.map(attack => attackBonusOf(monster, attack)),
      })),
    };
  });

  app.post<{
    Params: { campaignId: string };
    Body: { monsters: Pick[]; hp?: 'average' | 'roll'; disposition?: 'hostile' | 'neutral' | 'friendly'; sceneId?: string; x?: number; z?: number; hidden?: boolean };
  }>(
    '/campaigns/:campaignId/bestiary/spawn',
    {
      schema: {
        params: objectSchema({ campaignId: uuid }),
        body: objectSchema({
          monsters: picksSchema,
          hp: { type: 'string', enum: ['average', 'roll'] },
          disposition: { type: 'string', enum: ['hostile', 'neutral', 'friendly'] },
          sceneId: uuid,
          x: { type: 'number', minimum: -1000, maximum: 1000 },
          z: { type: 'number', minimum: -1000, maximum: 1000 },
          hidden: { type: 'boolean' },
        }, ['monsters']),
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const body = request.body;
      const chosen = monstersOf(body.monsters);

      const result = await db.transaction(async q => {
        await requireManager(q, campaignId, userId);

        let scene: any = null;
        let occupied = new Set<string>();
        let origin = { col: 0, row: 0 };
        if (body.sceneId) {
          scene = await getScene(q, campaignId, body.sceneId, true);
          const placements = await loadPlacements(q, campaignId, body.sceneId);
          occupied = new Set(placements.flatMap(placement =>
            occupiedCells(scene, placement.world_x, placement.world_z, footprintCells(placement.size)).map(cell => `${cell.col}:${cell.row}`)));
          origin = startOf(scene, body.x ?? 0, body.z ?? 0, 1);
        }

        const characters: Array<{ id: string; name: string; index: string; hp: number }> = [];
        const placements: Array<{ id: string; characterId: string; x: number; z: number }> = [];

        for (const { monster, count } of chosen) {
          const names = await namesFor(q, campaignId, monster.nameRu, count);
          for (const name of names) {
            const hp = body.hp === 'roll' ? rollHitPoints(monster.hitDice, rollDie) : monster.hp;
            const id = await createFromSnapshot(q, campaignId, monsterSnapshot(monster, hp, body.disposition ?? 'hostile'), name, userId);
            characters.push({ id, name, index: monster.index, hp });

            if (scene) {
              const n = footprintCells(monster.size);
              const fits = (col: number, row: number) => {
                for (let r = row; r < row + n; r += 1) {
                  for (let c = col; c < col + n; c += 1) {
                    if (c < 0 || r < 0 || c >= scene.width_cells || r >= scene.height_cells || occupied.has(`${c}:${r}`)) return false;
                  }
                }
                return true;
              };
              let spot: { col: number; row: number } | undefined = fits(origin.col, origin.row) ? origin : undefined;
              if (spot) {
                for (let r = spot.row; r < spot.row + n; r += 1) for (let c = spot.col; c < spot.col + n; c += 1) occupied.add(`${c}:${r}`);
              } else {
                spot = freeSpotsAround(scene, origin, n, occupied, 1)[0];
              }
              if (!spot) reject(400, 'На карте не хватает свободных клеток для стольких существ.');
              const x = spot.col + n / 2 - scene.width_cells / 2;
              const z = spot.row + n / 2 - scene.height_cells / 2;
              const placementId = await insertPlacement(q, campaignId, body.sceneId!, id, {
                x, y: 0, z, rotationY: 0, scale: 1, snapToGrid: true, hidden: body.hidden === true,
              }, userId);
              placements.push({ id: placementId, characterId: id, x, z });
            }
          }
        }

        if (body.sceneId) await bumpScene(q, body.sceneId);
        return { characters, placements };
      });

      void notifyCampaign(campaignId, { type: 'changed' });
      return reply.code(201).send(result);
    },
  );

  app.post<{ Params: { campaignId: string }; Body: { name: string; monsters: Pick[] } }>(
    '/campaigns/:campaignId/encounters/bestiary',
    {
      schema: {
        params: objectSchema({ campaignId: uuid }),
        body: objectSchema({ name: { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' }, monsters: picksSchema }),
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const chosen = monstersOf(request.body.monsters);

      const flat = chosen.flatMap(({ monster, count }) => Array.from({ length: count }, () => monster));
      const step = Math.max(...flat.map(monster => footprintCells(monster.size)));
      const columns = Math.ceil(Math.sqrt(flat.length));
      const rows = Math.ceil(flat.length / columns);
      const members = flat.map((monster, index) => ({
        snapshot: monsterSnapshot(monster, monster.hp),
        dx: ((index % columns) - Math.floor((columns - 1) / 2)) * step,
        dz: (Math.floor(index / columns) - Math.floor((rows - 1) / 2)) * step,
        y: 0, rotationY: 0, scale: 1, snapToGrid: true, hidden: false,
      }));
      const row = await db.transaction(async q => {
        await requireManager(q, campaignId, userId);
        return (
          await q.query(
            `INSERT INTO campaign_encounters (campaign_id, name, members, created_by)
             VALUES ($1,$2,$3,$4) RETURNING id, name, created_at`,
            [campaignId, request.body.name.trim(), JSON.stringify(members), userId],
          )
        ).rows[0];
      });

      return reply.code(201).send({
        id: row.id, name: row.name, created_at: row.created_at,
        members: members.map(member => ({ name: String((member.snapshot.character as any).name), kind: 'npc', disposition: 'hostile', dx: member.dx, dz: member.dz })),
      });
    },
  );
}
