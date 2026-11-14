import { ref } from 'vue';
import type { ModForm } from '../../campaign/modForms';

export type ModFormsDeps = {
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
  campaignId: () => string;
};

export function useModForms({ request, campaignId }: ModFormsDeps) {
  const modForms = ref<ModForm[]>([]);
  const openModForm = ref<ModForm | null>(null);

  async function loadModForms() {
    try {
      const data = await request(`/campaigns/${campaignId()}/mod-forms`);
      modForms.value = Array.isArray(data?.forms) ? data.forms : [];
    } catch {
      modForms.value = [];
    }
  }

  return { modForms, openModForm, loadModForms };
}
