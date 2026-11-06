import type { FastifyRequest } from 'fastify';
import type { Database, Queryable } from '../../db.ts';
import { accessGrantLevel } from '../sheet/access.ts';
import type { ValidatedProposal } from '../../../../../packages/importer/proposal.ts';

export type Options = {
  db: Database;
  auth: (request: FastifyRequest) => Promise<string>;
  membership: (
    db: Queryable,
    campaignId: string,
    userId: string,
    lock?: boolean,
  ) => Promise<any>;
  requirePermission: (
    db: Queryable,
    membership: any,
    userId: string,
    permission: string,
  ) => Promise<void>;
};

export function reject(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}

export const uuid = { type: 'string', format: 'uuid' };

export const paramsSchema = {
  type: 'object',
  required: ['campaignId'],
  additionalProperties: false,
  properties: { campaignId: uuid },
};

export const draftParamsSchema = {
  type: 'object',
  required: ['campaignId', 'draftId'],
  additionalProperties: false,
  properties: {
    campaignId: uuid,
    draftId: uuid,
  },
};

export type CampaignParams = {
  campaignId: string;
};

export type DraftParams = CampaignParams & {
  draftId: string;
};

export function importHelpers({ requirePermission }: Options) {
  async function characterForEditing(
    q: Queryable,
    campaignId: string,
    characterId: string,
    userId: string,
    member: any,
    lock = false,
  ) {
    const { rows } = await q.query(
      `SELECT * FROM characters
       WHERE campaign_id = $1 AND id = $2
       ${lock ? 'FOR UPDATE' : ''}`,
      [campaignId, characterId],
    );

    const character = rows[0];

    if (!character) {
      reject(404, 'Персонаж не найден.');
    }

    if (character.owner_user_id !== userId && (await accessGrantLevel(q, campaignId, characterId, userId)) !== 'edit') {
      await requirePermission(
        q,
        member,
        userId,
        'characters.manage',
      );
    }

    return character;
  }

  function characterValues(
    proposal: ValidatedProposal,
  ): unknown[] {
    return [
      proposal.name.trim(),
      proposal.strength,
      proposal.dexterity,
      proposal.constitution,
      proposal.intelligence,
      proposal.wisdom,
      proposal.charisma,
      proposal.hp_current,
      proposal.hp_max,
      proposal.hp_temp,
      proposal.armor_class,
      proposal.speed_feet,
      JSON.stringify(proposal.sheet_extra),
    ];
  }

  return { characterForEditing, characterValues };
}

export type ImportHelpers = ReturnType<typeof importHelpers>;
