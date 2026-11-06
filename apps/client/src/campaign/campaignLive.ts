import { onBeforeUnmount, watch, type ComputedRef, type Ref } from 'vue';
import { connectLive, type LiveConnection } from '../tabletop/live';
import { emitCampaignEvent } from './campaignEvents';

export function useCampaignLive({ loggedIn, campaignId, token }: {
  loggedIn: ComputedRef<boolean>;
  campaignId: Ref<string>;
  token: Ref<string>;
}) {
  let campaignLive: LiveConnection | undefined;
  watch([loggedIn, campaignId, token], ([logged, id]) => {
    campaignLive?.stop();
    campaignLive = undefined;
    if (!logged || !id) return;
    campaignLive = connectLive({
      campaignId: id,
      sceneId: null,
      token: token.value,
      onChange: () => {},
      onStatus: () => {},
      onRollsChanged: () => emitCampaignEvent('rolls', undefined),
      onInitiativeChanged: sceneId => emitCampaignEvent('initiative', sceneId),
      onNotes: () => emitCampaignEvent('notes', undefined),
      onCharacter: characterId => emitCampaignEvent('character', characterId),
      onCharacters: () => emitCampaignEvent('characters', undefined),
      onHandout: handout => emitCampaignEvent('handout', handout),
      onDialogue: () => emitCampaignEvent('dialogue', undefined),
      onArt: () => emitCampaignEvent('art', undefined),
      onAudioChanged: () => emitCampaignEvent('audio', undefined),
    });
  }, { immediate: true });
  onBeforeUnmount(() => campaignLive?.stop());
}
