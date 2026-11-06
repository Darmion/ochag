import { computed, watch, type Ref } from 'vue';
import { applySuggestion, type SpellTemplate, type Suggestion } from '../../../../packages/domain/spells/spell-template';
import { highlightPhrases } from './overview';
import type { SuggestionState } from './types';

type SuggestionsInput = {
  props: { campaignId: string; request: (path: string, method?: string, body?: unknown, file?: File) => Promise<any> };
  template: Ref<SpellTemplate>;
  suggestions: Ref<SuggestionState[]>;
  step: Ref<1 | 2 | 3>;
  busy: Ref<boolean>;
  error: Ref<string>;
  info: Ref<string>;
  infoKind: Ref<'' | 'suggest'>;
  suggestionsOpen: Ref<boolean>;
  rulesOpen: Ref<boolean>;
  focusField: (path: string) => Promise<void>;
};

export function useSuggestions({ props, template, suggestions, step, busy, error, info, infoKind, suggestionsOpen, rulesOpen, focusField }: SuggestionsInput) {
  const pending = computed(() => suggestions.value.filter(entry => entry.status === 'suggested'));
  watch(() => pending.value.length, (left, before) => {
    if (!left && before && infoKind.value === 'suggest') info.value = '';
  });
  const showInfo = computed(() => Boolean(info.value) && !(infoKind.value === 'suggest' && step.value === 2 && pending.value.length));

  async function suggest() {
    busy.value = true;
    error.value = '';
    try {
      const result = await props.request(`/campaigns/${props.campaignId}/spell-templates/suggest`, 'POST', {
        description: template.value.passport.description, higherLevel: template.value.passport.higherLevel, level: template.value.passport.level,
      });
      const kept = suggestions.value.filter(entry => entry.status !== 'suggested');
      const fresh = (result.suggestions as Suggestion[]).filter(entry => !kept.some(old => old.path === entry.path && old.path !== 'actions[+]' && old.path !== 'scaling[+]'));
      suggestions.value = [...kept, ...fresh.map(entry => ({ ...entry, status: 'suggested' as const }))];
      info.value = fresh.length ? `Подсказок: ${fresh.length}. Они ещё не приняты — посмотрите их в «Таблице».` : 'Ничего нового описание не подсказало.';
      infoKind.value = fresh.length ? 'suggest' : '';
      if (fresh.length) {
        step.value = 2;
        suggestionsOpen.value = true;
      }
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Не удалось разобрать описание. Попробуйте ещё раз.';
    } finally {
      busy.value = false;
    }
  }
  function accept(entry: SuggestionState, mode: 'accepted' | 'manual' = 'accepted') {
    template.value = applySuggestion(template.value, entry);
    entry.status = mode;
    if (mode === 'manual') {
      suggestionsOpen.value = false;
      void focusField(entry.path);
    }
  }
  function acceptAll() {
    for (const entry of pending.value) accept(entry);
  }
  async function insertExample(text: string, higher: string) {
    const passport = template.value.passport;
    passport.description = passport.description.trim() ? `${passport.description.trim()} ${text}` : text;
    if (higher) passport.higherLevel = passport.higherLevel.trim() ? `${passport.higherLevel.trim()} ${higher}` : higher;
    rulesOpen.value = false;
    await suggest();
  }

  const highlighted = computed(() => highlightPhrases(template.value.passport.description, suggestions.value));

  return { pending, showInfo, highlighted, suggest, accept, acceptAll, insertExample };
}
