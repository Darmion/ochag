export type MappingRow = {
  key: string;
  label: string;
  sourcePath: string;
  sourceValue: unknown;
};

export type SheetImporterInfo = {
  id: string;
  name: string;
  description: string;
  extensions: string[];
  translations?: Record<string, { name?: string; description?: string }>;
};

export type Draft = {
  id: string;
  draft_revision: number;
  proposed_document: Record<string, any>;
  field_mapping: MappingRow[];
  warnings: string[];
  current: Record<string, any> | null;
};
