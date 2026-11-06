import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { Database, Queryable } from '../db.ts';

export type SceneFeatureContext = {
  app: FastifyInstance;
  db: Database;
  auth: (request: FastifyRequest) => Promise<string>;
  membership: (q: Queryable, campaignId: string, userId: string, lock?: boolean) => Promise<any>;
  canManage: (q: Queryable, member: any, userId: string) => Promise<boolean>;
  getScene: (q: Queryable, campaignId: string, sceneId: string, lock?: boolean) => Promise<any>;
  notify: (campaignId: string, sceneId: string) => Promise<void>;
  notifyCampaign: (campaignId: string, message: Record<string, unknown>) => Promise<void>;
  notifyUsers?: (campaignId: string, userIds: Iterable<string>, message: Record<string, unknown>) => Promise<void>;
};

export const uuid = { type: 'string', format: 'uuid' };

export function objectSchema(properties: Record<string, unknown>, required = Object.keys(properties)) {
  return {
    type: 'object',
    required,
    additionalProperties: false,
    properties,
  };
}

export const sceneParams = objectSchema({ campaignId: uuid, sceneId: uuid });

export function reject(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}

export async function bumpScene(q: Queryable, sceneId: string) {
  await q.query('UPDATE scenes SET revision=revision+1 WHERE id=$1', [sceneId]);
}
