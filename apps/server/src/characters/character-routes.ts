import type { FastifyPluginAsync } from 'fastify';

import type { RouteOptions } from '../system/route-context.ts';
import { registerAccessRoutes } from './sheet/access.ts';
import { registerCreateRoute } from './sheet/create.ts';
import { registerEffectRoutes } from './sheet/effects.ts';
import { registerReactionRoutes } from './sheet/reactions.ts';
import { registerReadRoute } from './sheet/read.ts';
import { registerResourceRoutes } from './sheet/resources.ts';
import { registerSaveRoutes } from './sheet/saves.ts';
import { registerSkillRoutes } from './sheet/skills.ts';
import { registerUpdateRoute } from './sheet/update.ts';
import { registerVisibilityRoutes } from './sheet/visibility.ts';
import { registerWeaponRoutes } from './sheet/weapons.ts';

export const characterRoutes: FastifyPluginAsync<RouteOptions> = async (app, options) => {
  const ctx = { ...options, app };
  registerReadRoute(ctx);
  registerCreateRoute(ctx);
  registerUpdateRoute(ctx);
  registerVisibilityRoutes(ctx);
  registerAccessRoutes(ctx);
  registerEffectRoutes(ctx);
  registerResourceRoutes(ctx);
  registerWeaponRoutes(ctx);
  registerSkillRoutes(ctx);
  registerSaveRoutes(ctx);
  registerReactionRoutes(ctx);
};
