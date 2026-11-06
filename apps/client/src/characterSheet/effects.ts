import type { EffectDTO, CharacterDTO, SheetRequest } from './types';
import { ref, computed, reactive, type Ref } from 'vue';
import { conditionInfo } from '../rules/conditions';

const STANDARD_EFFECTS: Array<{ code: string; label: string }> = [
  { code: 'blinded', label: 'Ослеплён' },
  { code: 'charmed', label: 'Очарован' },
  { code: 'deafened', label: 'Оглох' },
  { code: 'frightened', label: 'Испуган' },
  { code: 'grappled', label: 'Схвачен' },
  { code: 'incapacitated', label: 'Недееспособен' },
  { code: 'invisible', label: 'Невидим' },
  { code: 'paralyzed', label: 'Парализован' },
  { code: 'petrified', label: 'Окаменел' },
  { code: 'poisoned', label: 'Отравлен' },
  { code: 'prone', label: 'Лежит ничком' },
  { code: 'restrained', label: 'Скован' },
  { code: 'stunned', label: 'Ошеломлён' },
  { code: 'unconscious', label: 'Без сознания' },
  ...[1, 2, 3, 4, 5, 6].map(level => ({ code: `exhaustion_${level}`, label: `Истощение ${level}` })),
];

export type SheetEffectsDeps = {
  props: { campaignId: string; characterId: string; request: SheetRequest };
  character: Ref<CharacterDTO | null>;
  busy: Ref<boolean>;
  error: Ref<string>;
  load: () => Promise<void>;
};

export function useSheetEffects({ props, character, busy, error, load }: SheetEffectsDeps) {
  const customEffectText = ref('');

  function effectLabel(code: string): string {
    const info = conditionInfo(code);
    return info.label !== code ? info.label : STANDARD_EFFECTS.find(e => e.code === code)?.label ?? code;
  }

  const CONDITION_EFFECTS = STANDARD_EFFECTS.filter(effect => !effect.code.startsWith('exhaustion_'));
  const activeEffectCodes = computed(() => new Set((character.value?.effects ?? []).map(effect => effect.effect_code)));
  async function addEffect(effectCode: string) {
    if (!effectCode.trim()) return;

    busy.value = true;
    error.value = '';

    try {
      await props.request(
        `/campaigns/${props.campaignId}/characters/${props.characterId}/effects`,
        'POST',
        { effectCode: effectCode.trim() },
      );
      customEffectText.value = '';
      await load();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Не удалось добавить эффект. Попробуйте ещё раз.';
    } finally {
      busy.value = false;
    }
  }

  async function toggleEffect(effect: EffectDTO) {
    busy.value = true;
    error.value = '';

    try {
      await props.request(
        `/campaigns/${props.campaignId}/characters/${props.characterId}/effects/${effect.id}`,
        'PATCH',
        { active: !effect.active },
      );
      await load();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Не удалось изменить эффект. Попробуйте ещё раз.';
    } finally {
      busy.value = false;
    }
  }

  async function removeEffect(effectId: string) {
    busy.value = true;
    error.value = '';

    try {
      await props.request(
        `/campaigns/${props.campaignId}/characters/${props.characterId}/effects/${effectId}`,
        'DELETE',
      );
      await load();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Не удалось убрать эффект. Попробуйте ещё раз.';
    } finally {
      busy.value = false;
    }
  }

  return reactive({ customEffectText, effectLabel, CONDITION_EFFECTS, activeEffectCodes, addEffect, toggleEffect, removeEffect });
}

export type SheetEffects = ReturnType<typeof useSheetEffects>;
