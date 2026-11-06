import { ref } from 'vue';

export type TutorialSceneDeps = {
  props: { campaignId: string; request: (path: string, method?: string, body?: unknown) => Promise<any>; };
};

export function useTutorialScene({ props }: TutorialSceneDeps) {
  const creatingTutorial = ref(false);
  const tutorialError = ref('');
  const tutorialSceneName = ref('');

  async function createTutorialScene() {
    creatingTutorial.value = true;
    tutorialError.value = '';
    tutorialSceneName.value = '';

    try {
      const scene = await props.request(`/campaigns/${props.campaignId}/scenes`, 'POST', {
        name: 'Обучение: первый бой', widthCells: 10, heightCells: 8,
      });
      await props.request(`/campaigns/${props.campaignId}/bestiary/spawn`, 'POST', {
        monsters: [{ index: 'goblin', count: 1 }], disposition: 'hostile', sceneId: scene.id, x: 2, z: 0,
      });
      tutorialSceneName.value = scene.name;
    } catch (cause) {
      tutorialError.value = cause instanceof Error ? cause.message : 'Не удалось создать пробную сцену. Попробуйте ещё раз.';
    } finally {
      creatingTutorial.value = false;
    }
  }

  return { creatingTutorial, tutorialError, tutorialSceneName, createTutorialScene };
}
