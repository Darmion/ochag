import { reactive, computed, type Ref, type ComputedRef } from 'vue';
import { objectImageId, classCrest } from '../../art/portraitArt';
import { conditionInfo } from '../../rules/conditions';
import type { PortraitEntry } from '../../components/game/GamePortraits.vue';
import type { SceneObjectDTO, TabletopProps, Character } from './types';
import type { ObjectSide } from '../scene';

export type HudPortraitsDeps = {
  props: TabletopProps;
  gameUi: ComputedRef<boolean>;
  characters: Ref<Character[]>;
  objects: Ref<SceneObjectDTO[]>;
  activeObjectId: Ref<string>;
  loadImageUrl: (assetId: string) => Promise<string>;
  allyOfViewer: (object: SceneObjectDTO) => boolean;
  sideOf: (object: SceneObjectDTO) => ObjectSide;
  currentTurnCharacterId: ComputedRef<string>;
};

export function useHudPortraits({ props, gameUi, characters, objects, activeObjectId, loadImageUrl, allyOfViewer, sideOf, currentTurnCharacterId }: HudPortraitsDeps) {
  const hudImages = reactive<Record<string, string>>({});

  function hudImage(assetId: string | null | undefined): string | null {
    if (!assetId) return null;
    if (!(assetId in hudImages)) {
      hudImages[assetId] = '';
      void loadImageUrl(assetId).then(url => { hudImages[assetId] = url; }).catch(() => {});
    }
    return hudImages[assetId] || null;
  }

  const factionPortraits = computed(() => Object.fromEntries(
    characters.value.filter(entry => entry.kind !== 'object').map(entry => [entry.id, hudImage(objectImageId(entry))]),
  ));

  const partyPortraits = computed<PortraitEntry[]>(() => {
    if (!gameUi.value) return [];
    const mine = (object: SceneObjectDTO) => object.owner_user_id === props.currentUserId;
    return objects.value
      .filter(allyOfViewer)
      .sort((a, b) => Number(mine(b)) - Number(mine(a)) || a.name.localeCompare(b.name, 'ru'))
      .map(object => ({
        id: object.id,
        characterId: object.character_id,
        name: object.name,
        imageUrl: hudImage(objectImageId(object)),
        imageCrop: object.image_asset_id ? object.image_crop : null,
        crest: classCrest(object.classId),
        side: sideOf(object),
        hp: object.hp,
        isCurrent: object.character_id === currentTurnCharacterId.value,
        isSelected: object.id === activeObjectId.value,
        conditions: (object.conditions ?? []).map(code => conditionInfo(code)),
        inspired: object.inspired === true,
      }));
  });

  return { hudImage, factionPortraits, partyPortraits };
}
