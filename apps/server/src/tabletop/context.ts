import type { FastifyInstance } from 'fastify';

import type { Database } from '../db.ts';
import type { SceneFeatureContext } from './scene-feature.ts';
import type { createConditionEngine } from '../rules/condition-engine.ts';
import type { createExperience } from '../characters/experience.ts';
import type { createActionEconomy } from '../rules/action-economy.ts';
import type { createTriggerEngine } from './scene/scene-triggers.ts';
import type { registerClassFeatureRoutes } from '../rules/class-features.ts';
import type { Options, Subscription } from './shared.ts';
import type { CounterWindow } from './spells/counterspell.ts';

export type TableContext = {
  app: FastifyInstance;
  db: Database;
  auth: Options['auth'];
  membership: Options['membership'];
  presence: Options['presence'];
  subscriptions: Set<Subscription>;
  counterWindows: Map<string, CounterWindow>;
  reactionWindowMs: number;
  feature: SceneFeatureContext;
  conditionEngine: ReturnType<typeof createConditionEngine>;
  experience: ReturnType<typeof createExperience>;
  actionEconomy: ReturnType<typeof createActionEconomy>;
  triggers: ReturnType<typeof createTriggerEngine>;
  featureApi: ReturnType<typeof registerClassFeatureRoutes>;
};

export function withTable<A extends unknown[], R>(ctx: TableContext, fn: (ctx: TableContext, ...args: A) => R): (...args: A) => R {
  return (...args) => fn(ctx, ...args);
}
