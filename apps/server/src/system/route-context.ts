import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { Database, Queryable } from '../db.ts';
import type { CampaignEvents } from './campaign-events.ts';

export type RouteOptions = {
  db: Database;
  auth: (request: FastifyRequest) => Promise<string>;
  membership: (db: Queryable, campaignId: string, userId: string, lock?: boolean) => Promise<any>;
  requirePermission: (db: Queryable, membership: any, userId: string, permission: string) => Promise<void>;
  events?: CampaignEvents;
};

export type RouteContext = RouteOptions & { app: FastifyInstance };
