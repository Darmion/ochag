import type { FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import type { Database, Queryable } from '../db.ts';
import type { CampaignEvents } from '../system/campaign-events.ts';
import { canManageScenes } from './scene/scene-permissions.ts';
import type { Presence } from '../system/presence.ts';
import type { LoadedMods } from '../system/mods.ts';

export type Options = {
  db: Database;

  auth: (request: FastifyRequest) => Promise<string>;

  membership: (
    db: Queryable,
    campaignId: string,
    userId: string,
    lock?: boolean,
  ) => Promise<any>;

  presence?: Presence;
  events?: CampaignEvents;
  reactionWindowMs?: number;
  mods?: LoadedMods;
};

export type CampaignParams = {
  campaignId: string;
};

export type SceneParams = CampaignParams & {
  sceneId: string;
};

export type ObjectParams = SceneParams & {
  objectId: string;
};

export const WALL_COLUMNS = 'id, x1, z1, x2, z2, style, texture_asset_id, kind, open, locked, hp, hp_max, broken';
export const WALLS_MOVE = `AND NOT broken AND (kind <> 'door' OR NOT open)`;
export const WALLS_SIGHT = `${WALLS_MOVE} AND kind <> 'window'`;

export type WallParams = SceneParams & {
  wallId: string;
};

export type InitiativeParams = SceneParams & {
  entryId: string;
};

export type RollParams = CampaignParams & {
  rollId: string;
};

export type CastSpellParams = CampaignParams & {
  characterId: string;
  characterSpellId: string;
};

export type ObjectKind = 'character' | 'npc' | 'object';

export type Placement = {
  id: string;
  character_id: string;
  parent_object_id: string | null;
  x: number;
  y: number;
  z: number;
  rotation_y: number;
  scale: number;
  snap_to_grid: boolean;
  animation_name: string | null;
  hidden: boolean;
  revision: number;
  name: string;
  kind: ObjectKind;
  disposition: 'hostile' | 'neutral' | 'friendly' | null;
  factions_explicit?: boolean;
  size: string;
  owner_user_id: string | null;
  shared: boolean;
  model_asset_id: string | null;
  image_asset_id: string | null;
  image_crop?: { x: number; y: number; zoom: number } | null;
  world_x: number;
  world_y: number;
  world_z: number;
  altitude_feet: number;
};

export type Illumination = Uint8Array & { darkness: Set<number> };

export type SaveBonus = { value: number; reason: string };

export type Rights = {
  sceneManager: boolean;
  characterManager: boolean;
  editGrants: Set<string>;
};

export type Subscription = {
  socket: WebSocket;
  hash: string;
  campaignId: string;
  sceneId: string;
  userId?: string;
};

export const uuid = { type: 'string', format: 'uuid' };

export const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function objectSchema(properties: Record<string, unknown>, required = Object.keys(properties)) {
  return {
    type: 'object',
    required,
    additionalProperties: false,
    properties,
  };
}

export const campaignParams = objectSchema({
  campaignId: uuid,
});

export const sceneParams = objectSchema({
  campaignId: uuid,
  sceneId: uuid,
});

export const objectParams = objectSchema({
  campaignId: uuid,
  sceneId: uuid,
  objectId: uuid,
});

export const wallParams = objectSchema({
  campaignId: uuid,
  sceneId: uuid,
  wallId: uuid,
});

export const initiativeParams = objectSchema({
  campaignId: uuid,
  sceneId: uuid,
  entryId: uuid,
});

export const rollParams = objectSchema({
  campaignId: uuid,
  rollId: uuid,
});

export const castSpellParams = objectSchema({
  campaignId: uuid,
  characterId: uuid,
  characterSpellId: uuid,
});

export function reject(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}
export const canManage = canManageScenes;
