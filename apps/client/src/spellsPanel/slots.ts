import { computed, reactive, ref, type Ref } from 'vue';
import type { SpellSlot, SpellsRequest } from './types';

type SlotsInput = {
  props: { campaignId: string; characterId: string; readOnly: boolean; request: SpellsRequest };
  busy: Ref<boolean>;
  error: Ref<string>;
};

export function useSpellSlots({ props, busy, error }: SlotsInput) {
  const slots = ref<SpellSlot[]>([]);
  const pactSlots = ref<{ current: number; max: number; slotLevel: number } | null>(null);
  const usePact = ref(false);
  const slotsBusy = ref(false);

  async function slotsByClass() {
    busy.value = true;
    error.value = '';
    try {
      await props.request(`/campaigns/${props.campaignId}/characters/${props.characterId}/spell-slots/by-class`, 'POST');
      await loadSlots();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Не удалось посчитать ячейки. Попробуйте ещё раз.';
    } finally {
      busy.value = false;
    }
  }

  async function loadSlots() {
    try {
      const data = await props.request(
        `/campaigns/${props.campaignId}/characters/${props.characterId}/spell-slots`,
      );
      slots.value = data.slots;
      pactSlots.value = data.pact ?? null;
      if (!pactSlots.value) usePact.value = false;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Не удалось загрузить ячейки заклинаний. Попробуйте ещё раз.';
    }
  }

  const showAllSlots = ref(false);
  const visibleSlots = computed(() => (props.readOnly || !showAllSlots.value ? slots.value.filter(s => s.max > 0) : slots.value));
  const allSlots = computed(() => Array.from({ length: 9 }, (_, index) => slotFor(index + 1)));

  function slotFor(level: number): SpellSlot {
    return slots.value.find(s => s.level === level) ?? { level, current: 0, max: 0 };
  }

  async function setSlot(level: number, patch: Partial<{ current: number; max: number }>) {
    const current = slotFor(level);
    const next = { current: current.current, max: current.max, ...patch };

    slotsBusy.value = true;
    error.value = '';

    try {
      const updated = await props.request(
        `/campaigns/${props.campaignId}/characters/${props.characterId}/spell-slots/${level}`,
        'PUT',
        next,
      );
      const index = slots.value.findIndex(s => s.level === level);
      if (index === -1) slots.value.push(updated);
      else slots.value[index] = updated;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Не удалось изменить ячейки заклинаний. Попробуйте ещё раз.';
    } finally {
      slotsBusy.value = false;
    }
  }

  return reactive({ slots, pactSlots, usePact, slotsBusy, slotsByClass, loadSlots, showAllSlots, visibleSlots, allSlots, slotFor, setSlot });
}

export type SpellSlots = ReturnType<typeof useSpellSlots>;
