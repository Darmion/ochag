import { ref, watch, type Ref } from 'vue';
import type { TabletopProps } from './types';

export type PlayerViewDeps = {
  props: TabletopProps;
  viewOnly: boolean;
  sceneId: Ref<string>;
  run: (action: () => Promise<void>) => Promise<void>;
};

export function usePlayerView({ props, viewOnly, sceneId, run }: PlayerViewDeps) {
  const playerViewAvailable = !viewOnly && Boolean(window.desktop?.playerView);
  const playerViewOpen = ref(false);
  const playerViewChooser = ref(false);
  const playerViewTarget = ref('');
  const playerViewName = ref('');
  const playerViewRoster = ref<Array<{ userId: string; displayName: string }>>([]);
  let stopPlayerViewListener: (() => void) | undefined;

  async function togglePlayerViewChooser() {
    if (playerViewChooser.value) {
      playerViewChooser.value = false;
      return;
    }

    await run(async () => {
      const result = await props.request(`/campaigns/${props.campaignId}/members/roster`);
      playerViewRoster.value = (result.members as Array<{ userId: string; displayName: string }>)
        .filter(member => member.userId !== props.currentUserId);
      if (!playerViewRoster.value.some(member => member.userId === playerViewTarget.value)) {
        playerViewTarget.value = playerViewRoster.value[0]?.userId ?? '';
      }
      playerViewChooser.value = true;
    });
  }

  function openPlayerView() {
    const target = playerViewRoster.value.find(member => member.userId === playerViewTarget.value);
    if (!target || !sceneId.value || !window.desktop?.playerView) return;

    return run(async () => {
      await window.desktop!.playerView.open({
        token: props.token,
        campaignId: props.campaignId,
        sceneId: sceneId.value,
        viewAs: target.userId,
        viewerName: target.displayName,
        currentUserId: props.currentUserId,
      });
      playerViewOpen.value = true;
      playerViewName.value = target.displayName;
      playerViewChooser.value = false;
    });
  }

  function closePlayerView() {
    void window.desktop?.playerView.close();
    playerViewChooser.value = false;
  }

  function stopPlayerViewListening() {
    stopPlayerViewListener?.();
  }

  if (playerViewAvailable) {
    stopPlayerViewListener = window.desktop!.playerView.onClosed(() => {
      playerViewOpen.value = false;
      playerViewName.value = '';
    });
    void window.desktop!.playerView.isOpen().then(open => { playerViewOpen.value = open; });

    watch(sceneId, id => {
      if (playerViewOpen.value && id) void window.desktop!.playerView.update({ sceneId: id });
    });
  }

  watch(() => props.fixedSceneId, id => {
    if (viewOnly && id) sceneId.value = id;
  }, { immediate: true });

  return { playerViewAvailable, playerViewOpen, playerViewChooser, playerViewTarget, playerViewName, playerViewRoster, togglePlayerViewChooser, openPlayerView, closePlayerView, stopPlayerViewListening };
}
