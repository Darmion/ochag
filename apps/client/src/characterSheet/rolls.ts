import type { CharacterDTO, SheetRequest } from './types';
import { ref, computed, type Ref } from 'vue';

export type SheetRollsDeps = {
  props: { campaignId: string; characterId: string; request: SheetRequest };
  character: Ref<CharacterDTO | null>;
  busy: Ref<boolean>;
  error: Ref<string>;
  load: () => Promise<void>;
};

export function useSheetRolls({ props, character, busy, error, load }: SheetRollsDeps) {
  const rollAdvantage = ref<'none' | 'adv' | 'disadv'>('none');
  const spendInspiration = ref(false);

  async function setInspiration(body: { inspired: boolean } | { giveTo: string }) {
    busy.value = true;
    error.value = '';
    try {
      await props.request(`/campaigns/${props.campaignId}/characters/${props.characterId}/inspiration`, 'POST', body);
      await load();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Не удалось изменить вдохновение. Попробуйте ещё раз.';
    } finally {
      busy.value = false;
    }
  }
  const rollBusy = ref(false);
  const lastRoll = ref<{ label: string; total: number; results: number[] } | null>(null);

  async function rollCheck(kind: 'save' | 'skill' | 'ability' | 'attack', key: string) {
    if (!character.value) return;
    rollBusy.value = true;
    error.value = '';

    try {
      const result = await props.request(
        `/campaigns/${props.campaignId}/rolls/check`,
        'POST',
        {
          characterId: props.characterId, kind, key, advantage: rollAdvantage.value,
          ...(spendInspiration.value && character.value.inspiration ? { inspiration: true } : {}),
        },
      );
      lastRoll.value = { label: result.label, total: result.total, results: result.dice_results };
      if (spendInspiration.value) {
        spendInspiration.value = false;
        await load();
      }
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Не удалось бросить. Попробуйте ещё раз.';
    } finally {
      rollBusy.value = false;
    }
  }

  const dyingNow = computed(() => Boolean(character.value && character.value.kind === 'character' && character.value.hp_current === 0 &&
    character.value.effects.some(effect => effect.active && effect.effect_code === 'unconscious') &&
    !character.value.effects.some(effect => effect.active && (effect.effect_code === 'dead' || effect.effect_code === 'stable'))));

  async function rollDeathSave() {
    rollBusy.value = true;
    error.value = '';
    try {
      const inspired = spendInspiration.value && character.value?.inspiration;
      const result = await props.request(`/campaigns/${props.campaignId}/characters/${props.characterId}/death-save`, 'POST', inspired ? { inspiration: true } : undefined);
      if (inspired) spendInspiration.value = false;
      lastRoll.value = { label: result.roll.label, total: result.roll.total, results: result.roll.dice_results };
      await load();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Не удалось бросить. Попробуйте ещё раз.';
    } finally {
      rollBusy.value = false;
    }
  }

  return { rollAdvantage, spendInspiration, setInspiration, rollBusy, lastRoll, rollCheck, dyingNow, rollDeathSave };
}
