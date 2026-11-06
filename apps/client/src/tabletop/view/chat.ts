import { computed, type Ref, type ComputedRef } from 'vue';
import type { Tabletop } from '../scene';
import type { ChatMessage } from '../../campaign/chat';
import type { TabletopProps, SceneObjectDTO } from './types';
import type { TableToast } from '../toasts';

export type ChatDeps = {
  props: TabletopProps;
  objects: Ref<SceneObjectDTO[]>;
  chatMessages: Ref<ChatMessage[]>;
  chatMembers: Ref<Array<{ userId: string; displayName: string }>>;
  table: () => Tabletop | undefined;
  pushToast: (toast: Omit<TableToast, "id">, durationMs?: number) => void;
  refresh: () => Promise<void>;
  run: (action: () => Promise<void>) => Promise<void>;
  actorObject: ComputedRef<SceneObjectDTO | null>;
};

export function useChat({ props, objects, chatMessages, chatMembers, table, pushToast, refresh, run, actorObject }: ChatDeps) {
  async function loadChat() {
    try {
      const [chat, roster] = await Promise.all([
        props.request(`/campaigns/${props.campaignId}/chat`),
        props.request(`/campaigns/${props.campaignId}/members/roster`),
      ]);
      chatMessages.value = chat.messages;
      chatMembers.value = (roster.members as Array<{ userId: string; displayName: string }>).filter(member => member.userId !== props.currentUserId);
    } catch {
    }
  }

  const chatSpeaker = computed(() => {
    const object = actorObject.value;
    return object && object.kind !== 'object' && object.canEdit ? { characterId: object.character_id, name: object.name } : null;
  });

  function sendChat(payload: { body: string; inCharacter: boolean; characterId?: string; toUserId?: string }) {
    return run(async () => {
      const result = await props.request(`/campaigns/${props.campaignId}/chat`, 'POST', payload);
      const message = result.message as ChatMessage;
      if (chatMessages.value.some(entry => entry.id === message.id)) return;
      chatMessages.value = [...chatMessages.value, message].slice(-200);
      speak(message);
    });
  }

  function speak(message: ChatMessage) {
    if (!message.in_character || !message.character_id) return;
    const placement = objects.value.find(object => object.character_id === message.character_id && !object.parent_object_id);
    if (placement) table()?.showSpeech(placement.id, message.body);
  }

  function onVisionChanged(message?: string) {
    if (message) pushToast({ tone: 'info', title: message });
    void refresh();
  }

  return { loadChat, chatSpeaker, sendChat, speak, onVisionChanged };
}
