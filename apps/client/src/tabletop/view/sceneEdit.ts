import type { Ref } from 'vue';
import type { TabletopProps, SceneDetail, SceneSize } from './types';
import type { TableHistory, HistoryEntry } from '../history';

export type SceneEditDeps = {
  props: TabletopProps;
  sceneId: Ref<string>;
  newSceneName: Ref<string>;
  sceneDetail: Ref<SceneDetail | null>;
  sizeWidthInput: Ref<number>;
  sizeHeightInput: Ref<number>;
  sizeFeetInput: Ref<number>;
  disposed: () => boolean;
  basePath: () => string;
  refresh: () => Promise<void>;
  run: (action: () => Promise<void>) => Promise<void>;
  loadLists: () => Promise<void>;
  currentSceneSize: () => SceneSize | null;
  history: TableHistory;
  sceneSizeEntry: (before: SceneSize, label: string) => HistoryEntry;
};

export function useSceneEdit({ props, sceneId, newSceneName, sceneDetail, sizeWidthInput, sizeHeightInput, sizeFeetInput, disposed, basePath, refresh, run, loadLists, currentSceneSize, history, sceneSizeEntry }: SceneEditDeps) {
  function createScene() {
    return run(async () => {
      const created = await props.request(
        `/campaigns/${props.campaignId}/scenes`,
        'POST',
        { name: newSceneName.value },
      );

      await loadLists();

      if (!disposed()) {
        sceneId.value = created.id;
        newSceneName.value = '';
      }
    });
  }

  function saveSceneSize() {
    return run(async () => {
      if (!sceneId.value) return;

      const before = currentSceneSize();
      // Only the size: lighting and vision live in the «Свет» window, and a stale field here would overwrite them.
      await props.request(basePath(), 'PATCH', {
        widthCells: sizeWidthInput.value,
        heightCells: sizeHeightInput.value,
        feetPerUnit: sizeFeetInput.value,
      });
      if (before) history.record(sceneSizeEntry(before, 'размер сцены'));

      await refresh();
    });
  }

  function uploadBackground(file: File) {
    return run(async () => {
      if (!sceneId.value) return;

      const uploaded = await props.request(
        `/campaigns/${props.campaignId}/assets?kind=scene_background`,
        'POST',
        undefined,
        file,
      );

      await props.request(basePath(), 'PATCH', {
        backgroundAssetId: uploaded.id,
      });

      await refresh();
    });
  }

  function clearBackground() {
    return run(async () => {
      if (!sceneId.value) return;

      await props.request(basePath(), 'PATCH', { backgroundAssetId: null });

      await refresh();
    });
  }

  function rotateBackground(delta: number) {
    return run(async () => {
      if (!sceneId.value) return;
      const next = ((((sceneDetail.value?.background_rotation ?? 0) + delta) % 360) + 360) % 360;
      await props.request(basePath(), 'PATCH', { backgroundRotation: next });
      await refresh();
    });
  }

  return { createScene, saveSceneSize, uploadBackground, clearBackground, rotateBackground };
}
