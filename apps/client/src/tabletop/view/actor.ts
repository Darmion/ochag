import { ref, watch, computed, type Ref, type ComputedRef } from 'vue';
import { objectImageId, classCrest } from '../../art/portraitArt';
import type { ActionActor } from '../../actionBar/types';
import type { InitiativeEntry, TabletopProps, SceneDetail, SceneObjectDTO } from './types';
import type { ObjectSide } from '../scene';

export type ActorDeps = {
  props: TabletopProps;
  sceneId: Ref<string>;
  sceneDetail: Ref<SceneDetail | null>;
  objects: Ref<SceneObjectDTO[]>;
  activeObjectId: Ref<string>;
  initiativeEntries: Ref<InitiativeEntry[]>;
  activeObject: ComputedRef<SceneObjectDTO | undefined>;
  sideOf: (object: SceneObjectDTO) => ObjectSide;
  hudImage: (assetId: string | null | undefined) => string | null;
  gmFree: ComputedRef<boolean>;
};

export function useActor({ props, sceneId, sceneDetail, objects, activeObjectId, initiativeEntries, activeObject, sideOf, hudImage, gmFree }: ActorDeps) {
  const actorCleared = ref(false);
  watch(activeObjectId, id => { if (id) actorCleared.value = false; });
  function deselectActor() {
    activeObjectId.value = '';
    actorCleared.value = true;
  }

  const actorObject = computed(() =>
    activeObject.value ??
    (actorCleared.value ? null : objects.value.find(object => object.kind === 'character' && object.owner_user_id === props.currentUserId)) ??
    null);

  const actionActor = computed<ActionActor | null>(() => {
    const object = actorObject.value;
    if (!object) return null;
    return {
      characterId: object.character_id,
      name: object.name,
      imageUrl: hudImage(objectImageId(object)),
      imageCrop: object.image_asset_id ? object.image_crop : null,
      crest: classCrest(object.classId),
      side: sideOf(object),
      kind: object.kind,
      hp: object.hp,
      canAct: object.canEdit,
      conditions: object.conditions ?? [],
      inspired: object.inspired === true,
    };
  });

  const actorEntry = computed<InitiativeEntry | null>(() =>
    initiativeEntries.value.find(entry => entry.character_id === actorObject.value?.character_id) ?? null);
  const currentEntry = computed<InitiativeEntry | null>(() => initiativeEntries.value.find(entry => entry.is_current) ?? null);
  const actorEconomy = computed(() => {
    const entry = actorEntry.value;
    if (!entry || entry.action_used === undefined) return null;
    return {
      entryId: entry.id,
      action: !entry.action_used,
      bonus: !entry.bonus_used,
      reaction: !entry.reaction_used,
      attacksMade: entry.attacks_made ?? 0,
      perAction: entry.attacks_per_action ?? 1,
      disengaged: entry.disengaged === true,
      hasteUsed: entry.haste_used === true,
    };
  });
  const actorDeathSaveNote = computed(() => {
    const entry = actorEntry.value;
    if (!entry || (sceneDetail.value?.canManage && gmFree.value)) return null;
    if (!entry.is_current) return 'В бою спасбросок от смерти — в начале своего хода, его бросает приложение само';
    if (entry.death_saved) return 'Спасбросок от смерти уже брошен в начале этого хода';
    return null;
  });
  const canJoinCombat = computed(() => {
    const object = actorObject.value;
    return Boolean(sceneId.value && object && object.kind !== 'object' && object.canEdit && !actorEntry.value);
  });

  return { deselectActor, actorObject, actionActor, actorEntry, currentEntry, actorEconomy, actorDeathSaveNote, canJoinCombat };
}
