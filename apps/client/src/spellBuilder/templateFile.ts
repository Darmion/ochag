import type { Ref } from 'vue';
import type { SpellTemplate } from '../../../../packages/domain/spells/spell-template';
import { isOwnSpellArt } from '../art/spellArt';
import type { View } from './types';

type TemplateFileInput = {
  props: { campaignId: string; request: (path: string, method?: string, body?: unknown, file?: File) => Promise<any> };
  template: Ref<SpellTemplate>;
  view: Ref<View | null>;
  busy: Ref<boolean>;
  error: Ref<string>;
  info: Ref<string>;
  applyCampaigns: Ref<Array<{ id: string; name: string }> | null>;
  applyChosen: Ref<string[]>;
};

export function useTemplateFile({ props, template, view, busy, error, info, applyCampaigns, applyChosen }: TemplateFileInput) {
  function asDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
  async function download() {
    const file: Record<string, unknown> = { format: 'ochag-spell-template', version: 1, template: template.value };
    if (isOwnSpellArt(template.value.passport.art)) {
      try {
        file.image = await asDataUrl(await props.request(`/campaigns/${props.campaignId}/assets/${template.value.passport.art}`));
      } catch {
      }
    }
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(template.value.passport.name || 'заклинание').replace(/[\\/:*?"<>|]+/g, '_')}.spell.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function openApply() {
    applyCampaigns.value = (await props.request(`/campaigns/${props.campaignId}/spell-templates/other-campaigns`)).campaigns;
    applyChosen.value = [];
  }
  async function applyNow() {
    if (!view.value || !applyChosen.value.length) return;
    busy.value = true;
    try {
      const result = await props.request(`/campaigns/${props.campaignId}/spell-templates/${view.value.spell.id}/apply`, 'POST', { campaignIds: applyChosen.value });
      info.value = `Применено в кампаниях: ${result.applied.length}.`;
      applyCampaigns.value = null;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Не удалось применить. Попробуйте ещё раз.';
    } finally {
      busy.value = false;
    }
  }

  return { download, openApply, applyNow };
}
