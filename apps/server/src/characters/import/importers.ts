import type { MappingRow, Proposal } from '../../../../../packages/importer/proposal.ts';

export type SheetImport = { proposal: Proposal; mapping: MappingRow[]; warnings: string[] };

export type SheetImporter = {
  id: string;
  name: string;
  description: string;
  extensions: string[];
  translations: Record<string, { name?: string; description?: string }>;
  parse: (original: Record<string, unknown>) => SheetImport;
};

export const IMPORTERS = new Map<string, SheetImporter>();

export const importerList = () => [...IMPORTERS.values()].map(({ id, name, description, extensions, translations }) => ({ id, name, description, extensions, translations }));
