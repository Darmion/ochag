import { type ValidatedProposal, fieldDefinitions } from './fields.ts';
import { object } from './internal.ts';

export function validateProposal(
  input: unknown,
): asserts input is ValidatedProposal {
  const value = object(input);
  const allowed = new Set<string>([
    ...fieldDefinitions.map(field => field.key),
    'sheet_extra',
  ]);

  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`Неизвестное поле: ${key}`);
    }
  }

  if (
    typeof value.name !== 'string' ||
    value.name.trim().length === 0 ||
    value.name.trim().length > 200
  ) {
    throw new Error('Имя должно содержать от 1 до 200 символов.');
  }

  for (const field of fieldDefinitions) {
    if (field.type !== 'number') continue;

    const number = value[field.key];

    if (typeof number !== 'number' || !Number.isFinite(number)) {
      throw new Error(`Заполните числовое поле «${field.label}».`);
    }

    if (field.key !== 'speed_feet' && !Number.isSafeInteger(number)) {
      throw new Error(`Поле «${field.label}» должно быть целым числом.`);
    }

    if (field.key !== 'armor_class' && number < 0) {
      throw new Error(`Поле «${field.label}» не может быть отрицательным.`);
    }

    if (
      field.key !== 'speed_feet' &&
      (number < -2147483648 || number > 2147483647)
    ) {
      throw new Error(`Значение «${field.label}» слишком велико.`);
    }
  }

  if (
    value.sheet_extra === null ||
    typeof value.sheet_extra !== 'object' ||
    Array.isArray(value.sheet_extra)
  ) {
    throw new Error('Дополнительные данные должны быть JSON-объектом.');
  }
}
