import type { FastifyPluginAsync } from 'fastify';

import type { RouteOptions } from '../system/route-context.ts';
import { registerCampaignSpellRoutes } from './campaign-spells.ts';
import { registerCharacterSpellRoutes } from './character-spells.ts';
import { registerSpellRefRoutes } from './refs.ts';
import { registerSpellSlotRoutes } from './slots.ts';
import { registerSpellcastingRoutes } from './spellcasting.ts';
import { registerSrdRoutes } from './srd-routes.ts';

export const spellRoutes: FastifyPluginAsync<RouteOptions> = async (app, options) => {
  const ctx = { ...options, app };
  registerSrdRoutes(ctx);
  registerCampaignSpellRoutes(ctx);
  registerSpellSlotRoutes(ctx);
  registerSpellcastingRoutes(ctx);
  registerSpellRefRoutes(ctx);
  registerCharacterSpellRoutes(ctx);
};
