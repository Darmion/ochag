import { computed, reactive, ref, watch, type ComputedRef, type Ref } from 'vue';

import { artPrefs } from '../art/artPersonalization';
import { campaignArt } from '../art/campaignArt';
import { matchesWords, queryWords, searchLibrary, type LibraryGroup } from './catalog';

export type OwnPicture = { id: string; label: string; url: string; value: string };

export function usePictureLibrary({ library, forAll, notice }: {
  library: Ref<LibraryGroup[]>;
  forAll: ComputedRef<boolean>;
  notice: Ref<string>;
}) {
  const pictureQuery = ref('');
  const pictureSection = ref('');
  const sections = computed(() => [...new Set(library.value.map(group => group.section))]);
  const pictureWords = computed(() => queryWords(pictureQuery.value));
  const ownSection = computed(() => (forAll.value ? 'campaign' : 'mine'));
  const searchedEverywhere = computed(() => Boolean(pictureWords.value.length && pictureSection.value && pictureSection.value !== ownSection.value
    && !searchLibrary(library.value, pictureSection.value, pictureWords.value).length));
  const pictureGroups = computed(() => (pictureSection.value === ownSection.value ? [] : searchLibrary(library.value, searchedEverywhere.value ? '' : pictureSection.value, pictureWords.value)));
  const ownPictures = computed<OwnPicture[]>(() => (forAll.value
    ? campaignArt.sprites.filter(sprite => sprite.url).map(sprite => ({ id: sprite.id, label: sprite.label, url: sprite.url!, value: `asset:${sprite.id}` }))
    : artPrefs.uploads.map(upload => ({ id: upload.id, label: upload.label, url: upload.data, value: `upload:${upload.id}` })))
    .filter(picture => matchesWords(picture.label, pictureWords.value)));
  const ownTotal = computed(() => (forAll.value ? campaignArt.sprites.length : artPrefs.uploads.length));
  const ownLabel = computed(() => (forAll.value ? 'Спрайты кампании' : 'Мои картинки'));
  const showOwn = computed(() => (pictureSection.value === '' || pictureSection.value === ownSection.value || searchedEverywhere.value) && ownPictures.value.length > 0);
  const pictureCount = computed(() => pictureGroups.value.reduce((sum, group) => sum + group.items.length, 0) + (showOwn.value ? ownPictures.value.length : 0));
  const sectionLabel = (section: string) => library.value.find(group => group.id === section)?.label ?? section;
  watch(forAll, () => {
    if (pictureSection.value === 'mine' || pictureSection.value === 'campaign') pictureSection.value = ownSection.value;
    notice.value = '';
  });

  // Mutable on purpose; field names are kept because en.json placeholders are named after template expressions.
  return reactive({
    pictureQuery, pictureSection, sections, ownSection, searchedEverywhere, pictureGroups,
    ownPictures, ownTotal, ownLabel, showOwn, pictureCount, sectionLabel,
  });
}

export type PictureLibrary = ReturnType<typeof usePictureLibrary>;
