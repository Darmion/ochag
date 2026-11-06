import { ref, computed, type Ref, type ComputedRef } from 'vue';
import type { Tabletop } from '../scene';
import type { LiveKind, LivePose, LiveConnection } from '../live';
import type { LivePoint, SceneObjectDTO, TabletopProps } from './types';

export type LiveGrabsDeps = {
  props: TabletopProps;
  viewOnly: boolean;
  objects: Ref<SceneObjectDTO[]>;
  error: Ref<string>;
  table: () => Tabletop | undefined;
  live: () => LiveConnection | undefined;
  disposed: () => boolean;
  activeObject: ComputedRef<SceneObjectDTO | undefined>;
  paint: () => void;
  refresh: () => Promise<void>;
  run: (action: () => Promise<void>) => Promise<void>;
};

export function useLiveGrabs({ props, viewOnly, objects, error, table, live, disposed, activeObject, paint, refresh, run }: LiveGrabsDeps) {
  const liveGrabs = new Set<string>();
  const deniedGrabs = new Set<string>();
  const liveHolders = ref<Record<string, { label: string; holders: string[] }>>({});
  const liveKey = (kind: LiveKind, id: string) => `${kind}:${id}`;

  const holdersText = computed(() =>
    Object.values(liveHolders.value)
      .filter(entry => entry.holders.length)
      .map(entry => `«${entry.label}» — ${entry.holders.join(', ')}`)
      .join('; '),
  );

  function liveGrab(kind: LiveKind, id: string) {
    const key = liveKey(kind, id);
    deniedGrabs.delete(key);
    if (live()?.send({ type: 'grab', kind, id })) liveGrabs.add(key);
  }

  function livePull(kind: LiveKind, id: string, point: LivePoint) {
    if (liveGrabs.has(liveKey(kind, id))) live()?.send({ type: 'pull', kind, id, ...point });
  }

  function finishLiveGrab(kind: LiveKind, id: string, point: LivePoint): boolean {
    const key = liveKey(kind, id);

    if (deniedGrabs.delete(key)) {
      void refresh();
      return true;
    }

    if (!liveGrabs.delete(key)) return false;

    live()?.send({ type: 'pull', kind, id, ...point });
    live()?.send({ type: 'release', kind, id });
    return true;
  }

  function descendantsOf(objectId: string): SceneObjectDTO[] {
    const result: SceneObjectDTO[] = [];
    const queue = [objectId];

    while (queue.length) {
      const current = queue.shift()!;
      for (const object of objects.value) {
        if (object.parent_object_id === current && !result.includes(object)) {
          result.push(object);
          queue.push(object.id);
        }
      }
    }

    return result;
  }

  function onLivePose(pose: LivePose) {
    if (disposed()) return;

    if (viewOnly) {
      if (pose.final) void refresh();
      return;
    }

    const key = liveKey(pose.kind, pose.id);
    const draggedByMe = liveGrabs.has(key);
    const othersHold = pose.holders.some(holder => holder.userId !== props.currentUserId);
    const source = { draggedByMe, contested: draggedByMe && othersHold };

    {
      const object = objects.value.find(o => o.id === pose.id);
      table()?.applyObjectPose(pose.id, pose, source, pose.final);

      if (object) {
        const dx = pose.x - object.world_x;
        const dy = pose.y - object.world_y;
        const dz = pose.z - object.world_z;

        for (const child of descendantsOf(object.id)) {
          const childPose = { x: child.world_x + dx, y: child.world_y + dy, z: child.world_z + dz, rotationY: child.rotation_y, scale: child.scale };
          if (pose.final) {
            child.world_x = childPose.x;
            child.world_y = childPose.y;
            child.world_z = childPose.z;
            table()?.clearObjectPose(child.id);
          } else {
            table()?.applyObjectPose(child.id, childPose, { draggedByMe: false, contested: false });
          }
        }

        if (pose.final) {
          Object.assign(object, { world_x: pose.x, world_y: pose.y, world_z: pose.z, rotation_y: pose.rotationY, scale: pose.scale });
        }
      }

      if (pose.final) {
        table()?.clearObjectPose(pose.id);
      }
    }

    const next = { ...liveHolders.value };

    if (pose.final) {
      delete next[key];
      liveGrabs.delete(key);
      paint();
    } else {
      const label = objects.value.find(o => o.id === pose.id)?.name ?? 'Объект';
      next[key] = { label, holders: pose.holders.map(holder => holder.displayName) };
    }

    liveHolders.value = next;
  }

  function onLiveGrabDenied(kind: LiveKind, id: string, message: string) {
    const key = liveKey(kind, id);
    liveGrabs.delete(key);
    deniedGrabs.add(key);
    if (!disposed()) error.value = message;

    table()?.clearObjectPose(id);

    void refresh();
  }

  function setObjectShared(shared: boolean) {
    const object = activeObject.value;
    if (!object) return;

    return run(async () => {
      await props.request(`/campaigns/${props.campaignId}/characters/${object.character_id}/shared`, 'PATCH', { shared });
      await refresh();
    });
  }

  return { holdersText, liveGrab, livePull, finishLiveGrab, onLivePose, onLiveGrabDenied, setObjectShared };
}
