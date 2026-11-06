import { ref, onMounted, computed, type Ref } from 'vue';
import type { ObjectKind } from '../campaign/objects';
import { heroPortraitPaths, npcPortraitPath, artFile, libraryUrl } from '../art/portraitArt';
import type { Look, LibraryAsset } from './types';

export type ObjectLookDeps = {
  props: { campaignId: string; request: (path: string, method?: string, body?: unknown, file?: File) => Promise<any> };
  kind: Ref<ObjectKind>;
  name: Ref<string>;
};

export function useObjectLook({ props, kind, name }: ObjectLookDeps) {
  const look = ref<Look>('default');
  const imageFile = ref<File | null>(null);
  const imagePreview = ref('');
  const modelFile = ref<File | null>(null);
  const modelAssetId = ref('');
  const library = ref<LibraryAsset[]>([]);

  onMounted(async () => {
    try {
      library.value = (await props.request(`/campaigns/${props.campaignId}/assets?kind=object_model`)).assets;
    } catch {
    }
  });

  function onImageChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (imagePreview.value.startsWith('blob:')) URL.revokeObjectURL(imagePreview.value);
    imageFile.value = file;
    imagePreview.value = file ? URL.createObjectURL(file) : '';
  }

  const artPickerOpen = ref(false);
  const artBusy = ref(false);
  const artError = ref('');
  const artSuggested = computed(() => {
    if (kind.value === 'object') return [];
    if (kind.value === 'character') return heroPortraitPaths(null);
    const byName = npcPortraitPath(name.value);
    return byName ? [byName] : [];
  });

  async function onLibraryArt(path: string) {
    artBusy.value = true;
    artError.value = '';
    try {
      const file = await artFile(path);
      if (imagePreview.value.startsWith('blob:')) URL.revokeObjectURL(imagePreview.value);
      imageFile.value = file;
      imagePreview.value = libraryUrl(path);
      artPickerOpen.value = false;
    } catch (cause) {
      artError.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      artBusy.value = false;
    }
  }

  function onModelChange(event: Event) {
    const input = event.target as HTMLInputElement;
    modelFile.value = input.files?.[0] ?? null;
    if (modelFile.value) modelAssetId.value = '';
  }

  return { look, imageFile, imagePreview, modelFile, modelAssetId, library, onImageChange, artPickerOpen, artBusy, artError, artSuggested, onLibraryArt, onModelChange };
}
