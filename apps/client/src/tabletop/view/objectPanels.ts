import { computed, type Ref } from 'vue';
import type { TableToast } from '../toasts';
import type { ObjectKind } from '../../campaign/objects';
import type { Character, SceneObjectDTO } from './types';

export type ObjectPanelsDeps = {
  characters: Ref<Character[]>;
  objects: Ref<SceneObjectDTO[]>;
  pushToast: (toast: Omit<TableToast, "id">, durationMs?: number) => void;
  loadRolls: () => Promise<void>;
  refresh: () => Promise<void>;
  run: (action: () => Promise<void>) => Promise<void>;
  loadLists: () => Promise<void>;
};

export function useObjectPanels({ characters, objects, pushToast, loadRolls, refresh, run, loadLists }: ObjectPanelsDeps) {
  const stateActors = computed(() => objects.value
    .filter(object => object.kind !== 'object' && object.canEdit)
    .map(object => ({ id: object.character_id, name: object.name })));

  function onStateResult(payload: { message: string; outcome: string }) {
    if (payload.outcome !== 'trap') {
      pushToast({ tone: payload.outcome === 'failure' || payload.outcome === 'locked' ? 'fumble' : 'info', title: payload.message });
    }
    void run(async () => {
      await Promise.all([refresh(), loadRolls()]);
    });
  }

  const inventoryTargets = computed(() => {
    const seen = new Set<string>();
    const result: Array<{ id: string; name: string; kind: ObjectKind }> = [];
    for (const object of objects.value) {
      if (seen.has(object.character_id)) continue;
      seen.add(object.character_id);
      result.push({ id: object.character_id, name: object.name, kind: object.kind });
    }
    for (const character of characters.value) {
      if (character.kind !== 'character' || seen.has(character.id)) continue;
      seen.add(character.id);
      result.push({ id: character.id, name: character.name, kind: character.kind });
    }
    return result;
  });

  function onInventoryChanged(message: string) {
    pushToast({ tone: 'info', title: message });
    void run(async () => {
      await Promise.all([refresh(), loadLists()]);
    });
  }

  return { stateActors, onStateResult, inventoryTargets, onInventoryChanged };
}
