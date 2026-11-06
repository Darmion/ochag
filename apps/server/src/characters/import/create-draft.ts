import type { FastifyInstance } from 'fastify';
import { IMPORTERS, type SheetImport } from './importers.ts';
import { type Options, reject, uuid, paramsSchema, type CampaignParams, type ImportHelpers } from './shared.ts';

export function registerCreateDraftRoute(app: FastifyInstance, { db, auth, membership }: Options, { characterForEditing }: ImportHelpers) {
  app.post<{
    Params: CampaignParams;
    Body: {
      importer: string;
      original: Record<string, unknown>;
      targetCharacterId?: string;
    };
  }>('/campaigns/:campaignId/imports', {
    bodyLimit: 2 * 1024 * 1024,
    schema: {
      params: paramsSchema,
      body: {
        type: 'object',
        required: ['importer', 'original'],
        additionalProperties: false,
        properties: {
          importer: { type: 'string', minLength: 1, maxLength: 64 },
          original: {
            type: 'object',
            additionalProperties: true,
          },
          targetCharacterId: uuid,
        },
      },
    },
  }, async (request, reply) => {
    const userId = await auth(request);
    const campaignId = request.params.campaignId;

    await membership(db, campaignId, userId);

    const importer = IMPORTERS.get(request.body.importer);
    if (!importer) reject(400, `На этом сервере нет импорта «${request.body.importer}» — мастер включает его в окне «Моды».`);

    let parsed: SheetImport;

    try {
      parsed = importer.parse(request.body.original);
    } catch (error) {
      reject(
        400,
        error instanceof Error ? error.message : 'Файл не читается — выберите другой файл листа.',
      );
    }

    const result = await db.transaction(async q => {
      const member = await membership(
        q,
        campaignId,
        userId,
        true,
      );

      const targetId = request.body.targetCharacterId ?? null;

      const current = targetId
        ? await characterForEditing(
            q,
            campaignId,
            targetId,
            userId,
            member,
            true,
          )
        : null;

      const { rows } = await q.query(
        `INSERT INTO import_drafts (
          campaign_id,
          created_by,
          target_character_id,
          expected_character_revision,
          original_document,
          proposed_document,
          field_mapping,
          warnings
        )
        VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb)
        RETURNING
          id, draft_revision, proposed_document,
          field_mapping, warnings`,
        [
          campaignId,
          userId,
          targetId,
          current?.revision ?? null,
          JSON.stringify(request.body.original),
          JSON.stringify(parsed.proposal),
          JSON.stringify(parsed.mapping),
          JSON.stringify(parsed.warnings),
        ],
      );

      return {
        ...rows[0],
        current,
      };
    });

    return reply.code(201).send(result);
  });
}
