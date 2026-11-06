import { ref, computed, type Ref } from 'vue';
import { type RuleKind, KEY_PATTERN, KNOWN_FLAGS, KNOWN_CHOICES, knownChoice, isValidFormula, createRule, type CampaignRule } from '../campaign/campaignRules';

export type NewRuleFormDeps = {
  props: { campaignId: string; request: (path: string, method?: string, body?: unknown) => Promise<any>; };
  rules: Ref<CampaignRule[]>;
  refresh: () => Promise<void>;
  addForm: Ref<HTMLDetailsElement | null>;
};

export function useNewRuleForm({ props, rules, refresh, addForm }: NewRuleFormDeps) {
  const newKey = ref('');
  const newKind = ref<RuleKind>('flag');
  const newLabel = ref('');
  const newDescription = ref('');
  const newFlagValue = ref(true);
  const newNumberValue = ref(0);
  const newFormulaValue = ref('');
  const newTextValue = ref('');
  const createBusy = ref(false);
  const createError = ref('');

  function currentNewValue(): unknown {
    if (newKind.value === 'flag') return newFlagValue.value;
    if (newKind.value === 'number') return newNumberValue.value;
    if (newKind.value === 'formula') return newFormulaValue.value.trim();
    return newTextValue.value;
  }

  const keyValid = computed(() => KEY_PATTERN.test(newKey.value.trim()));
  const suggestedFlags = computed(() => KNOWN_FLAGS.filter(flag => !rules.value.some(rule => rule.key === flag.key)));

  const suggestedChoices = computed(() => KNOWN_CHOICES.filter(choice => !rules.value.some(rule => rule.key === choice.key)));
  const newChoice = computed(() => (newKind.value === 'text' ? knownChoice(newKey.value.trim()) : null));

  function useKnownChoice(choice: typeof KNOWN_CHOICES[number]) {
    newKey.value = choice.key;
    newKind.value = 'text';
    newLabel.value = choice.label;
    newDescription.value = choice.description;
    newTextValue.value = choice.options.find(option => option.value !== choice.default)?.value ?? choice.default;
  }

  function useKnownFlag(flag: typeof KNOWN_FLAGS[number]) {
    newKey.value = flag.key;
    newKind.value = 'flag';
    newLabel.value = flag.label;
    newDescription.value = flag.description;
    newFlagValue.value = !flag.enabled;
  }
  const formulaValid = computed(() => newKind.value !== 'formula' || isValidFormula(newFormulaValue.value));
  const canSubmit = computed(() => keyValid.value && newLabel.value.trim() !== '' && formulaValid.value && !createBusy.value);

  function resetForm() {
    newKey.value = '';
    newKind.value = 'flag';
    newLabel.value = '';
    newDescription.value = '';
    newFlagValue.value = true;
    newNumberValue.value = 0;
    newFormulaValue.value = '';
    newTextValue.value = '';
    createError.value = '';
  }

  async function submitNewRule() {
    if (!canSubmit.value) return;
    createBusy.value = true;
    createError.value = '';

    try {
      await createRule(props.request, props.campaignId, {
        key: newKey.value.trim(),
        kind: newKind.value,
        label: newLabel.value.trim(),
        description: newDescription.value.trim() || undefined,
        value: currentNewValue(),
      });
      resetForm();
      if (addForm.value) addForm.value.open = false;
      await refresh();
    } catch (cause) {
      createError.value = cause instanceof Error ? cause.message : 'Не удалось создать правило. Попробуйте ещё раз.';
    } finally {
      createBusy.value = false;
    }
  }

  return { newKey, newKind, newLabel, newDescription, newFlagValue, newNumberValue, newFormulaValue, newTextValue, createBusy, createError, keyValid, suggestedFlags, suggestedChoices, newChoice, useKnownChoice, useKnownFlag, formulaValid, canSubmit, submitNewRule };
}
