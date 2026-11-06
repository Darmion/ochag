import { IMPORTERS } from '../src/characters/import/importers.ts';
import { lssImporter } from '../../../mods/lss-import/importer.ts';

IMPORTERS.set(lssImporter.id, lssImporter);
