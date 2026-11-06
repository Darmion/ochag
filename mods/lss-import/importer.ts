import type { SheetImporter } from '../../apps/server/src/characters/import/importers.ts';
import { parseLss } from './lss/parse.ts';

export const lssImporter: SheetImporter = {
  id: 'lss',
  name: 'Long Story Short',
  description: 'Лист персонажа из Long Story Short (.json)',
  extensions: ['.json'],
  translations: { en: { description: 'A Long Story Short character sheet (.json)' } },
  parse: parseLss,
};
