import { liveLatencyMs } from '../connection/latency';
type Options = {
  campaignId: string;
  sceneId: string | null;
  token: string;
  onChange: () => void;
  onStatus: (status: string) => void;
  onRollsChanged?: () => void;
  onInitiativeChanged?: (sceneId: string | null) => void;
  onNotes?: () => void;
  onCharacter?: (characterId: string) => void;
  onCharacters?: () => void;
  onPose?: (pose: LivePose) => void;
  onGrabDenied?: (denied: { kind: LiveKind; id: string; message: string }) => void;
  onPing?: (ping: LivePing) => void;
  onMeasure?: (measure: LiveMeasure) => void;
  onMeasureClear?: (userId: string) => void;
  onAudioChanged?: () => void;
  onSound?: (assetId: string, settings: { volume?: number; mode?: 'overlap' | 'interrupt' }) => void;
  onSoundStop?: () => void;
  onHandout?: (handout: { id: string; title: string; body: string | null; assetId: string | null }) => void;
  onDialogue?: () => void;
  onArt?: () => void;
  onChat?: (message: any) => void;
  onChatRemoved?: (messageId: string) => void;
  onPassage?: (passage: { fromSceneId: string; sceneId: string; sceneName: string; characterIds: string[] }) => void;
  onNotice?: (notice: { title: string; detail?: string; tone?: 'info' | 'good' }) => void;
  onSpellSpecial?: (special: { spellId: string; spellName: string; casterName: string; items: string[] }) => void;
  onHp?: (event: LiveHp) => void;
  onExperience?: (event: LiveExperience) => void;
  onFloat?: (event: { characterId: string; text: string; tone: string }) => void;
  onQuests?: () => void;
  onOpportunity?: (event: LiveOpportunity) => void;
  onCounterspell?: (event: LiveCounterspell) => void;
  onCounterspellClosed?: (event: LiveCounterspellClosed) => void;
  onReactionOffer?: (event: LiveReactionOffer) => void;
  onAttack?: (event: LiveAttack) => void;
  onCombatSummary?: (event: { sceneId: string; summary: unknown }) => void;
};

export type LiveAttack = {
  sceneId: string;
  attackerId: string;
  targetId: string;
  source: 'weapon' | 'spell';
  effect: 'hit' | 'miss' | 'crit' | 'heal';
  ranged: boolean;
  damageType?: string | null;
  area?: 'circle' | 'cone' | 'square' | 'line' | null;
};

export type LiveOpportunity = {
  sceneId: string;
  moverId: string;
  moverName: string;
  reason?: 'leave' | 'sentinel' | 'mage-slayer';
  reactors: Array<{ characterId: string; name: string; weaponId: string | null }>;
};

export type LiveCounterspell = {
  windowId: string;
  sceneId: string;
  casterId: string;
  casterName: string;
  spellName: string;
  spellLevel: number;
  expiresInMs: number;
  reactors: Array<{ characterId: string; name: string; slots: number[]; pact: number | null }>;
};

export type LiveCounterspellClosed = {
  windowId: string;
  sceneId: string;
  casterId: string;
  spellName: string;
  countered: boolean;
  byName: string | null;
  reason: 'countered' | 'resisted' | 'declined' | 'timeout';
};

export type LiveReactionOffer = {
  kind: 'hellish-rebuke';
  racial?: boolean;
  sceneId: string;
  reactorId: string;
  reactorName: string;
  triggerId: string;
  triggerName: string;
  spellEntryId: string;
  slots: number[];
  pact: number | null;
};

export type LiveExperience = {
  reason: string;
  awards: Array<{
    characterId: string; name: string; amount: number; experience: number; level: number;
    leveledUp: boolean; readyLevel: number | null; hpGain: number;
  }>;
};

export type LiveHp = {
  characterId: string;
  mode: 'damage' | 'heal' | 'miss';
  amount: number;
  blocked: string | null;
  modified: string | null;
  critical: boolean;
};

export type LivePoint = { x: number; z: number };

export type LivePing = LivePoint & { userId: string; displayName: string };

export type LiveMeasure = { userId: string; displayName: string; from: LivePoint; to: LivePoint };

export type LiveKind = 'object';

export type LivePose = {
  kind: LiveKind;
  id: string;
  x: number;
  y: number;
  z: number;
  rotationY: number;
  scale: number;
  holders: Array<{ userId?: string; displayName: string }>;
  final: boolean;
};

export type LiveConnection = {
  stop: () => void;
  send: (message: Record<string, unknown>) => boolean;
  isReady: () => boolean;
};

const RTT_MS = 10_000;

export function connectLive(options: Options): LiveConnection {
  let stopped = false;
  let ready = false;
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let rttTimer: ReturnType<typeof setInterval> | undefined;

  function measure() {
    if (ready && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'rtt', t: performance.now() }));
  }

  async function open() {
    if (stopped) return;

    options.onStatus('Подключение…');

    try {
      const base = window.desktop
        ? await window.desktop.getServer()
        : window.location.origin;

      if (stopped) return;

      const url = new URL('/live', base);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

      const connection = new WebSocket(url);
      socket = connection;

      connection.onopen = () => {
        if (stopped) {
          connection.close();
          return;
        }

        connection.send(JSON.stringify({
          token: options.token,
          campaignId: options.campaignId,
          sceneId: options.sceneId,
        }));
      };

      connection.onmessage = event => {
        if (stopped || socket !== connection) return;

        try {
          const message = JSON.parse(event.data);

          if (message.type === 'ready') {
            ready = true;
            options.onStatus('Синхронизация подключена');
            options.onChange();
            measure();
            clearInterval(rttTimer);
            rttTimer = setInterval(measure, RTT_MS);
          }

          if (message.type === 'rtt' && typeof message.t === 'number') {
            liveLatencyMs.value = Math.max(0, Math.round(performance.now() - message.t));
          }

          if (message.type === 'changed') {
            options.onChange();
          }

          if (message.type === 'rolls') {
            options.onRollsChanged?.();
          }

          if (message.type === 'initiative') {
            options.onInitiativeChanged?.(typeof message.sceneId === 'string' ? message.sceneId : null);
          }

          if (message.type === 'notes') options.onNotes?.();
          if (message.type === 'character' && typeof message.characterId === 'string') options.onCharacter?.(message.characterId);
          if (message.type === 'characters') options.onCharacters?.();

          if (message.type === 'pose') {
            options.onPose?.(message as LivePose);
          }

          if (message.type === 'grab-denied') {
            options.onGrabDenied?.(message);
          }

          if (message.type === 'ping') {
            options.onPing?.(message as LivePing);
          }

          if (message.type === 'measure') {
            options.onMeasure?.(message as LiveMeasure);
          }

          if (message.type === 'measure-clear') {
            options.onMeasureClear?.(message.userId);
          }

          if (message.type === 'audio') {
            options.onAudioChanged?.();
          }

          if (message.type === 'sound' && typeof message.assetId === 'string') {
            options.onSound?.(message.assetId, {
              volume: typeof message.volume === 'number' ? message.volume : undefined,
              mode: message.mode === 'interrupt' ? 'interrupt' : 'overlap',
            });
          }

          if (message.type === 'soundStop') {
            options.onSoundStop?.();
          }

          if (message.type === 'art') options.onArt?.();
          if (message.type === 'dialogue') {
            options.onDialogue?.();
          }

          if (message.type === 'chat' && message.message && typeof message.message.id === 'string') {
            options.onChat?.(message.message);
          }

          if (message.type === 'chatRemoved' && typeof message.messageId === 'string') {
            options.onChatRemoved?.(message.messageId);
          }

          if (message.type === 'handout' && message.handout && typeof message.handout.id === 'string') {
            options.onHandout?.({
              id: message.handout.id, title: String(message.handout.title ?? ''),
              body: typeof message.handout.body === 'string' ? message.handout.body : null,
              assetId: typeof message.handout.assetId === 'string' ? message.handout.assetId : null,
            });
          }

          if (message.type === 'passage' && typeof message.sceneId === 'string') {
            options.onPassage?.({
              fromSceneId: String(message.fromSceneId ?? ''), sceneId: message.sceneId,
              sceneName: String(message.sceneName ?? ''), characterIds: Array.isArray(message.characterIds) ? message.characterIds : [],
            });
          }

          if (message.type === 'hp' && typeof message.characterId === 'string') {
            options.onHp?.(message as LiveHp);
          }

          if (message.type === 'quests') {
            options.onQuests?.();
          }

          if (message.type === 'combatSummary' && message.summary && typeof message.sceneId === 'string') {
            options.onCombatSummary?.({ sceneId: message.sceneId, summary: message.summary });
          }

          if (message.type === 'attack' && typeof message.attackerId === 'string' && typeof message.targetId === 'string') {
            options.onAttack?.(message as LiveAttack);
          }

          if (message.type === 'opportunity' && Array.isArray(message.reactors)) {
            options.onOpportunity?.(message as LiveOpportunity);
          }

          if (message.type === 'counterspell' && typeof message.windowId === 'string' && Array.isArray(message.reactors)) {
            options.onCounterspell?.(message as LiveCounterspell);
          }

          if (message.type === 'counterspell-closed' && typeof message.windowId === 'string') {
            options.onCounterspellClosed?.(message as LiveCounterspellClosed);
          }

          if (message.type === 'reaction-offer' && typeof message.reactorId === 'string' && typeof message.spellEntryId === 'string') {
            options.onReactionOffer?.(message as LiveReactionOffer);
          }

          if (message.type === 'float' && typeof message.characterId === 'string' && typeof message.text === 'string') {
            options.onFloat?.({ characterId: message.characterId, text: message.text, tone: typeof message.tone === 'string' ? message.tone : 'info' });
          }

          if (message.type === 'experience' && Array.isArray(message.awards)) {
            options.onExperience?.(message as LiveExperience);
          }

          if (message.type === 'spell-special' && typeof message.spellId === 'string' && Array.isArray(message.items)) {
            options.onSpellSpecial?.({
              spellId: message.spellId, spellName: String(message.spellName ?? ''), casterName: String(message.casterName ?? ''),
              items: message.items.map((item: unknown) => String(item)),
            });
          }

          if (message.type === 'notice' && typeof message.title === 'string') {
            options.onNotice?.({
              title: message.title,
              detail: typeof message.detail === 'string' ? message.detail : undefined,
              tone: message.tone === 'info' || message.tone === 'good' ? message.tone : undefined,
            });
          }
        } catch {
          connection.close();
        }
      };

      connection.onerror = () => {
        connection.close();
      };

      connection.onclose = event => {
        if (socket === connection) {
          ready = false;
          clearInterval(rttTimer);
          liveLatencyMs.value = null;
        }
        if (stopped || socket !== connection) return;

        if (event.code === 1008) {
          options.onStatus(
            'Нет доступа к синхронизации. Проверьте сессию и кампанию.',
          );
          return;
        }

        options.onStatus('Соединение потеряно. Повторное подключение…');
        retry = setTimeout(() => void open(), 3000);
      };
    } catch {
      if (stopped) return;

      options.onStatus('Сервер недоступен. Повторное подключение…');
      retry = setTimeout(() => void open(), 3000);
    }
  }

  void open();

  return {
    stop: () => {
      stopped = true;
      ready = false;
      clearTimeout(retry);
      clearInterval(rttTimer);
      liveLatencyMs.value = null;
      socket?.close();
    },
    send: message => {
      if (!ready || !socket || socket.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify(message));
      return true;
    },
    isReady: () => ready && socket?.readyState === WebSocket.OPEN,
  };
}
