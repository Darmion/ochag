import { computed, reactive, ref, watch, type ComputedRef, type Ref } from 'vue';
import { sheetResources, sheetTexts } from './sheetExtra';
import { factLines, storyEntries, textOf, titledCards } from './otherTexts';
import type { CharacterDTO, SheetRequest } from './types';

export type SheetFeature = { id: string; name: string; text: string; use: string; detail?: string };

export type OtherTabDeps = {
  props: { campaignId: string; characterId: string; request: SheetRequest };
  character: Ref<CharacterDTO | null>;
  tab: Readonly<Ref<string>>;
  isCreature: ComputedRef<boolean>;
  editExtraText: Ref<string>;
  error: Ref<string>;
  save: () => Promise<void>;
};

export function useOtherTab({ props, character, tab, isCreature, editExtraText, error, save }: OtherTabDeps) {
  const miscTexts = computed(() => sheetTexts(character.value?.sheet_extra?.text));
  const miscResources = computed(() => sheetResources(character.value?.sheet_extra?.resources));

  const profLines = computed(() => factLines(textOf(miscTexts.value, 'prof')));
  const featureCards = computed(() => titledCards(textOf(miscTexts.value, 'features')));
  const levelCards = computed(() => titledCards(textOf(miscTexts.value, 'levels')));
  const storyTexts = computed(() => storyEntries(miscTexts.value));
  const classFeatures = ref<SheetFeature[]>([]);
  watch(() => [tab.value, props.characterId] as const, async ([current]) => {
    if (current !== 'other' || !isCreature.value) return;
    try {
      const result = await props.request(`/campaigns/${props.campaignId}/characters/${props.characterId}/features`);
      classFeatures.value = Array.isArray(result.features) ? result.features : [];
    } catch {
      classFeatures.value = [];
    }
  });
  const textEdit = ref<{ key: 'prof' | 'features'; value: string } | null>(null);
  function startTextEdit(key: 'prof' | 'features') {
    textEdit.value = textEdit.value?.key === key ? null : { key, value: textOf(miscTexts.value, key) };
  }
  async function saveTextEdit() {
    const edit = textEdit.value;
    if (!edit) return;
    let extra: Record<string, any>;
    try {
      extra = JSON.parse(editExtraText.value || '{}');
    } catch {
      error.value = 'Дополнительные данные — некорректный JSON (вкладка «Правка листа» → «Сырые данные»).';
      return;
    }
    const text = extra.text && typeof extra.text === 'object' ? { ...extra.text } : {};
    if (edit.value.trim()) text[edit.key] = { name: edit.key === 'prof' ? 'Владения и языки' : 'Умения и особенности', value: edit.value.trim() };
    else delete text[edit.key];
    editExtraText.value = JSON.stringify({ ...extra, text }, null, 2);
    textEdit.value = null;
    await save();
  }

  return reactive({ miscResources, profLines, featureCards, levelCards, storyTexts, classFeatures, textEdit, startTextEdit, saveTextEdit });
}

export type OtherTab = ReturnType<typeof useOtherTab>;
