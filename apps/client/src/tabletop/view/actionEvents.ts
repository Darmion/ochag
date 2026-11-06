import { computed, type Ref, type ComputedRef } from 'vue';
import type { Tabletop, ObjectSide } from '../scene';
import { objectImageId, classCrest } from '../../art/portraitArt';
import type { InitiativeMedal } from '../../components/game/GameInitiative.vue';
import type { SceneObjectDTO, InitiativeEntry } from './types';
import type { TableToast } from '../toasts';

export type ActionEventsDeps = {
  objects: Ref<SceneObjectDTO[]>;
  activeObjectId: Ref<string>;
  initiativeEntries: Ref<InitiativeEntry[]>;
  feetPerUnit: ComputedRef<number>;
  table: () => Tabletop | undefined;
  pushToast: (toast: Omit<TableToast, "id">, durationMs?: number) => void;
  sideOf: (object: SceneObjectDTO) => ObjectSide;
  focusActiveObject: () => void;
  refresh: () => Promise<void>;
  hudImage: (assetId: string | null | undefined) => string | null;
  actorObject: ComputedRef<SceneObjectDTO | null>;
};

export function useActionEvents({ objects, activeObjectId, initiativeEntries, feetPerUnit, table, pushToast, sideOf, focusActiveObject, refresh, hudImage, actorObject }: ActionEventsDeps) {
  function onAimRange(feet: number | null) {
    const object = actorObject.value;
    table()?.setRangeFrame(feet && object ? object.id : null, feet ? feet / feetPerUnit.value : null);
  }

  function onConditionResult(message: string) {
    pushToast({ tone: 'info', title: 'Состояния', detail: message });
    void refresh();
  }

  function onActed(message: string) {
    pushToast({ tone: 'info', title: 'Итог', detail: message });
    void refresh();
  }

  const initiativeMedals = computed<InitiativeMedal[]>(() => initiativeEntries.value.map(entry => {
    const placement = entry.character_id ? objects.value.find(object => object.character_id === entry.character_id) : undefined;
    return {
      id: entry.id,
      characterId: entry.character_id,
      name: entry.name,
      score: entry.score,
      isCurrent: entry.is_current,
      imageUrl: hudImage(placement ? objectImageId(placement) : null),
      imageCrop: placement?.image_asset_id ? placement.image_crop : null,
      crest: classCrest(placement?.classId),
      side: placement ? sideOf(placement) : 'neutral',
      legendary: (entry.legendary_actions ?? 0) > 0 ? { max: entry.legendary_actions!, used: entry.legendary_used ?? 0 } : null,
      dead: Boolean(placement && (placement.conditions ?? []).includes('dead')),
    };
  }));

  function selectPlacement(placementId: string) {
    activeObjectId.value = placementId;
    focusActiveObject();
  }

  function focusCharacter(characterId: string) {
    const placement = objects.value.find(object => object.character_id === characterId);
    if (placement) selectPlacement(placement.id);
  }

  return { onAimRange, onConditionResult, onActed, initiativeMedals, selectPlacement, focusCharacter };
}
