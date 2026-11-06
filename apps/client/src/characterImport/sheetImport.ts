import { ref, type Ref } from 'vue';
import type { Draft, SheetImporterInfo } from './types';
import { buildProposal, parseFieldValue } from './values';

export function useSheetImport({ api, run, campaignId, message }: {
  api: (path: string, method?: string, body?: unknown, file?: File) => Promise<any>;
  run: (action: () => Promise<void>) => Promise<void>;
  campaignId: Ref<string>;
  message: Ref<string>;
}) {
  const targetCharacterId = ref('');
  const draft = ref<Draft | null>(null);
  const proposal = ref<Record<string, any>>({});
  const extrasText = ref('{}');
  const keepCurrent = ref<Record<string, boolean>>({});
  const keepCurrentExtras = ref(false);
  const importers = ref<SheetImporterInfo[]>([]);

  async function loadImporters() {
    try {
      importers.value = (await api('/importers')).importers ?? [];
    } catch {
      importers.value = [];
    }
  }

  function importFile(importerId: string, file: File) {
    return run(async () => {
      if (!campaignId.value) {
        throw new Error('Сначала выберите кампанию.');
      }

      if (file.size > 1024 * 1024) {
        throw new Error('Максимальный размер файла — 1 МБ.');
      }

      let original: unknown;

      try {
        original = JSON.parse(await file.text());
      } catch {
        throw new Error('Файл содержит некорректный JSON.');
      }

      const result: Draft = await api(
        `/campaigns/${campaignId.value}/imports`,
        'POST',
        {
          importer: importerId,
          original,
          ...(targetCharacterId.value.trim()
            ? { targetCharacterId: targetCharacterId.value.trim() }
            : {}),
        },
      );

      draft.value = result;
      proposal.value = JSON.parse(
        JSON.stringify(result.proposed_document),
      );
      extrasText.value = JSON.stringify(
        result.proposed_document.sheet_extra,
        null,
        2,
      );

      keepCurrent.value = {};
      keepCurrentExtras.value = false;
    });
  }

  function editField(key: string, event: Event) {
    const input = event.target as HTMLInputElement;

    proposal.value[key] = parseFieldValue(key, input.value);
  }

  function confirmImport() {
    return run(async () => {
      if (!draft.value) return;

      let extras: unknown;

      try {
        extras = JSON.parse(extrasText.value);
      } catch {
        throw new Error('Исправьте JSON дополнительных данных.');
      }

      const finalProposal = buildProposal(draft.value, proposal.value, keepCurrent.value, keepCurrentExtras.value, extras);

      const base =
        `/campaigns/${campaignId.value}/imports/${draft.value.id}`;

      const saved = await api(base, 'PUT', {
        draftRevision: draft.value.draft_revision,
        proposal: finalProposal,
      });

      draft.value.draft_revision = saved.draftRevision;

      const result = await api(`${base}/confirm`, 'POST', {
        draftRevision: saved.draftRevision,
      });

      const importedName = typeof finalProposal.name === 'string' ? finalProposal.name : 'Персонаж';
      draft.value = null;
      message.value = `«${importedName}» импортирован — он во вкладке «Отряд».`;
      void result;
    });
  }

  function cancelImport() {
    return run(async () => {
      if (!draft.value) return;

      await api(
        `/campaigns/${campaignId.value}/imports/${draft.value.id}`,
        'DELETE',
      );

      draft.value = null;
      message.value = 'Импорт отменён. Персонаж не изменён.';
    });
  }

  return { targetCharacterId, draft, proposal, extrasText, keepCurrent, keepCurrentExtras, importers, loadImporters, importFile, editField, confirmImport, cancelImport };
}
