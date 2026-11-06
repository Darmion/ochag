import { ref, watch, type Ref, type ComputedRef } from 'vue';
import type { LiveOpportunity, LiveCounterspell, LiveCounterspellClosed, LiveReactionOffer } from '../live';
import type { OpportunityPrompt, CounterPrompt, RebukePrompt, SlotChoice, TabletopProps, SceneObjectDTO, InitiativeEntry } from './types';
import type { TableToast } from '../toasts';

export type ReactionsDeps = {
  props: TabletopProps;
  sceneId: Ref<string>;
  objects: Ref<SceneObjectDTO[]>;
  pushToast: (toast: Omit<TableToast, "id">, durationMs?: number) => void;
  run: (action: () => Promise<void>) => Promise<void>;
  currentEntry: ComputedRef<InitiativeEntry | null>;
};

export function useReactions({ props, sceneId, objects, pushToast, run, currentEntry }: ReactionsDeps) {
  const opportunityPrompts = ref<OpportunityPrompt[]>([]);

  function addOpportunity(event: LiveOpportunity) {
    if (event.sceneId !== sceneId.value) return;
    for (const reactor of event.reactors) {
      const controlled = objects.value.some(object => object.character_id === reactor.characterId && object.canEdit);
      const key = `${reactor.characterId}:${event.moverId}`;
      if (!controlled || opportunityPrompts.value.some(prompt => prompt.key === key)) continue;
      opportunityPrompts.value.push({ key, moverId: event.moverId, moverName: event.moverName, reactorId: reactor.characterId, reactorName: reactor.name, weaponId: reactor.weaponId, reason: event.reason ?? 'leave' });
    }
  }

  function opportunityTitle(prompt: OpportunityPrompt) {
    return prompt.reason === 'sentinel' ? '«Часовой»' : prompt.reason === 'mage-slayer' ? '«Убийца магов»' : 'Атака при уходе';
  }

  function dismissOpportunity(prompt: OpportunityPrompt) {
    opportunityPrompts.value = opportunityPrompts.value.filter(entry => entry.key !== prompt.key);
  }

  function takeOpportunity(prompt: OpportunityPrompt) {
    if (!prompt.weaponId) {
      pushToast({ tone: 'info', title: opportunityTitle(prompt), detail: `У «${prompt.reactorName}» нет рукопашного оружия в листе.` });
      dismissOpportunity(prompt);
      return;
    }
    return run(async () => {
      await props.request(`/campaigns/${props.campaignId}/rolls/check`, 'POST', {
        characterId: prompt.reactorId, kind: 'attack', key: prompt.weaponId, targetCharacterId: prompt.moverId,
        sceneId: sceneId.value, using: 'reaction', opportunity: true,
      });
      dismissOpportunity(prompt);
    });
  }
  const counterPrompts = ref<CounterPrompt[]>([]);
  watch(() => currentEntry.value?.id, () => { opportunityPrompts.value = []; rebukePrompts.value = []; });
  const rebukePrompts = ref<RebukePrompt[]>([]);
  const promptNow = ref(Date.now());
  let promptClock: ReturnType<typeof setInterval> | null = null;
  function stopPromptClock() {
    if (promptClock) clearInterval(promptClock);
    promptClock = null;
  }

  function reactionSlotChoices(slots: number[], pact: number | null, racial = false): SlotChoice[] {
    return [
      ...(racial ? [{ value: 'racial', level: 2, label: 'по наследию тифлинга (2 ур., без ячейки)' }] : []),
      ...slots.map(level => ({ value: String(level), level, label: `ячейка ${level} ур.` })),
      ...(pact !== null ? [{ value: 'pact', level: pact, label: `ячейка договора ${pact} ур.` }] : []),
    ];
  }

  function slotPayload(choices: SlotChoice[], value: string) {
    const choice = choices.find(entry => entry.value === value);
    return choice?.value === 'racial' ? { racial: true } : choice?.value === 'pact' ? { pact: true } : choice ? { slotLevel: choice.level } : {};
  }

  function counterHint(prompt: CounterPrompt, choice: SlotChoice) {
    return choice.level >= prompt.spellLevel ? 'прервёт наверняка' : `проверка, СЛ ${10 + prompt.spellLevel}`;
  }

  function secondsLeft(deadline: number) {
    return Math.max(0, Math.ceil((deadline - promptNow.value) / 1000));
  }

  function tickPrompts() {
    promptNow.value = Date.now();
    counterPrompts.value = counterPrompts.value.filter(prompt => prompt.deadline > promptNow.value);
    rebukePrompts.value = rebukePrompts.value.filter(prompt => prompt.deadline > promptNow.value);
    if (!counterPrompts.value.length && !rebukePrompts.value.length && promptClock) {
      clearInterval(promptClock);
      promptClock = null;
    }
  }

  function startPromptClock() {
    promptNow.value = Date.now();
    promptClock ??= setInterval(tickPrompts, 500);
  }

  function controlsCreature(characterId: string) {
    return objects.value.some(object => object.character_id === characterId && object.canEdit);
  }

  function addCounterspell(event: LiveCounterspell) {
    const deadline = Date.now() + event.expiresInMs;
    for (const reactor of event.reactors) {
      const key = `${event.windowId}:${reactor.characterId}`;
      if (!controlsCreature(reactor.characterId) || counterPrompts.value.some(prompt => prompt.key === key)) continue;
      const choices = reactionSlotChoices(reactor.slots, reactor.pact);
      counterPrompts.value.push({
        key, windowId: event.windowId, casterName: event.casterName, spellName: event.spellName, spellLevel: event.spellLevel,
        reactorId: reactor.characterId, reactorName: reactor.name, choices, choice: choices[0]?.value ?? '', deadline,
      });
    }
    if (counterPrompts.value.length) startPromptClock();
  }

  function closeCounterspell(event: LiveCounterspellClosed) {
    counterPrompts.value = counterPrompts.value.filter(prompt => prompt.windowId !== event.windowId);
  }

  function counterspellIt(prompt: CounterPrompt) {
    return run(async () => {
      const result = await props.request(`/campaigns/${props.campaignId}/counterspell/${prompt.windowId}`, 'POST', {
        characterId: prompt.reactorId, ...slotPayload(prompt.choices, prompt.choice),
      });
      counterPrompts.value = counterPrompts.value.filter(entry => entry.windowId !== prompt.windowId);
      if (result?.pending) pushToast({ tone: 'info', title: '«Контрзаклинание» ждёт', detail: 'Противник может ответить своим.' });
    });
  }

  function skipCounterspell(prompt: CounterPrompt) {
    counterPrompts.value = counterPrompts.value.filter(entry => entry.key !== prompt.key);
    void props.request(`/campaigns/${props.campaignId}/counterspell/${prompt.windowId}/decline`, 'POST', { characterId: prompt.reactorId })
      .catch(() => undefined);
  }

  function addReactionOffer(event: LiveReactionOffer) {
    if (event.kind !== 'hellish-rebuke' || !controlsCreature(event.reactorId)) return;
    const key = `${event.reactorId}:${event.triggerId}`;
    if (rebukePrompts.value.some(prompt => prompt.key === key)) return;
    const choices = reactionSlotChoices(event.slots, event.pact, event.racial === true);
    rebukePrompts.value.push({
      key, sceneId: event.sceneId, reactorId: event.reactorId, reactorName: event.reactorName, triggerId: event.triggerId,
      triggerName: event.triggerName, spellEntryId: event.spellEntryId, choices, choice: choices[0]?.value ?? '', deadline: Date.now() + 60_000,
    });
    startPromptClock();
  }

  function rebukeIt(prompt: RebukePrompt) {
    return run(async () => {
      const result = await props.request(`/campaigns/${props.campaignId}/characters/${prompt.reactorId}/spells/${prompt.spellEntryId}/cast`, 'POST', {
        targetIds: [prompt.triggerId], sceneId: prompt.sceneId, ...slotPayload(prompt.choices, prompt.choice),
      });
      rebukePrompts.value = rebukePrompts.value.filter(entry => entry.key !== prompt.key);
      if (result.pending) pushToast({ tone: 'info', title: '«Адское возмездие» ждёт', detail: 'Противник может ответить «Контрзаклинанием».' });
    });
  }

  function skipRebuke(prompt: RebukePrompt) {
    rebukePrompts.value = rebukePrompts.value.filter(entry => entry.key !== prompt.key);
  }

  return { opportunityPrompts, addOpportunity, dismissOpportunity, takeOpportunity, counterPrompts, rebukePrompts, stopPromptClock, counterHint, secondsLeft, addCounterspell, closeCounterspell, counterspellIt, skipCounterspell, addReactionOffer, rebukeIt, skipRebuke };
}
