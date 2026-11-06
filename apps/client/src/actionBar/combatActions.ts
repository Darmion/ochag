import { computed, watch, ref, type Ref, type ComputedRef } from 'vue';
import type { ActionBarProps, Popover, ActionBarEmit, ActionUsing, StandardAction, StealthKind, CombatCommand } from './types';

export type CombatActionsDeps = {
  props: ActionBarProps;
  emit: ActionBarEmit;
  popover: Ref<Popover>;
  loadedFor: Ref<string>;
  useInspiration: Ref<boolean>;
  targetId: Ref<string>;
  perform: (action: () => Promise<unknown>, keepOpen?: boolean) => Promise<void>;
  bonusAllowed: ComputedRef<boolean>;
  attackUsing: Ref<"bonus" | "action" | "reaction">;
};

export function useCombatActions({ props, emit, popover, loadedFor, useInspiration, targetId, perform, bonusAllowed, attackUsing }: CombatActionsDeps) {
  const hasteAction = computed(() => Boolean(props.economy && !props.economy.action && !props.economy.hasteUsed && props.actor?.conditions.includes('hasted')));
  watch(() => [props.isActorTurn, props.economy?.action, props.economy?.attacksMade, props.economy?.perAction, bonusAllowed.value, hasteAction.value].join('|'), () => {
    const economy = props.economy;
    if (!economy) attackUsing.value = 'action';
    else if (!props.isActorTurn) attackUsing.value = 'reaction';
    else if (!economy.action && !hasteAction.value && !(economy.attacksMade > 0 && economy.attacksMade < economy.perAction) && economy.bonus && bonusAllowed.value) attackUsing.value = 'bonus';
    else attackUsing.value = 'action';
  }, { immediate: true });
  const attacksLeftText = computed(() => {
    const economy = props.economy;
    if (!economy || economy.perAction <= 1) return '';
    const left = economy.action ? economy.perAction : economy.attacksMade > 0 ? economy.perAction - economy.attacksMade : 0;
    return `атак в действии: ${left} из ${economy.perAction}`;
  });

  function standardAction(action: StandardAction, using: ActionUsing) {
    const economy = props.economy;
    if (!economy || !props.sceneId) return;
    const path = `/campaigns/${props.campaignId}/scenes/${props.sceneId}/initiative/${economy.entryId}`;
    return perform(async () => {
      if (action === 'dash') await props.request(`${path}/dash`, 'POST', { using });
      else await props.request(`${path}/act`, 'POST', { action, using });
      emit('acted', `${props.actor?.name ?? ''}: ${({ dash: 'Рывок', disengage: 'Отход', dodge: 'Уклонение' })[action]}${using === 'bonus' ? ' (бонусным действием)' : ''}.`);
    });
  }

  const helpAlly = ref('');
  const helpFoe = ref('');
  const actorGrappled = computed(() => Boolean(props.actor?.conditions.includes('grappled')));
  const canAttackAction = computed(() => !props.economy || props.economy.action || (props.economy.attacksMade > 0 && props.economy.attacksMade < props.economy.perAction));
  const targetName = computed(() => props.targets.find(target => target.characterId === targetId.value)?.name ?? '');
  const readyTrigger = ref('');
  function combatAction(action: CombatCommand, extra: Record<string, unknown> = {}) {
    const actor = props.actor;
    if (!actor) return;
    return perform(async () => {
      await props.request(`/campaigns/${props.campaignId}/characters/${actor.characterId}/combat-action`, 'POST', {
        action, ...(props.sceneId ? { sceneId: props.sceneId } : {}), ...extra,
      });
      if (action === 'help') helpAlly.value = '';
      if (action === 'ready') readyTrigger.value = '';
    });
  }

  const actorHidden = computed(() => Boolean(props.actor?.conditions.includes('hidden')));
  function stealthAction(kind: StealthKind, using?: ActionUsing) {
    const actor = props.actor;
    if (!actor || !props.sceneId) return;
    return perform(async () => {
      const result = await props.request(`/campaigns/${props.campaignId}/scenes/${props.sceneId}/${kind}`, 'POST', {
        characterId: actor.characterId, ...(using ? { using } : {}),
      });
      if (kind === 'hide') emit('acted', `${actor.name} прячется: Скрытность ${result.total}.`);
      else if (kind === 'unhide') emit('acted', `${actor.name} выходит из тени.`);
      else emit('acted', result.found?.length ? `${actor.name} ищет (${result.total}) и находит: ${result.found.join(', ')}.` : `${actor.name} ищет (${result.total}) — ничего не найдено.`);
    });
  }

  function markEconomy(field: 'action' | 'bonus' | 'reaction') {
    const economy = props.economy;
    if (!economy || !props.sceneId) return;
    const available = economy[field];
    if (!available && !props.canStartCombat && !props.canInspire) return;
    return perform(() => props.request(
      `/campaigns/${props.campaignId}/scenes/${props.sceneId}/initiative/${economy.entryId}/economy`, 'POST', { [field]: available },
    ));
  }

  function inspire() {
    const actor = props.actor;
    if (!actor) return;
    return perform(() => props.request(`/campaigns/${props.campaignId}/characters/${actor.characterId}/inspiration`, 'POST', { inspired: true }));
  }

  function deathSave() {
    const actor = props.actor;
    if (!actor) return;
    const spend = useInspiration.value && actor.inspired;
    return perform(async () => {
      const { result } = await props.request(`/campaigns/${props.campaignId}/characters/${actor.characterId}/death-save`, 'POST', {
        ...(spend ? { inspiration: true } : {}), ...(props.sceneId ? { sceneId: props.sceneId } : {}),
      });
      if (spend) useInspiration.value = false;
      emit('acted', `${actor.name}: спасбросок от смерти — ${({ success: 'успех', failure: 'провал', stable: 'стабилен', dead: 'смерть', revived: 'приходит в себя' } as Record<string, string>)[result] ?? result}.`);
    });
  }

  function stand() {
    const actor = props.actor;
    if (!actor) return;
    return perform(async () => {
      const { spentMovement } = await props.request(`/campaigns/${props.campaignId}/characters/${actor.characterId}/stand`, 'POST');
      emit('acted', `${actor.name} встаёт${spentMovement ? ' — ушла половина скорости' : ''}.`);
    });
  }

  function onRested() {
    popover.value = null;
    loadedFor.value = '';
  }

  function restParty(kind: 'short' | 'long') {
    popover.value = null;
    emit('restParty', kind);
  }

  return { hasteAction, attacksLeftText, standardAction, helpAlly, helpFoe, actorGrappled, canAttackAction, targetName, readyTrigger, combatAction, actorHidden, stealthAction, markEconomy, inspire, deathSave, stand, onRested, restParty };
}
