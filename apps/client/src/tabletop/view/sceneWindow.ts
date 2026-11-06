import { computed, type Ref } from 'vue';
import type { TabletopProps, SceneDetail } from './types';

export type SceneWindowDeps = {
  props: TabletopProps;
  sceneId: Ref<string>;
  newSceneName: Ref<string>;
  sceneDetail: Ref<SceneDetail | null>;
  sizeWidthInput: Ref<number>;
  sizeHeightInput: Ref<number>;
  sizeFeetInput: Ref<number>;
  mapDialog: Ref<'size' | 'picture' | null>;
  run: (action: () => Promise<void>) => Promise<void>;
  loadLists: () => Promise<void>;
  createScene: () => Promise<void>;
  saveSceneSize: () => Promise<void>;
  hudImage: (assetId: string | null | undefined) => string | null;
};

export function useSceneWindow({ props, sceneId, newSceneName, sceneDetail, sizeWidthInput, sizeHeightInput, sizeFeetInput, mapDialog, run, loadLists, createScene, saveSceneSize, hudImage }: SceneWindowDeps) {
  function renameScene({ sceneId: id, name }: { sceneId: string; name: string }) {
    return run(async () => {
      await props.request(`/campaigns/${props.campaignId}/scenes/${id}`, 'PATCH', { name });
      await loadLists();
    });
  }

  function selectScene(id: string) {
    sceneId.value = id;
  }

  function createSceneNamed(name: string) {
    newSceneName.value = name;
    return createScene();
  }

  function openSceneSettings(id: string) {
    if (id !== sceneId.value) sceneId.value = id;
    mapDialog.value = 'size';
  }

  function saveMapSize(size: { widthCells: number; heightCells: number; feetPerUnit: number }) {
    sizeWidthInput.value = size.widthCells;
    sizeHeightInput.value = size.heightCells;
    sizeFeetInput.value = size.feetPerUnit;
    return saveSceneSize();
  }

  const mapBackgroundUrl = computed(() => hudImage(sceneDetail.value?.background_asset_id));

  return { renameScene, selectScene, createSceneNamed, openSceneSettings, saveMapSize, mapBackgroundUrl };
}
