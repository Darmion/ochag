export const fieldDefinitions = [
  { key: 'name', label: 'Имя', type: 'text' },
  { key: 'strength', label: 'Сила', type: 'number' },
  { key: 'dexterity', label: 'Ловкость', type: 'number' },
  { key: 'constitution', label: 'Телосложение', type: 'number' },
  { key: 'intelligence', label: 'Интеллект', type: 'number' },
  { key: 'wisdom', label: 'Мудрость', type: 'number' },
  { key: 'charisma', label: 'Харизма', type: 'number' },
  { key: 'hp_current', label: 'Текущие хиты', type: 'number' },
  { key: 'hp_max', label: 'Максимальные хиты', type: 'number' },
  { key: 'hp_temp', label: 'Временные хиты', type: 'number' },
  { key: 'armor_class', label: 'Класс доспеха', type: 'number' },
  { key: 'speed_feet', label: 'Скорость, футы', type: 'number' },
] as const;

export type FieldKey = typeof fieldDefinitions[number]['key'];

export type Proposal = Record<FieldKey, string | number | null> & {
  sheet_extra: Record<string, unknown>;
};

type NumericFieldKey = Exclude<FieldKey, 'name'>;

export type ValidatedProposal = {
  name: string;
} & Record<NumericFieldKey, number> & {
  sheet_extra: Record<string, unknown>;
};

export type MappingRow = {
  key: FieldKey;
  label: string;
  sourcePath: string;
  sourceValue: unknown;
};
