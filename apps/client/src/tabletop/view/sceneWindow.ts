import { computed, type Ref } from 'vue';
import type { TabletopProps, SceneDetail } from './types';
import type { TableToast } from '../toasts';

export type ScenePreset = 'tavern' | 'cave' | 'glade' | 'road';
export type SceneContents = {
  walls: number; doors: number; windows: number; objects: number; npcs: number; characters: number;
  traps: number; pins: number; drawings: number; counters: number; combat: boolean;
};
export type SceneBackup = {
  id: string; name: string; deletedAt: string; deletedBy: string | null;
  counts: { walls: number; doors: number; windows: number; objects: number; creatures: number; traps: number; pins: number; drawings: number; counters: number };
};

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
  pushToast: (toast: Omit<TableToast, 'id'>, durationMs?: number) => void;
  error: Ref<string>;
};

export function useSceneWindow({ props, sceneId, newSceneName, sceneDetail, sizeWidthInput, sizeHeightInput, sizeFeetInput, mapDialog, run, loadLists, createScene, saveSceneSize, hudImage, pushToast, error }: SceneWindowDeps) {
  const scenesPath = () => `/campaigns/${props.campaignId}/scenes`;
  const removedHere = new Set<string>();

  function renameScene({ sceneId: id, name }: { sceneId: string; name: string }) {
    return run(async () => {
      await props.request(`${scenesPath()}/${id}`, 'PATCH', { name });
      await loadLists();
    });
  }

  function selectScene(id: string) {
    sceneId.value = id;
  }

  function goTo(id: string) {
    return run(async () => {
      await loadLists();
      sceneId.value = id;
    });
  }

  function createSceneNamed({ name, preset }: { name: string; preset: ScenePreset | null }) {
    if (!preset) {
      newSceneName.value = name;
      return createScene();
    }
    return run(async () => {
      const created = await props.request(scenesPath(), 'POST', { name, preset });
      await loadLists();
      sceneId.value = created.id;
    });
  }

  function copyScene({ sceneId: id, name, creatures }: { sceneId: string; name: string; creatures: boolean }) {
    return run(async () => {
      const created = await props.request(`${scenesPath()}/${id}/copy`, 'POST', { name, creatures });
      await loadLists();
      sceneId.value = created.id;
    });
  }

  function removeScene(id: string) {
    return run(async () => {
      removedHere.add(id);
      try {
        const removed = await props.request(`${scenesPath()}/${id}`, 'DELETE');
        await loadLists();
        pushToast({ tone: 'info', title: `Сцена «${removed.name}» удалена`, detail: 'Вернуть её можно в меню «⋯» → «Удалённые сцены».' }, 9000);
      } catch (cause) {
        removedHere.delete(id);
        throw cause;
      }
    });
  }

  function restoreScene(backupId: string) {
    return run(async () => {
      const restored = await props.request(`/campaigns/${props.campaignId}/scene-backups/${backupId}/restore`, 'POST');
      await loadLists();
      sceneId.value = restored.id;
      if (restored.missing > 0) {
        pushToast({ tone: 'info', title: `Сцена «${restored.name}» возвращена`, detail: `Объектов, удалённых из кампании после сцены, на ней нет: ${restored.missing}.` }, 9000);
      }
    });
  }

  const loadSceneContents = (id: string): Promise<SceneContents> => props.request(`${scenesPath()}/${id}/contents`);
  const loadSceneBackups = async (): Promise<SceneBackup[]> => (await props.request(`/campaigns/${props.campaignId}/scene-backups`)).backups;

  const canUseSceneFiles = computed(() => Boolean(window.desktop?.campaign?.exportScene && props.token));

  async function exportScene({ sceneId: id, name, creatures }: { sceneId: string; name: string; creatures: boolean }) {
    if (!window.desktop?.campaign?.exportScene || !props.token) return;
    error.value = '';
    const result = await window.desktop.campaign.exportScene({ campaignId: props.campaignId, sceneId: id, name, creatures, token: props.token });
    if ('canceled' in result) return;
    if (result.ok) pushToast({ tone: 'info', title: `Сцена «${name}» сохранена в файл`, detail: result.filePath }, 9000);
    else error.value = result.message;
  }

  async function importScene() {
    if (!window.desktop?.campaign?.importScene || !props.token) return;
    error.value = '';
    const result = await window.desktop.campaign.importScene({ campaignId: props.campaignId, token: props.token });
    if ('canceled' in result) return;
    if (!result.ok) {
      error.value = result.message;
      return;
    }
    await goTo(result.sceneId);
    pushToast({
      tone: 'info', title: `Сцена «${result.name}» загружена из ${result.fileName}`,
      ...(result.skipped > 0 ? { detail: `Пропущено повреждённых частей файла: ${result.skipped}.` } : {}),
    }, 9000);
  }

  function onSceneRemoved({ sceneId: removed, name }: { sceneId: string; name: string }) {
    const wasHere = removed === sceneId.value;
    void loadLists().catch(() => {});
    if (removedHere.delete(removed) || !wasHere) return;
    pushToast({ tone: 'info', title: `Мастер удалил сцену «${name}»` }, 9000);
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

  return {
    renameScene, selectScene, createSceneNamed, copyScene, removeScene, restoreScene, loadSceneContents, loadSceneBackups,
    canUseSceneFiles, exportScene, importScene, onSceneRemoved, openSceneSettings, saveMapSize, mapBackgroundUrl,
  };
}
