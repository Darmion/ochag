import { computed, onBeforeUnmount, onMounted, reactive, ref, type Ref } from 'vue';
import type { ImageCrop } from '../art/imageCrop';
import { artHas } from '../art/artSource';
import { artFile, artImageUrl, heroPortraitPaths, isArtImageId, npcPortraitPath, objectImageId, raceIdOf } from '../art/portraitArt';
import { openArtChoices, openArtFor } from '../art/openPairs';
import type { CharacterDTO, SheetRequest } from './types';

export type AppearanceDeps = {
  props: { campaignId: string; characterId: string; request: SheetRequest };
  character: Ref<CharacterDTO | null>;
  error: Ref<string>;
  syncEditFields: (data: CharacterDTO) => void;
};

export function useAppearance({ props, character, error, syncEditFields }: AppearanceDeps) {
  const imagePreview = ref('');
  const openPreview = ref('');
  const lastLibraryPath = ref<string | null>(null);
  const previewFromLibrary = ref(false);
  const modelLibrary = ref<Array<{ id: string; original_filename: string | null }>>([]);
  const busy = ref(false);

  async function loadOpenPreview(data: CharacterDTO) {
    if (openPreview.value) URL.revokeObjectURL(openPreview.value);
    openPreview.value = '';
    if (!data.image_open_asset_id) return;
    try {
      const blob: Blob = await props.request(`/campaigns/${props.campaignId}/assets/${data.image_open_asset_id}`);
      openPreview.value = URL.createObjectURL(blob);
    } catch {
    }
  }

  async function loadAppearancePreview(data: CharacterDTO) {
    void loadOpenPreview(data);
    if (imagePreview.value && !previewFromLibrary.value) URL.revokeObjectURL(imagePreview.value);
    imagePreview.value = '';
    previewFromLibrary.value = false;
    if (!data.image_asset_id) {
      const fallback = objectImageId(data);
      const url = fallback && isArtImageId(fallback) ? artImageUrl(fallback) : null;
      if (url) {
        imagePreview.value = url;
        previewFromLibrary.value = true;
      }
      return;
    }

    try {
      const blob: Blob = await props.request(`/campaigns/${props.campaignId}/assets/${data.image_asset_id}`);
      imagePreview.value = URL.createObjectURL(blob);
    } catch {
    }
  }

  async function loadModelLibrary() {
    try {
      modelLibrary.value = (await props.request(`/campaigns/${props.campaignId}/assets?kind=object_model`)).assets;
    } catch {
      modelLibrary.value = [];
    }
  }

  onBeforeUnmount(() => {
    if (imagePreview.value && !previewFromLibrary.value) URL.revokeObjectURL(imagePreview.value);
    if (openPreview.value) URL.revokeObjectURL(openPreview.value);
  });

  const artPickerOpen = ref(false);
  const artPickerSuggested = computed(() => {
    const data = character.value;
    if (!data || data.kind === 'object') return [];
    if (data.kind === 'character') {
      const builder = data.sheet_extra?.builder;
      const info = data.sheet_extra?.info;
      return heroPortraitPaths(builder?.race ?? raceIdOf(builder?.raceName ?? (typeof info?.race === 'string' ? info.race : null)));
    }
    const byName = npcPortraitPath(data.name);
    return [...(byName ? [byName] : []), 'portraits/npc/townsperson-male', 'portraits/npc/townsperson-female',
      'portraits/npc/merchant-male', 'portraits/npc/merchant-female', 'portraits/npc/guard-male', 'portraits/npc/guard-female']
      .filter((path, index, list) => list.indexOf(path) === index && artHas(path));
  });
  const openArtPicker = () => { artPickerOpen.value = true; };
  const closeArtPicker = () => { artPickerOpen.value = false; };
  const openArtPickerShown = ref(false);
  const openArtSuggested = computed(() => openArtChoices(lastLibraryPath.value));

  const uploadArt = async (path: string) => (await props.request(`/campaigns/${props.campaignId}/assets?kind=object_image`, 'POST', undefined, await artFile(path))).id as string;

  function onLibraryArtPicked(path: string) {
    artPickerOpen.value = false;
    return runAppearance(async () => {
      const imageAssetId = await uploadArt(path);
      const pair = character.value?.kind === 'object' && !character.value.image_open_asset_id ? openArtFor(path) : null;
      lastLibraryPath.value = path;
      await patchAppearance({ imageAssetId, ...(pair ? { imageOpenAssetId: await uploadArt(pair) } : {}) });
    });
  }

  function onOpenArtPicked(path: string) {
    openArtPickerShown.value = false;
    return runAppearance(async () => patchAppearance({ imageOpenAssetId: await uploadArt(path) }));
  }

  function onOpenImageChosen(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    return runAppearance(async () => {
      const uploaded = await props.request(`/campaigns/${props.campaignId}/assets?kind=object_image`, 'POST', undefined, file);
      await patchAppearance({ imageOpenAssetId: uploaded.id });
    });
  }

  function clearOpenImage() {
    return runAppearance(() => patchAppearance({ imageOpenAssetId: null }));
  }

  async function patchAppearance(fields: { imageAssetId?: string | null; imageOpenAssetId?: string | null; imageCrop?: ImageCrop | null; modelAssetId?: string | null }) {
    if (!character.value) return;

    const updated = await props.request(
      `/campaigns/${props.campaignId}/characters/${props.characterId}`,
      'PATCH',
      { revision: character.value.revision, ...fields },
    );

    character.value = updated;
    syncEditFields(updated);
    if ('imageOpenAssetId' in fields) void loadOpenPreview(updated);
  }

  async function runAppearance(action: () => Promise<void>) {
    busy.value = true;
    error.value = '';

    try {
      await action();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Не удалось изменить внешний вид. Попробуйте ещё раз.';
    } finally {
      busy.value = false;
    }
  }

  function onImageChosen(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    return runAppearance(async () => {
      const uploaded = await props.request(`/campaigns/${props.campaignId}/assets?kind=object_image`, 'POST', undefined, file);
      await patchAppearance({ imageAssetId: uploaded.id });
      openPortraitCrop(URL.createObjectURL(file), true);
    });
  }

  const portraitCrop = ref<{ src: string; revoke: boolean } | null>(null);
  function openPortraitCrop(src?: string, revoke = false) {
    const url = src ?? (previewFromLibrary.value ? '' : imagePreview.value);
    if (!url) return;
    closePortraitCrop();
    portraitCrop.value = { src: url, revoke };
  }
  function closePortraitCrop() {
    if (portraitCrop.value?.revoke) URL.revokeObjectURL(portraitCrop.value.src);
    portraitCrop.value = null;
  }
  function savePortraitCrop(crop: ImageCrop | null) {
    return runAppearance(async () => {
      await patchAppearance({ imageCrop: crop });
      closePortraitCrop();
    });
  }
  onBeforeUnmount(closePortraitCrop);

  function onModelChosen(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    return runAppearance(async () => {
      const uploaded = await props.request(`/campaigns/${props.campaignId}/assets?kind=object_model`, 'POST', undefined, file);
      await loadModelLibrary();
      await patchAppearance({ modelAssetId: uploaded.id });
    });
  }

  function setModel(assetId: string) {
    return runAppearance(() => patchAppearance({ modelAssetId: assetId || null }));
  }

  function clearImage() {
    return runAppearance(() => patchAppearance({ imageAssetId: null }));
  }

  onMounted(loadModelLibrary);

  return reactive({
    imagePreview, openPreview, previewFromLibrary, modelLibrary, busy, artPickerOpen, artPickerSuggested, portraitCrop,
    openArtPickerShown, openArtSuggested,
    loadAppearancePreview, openArtPicker, closeArtPicker, onLibraryArtPicked, onImageChosen, openPortraitCrop,
    closePortraitCrop, savePortraitCrop, onModelChosen, setModel, clearImage, onOpenArtPicked, onOpenImageChosen, clearOpenImage,
  });
}

export type Appearance = ReturnType<typeof useAppearance>;
