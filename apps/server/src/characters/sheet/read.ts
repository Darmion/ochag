import { characterForViewing } from './access.ts';
import { loadExtras } from './extras.ts';
import { characterParams, type CharacterParams } from './shared.ts';
import { applyVisibility, loadVisibilityRows, summarizeVisibility } from './visibility.ts';
import { classView, experienceView, hitDiceView } from './views.ts';
import type { RouteContext } from '../../system/route-context.ts';

export function registerReadRoute(ctx: RouteContext) {
  const { app, auth, db, membership } = ctx;

  app.get<{ Params: CharacterParams }>(
    '/campaigns/:campaignId/characters/:characterId',
    { schema: { params: characterParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;

      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const { character, privileged } = await characterForViewing(ctx, q, campaignId, characterId, userId, member);
        const extras = await loadExtras(q, campaignId, characterId);
        const { visibilityRows, grantRows } = await loadVisibilityRows(q, campaignId, characterId);

        if (privileged) {
          return {
            ...character, ...extras, hit_dice: hitDiceView(character), experience_info: experienceView(character), class_info: classView(character),
            hiddenFields: [], privileged: true,
            visibility: summarizeVisibility(visibilityRows, grantRows),
          };
        }

        return applyVisibility(character, extras, userId, visibilityRows, grantRows);
      });
    },
  );
}
