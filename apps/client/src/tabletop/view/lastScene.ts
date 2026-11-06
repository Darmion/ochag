import { watch, type Ref } from 'vue';
import type { TabletopProps } from './types';

export type LastSceneDeps = {
  props: TabletopProps;
  viewOnly: boolean;
  sceneId: Ref<string>;
};

export function useLastScene({ props, viewOnly, sceneId }: LastSceneDeps) {
  const LAST_SCENE_KEY = 'ochag.lastScene.v1';
  function readLastScenes(): Record<string, string> {
    try {
      const raw = JSON.parse(localStorage.getItem(LAST_SCENE_KEY) ?? '{}');
      return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    } catch {
      return {};
    }
  }
  watch(sceneId, id => {
    if (viewOnly || !id) return;
    try {
      localStorage.setItem(LAST_SCENE_KEY, JSON.stringify({ ...readLastScenes(), [props.campaignId]: id }));
    } catch {
    }
  });

  return { readLastScenes };
}
