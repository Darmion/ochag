import { computed, type Ref } from 'vue';
import { schoolArtPath } from '../art/itemArt';
import { rememberSpellArt, spellOrSchoolArt } from '../art/spellArt';
import type { SpellTemplate } from '../../../../packages/domain/spells/spell-template';

type ArtInput = {
  props: { campaignId: string; request: (path: string, method?: string, body?: unknown, file?: File) => Promise<any> };
  template: Ref<SpellTemplate>;
  schoolKey: Readonly<Ref<string>>;
  busy: Ref<boolean>;
  error: Ref<string>;
  artMenu: Ref<'' | 'head' | 'passport'>;
  artPicker: Ref<boolean>;
  strengthOpen: Ref<boolean>;
};

export function useSpellArt({ props, template, schoolKey, busy, error, artMenu, artPicker, strengthOpen }: ArtInput) {
  const artUrl = computed(() => spellOrSchoolArt(template.value.passport.art, schoolKey.value, props.campaignId, props.request));
  const hasArt = computed(() => Boolean(template.value.passport.art));
  const artSuggested = computed(() => {
    const path = schoolArtPath(schoolKey.value);
    return path ? [path] : [];
  });
  async function uploadArt(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    artMenu.value = '';
    if (!file) return;
    busy.value = true;
    error.value = '';
    try {
      const uploaded = await props.request(`/campaigns/${props.campaignId}/assets?kind=object_image`, 'POST', undefined, file);
      rememberSpellArt(props.campaignId, uploaded.id, file);
      template.value.passport.art = uploaded.id;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Не удалось загрузить картинку. Попробуйте ещё раз.';
    } finally {
      busy.value = false;
    }
  }
  function pickLibraryArt(path: string) {
    template.value.passport.art = path;
    artPicker.value = false;
  }
  function openLibrary() {
    artMenu.value = '';
    artPicker.value = true;
  }
  function clearArt() {
    template.value.passport.art = '';
    artMenu.value = '';
  }
  function toggleArtMenu(where: 'head' | 'passport') {
    strengthOpen.value = false;
    artMenu.value = artMenu.value === where ? '' : where;
  }

  return { artUrl, hasArt, artSuggested, uploadArt, pickLibraryArt, openLibrary, clearArt, toggleArtMenu };
}
