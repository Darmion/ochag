import type { Ref } from 'vue';
import type { ObjectSave, TabletopProps, SceneObjectDTO } from './types';

export type ObjectSavesDeps = {
  props: TabletopProps;
  objects: Ref<SceneObjectDTO[]>;
  error: Ref<string>;
  disposed: () => boolean;
  objectsPath: () => string;
  refresh: () => Promise<void>;
};

export function useObjectSaves({ props, objects, error, disposed, objectsPath, refresh }: ObjectSavesDeps) {
  const knownRevisions = new Map<string, number>();
  const lastCommitted = new Map<string, Record<string, number>>();

  function createSaveQueue<T>(send: (id: string, value: T) => Promise<void>) {
    const pending = new Map<string, T>();
    const running = new Set<string>();

    return (id: string, value: T) => {
      pending.set(id, value);
      if (running.has(id)) return;
      running.add(id);

      void (async () => {
        try {
          while (pending.has(id) && !disposed()) {
            const next = pending.get(id)!;
            pending.delete(id);

            try {
              await send(id, next);
            } catch (cause) {
              if (!disposed()) {
                error.value = cause instanceof Error ? cause.message : 'Не удалось сохранить. Попробуйте ещё раз.';
                void refresh();
              }
            }
          }
        } finally {
          running.delete(id);
        }
      })();
    };
  }

  function isConflict(cause: unknown) {
    return (cause as { status?: number } | null)?.status === 409;
  }

  function freshRevision(id: string, listed: number) {
    return Math.max(listed, knownRevisions.get(id) ?? 0);
  }

  function sameAsCommitted(id: string, current: Record<string, number>) {
    const committed = lastCommitted.get(id);
    return committed !== undefined &&
      Object.entries(committed).every(([key, value]) => Math.abs((current[key] ?? NaN) - value) < 1e-6);
  }

  function objectSnapshot(object: { x: number; y: number; z: number; rotation_y: number; scale: number }) {
    return {
      x: Number(object.x),
      y: Number(object.y),
      z: Number(object.z),
      rotation_y: Number(object.rotation_y),
      scale: Number(object.scale),
    };
  }

  function rememberSaved(objectId: string, result: { x: number; y: number; z: number; rotation_y: number; scale: number; revision: number }) {
    knownRevisions.set(objectId, result.revision);
    lastCommitted.set(objectId, objectSnapshot(result));
  }

  async function saveObjectNow(objectId: string, body: ObjectSave, refreshAfter = true) {
    const listed = objects.value.find(object => object.id === objectId);
    if (!listed) return;

    const put = (revision: number) =>
      props.request(`${objectsPath()}/${objectId}`, 'PUT', { ...body, revision });
    let result: { x: number; y: number; z: number; rotation_y: number; scale: number; revision: number };

    try {
      result = await put(freshRevision(objectId, listed.revision));
    } catch (cause) {
      if (!isConflict(cause)) throw cause;
      await refresh();
      const current = objects.value.find(object => object.id === objectId);
      if (!current || !sameAsCommitted(objectId, objectSnapshot(current))) {
        throw new Error('Этот объект только что изменил другой участник — ваша правка не применена.');
      }
      result = await put(current.revision);
    }

    rememberSaved(objectId, result);
    if (refreshAfter) await refresh();
  }

  const queueObjectSave = createSaveQueue<ObjectSave>((objectId, body) => saveObjectNow(objectId, body));

  return { freshRevision, rememberSaved, saveObjectNow, queueObjectSave };
}
