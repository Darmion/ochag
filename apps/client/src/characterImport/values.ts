import type { Draft } from './types.ts';

export function parseFieldValue(key: string, text: string): string | number | null {
  return key === 'name'
    ? text
    : text === '' ? null : Number(text);
}

export function display(value: unknown): string {
  if (value === null || value === undefined) return 'Не указано';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export function differs(
  draft: Draft,
  proposal: Record<string, any>,
  keepCurrent: Record<string, boolean>,
  key: string,
): boolean {
  if (!draft.current) return false;

  const finalValue = keepCurrent[key]
    ? draft.current[key]
    : proposal[key];

  return finalValue !== draft.current[key];
}

export function buildProposal(
  draft: Draft,
  proposal: Record<string, any>,
  keepCurrent: Record<string, boolean>,
  keepCurrentExtras: boolean,
  extras: unknown,
): Record<string, any> {
  const finalProposal = JSON.parse(
    JSON.stringify(proposal),
  ) as Record<string, any>;

  for (const row of draft.field_mapping) {
    if (keepCurrent[row.key] && draft.current) {
      finalProposal[row.key] = draft.current[row.key];
    }
  }

  finalProposal.sheet_extra =
    keepCurrentExtras && draft.current
      ? draft.current.sheet_extra
      : extras;

  return finalProposal;
}
