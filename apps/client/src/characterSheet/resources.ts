import { reactive, ref, type Ref } from 'vue';
import type { Recharge, ResourceDTO, SheetRequest } from './types';

export const RECHARGE_LABELS: Record<Recharge, string> = { none: 'сам', short: 'короткий отдых', long: 'долгий отдых' };

export type ResourcesDeps = {
  props: { campaignId: string; characterId: string; request: SheetRequest };
  busy: Ref<boolean>;
  error: Ref<string>;
  load: () => Promise<void>;
};

export function useResources({ props, busy, error, load }: ResourcesDeps) {
  const newResourceName = ref('');
  const newResourceMax = ref(1);
  const newResourceRecharge = ref<Recharge>('long');

  async function addResource() {
    if (!newResourceName.value.trim()) return;

    busy.value = true;
    error.value = '';

    try {
      await props.request(
        `/campaigns/${props.campaignId}/characters/${props.characterId}/resources`,
        'POST',
        { name: newResourceName.value.trim(), current: newResourceMax.value, max: newResourceMax.value, recharge: newResourceRecharge.value },
      );
      newResourceName.value = '';
      newResourceMax.value = 1;
      await load();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Не удалось добавить ресурс. Попробуйте ещё раз.';
    } finally {
      busy.value = false;
    }
  }

  async function adjustResource(resource: ResourceDTO, delta: number) {
    const next = Math.max(0, Math.min(resource.max, resource.current + delta));
    if (next === resource.current) return;

    busy.value = true;
    error.value = '';

    try {
      await props.request(
        `/campaigns/${props.campaignId}/characters/${props.characterId}/resources/${resource.id}`,
        'PATCH',
        { current: next },
      );
      await load();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Не удалось изменить ресурс. Попробуйте ещё раз.';
    } finally {
      busy.value = false;
    }
  }

  async function setRecharge(resource: ResourceDTO, recharge: Recharge) {
    busy.value = true;
    error.value = '';
    try {
      await props.request(
        `/campaigns/${props.campaignId}/characters/${props.characterId}/resources/${resource.id}`,
        'PATCH',
        { recharge },
      );
      await load();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Не удалось изменить ресурс. Попробуйте ещё раз.';
    } finally {
      busy.value = false;
    }
  }

  async function removeResource(resourceId: string) {
    busy.value = true;
    error.value = '';

    try {
      await props.request(
        `/campaigns/${props.campaignId}/characters/${props.characterId}/resources/${resourceId}`,
        'DELETE',
      );
      await load();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Не удалось удалить ресурс. Попробуйте ещё раз.';
    } finally {
      busy.value = false;
    }
  }

  return reactive({ newResourceName, newResourceMax, newResourceRecharge, addResource, adjustResource, setRecharge, removeResource });
}

export type Resources = ReturnType<typeof useResources>;
