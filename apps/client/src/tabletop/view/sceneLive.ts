import type { Ref } from 'vue';
import type { Tabletop } from '../scene';
import { signalColor } from '../signals';
import { connectLive, type LivePose, type LiveKind, type LiveAttack, type LiveOpportunity, type LiveCounterspell, type LiveCounterspellClosed, type LiveReactionOffer, type LiveHp, type LiveExperience } from '../live';
import type { ChatMessage } from '../../campaign/chat';
import type { createAudioPlayer } from '../audio';
import type { CombatSummaryData } from '../../components/tabletop/CombatSummary.vue';
import type { TabletopProps, SceneObjectDTO } from './types';
import type { TableToast } from '../toasts';

export type SceneLiveDeps = {
  props: TabletopProps;
  viewOnly: boolean;
  sceneId: Ref<string>;
  spellSpecials: Ref<Array<{ spellId: string; spellName: string; casterName: string; items: string[] }>>;
  objects: Ref<SceneObjectDTO[]>;
  chatMessages: Ref<ChatMessage[]>;
  status: Ref<string>;
  table: () => Tabletop | undefined;
  disposed: () => boolean;
  factionsOpen: Ref<boolean>;
  factionsRevision: Ref<number>;
  pushToast: (toast: Omit<TableToast, "id">, durationMs?: number) => void;
  loadAudio: () => Promise<void>;
  audioPlayer: ReturnType<typeof createAudioPlayer>;
  loadRolls: () => Promise<void>;
  loadInitiative: () => Promise<void>;
  loadNotes: () => Promise<void>;
  refresh: () => Promise<void>;
  reloadCharacters: () => Promise<void>;
  onLivePose: (pose: LivePose) => void;
  onLiveGrabDenied: (kind: LiveKind, id: string, message: string) => void;
  speak: (message: ChatMessage) => void;
  factionList: Ref<{ id: string; name: string; color: string; }[]>;
  loadFactionList: () => Promise<void>;
  showAttackFx: (event: LiveAttack) => void;
  combatSummary: Ref<CombatSummaryData | null>;
  addOpportunity: (event: LiveOpportunity) => void;
  addCounterspell: (event: LiveCounterspell) => void;
  closeCounterspell: (event: LiveCounterspellClosed) => void;
  addReactionOffer: (event: LiveReactionOffer) => void;
  showHpFloat: (event: LiveHp) => void;
  showExperience: (event: LiveExperience) => void;
  questsRevision: Ref<number>;
};

export function useSceneLive({ props, viewOnly, sceneId, spellSpecials, objects, chatMessages, status, table, disposed, factionsOpen, factionsRevision, pushToast, loadAudio, audioPlayer, loadRolls, loadInitiative, loadNotes, refresh, reloadCharacters, onLivePose, onLiveGrabDenied, speak, factionList, loadFactionList, showAttackFx, combatSummary, addOpportunity, addCounterspell, closeCounterspell, addReactionOffer, showHpFloat, showExperience, questsRevision }: SceneLiveDeps) {
  function connectScene(id: string) {
    return connectLive({
      campaignId: props.campaignId,
      sceneId: id,
      token: props.token,
      onChange: () => {
        void refresh();
        if (factionsOpen.value) factionsRevision.value += 1;
        if (factionList.value.length) void loadFactionList();
      },
      onStatus: value => {
        if (!disposed()) status.value = value;
      },
      onRollsChanged: () => void loadRolls(),
      onInitiativeChanged: () => {
        void loadInitiative();
        if (!viewOnly) void loadAudio();
      },
      onHp: event => showHpFloat(event),
      onExperience: event => showExperience(event),
      onQuests: () => { questsRevision.value += 1; },
      onOpportunity: event => addOpportunity(event),
      onCounterspell: event => addCounterspell(event),
      onCounterspellClosed: event => closeCounterspell(event),
      onReactionOffer: event => addReactionOffer(event),
      onAttack: event => showAttackFx(event),
      onCombatSummary: event => {
        if (event.sceneId === sceneId.value) combatSummary.value = event.summary as CombatSummaryData;
      },
      onFloat: event => {
        const tone = (['xp', 'level', 'info', 'heal', 'condition'] as const).find(entry => entry === event.tone) ?? 'info';
        for (const placement of objects.value.filter(object => object.character_id === event.characterId)) {
          table()?.showFloatingText(placement.id, event.text, tone);
        }
      },
      onNotes: () => void loadNotes(),
      onCharacters: () => {
        void reloadCharacters();
        void refresh();
      },
      onCharacter: characterId => {
        void reloadCharacters();
        if (objects.value.some(object => object.character_id === characterId)) void refresh();
      },
      onPose: pose => onLivePose(pose),
      onGrabDenied: denied => onLiveGrabDenied(denied.kind, denied.id, denied.message),
      onPing: ping => table()?.showPing(ping, ping.displayName, signalColor(ping.userId)),
      onMeasure: measure => table()?.showRemoteMeasure(
        measure.userId, measure.displayName, signalColor(measure.userId), measure.from, measure.to,
      ),
      onMeasureClear: userId => table()?.clearRemoteMeasure(userId),
      // Sound plays in the GM's main window only, otherwise one computer would play the music twice.
      onAudioChanged: () => { if (!viewOnly) void loadAudio(); },
      onSound: (assetId, settings) => { if (!viewOnly) void audioPlayer.playEffect(assetId, settings); },
      onSoundStop: () => audioPlayer.stopEffects(),
      onChat: message => {
        if (chatMessages.value.some(entry => entry.id === message.id)) return;
        chatMessages.value = [...chatMessages.value, message].slice(-200);
        speak(message);
      },
      onChatRemoved: messageId => { chatMessages.value = chatMessages.value.filter(entry => entry.id !== messageId); },
      onPassage: passage => {
        if (viewOnly || passage.fromSceneId !== sceneId.value) return;
        sceneId.value = passage.sceneId;
        pushToast({ tone: 'info', title: `Переход: ${passage.sceneName}` });
      },
      onSpellSpecial: special => { spellSpecials.value = [...spellSpecials.value, special]; },
      onNotice: notice => pushToast({
        tone: notice.tone === 'good' ? 'crit' : notice.tone === 'info' ? 'info' : 'fumble', title: notice.title, detail: notice.detail,
      }, 9000),
    });
  }

  return { connectScene };
}
