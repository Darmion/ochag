import { tokenHash } from '../../system/security.ts';
import { peerOf } from '../../system/network.ts';
import { type ManipulationTarget, createManipulation } from './live-manipulation.ts';
import { createSignals } from './live-signals.ts';
import type { Notice } from '../scene/scene-triggers.ts';
import type { WallSegment } from '../../../../../packages/domain/map/los.ts';
import { footprintCells, snapFootprint } from '../../../../../packages/domain/map/footprint.ts';

import { detectOpportunities, settleOpportunities } from '../combat/opportunity.ts';
import { announceFound, detectAround, stealthHiddenIds } from '../combat/stealth.ts';
import { type TableContext, withTable } from '../context.ts';
import { notify, notifyUsers, validSubscription } from './notify.ts';
import { breakCamouflage } from '../rolls/modifiers.ts';
import { getScene, halfBoundsFor } from '../scene/board.ts';
import { assertFreeCell, assertNotTowardFear, assertPassable, dragAlong, gmFreeMove, releaseDistantGrapples, spendMovement } from '../scene/movement.ts';
import { controls, loadPlacements, rightsOf } from '../scene/placements.ts';
import { computeVisibleIndexSet, seenThroughFog, visiblePlacementIds } from '../scene/vision.ts';
import { type Placement, type Subscription, uuidPattern, WALLS_SIGHT } from '../shared.ts';

export const MAX_LIVE_PER_USER = 24;

export function boardClamp(scene: any) {
  const { halfWidth, halfHeight } = halfBoundsFor(scene);

  return (point: { x: number; y: number; z: number }) => ({
    x: Math.max(-halfWidth, Math.min(halfWidth, point.x)),
    y: Math.max(-5, Math.min(50, point.y)),
    z: Math.max(-halfHeight, Math.min(halfHeight, point.z)),
  });
}

export async function liveMember(ctx: TableContext, subscriber: Subscription, userId = subscriber.userId) {
  const { db, membership } = ctx;
  if (!userId) return null;

  try {
    return await membership(db, subscriber.campaignId, userId);
  } catch {
    return null;
  }
}

export async function loadObjectTarget(ctx: TableContext, subscriber: Subscription, objectId: string): Promise<ManipulationTarget | { denied: string }> {
  const { db, subscriptions, triggers } = ctx;
  const member = await liveMember(ctx, subscriber);
  if (!member) return { denied: 'Нет доступа к кампании — попросите мастера пригласить вас.' };

  const { campaignId, sceneId } = subscriber;
  const userId = subscriber.userId!;
  const scene = await getScene(db, campaignId, sceneId, false);
  const placements = await loadPlacements(db, campaignId, sceneId);
  const object = placements.find(placement => placement.id === objectId);
  if (!object) return { denied: 'Объект не найден в этой сцене.' };

  const grabberRights = await rightsOf(db, member, userId);
  if (!controls(grabberRights, userId, object.character_id, object.owner_user_id) && !object.shared) {
    return { denied: 'Двигать этот объект может владелец, мастер или тот, кому выдано «Редактирование». Владелец или мастер может сделать его общим.' };
  }

  const campaign = (await db.query('SELECT fog_enabled, house_rules FROM campaigns WHERE id=$1', [campaignId])).rows[0]!;
  const walls = (
    await db.query<WallSegment & { id: string }>(
      `SELECT id, x1, z1, x2, z2 FROM scene_walls WHERE campaign_id=$1 AND scene_id=$2 ${WALLS_SIGHT}`,
      [campaignId, sceneId],
    )
  ).rows;

  const seeing = new Map<string, (pose: { x: number; z: number }) => boolean>();
  const viewerIds = new Set(
    [...subscriptions]
      .filter(sub => sub.campaignId === campaignId && sub.sceneId === sceneId && sub.userId)
      .map(sub => sub.userId!),
  );

  for (const viewerId of viewerIds) {
    const viewer = await liveMember(ctx, subscriber, viewerId);
    if (!viewer) continue;

    const viewerRights = await rightsOf(db, viewer, viewerId);
    const isControlled = (placement: Placement) =>
      controls(viewerRights, viewerId, placement.character_id, placement.owner_user_id);
    const bypass = viewerRights.sceneManager || !campaign.fog_enabled || viewer.fog_disabled_by_gm;
    const fog = bypass ? null : await computeVisibleIndexSet(db, campaignId, scene, campaign, viewer, viewerId, walls, placements);

    if (!viewerRights.sceneManager && (await stealthHiddenIds(db, campaignId, scene, placements, viewer, viewerId, isControlled)).has(object.id)) {
      seeing.set(viewerId, () => false);
      continue;
    }

    if (isControlled(object) || object.hidden || object.shared || !fog) {
      const visible = visiblePlacementIds(scene, placements, isControlled, fog).has(object.id);
      seeing.set(viewerId, () => visible);
    } else {
      seeing.set(viewerId, pose => seenThroughFog(scene, fog, pose.x, pose.z, object.size));
    }
  }

  const parent = object.parent_object_id ? placements.find(placement => placement.id === object.parent_object_id) : undefined;
  const parentWorld = parent ? { x: parent.world_x, y: parent.world_y, z: parent.world_z } : { x: 0, y: 0, z: 0 };

  return {
    pose: { x: object.world_x, y: object.world_y, z: object.world_z, rotationY: Number(object.rotation_y), scale: Number(object.scale) },
    canSee: (viewer, pose) => Boolean(viewer.userId) && (seeing.get(viewer.userId!)?.(pose) ?? false),
    clamp: boardClamp(scene),
    commit: async pose => {
      let notices: Notice[] = [];
      const footprint = footprintCells(object.size);
      let x = object.snap_to_grid ? snapFootprint(pose.x, scene.width_cells, footprint) : pose.x;
      let z = object.snap_to_grid ? snapFootprint(pose.z, scene.height_cells, footprint) : pose.z;

      const combatLimited = object.kind !== 'object' && !object.parent_object_id && (!grabberRights.sceneManager || !(await gmFreeMove(db, campaignId)));
      const limited = combatLimited;
      let bounced: string | null = null;
      let found: string[] = [];
      if (limited) {
        try {
          await assertPassable(db, campaignId, scene, object.id, { x: object.world_x, z: object.world_z }, { x, z }, object.size, grabberRights.sceneManager);
        } catch (error) {
          bounced = (error as Error).message;
          x = object.world_x;
          z = object.world_z;
        }
      }
      if (object.kind !== 'object' && !object.parent_object_id) {
        try {
          await assertFreeCell(db, campaignId, scene, object.id, { x: object.world_x, z: object.world_z }, { x, z }, object.size);
        } catch (error) {
          bounced = (error as Error).message;
          x = object.world_x;
          z = object.world_z;
        }
      }
      const rotationY = (((pose.rotationY % 360) + 360) % 360) % 360;
      const scale = Math.min(50, Math.max(0.01, pose.scale));

      await db.transaction(async q => {
        if (combatLimited) {
          try {
            await assertNotTowardFear(q, campaignId, scene, object, { x, z });
            await spendMovement(ctx, q, campaignId, scene, object.character_id, { x: object.world_x, z: object.world_z }, { x, z });
          } catch (error) {
            bounced = (error as Error).message;
            x = object.world_x;
            z = object.world_z;
          }
        }

        await q.query(
          `UPDATE scene_objects
             SET x=$1, y=$2, z=$3, rotation_y=$4, scale=$5, revision=revision+1
             WHERE campaign_id=$6 AND id=$7`,
          [x - parentWorld.x, pose.y - parentWorld.y, z - parentWorld.z, rotationY, scale, campaignId, objectId],
        );
        await q.query('UPDATE scenes SET revision=revision+1 WHERE id=$1', [sceneId]);

        if (object.kind !== 'object' && !object.parent_object_id) {
          notices = await triggers.fireEnter(
            q, campaignId, scene, userId,
            { characterId: object.character_id, name: object.name, size: object.size },
            { x: object.world_x, z: object.world_z }, { x, z },
          );
          if (combatLimited) notices.push(...await dragAlong(q, campaignId, scene, object, { x: object.world_x, z: object.world_z }, { x, z }));
          if (x !== object.world_x || z !== object.world_z) {
            await breakCamouflage(ctx, q, campaignId, object.character_id);
            found = await detectAround(q, campaignId, scene, object.character_id);
            notices.push(...await releaseDistantGrapples(q, campaignId, scene, object.character_id));
          }
        }
      });

      void notify(ctx, campaignId, sceneId);
      triggers.send(campaignId, notices);
      if (bounced) void notifyUsers(ctx, campaignId, [userId], { type: 'notice', title: `${object.name} остаётся на месте`, detail: bounced });
      announceFound(ctx, campaignId, object.name, found);
      if (object.kind !== 'object' && !object.parent_object_id) {
        await settleOpportunities(ctx, campaignId, await detectOpportunities(db, campaignId, scene, object.character_id, { x: object.world_x, z: object.world_z }, { x, z }));
      }
      return { x, y: pose.y, z, rotationY, scale };
    },
  };
}

export const displayName = async (ctx: TableContext, userId: string): Promise<string> =>
  { const { db } = ctx; return (await db.query('SELECT display_name FROM users WHERE id=$1', [userId])).rows[0]?.display_name ?? '?'; };

export function registerLiveRoutes(ctx: TableContext) {
  const { app, db, presence, subscriptions } = ctx;

  const manipulation = createManipulation({
    load: (subscriber, _kind, id) => loadObjectTarget(ctx, subscriber as Subscription, id),
    displayName: withTable(ctx, displayName),
    subscribers: () => subscriptions,
  });

  const signals = createSignals({ displayName: withTable(ctx, displayName), subscribers: () => subscriptions });

  app.get('/live', { websocket: true }, (socket, request) => {
    let received = false;
    let subscription: Subscription | undefined;

    const timeout = setTimeout(() => {
      socket.close(1008, 'Authentication timeout');
    }, 5000);

    socket.on('message', raw => {
      if (subscription) {
        const text = raw.toString();
        if (text.length < 64 && text.startsWith('{"type":"rtt"')) {
          try {
            const { t } = JSON.parse(text);
            if (typeof t === 'number' && Number.isFinite(t)) socket.send(JSON.stringify({ type: 'rtt', t }));
          } catch {
          }
          return;
        }
        if (!subscription.sceneId) return;
        if (!signals.handle(subscription, text)) manipulation.handle(subscription, text);
        return;
      }

      if (received) return;

      received = true;

      void (async () => {
        try {
          const input = JSON.parse(raw.toString());

          if (
            typeof input.token !== 'string' ||
            !/^[A-Za-z0-9_-]{43}$/.test(input.token) ||
            typeof input.campaignId !== 'string' ||
            !uuidPattern.test(input.campaignId) ||
            (input.sceneId !== null && input.sceneId !== undefined &&
              (typeof input.sceneId !== 'string' || !uuidPattern.test(input.sceneId)))
          ) {
            socket.close(1008, 'Invalid subscription');
            return;
          }

          const candidate: Subscription = {
            socket,
            hash: tokenHash(input.token),
            campaignId: input.campaignId,
            sceneId: input.sceneId ?? '',
          };

          if (!(await validSubscription(ctx, candidate))) {
            socket.close(1008, 'Access denied');
            return;
          }

          candidate.userId = (
            await db.query('SELECT user_id FROM auth_sessions WHERE token_hash=$1', [candidate.hash])
          ).rows[0]?.user_id;

          if (socket.readyState !== 1) return;

          // Every open connection costs a database check on each table change; the oldest one goes first, so connections left behind by a dropped network clear themselves.
          const own = [...subscriptions].filter(sub => sub.userId && sub.userId === candidate.userId);
          if (own.length >= MAX_LIVE_PER_USER) own[0]!.socket.close(4001, 'Too many connections');

          subscription = candidate;
          subscriptions.add(candidate);

          if (presence && candidate.userId && candidate.sceneId) {
            presence.liveOpened(candidate.hash, candidate.userId, peerOf(request), candidate, {
              campaignId: candidate.campaignId,
              sceneId: candidate.sceneId,
            });
          }

          clearTimeout(timeout);

          socket.send(JSON.stringify({ type: 'ready' }));
        } catch {
          socket.close(1008, 'Invalid subscription');
        }
      })();
    });

    socket.on('close', () => {
      clearTimeout(timeout);
      if (subscription) {
        subscriptions.delete(subscription);
        if (subscription.sceneId) presence?.liveClosed(subscription.hash, subscription);
        manipulation.releaseAll(subscription);
        signals.disconnected(subscription);
      }
    });

    socket.on('error', () => {
      socket.close();
    });
  });

  const accessTimer = setInterval(() => {
    for (const sub of subscriptions) {
      void validSubscription(ctx, sub)
        .then(valid => {
          if (!valid) sub.socket.close(1008, 'Access expired');
        })
        .catch(() => {
          sub.socket.close(1011, 'Server error');
        });
    }
  }, 30000);

  accessTimer.unref();

  app.addHook('onClose', async () => {
    clearInterval(accessTimer);
    manipulation.dispose();

    for (const sub of subscriptions) {
      sub.socket.terminate();
    }

    subscriptions.clear();
  });
}
