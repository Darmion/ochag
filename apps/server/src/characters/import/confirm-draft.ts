import type { FastifyInstance } from 'fastify';
import { validateProposal } from '../../../../../packages/importer/proposal.ts';
import { type Options, reject, draftParamsSchema, type DraftParams, type ImportHelpers } from './shared.ts';
import { applyStructure } from './apply-structure.ts';

export function registerConfirmDraftRoute(app: FastifyInstance, { db, auth, membership }: Options, { characterForEditing, characterValues }: ImportHelpers) {
  app.post<{
    Params: DraftParams;
    Body: { draftRevision: number };
  }>('/campaigns/:campaignId/imports/:draftId/confirm', {
    schema: {
      params: draftParamsSchema,
      body: {
        type: 'object',
        required: ['draftRevision'],
        additionalProperties: false,
        properties: {
          draftRevision: {
            type: 'integer',
            minimum: 1,
          },
        },
      },
    },
  }, async request => {
    const userId = await auth(request);
    const { campaignId, draftId } = request.params;

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

      if (draft.status === 'confirmed') {
        await characterForEditing(
          q,
          campaignId,
          draft.result_character_id,
          userId,
          member,
        );

        return {
          characterId: draft.result_character_id,
          alreadyConfirmed: true,
        };
      }

      if (
        draft.status !== 'draft' ||
        draft.draft_revision !== request.body.draftRevision
      ) {
        reject(409, 'Черновик уже изменён или закрыт.');
      }

      const proposal = draft.proposed_document;

      try {
        validateProposal(proposal);
      } catch (error) {
        reject(
          400,
          error instanceof Error ? error.message : 'Поля листа заполнены неверно — проверьте их в предпросмотре.',
        );
      }

      const values = characterValues(proposal);
      let characterId: string;

      if (draft.target_character_id) {
        const current = await characterForEditing(
          q,
          campaignId,
          draft.target_character_id,
          userId,
          member,
          true,
        );

        if (current.revision !== draft.expected_character_revision) {
          reject(
            409,
            'Персонаж изменён после открытия импорта. ' +
            'Создайте новый предпросмотр для сравнения с актуальным листом.',
          );
        }

        const updated = await q.query(
          `UPDATE characters SET
            name=$1,
            strength=$2,
            dexterity=$3,
            constitution=$4,
            intelligence=$5,
            wisdom=$6,
            charisma=$7,
            hp_current=$8,
            hp_max=$9,
            hp_temp=$10,
            armor_class=$11,
            speed_feet=$12,
            sheet_extra=$13::jsonb,
            revision=revision+1
           WHERE campaign_id=$14 AND id=$15
           RETURNING id`,
          [
            ...values,
            campaignId,
            draft.target_character_id,
          ],
        );

        characterId = updated.rows[0].id;
      } else {
        const inserted = await q.query(
          `INSERT INTO characters (
            name,
            strength,
            dexterity,
            constitution,
            intelligence,
            wisdom,
            charisma,
            hp_current,
            hp_max,
            hp_temp,
            armor_class,
            speed_feet,
            sheet_extra,
            campaign_id,
            owner_user_id
          )
          VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
            $13::jsonb,$14,$15
          )
          RETURNING id`,
          [...values, campaignId, userId],
        );

        characterId = inserted.rows[0].id;
      }

      await applyStructure(q, campaignId, characterId, (proposal.sheet_extra as Record<string, unknown>)?.importedStructure, proposal.sheet_extra);

      await q.query(
        `UPDATE characters SET cp=coins_from_extra(sheet_extra,'cp'), sp=coins_from_extra(sheet_extra,'sp'),
           ep=coins_from_extra(sheet_extra,'ep'), gp=coins_from_extra(sheet_extra,'gp'), pp=coins_from_extra(sheet_extra,'pp')
         WHERE campaign_id=$1 AND id=$2`,
        [campaignId, characterId],
      );

      await q.query(
        `UPDATE import_drafts
         SET status='confirmed',
             result_character_id=$1,
             draft_revision=draft_revision+1
         WHERE id=$2`,
        [characterId, draftId],
      );

      return {
        characterId,
        alreadyConfirmed: false,
      };
    });
  });
}
