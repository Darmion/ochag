import type { FastifyPluginAsync } from 'fastify';
import { importHelpers, type Options } from './import/shared.ts';
import { importerList } from './import/importers.ts';
import { registerCreateDraftRoute } from './import/create-draft.ts';
import { registerUpdateDraftRoute } from './import/update-draft.ts';
import { registerConfirmDraftRoute } from './import/confirm-draft.ts';
import { registerDeleteDraftRoute } from './import/delete-draft.ts';
import { registerCharacterListRoute } from './roster-route.ts';

export const characterImportRoutes: FastifyPluginAsync<Options> =
async (app, options) => {
  app.get('/importers', async request => {
    await options.auth(request);
    return { importers: importerList() };
  });

  const helpers = importHelpers(options);
  registerCreateDraftRoute(app, options, helpers);
  registerUpdateDraftRoute(app, options, helpers);
  registerConfirmDraftRoute(app, options, helpers);
  registerDeleteDraftRoute(app, options);
  registerCharacterListRoute(app, options);
};
