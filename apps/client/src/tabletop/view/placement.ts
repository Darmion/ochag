import { computed, type Ref } from 'vue';
import { objectImageId } from '../../art/portraitArt';
import type { Character, TabletopProps, SceneDetail } from './types';
import type { TableHistory, HistoryEntry } from '../history';

export type PlacementDeps = {
  props: TabletopProps;
  sceneId: Ref<string>;
  sceneDetail: Ref<SceneDetail | null>;
  characters: Ref<Character[]>;
  placeCharacterId: Ref<string>;
  createOpen: Ref<boolean>;
  activeObjectId: Ref<string>;
  disposed: () => boolean;
  objectsPath: () => string;
  refresh: () => Promise<void>;
  run: (action: () => Promise<void>) => Promise<void>;
  loadLists: () => Promise<void>;
  hudImage: (assetId: string | null | undefined) => string | null;
  history: TableHistory;
  placementAddedEntry: (placementId: string, label: string) => HistoryEntry;
};

export function usePlacement({ props, sceneId, sceneDetail, characters, placeCharacterId, createOpen, activeObjectId, disposed, objectsPath, refresh, run, loadLists, hudImage, history, placementAddedEntry }: PlacementDeps) {
  const rollApplyTargets = computed(() => {
    const list = (sceneDetail.value?.canManage ? characters.value : characters.value.filter(character => character.can_control))
      .filter(character => !character.container_id)
      .map(character => ({ id: character.id, name: character.name }));
    return list.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  });

  const placeImage = (item: { id: string; name: string; kind: string }) => {
    const character = characters.value.find(entry => entry.id === item.id);
    return character ? hudImage(objectImageId(character)) : null;
  };

  function placeOnScene(characterId: string) {
    return run(async () => {
      if (!sceneId.value || !characterId) return;

      const result = await props.request(`${objectsPath()}`, 'POST', { characterId });
      if (!result.alreadyPlaced) {
        const name = characters.value.find(c => c.id === characterId)?.name ?? 'объект';
        history.record(placementAddedEntry(result.id, `постановка «${name}»`));
      }

      await refresh();

      if (!disposed()) {
        activeObjectId.value = result.id;
        placeCharacterId.value = '';
      }
    });
  }

  async function onObjectCreated(payload: { character: Character; place: boolean }) {
    createOpen.value = false;
    await run(loadLists);
    if (payload.place && sceneId.value) await placeOnScene(payload.character.id);
  }

  return { rollApplyTargets, placeImage, placeOnScene, onObjectCreated };
}
