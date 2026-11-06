import type { Queryable } from '../db.ts';
import { bumpScene, objectSchema, reject, uuid, type SceneFeatureContext } from '../tabletop/scene-feature.ts';
import { freeSpotsAround, insertPlacement, startOf, type PlacementView } from '../campaign/encounter-routes.ts';
import { footprintCells, isFootprintCenter, occupiedCells, snapFootprint } from '../../../../packages/domain/map/footprint.ts';
import { syncItem } from './magic-items.ts';

type Node = {
  id: string;
  name: string;
  kind: 'character' | 'npc' | 'object';
  owner_user_id: string | null;
  shared: boolean;
  container_id: string | null;
};

type Rights = { sceneManager: boolean; characterManager: boolean; editGrants: Set<string> };

export type InventoryContext = SceneFeatureContext & {
  rightsOf: (q: Queryable, member: any, userId: string) => Promise<Rights>;
  loadPlacements: (q: Queryable, campaignId: string, sceneId: string) => Promise<PlacementView[]>;
  detachChildren: (q: Queryable, campaignId: string, removed: Array<{ id: string; scene_id: string }>) => Promise<void>;
};

const MAX_DEPTH = 8;

async function loadTree(q: Queryable, campaignId: string) {
  const rows = (
    await q.query(
      `SELECT id, name, kind, owner_user_id, shared, container_id FROM characters WHERE campaign_id=$1`,
      [campaignId],
    )
  ).rows as Node[];
  return new Map(rows.map(row => [row.id, row]));
}

function controls(rights: Rights, userId: string, node: Node) {
  return rights.sceneManager || rights.characterManager || node.owner_user_id === userId || rights.editGrants.has(node.id);
}

function ancestors(tree: Map<string, Node>, node: Node) {
  const chain: Node[] = [];
  let current = node.container_id ? tree.get(node.container_id) : undefined;
  while (current && chain.length < MAX_DEPTH) {
    chain.push(current);
    current = current.container_id ? tree.get(current.container_id) : undefined;
  }
  return chain;
}

function canOpen(tree: Map<string, Node>, rights: Rights, userId: string, container: Node) {
  return [container, ...ancestors(tree, container)].some(node => controls(rights, userId, node) || node.shared);
}

function canHandle(tree: Map<string, Node>, rights: Rights, userId: string, item: Node) {
  if (controls(rights, userId, item)) return true;
  const container = item.container_id ? tree.get(item.container_id) : undefined;
  return Boolean(container && canOpen(tree, rights, userId, container));
}

export function registerInventoryRoutes(context: InventoryContext) {
  const { app, db, auth, membership, getScene, notifyCampaign, rightsOf, loadPlacements, detachChildren } = context;
  const characterParams = objectSchema({ campaignId: uuid, characterId: uuid });

  app.get<{ Params: { campaignId: string; characterId: string } }>(
    '/campaigns/:campaignId/characters/:characterId/contents',
    { schema: { params: characterParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;

      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId);
        const rights = await rightsOf(q, member, userId);
        const tree = await loadTree(q, campaignId);
        const container = tree.get(characterId);
        if (!container) reject(404, 'Объект не найден.');
        if (!canOpen(tree, rights, userId, container)) reject(403, 'Заглянуть внутрь может тот, кто управляет этим объектом.');

        const contents = (
          await q.query(
            `SELECT c.id, c.name, c.kind, c.size, c.image_asset_id, c.model_asset_id, c.owner_user_id,
                    c.price_cp, c.weight_lb::float8 AS weight_lb,
                    (SELECT count(*)::int FROM characters inner_c
                     WHERE inner_c.campaign_id = c.campaign_id AND inner_c.container_id = c.id) AS contents_count
             FROM characters c
             WHERE c.campaign_id=$1 AND c.container_id=$2
             ORDER BY c.name, c.id`,
            [campaignId, characterId],
          )
        ).rows;

        return { contents };
      });
    },
  );

  app.put<{
    Params: { campaignId: string; characterId: string };
    Body: { containerId: string | null; sceneId?: string; x?: number; z?: number };
  }>(
    '/campaigns/:campaignId/characters/:characterId/container',
    {
      schema: {
        params: characterParams,
        body: objectSchema(
          {
            containerId: { oneOf: [uuid, { type: 'null' }] },
            sceneId: uuid,
            x: { type: 'number', minimum: -1000, maximum: 1000 },
            z: { type: 'number', minimum: -1000, maximum: 1000 },
          },
          ['containerId'],
        ),
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const { containerId, sceneId } = request.body;
      let touched: string[] = [];

      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const rights = await rightsOf(q, member, userId);
        const manager = rights.sceneManager || rights.characterManager;
        const tree = await loadTree(q, campaignId);
        const item = tree.get(characterId);
        if (!item) reject(404, 'Объект не найден.');
        if (item.kind !== 'object') reject(400, 'Внутрь кладут только предметы, не существ.');
        if (!canHandle(tree, rights, userId, item)) reject(403, 'Распоряжаться можно своим предметом или тем, что лежит в доступном вам контейнере.');

        if (containerId) {
          const container = tree.get(containerId);
          if (!container) reject(404, 'Контейнер не найден.');
          if (container.id === item.id || ancestors(tree, container).some(node => node.id === item.id)) {
            reject(400, 'Нельзя положить предмет в него же или в то, что лежит в нём.');
          }
          if (ancestors(tree, container).length >= MAX_DEPTH - 1) reject(400, 'Слишком глубокое вложение.');

          const giving = container.kind !== 'object';
          if (!giving && !canOpen(tree, rights, userId, container)) {
            reject(403, 'Положить можно в то, чем вы управляете, в «общий» контейнер или отдать персонажу.');
          }

          const placed = (
            await q.query('SELECT id, scene_id FROM scene_objects WHERE campaign_id=$1 AND character_id=$2', [campaignId, item.id])
          ).rows as Array<{ id: string; scene_id: string }>;
          await detachChildren(q, campaignId, placed);
          await q.query('DELETE FROM scene_objects WHERE campaign_id=$1 AND character_id=$2', [campaignId, item.id]);
          for (const scene of new Set(placed.map(entry => entry.scene_id))) await bumpScene(q, scene);

          const owner = giving && container.owner_user_id ? container.owner_user_id : item.owner_user_id;
          await q.query(
            'UPDATE characters SET container_id=$3, owner_user_id=$4, revision=revision+1 WHERE campaign_id=$1 AND id=$2',
            [campaignId, item.id, container.id, owner],
          );
          touched = await syncItem(q, campaignId, item.id);

          return { containerId: container.id, ownerUserId: owner, placement: null };
        }

        if (!item.container_id) reject(400, 'Предмет ни во что не положен.');
        const from = tree.get(item.container_id)!;
        const owner = !controls(rights, userId, item) && !manager ? userId : item.owner_user_id;
        await q.query(
          'UPDATE characters SET container_id=NULL, owner_user_id=$3, revision=revision+1 WHERE campaign_id=$1 AND id=$2',
          [campaignId, item.id, owner],
        );
        touched = await syncItem(q, campaignId, item.id);

        let placement: { id: string; sceneId: string; x: number; z: number } | null = null;

        if (sceneId) {
          const scene = await getScene(q, campaignId, sceneId, true);
          const placements = await loadPlacements(q, campaignId, sceneId);
          const size = (await q.query('SELECT size FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, item.id])).rows[0].size;
          const n = footprintCells(size);
          let x: number;
          let z: number;

          if (request.body.x !== undefined && request.body.z !== undefined) {
            x = request.body.x;
            z = request.body.z;
            if (!isFootprintCenter(x, scene.width_cells, n) || !isFootprintCenter(z, scene.height_cells, n)) {
              reject(400, 'Предмет встаёт по клеткам и целиком на карте.');
            }
          } else {
            const holders = [from, ...ancestors(tree, from)];
            const anchor = holders.map(node => placements.find(p => p.character_id === node.id)).find(Boolean);
            const occupied = new Set(placements.flatMap(p =>
              occupiedCells(scene, p.world_x, p.world_z, footprintCells(p.size)).map(cell => `${cell.col}:${cell.row}`)));
            const spot = anchor
              ? freeSpotsAround(scene, startOf(scene, anchor.world_x, anchor.world_z, n), n, occupied, 1)[0]
              : undefined;
            x = spot ? spot.col + n / 2 - scene.width_cells / 2 : snapFootprint(0, scene.width_cells, n);
            z = spot ? spot.row + n / 2 - scene.height_cells / 2 : snapFootprint(0, scene.height_cells, n);
          }

          const id = await insertPlacement(q, campaignId, sceneId, item.id, {
            x, y: 0, z, rotationY: 0, scale: 1, snapToGrid: true, hidden: false,
          }, userId);
          await bumpScene(q, sceneId);
          placement = { id, sceneId, x, z };
        }

        return { containerId: null, ownerUserId: owner, placement };
      });

      void notifyCampaign(campaignId, { type: 'changed' });
      for (const id of touched) void notifyCampaign(campaignId, { type: 'character', characterId: id });
      return result;
    },
  );
}

export function inventoryVisibility(
  rows: Array<{ id: string; container_id: string | null; owner_user_id: string | null; shared: boolean; can_control: boolean; kind: Node['kind']; name: string }>,
  privileged: boolean,
) {
  const tree = new Map(rows.map(row => [row.id, row as unknown as Node & { can_control: boolean }]));
  const openable = (node: Node & { can_control: boolean }) => {
    const chain = [node, ...ancestors(tree as Map<string, Node>, node)] as Array<Node & { can_control: boolean }>;
    return chain.some(entry => entry.can_control || entry.shared);
  };

  return rows
    .map(row => {
      if (!row.container_id) return row;
      const container = tree.get(row.container_id);
      const reachable = Boolean(container && openable(container));
      if (!privileged && !row.can_control && !reachable) return null;
      return { ...row, can_control: row.can_control || reachable, container_name: container?.name ?? null };
    })
    .filter(<T>(row: T | null): row is T => row !== null);
}
