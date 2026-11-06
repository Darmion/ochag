import { ref, computed } from 'vue';
import type { GameLogEmit, GameLogProps } from './types';
import type { useLogLines } from './lines';

export type ApplyRollDeps = {
  props: GameLogProps;
  emit: GameLogEmit;
  rollLines: ReturnType<typeof useLogLines>['rollLines'];
};

export function useApplyRoll({ props, emit, rollLines }: ApplyRollDeps) {
  const applyFor = ref<string | null>(null);
  const applyTarget = ref('');
  const applyType = ref('');
  const applyCritical = ref(false);
  const applyRollLine = computed(() => rollLines.value.find(line => line.id === applyFor.value) ?? null);
  function openApply(rollId: string) {
    if (applyFor.value === rollId) {
      applyFor.value = null;
      return;
    }
    applyFor.value = rollId;
    const targets = props.applyTargets ?? [];
    if (!targets.some(target => target.id === applyTarget.value)) {
      applyTarget.value = targets.some(target => target.id === props.defaultTargetId) ? props.defaultTargetId! : targets[0]?.id ?? '';
    }
    applyCritical.value = false;
  }
  const alreadyApplied = computed(() => Boolean(applyTarget.value && applyRollLine.value?.applied.includes(applyTarget.value)));
  function apply(mode: 'damage' | 'heal') {
    if (!applyFor.value || !applyTarget.value) return;
    emit('applyRoll', {
      rollId: applyFor.value, characterId: applyTarget.value, mode,
      ...(mode === 'damage' && applyCritical.value ? { critical: true } : {}),
      ...(mode === 'damage' && applyType.value ? { damageType: applyType.value } : {}),
    });
    applyFor.value = null;
  }

  return { applyFor, applyTarget, applyType, applyCritical, applyRollLine, openApply, alreadyApplied, apply };
}
