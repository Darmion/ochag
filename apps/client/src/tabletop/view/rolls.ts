import type { Ref } from 'vue';
import type { TabletopProps, Character } from './types';

export type RollsDeps = {
  props: TabletopProps;
  characters: Ref<Character[]>;
  combatNotice: Ref<string>;
  loadRolls: () => Promise<void>;
  run: (action: () => Promise<void>) => Promise<void>;
};

export function useRolls({ props, characters, combatNotice, loadRolls, run }: RollsDeps) {
  function submitRoll(payload: { formula: string; label: string; characterId: string; hidden: boolean }) {
    return run(async () => {
      await props.request(`/campaigns/${props.campaignId}/rolls`, 'POST', {
        formula: payload.formula,
        ...(payload.label ? { label: payload.label } : {}),
        ...(payload.characterId ? { characterId: payload.characterId } : {}),
        hidden: payload.hidden,
      });

      await loadRolls();
    });
  }

  let combatNoticeTimer: ReturnType<typeof setTimeout> | undefined;
  function stopCombatNoticeTimer() {
    clearTimeout(combatNoticeTimer);
  }

  function applyRoll(payload: { rollId: string; characterId: string; mode: 'damage' | 'heal'; critical?: boolean; damageType?: string }) {
    return run(async () => {
      const result = await props.request(
        `/campaigns/${props.campaignId}/rolls/${payload.rollId}/apply`,
        'POST',
        {
          characterId: payload.characterId,
          mode: payload.mode,
          ...(payload.critical ? { critical: true } : {}),
          ...(payload.damageType ? { damageType: payload.damageType } : {}),
        },
      );

      const characterName = characters.value.find(c => c.id === payload.characterId)?.name ?? '';
      const critSuffix = payload.mode === 'damage' && result.critical
        ? ` (крит! доп. кости: ${result.criticalDice.join(', ')})`
        : '';
      const blockedText = result.blocked === 'immune'
        ? ` — не действует: у предмета иммунитет`
        : result.blocked === 'threshold' ? ' — меньше порога урона, не прошёл' : '';
      combatNotice.value = payload.mode === 'damage'
        ? `Урон применён: ${characterName}${critSuffix}${blockedText}`
        : `Лечение применено: ${characterName}${result.blocked === 'no_healing' ? ' — не действует: хиты не восстанавливаются' : ''}`;
      clearTimeout(combatNoticeTimer);
      combatNoticeTimer = setTimeout(() => { combatNotice.value = ''; }, 4000);
    });
  }

  return { submitRoll, stopCombatNoticeTimer, applyRoll };
}
