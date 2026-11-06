import type { Queryable } from '../db.ts';
import { copyNames, createFromSnapshot, snapshotObject, type ObjectSnapshot } from '../tabletop/scene/object-copies.ts';
import { bumpScene, objectSchema, reject, uuid, type SceneFeatureContext } from '../tabletop/scene-feature.ts';
import { footprintCells, occupiedCells } from '../../../../packages/domain/map/footprint.ts';

export type PlacementView = {
  id: string;
  character_id: string;
  kind: 'character' | 'npc' | 'object';
  name: string;
  size: string;
  world_x: number;
  world_y: number;
  world_z: number;
  rotation_y: number;
  scale: number;
  snap_to_grid: boolean;
  hidden: boolean;
};

export type EncounterContext = SceneFeatureContext & {
  loadPlacements: (q: Queryable, campaignId: string, sceneId: string) => Promise<PlacementView[]>;
  isCharacterManager: (q: Queryable, member: any, userId: string) => Promise<boolean>;
};

type Member = {
  snapshot: ObjectSnapshot;
  dx: number;
  dz: number;
  y: number;
  rotationY: number;
  scale: number;
  snapToGrid: boolean;
  hidden: boolean;
};

const MAX_COPIES = 20;
const MAX_MEMBERS = 50;

export function startOf(scene: any, x: number, z: number, n: number) {
  return {
    col: Math.round(x + scene.width_cells / 2 - n / 2),
    row: Math.round(z + scene.height_cells / 2 - n / 2),
  };
}

function cellOf(scene: any, x: number, z: number) {
  return {
    col: Math.round(x + scene.width_cells / 2 - 0.5),
    row: Math.round(z + scene.height_cells / 2 - 0.5),
  };
}

function cellCenter(scene: any, col: number, row: number) {
  return { x: col - scene.width_cells / 2 + 0.5, z: row - scene.height_cells / 2 + 0.5 };
}

function onBoard(scene: any, col: number, row: number) {
  return col >= 0 && row >= 0 && col < scene.width_cells && row < scene.height_cells;
}

export function freeSpotsAround(scene: any, origin: { col: number; row: number }, n: number, occupied: Set<string>, count: number) {
  const found: Array<{ col: number; row: number }> = [];
  const maxRing = Math.max(scene.width_cells, scene.height_cells);
  const fits = (col: number, row: number) => {
    for (let r = row; r < row + n; r += 1) {
      for (let c = col; c < col + n; c += 1) {
        if (!onBoard(scene, c, r) || occupied.has(`${c}:${r}`)) return false;
      }
    }
    return true;
  };

  for (let ring = 1; ring <= maxRing && found.length < count; ring += 1) {
    for (let dz = -ring; dz <= ring && found.length < count; dz += 1) {
      for (let dx = -ring; dx <= ring && found.length < count; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        const spot = { col: origin.col + dx * n, row: origin.row + dz * n };
        if (!fits(spot.col, spot.row)) continue;
        for (let r = spot.row; r < spot.row + n; r += 1) {
          for (let c = spot.col; c < spot.col + n; c += 1) occupied.add(`${c}:${r}`);
        }
        found.push(spot);
      }
    }
  }

  return found;
}

export async function insertPlacement(
  q: Queryable,
  campaignId: string,
  sceneId: string,
  characterId: string,
  place: { x: number; y: number; z: number; rotationY: number; scale: number; snapToGrid: boolean; hidden: boolean },
  userId: string,
) {
  return (
    await q.query(
      `INSERT INTO scene_objects (
         campaign_id, scene_id, character_id, x, y, z, rotation_y, scale, snap_to_grid, hidden, created_by
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [campaignId, sceneId, characterId, place.x, place.y, place.z, place.rotationY, place.scale, place.snapToGrid, place.hidden, userId],
    )
  ).rows[0].id as string;
}

function summary(row: any) {
  const members = (row.members as Member[]).map(member => ({
    name: String(member.snapshot.character.name),
    kind: member.snapshot.character.kind,
    disposition: member.snapshot.character.disposition ?? null,
    dx: member.dx,
    dz: member.dz,
  }));

  return { id: row.id, name: row.name, created_at: row.created_at, members };
}

export function registerEncounterRoutes(context: EncounterContext) {
  const { app, db, auth, membership, getScene, notifyCampaign, loadPlacements, isCharacterManager } = context;

  async function requireManager(q: Queryable, campaignId: string, userId: string) {
    const member = await membership(q, campaignId, userId, true);
    if (!(await isCharacterManager(q, member, userId))) {
      reject(403, 'Копировать объекты и собирать встречи может мастер (или участник с правом на персонажей).');
    }
    return member;
  }

  app.post<{
    Params: { campaignId: string; characterId: string };
    Body: { count: number; sceneId?: string };
  }>(
    '/campaigns/:campaignId/characters/:characterId/duplicate',
    {
      schema: {
        params: objectSchema({ campaignId: uuid, characterId: uuid }),
        body: objectSchema(
          { count: { type: 'integer', minimum: 1, maximum: MAX_COPIES }, sceneId: uuid },
          ['count'],
        ),
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const { count, sceneId } = request.body;

      const result = await db.transaction(async q => {
        await requireManager(q, campaignId, userId);

        const snapshot = await snapshotObject(q, campaignId, characterId);
        if (!snapshot) reject(404, 'Объект не найден в этой кампании.');
        if (snapshot.character.kind === 'character') {
          reject(400, 'Персонажа игрока не копируют — копировать можно НПС и предметы.');
        }

        let spots: Array<{ x: number; y: number; z: number; rotationY: number; scale: number; snapToGrid: boolean; hidden: boolean }> = [];

        if (sceneId) {
          const scene = await getScene(q, campaignId, sceneId, true);
          const placements = await loadPlacements(q, campaignId, sceneId);
          const original = placements.find(placement => placement.character_id === characterId);
          if (!original) reject(400, 'Этот объект не стоит на этой сцене — копии некуда поставить рядом.');

          const occupied = new Set(placements.flatMap(placement =>
            occupiedCells(scene, placement.world_x, placement.world_z, footprintCells(placement.size))
              .map(cell => `${cell.col}:${cell.row}`)));
          const n = footprintCells(original.size);
          const origin = startOf(scene, original.world_x, original.world_z, n);
          const found = freeSpotsAround(scene, origin, n, occupied, count);
          if (found.length < count) reject(400, 'На карте не хватает свободных клеток для стольких копий.');

          spots = found.map(spot => ({
            x: spot.col + n / 2 - scene.width_cells / 2,
            z: spot.row + n / 2 - scene.height_cells / 2,
            y: original.world_y, rotationY: original.rotation_y, scale: original.scale,
            snapToGrid: original.snap_to_grid, hidden: original.hidden,
          }));
        }

        const names = await copyNames(q, campaignId, String(snapshot.character.name), count);
        const characters: Array<{ id: string; name: string }> = [];
        const placements: Array<{ id: string; characterId: string; x: number; z: number }> = [];

        for (const [index, name] of names.entries()) {
          const id = await createFromSnapshot(q, campaignId, snapshot, name, userId);
          characters.push({ id, name });

          const spot = spots[index];
          if (sceneId && spot) {
            placements.push({ id: await insertPlacement(q, campaignId, sceneId, id, spot, userId), characterId: id, x: spot.x, z: spot.z });
          }
        }

        if (sceneId) await bumpScene(q, sceneId);
        return { characters, placements };
      });

      void notifyCampaign(campaignId, { type: 'changed' });
      return reply.code(201).send(result);
    },
  );

  app.get<{ Params: { campaignId: string } }>(
    '/campaigns/:campaignId/encounters',
    { schema: { params: objectSchema({ campaignId: uuid }) } },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;

      return db.transaction(async q => {
        await requireManager(q, campaignId, userId);
        const rows = (
          await q.query(
            `SELECT id, name, members, created_at FROM campaign_encounters
             WHERE campaign_id=$1 ORDER BY created_at, id`,
            [campaignId],
          )
        ).rows;
        return rows.map(summary);
      });
    },
  );

  app.post<{
    Params: { campaignId: string };
    Body: { name: string; sceneId: string; objectIds: string[] };
  }>(
    '/campaigns/:campaignId/encounters',
    {
      schema: {
        params: objectSchema({ campaignId: uuid }),
        body: objectSchema({
          name: { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' },
          sceneId: uuid,
          objectIds: { type: 'array', minItems: 1, maxItems: MAX_MEMBERS, uniqueItems: true, items: uuid },
        }),
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const { name, sceneId, objectIds } = request.body;

      const created = await db.transaction(async q => {
        await requireManager(q, campaignId, userId);
        const scene = await getScene(q, campaignId, sceneId);
        const placements = new Map((await loadPlacements(q, campaignId, sceneId)).map(placement => [placement.id, placement]));

        const chosen = objectIds.map(id => {
          const placement = placements.get(id);
          if (!placement) reject(400, 'Не все выбранные объекты стоят на этой сцене.');
          if (placement.kind === 'character') reject(400, 'Персонажи игроков во встречу не входят — только НПС и предметы.');
          return placement;
        });

        const middle = cellOf(
          scene,
          chosen.reduce((sum, placement) => sum + placement.world_x, 0) / chosen.length,
          chosen.reduce((sum, placement) => sum + placement.world_z, 0) / chosen.length,
        );
        const center = cellCenter(scene, middle.col, middle.row);

        const members: Member[] = [];
        for (const placement of chosen) {
          const snapshot = await snapshotObject(q, campaignId, placement.character_id);
          if (!snapshot) continue;
          members.push({
            snapshot,
            dx: placement.world_x - center.x,
            dz: placement.world_z - center.z,
            y: placement.world_y,
            rotationY: placement.rotation_y,
            scale: placement.scale,
            snapToGrid: placement.snap_to_grid,
            hidden: placement.hidden,
          });
        }

        const row = (
          await q.query(
            `INSERT INTO campaign_encounters (campaign_id, name, members, created_by)
             VALUES ($1,$2,$3,$4)
             RETURNING id, name, members, created_at`,
            [campaignId, name.trim(), JSON.stringify(members), userId],
          )
        ).rows[0];

        return summary(row);
      });

      return reply.code(201).send(created);
    },
  );

  app.delete<{ Params: { campaignId: string; encounterId: string } }>(
    '/campaigns/:campaignId/encounters/:encounterId',
    { schema: { params: objectSchema({ campaignId: uuid, encounterId: uuid }) } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, encounterId } = request.params;

      await db.transaction(async q => {
        await requireManager(q, campaignId, userId);
        const deleted = await q.query(
          'DELETE FROM campaign_encounters WHERE campaign_id=$1 AND id=$2 RETURNING id',
          [campaignId, encounterId],
        );
        if (!deleted.rows[0]) reject(404, 'Встреча не найдена.');
      });

      return reply.code(204).send();
    },
  );

  app.post<{
    Params: { campaignId: string; encounterId: string };
    Body: { sceneId: string; x: number; z: number };
  }>(
    '/campaigns/:campaignId/encounters/:encounterId/deploy',
    {
      schema: {
        params: objectSchema({ campaignId: uuid, encounterId: uuid }),
        body: objectSchema({
          sceneId: uuid,
          x: { type: 'number', minimum: -1000, maximum: 1000 },
          z: { type: 'number', minimum: -1000, maximum: 1000 },
        }),
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, encounterId } = request.params;
      const body = request.body;

      const result = await db.transaction(async q => {
        await requireManager(q, campaignId, userId);
        const scene = await getScene(q, campaignId, body.sceneId, true);

        const encounter = (
          await q.query('SELECT members FROM campaign_encounters WHERE campaign_id=$1 AND id=$2', [campaignId, encounterId])
        ).rows[0];
        if (!encounter) reject(404, 'Встреча не найдена.');

        const target = cellOf(scene, body.x, body.z);
        if (!onBoard(scene, target.col, target.row)) reject(400, 'Точка вне карты.');
        const center = cellCenter(scene, target.col, target.row);
        const halfWidth = scene.width_cells / 2;
        const halfHeight = scene.height_cells / 2;
        const clamp = (value: number, half: number) => Math.max(-half + 0.5, Math.min(half - 0.5, value));

        const characters: Array<{ id: string; name: string }> = [];
        const placements: Array<{ id: string; characterId: string; x: number; z: number }> = [];

        for (const member of encounter.members as Member[]) {
          const [name] = await copyNames(q, campaignId, String(member.snapshot.character.name), 1);
          const id = await createFromSnapshot(q, campaignId, member.snapshot, name!, userId);
          characters.push({ id, name: name! });

          const x = clamp(center.x + member.dx, halfWidth);
          const z = clamp(center.z + member.dz, halfHeight);
          const placementId = await insertPlacement(q, campaignId, body.sceneId, id, {
            x, y: member.y ?? 0, z,
            rotationY: member.rotationY ?? 0, scale: member.scale ?? 1,
            snapToGrid: member.snapToGrid !== false, hidden: member.hidden === true,
          }, userId);
          placements.push({ id: placementId, characterId: id, x, z });
        }

        await bumpScene(q, body.sceneId);
        return { characters, placements };
      });

      void notifyCampaign(campaignId, { type: 'changed' });
      return reply.code(201).send(result);
    },
  );
}

