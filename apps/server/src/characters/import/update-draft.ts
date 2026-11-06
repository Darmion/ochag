import type { FastifyInstance } from 'fastify';
import { validateProposal } from '../../../../../packages/importer/proposal.ts';
import { type Options, reject, draftParamsSchema, type DraftParams, type ImportHelpers } from './shared.ts';

export function registerUpdateDraftRoute(app: FastifyInstance, { db, auth, membership }: Options, { characterForEditing }: ImportHelpers) {
  app.put<{
    Params: DraftParams;
    Body: {
      draftRevision: number;
      proposal: Record<string, unknown>;
    };
  }>('/campaigns/:campaignId/imports/:draftId', {
    bodyLimit: 2 * 1024 * 1024,
    schema: {
      params: draftParamsSchema,
      body: {
        type: 'object',
        required: ['draftRevision', 'proposal'],
        additionalProperties: false,
        properties: {
          draftRevision: {
            type: 'integer',
            minimum: 1,
          },
          proposal: {
            type: 'object',
            additionalProperties: true,
          },
        },
      },
    },
  }, async request => {
    const userId = await auth(request);
    const { campaignId, draftId } = request.params;

    const proposal = request.body.proposal;

    try {
      validateProposal(proposal);
    } catch (error) {
      reject(
        400,
        error instanceof Error ? error.message : 'Поля листа заполнены неверно — проверьте их в предпросмотре.',
      );
    }

    return db.transaction(async q => {
      const member = await membership(
        q,
        campaignId,
        userId,
        true,
      );

      const { rows } = await q.query(
        `SELECT * FROM import_drafts
         WHERE id=$1 AND campaign_id=$2 AND created_by=$3
         FOR UPDATE`,
        [draftId, campaignId, userId],
      );

      const draft = rows[0];

      if (!draft) reject(404, 'Черновик не найден.');

      if (
        draft.status !== 'draft' ||
        draft.draft_revision !== request.body.draftRevision
      ) {
        reject(409, 'Черновик уже изменён или закрыт.');
      }

      if (draft.target_character_id) {
        await characterForEditing(
          q,
          campaignId,
          draft.target_character_id,
          userId,
          member,
        );
      }

      const saved = await q.query(
        `UPDATE import_drafts
         SET proposed_document=$1::jsonb,
             draft_revision=draft_revision+1
         WHERE id=$2
         RETURNING draft_revision`,
        [JSON.stringify(proposal), draftId],
      );

      return {
        draftRevision: saved.rows[0].draft_revision,
      };
    });
  });
}
