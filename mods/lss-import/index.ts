import type { ModApi } from '../../apps/server/src/system/mods.ts';
import { lssImporter } from './importer.ts';
import { repairLssWeapons } from './repair.ts';

export default function (api: ModApi) {
  api.importers.define(lssImporter);
  api.routes(ctx => {
    ctx.app.addHook('onReady', async () => {
      try {
        const fixed = await repairLssWeapons(ctx.db);
        if (fixed) api.log(`оружие из старых импортов исправлено: ${fixed}`);
      } catch (error) {
        api.log(`оружие из старых импортов не исправлено: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  });
}
