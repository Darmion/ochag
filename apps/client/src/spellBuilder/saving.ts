import type { Ref } from 'vue';
import { normalizeTemplate, type SpellTemplate } from '../../../../packages/domain/spells/spell-template';
import type { SrdView, SuggestionState, View } from './types';

type SavingInput = {
  props: { campaignId: string; request: (path: string, method?: string, body?: unknown, file?: File) => Promise<any>; spellId?: string | null; srdIndex?: string | null };
  template: Ref<SpellTemplate>;
  suggestions: Ref<SuggestionState[]>;
  view: Ref<View | null>;
  srdView: Ref<SrdView | null>;
  loaded: Ref<string>;
  note: Ref<string>;
  dirty: Readonly<Ref<boolean>>;
  busy: Ref<boolean>;
  error: Ref<string>;
  info: Ref<string>;
  infoKind: Ref<'' | 'suggest'>;
  onSaved: (spellId: string) => void;
};

export function useSpellSaving({ props, template, suggestions, view, srdView, loaded, note, dirty, busy, error, info, infoKind, onSaved }: SavingInput) {
  const suggestionsBody = () => ({ items: suggestions.value });
  async function save(submit: boolean) {
    busy.value = true;
    error.value = '';
    info.value = '';
    infoKind.value = '';
    try {
      const body = { template: template.value, suggestions: suggestionsBody(), submit };
      const result: View = props.spellId || view.value
        ? await props.request(`/campaigns/${props.campaignId}/spell-templates/${view.value!.spell.id}`, 'PUT', body)
        : await props.request(`/campaigns/${props.campaignId}/spell-templates`, 'POST', body);
      view.value = result;
      loaded.value = JSON.stringify(template.value);
      info.value = submit
        ? result.spell.status === 'approved' && !result.proposal ? 'Готово: заклинание доступно в кампании.' : 'Отправлено мастеру на рассмотрение.'
        : 'Черновик сохранён.';
      onSaved(result.spell.id);
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Не удалось сохранить. Попробуйте ещё раз.';
    } finally {
      busy.value = false;
    }
  }
  async function decide(decision: 'approve' | 'rework' | 'reject') {
    if (!view.value) return;
    busy.value = true;
    error.value = '';
    try {
      view.value = await props.request(`/campaigns/${props.campaignId}/spell-templates/${view.value.spell.id}/review`, 'POST', {
        decision, ...(note.value.trim() ? { note: note.value.trim() } : {}), ...(decision === 'approve' && dirty.value ? { template: template.value } : {}),
      });
      info.value = decision === 'approve' ? (dirty.value ? 'Принято с вашими правками.' : 'Принято.') : decision === 'rework' ? 'Возвращено на доработку.' : 'Отклонено.';
      loaded.value = JSON.stringify(template.value);
      onSaved(view.value!.spell.id);
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Не удалось принять решение. Попробуйте ещё раз.';
    } finally {
      busy.value = false;
    }
  }
  async function saveSrd(reset: boolean) {
    if (!props.srdIndex) return;
    busy.value = true;
    error.value = '';
    info.value = '';
    try {
      const path = `/campaigns/${props.campaignId}/srd-templates/${props.srdIndex}`;
      const data = reset ? await props.request(path, 'DELETE') : await props.request(path, 'PUT', { template: template.value });
      srdView.value = { overridden: data.overridden, canEdit: data.canEdit, templateVersion: data.templateVersion, specialNotify: data.specialNotify };
      template.value = normalizeTemplate(data.template);
      loaded.value = JSON.stringify(template.value);
      info.value = reset ? 'Правка кампании убрана: заклинание снова работает как в SRD.' : 'Сохранено: в этой кампании заклинание работает по этой таблице.';
      onSaved(props.srdIndex);
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Не удалось сохранить. Попробуйте ещё раз.';
    } finally {
      busy.value = false;
    }
  }
  async function toggleSrdSpecial() {
    if (!props.srdIndex || !srdView.value) return;
    const next = !srdView.value.specialNotify;
    await props.request(`/campaigns/${props.campaignId}/srd-templates/${props.srdIndex}/special`, 'PATCH', { notify: next });
    srdView.value.specialNotify = next;
  }
  async function toggleSpecial() {
    if (!view.value) return;
    const next = !view.value.spell.specialNotify;
    await props.request(`/campaigns/${props.campaignId}/spell-templates/${view.value.spell.id}/special`, 'PATCH', { notify: next });
    view.value.spell.specialNotify = next;
  }

  return { save, decide, saveSrd, toggleSrdSpecial, toggleSpecial };
}
