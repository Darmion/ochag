import type { Queryable } from '../db.ts';
import { objectSchema, reject, uuid, type SceneFeatureContext } from '../tabletop/scene-feature.ts';
import { MAX_FORMULA_LENGTH, parseExpression } from '../../../../packages/domain/dice/expression.ts';

const MAX_MACROS = 30;
const COLUMNS = 'id, label, formula, character_id, hidden, position';

const fields = {
  label: { type: 'string', minLength: 1, maxLength: 40, pattern: '\\S' },
  formula: { type: 'string', minLength: 1, maxLength: MAX_FORMULA_LENGTH },
  characterId: { anyOf: [uuid, { type: 'null' }] },
  hidden: { type: 'boolean' },
};
type MacroBody = { label?: string; formula?: string; characterId?: string | null; hidden?: boolean };

const view = (row: Record<string, any>) => ({
  id: String(row.id), label: String(row.label), formula: String(row.formula), characterId: row.character_id ?? null, hidden: row.hidden === true,
});

// A player's own roll buttons in a campaign: a caption and a formula, rolled from the chat, maybe as one of the heroes.
export function registerRollMacroRoutes(ctx: SceneFeatureContext) {
  const { app, db, auth, membership } = ctx;
  const campaignParams = objectSchema({ campaignId: uuid });
  const macroParams = objectSchema({ campaignId: uuid, macroId: uuid });

  function checkFormula(formula: string) {
    const parsed = parseExpression(formula.trim().toLowerCase().replace(/к/g, 'd'));
    if (!parsed.ok) reject(400, parsed.reason === 'unknown-token'
      ? `Неизвестная переменная @${parsed.token}. Можно: @str @dex @con @int @wis @cha @prof.`
      : 'Формулу не удалось разобрать. Примеры: 1d20+@dex, 2d6+3, 4d6kh3, 1d20r1, 6d10cs>=8.');
    return formula.trim().toLowerCase().replace(/к/g, 'd');
  }

  async function checkCharacter(q: Queryable, campaignId: string, characterId: string | null | undefined) {
    if (!characterId) return;
    const found = (await q.query(`SELECT 1 FROM characters WHERE campaign_id=$1 AND id=$2 AND kind <> 'object'`, [campaignId, characterId])).rows.length;
    if (!found) reject(400, 'Этого героя в кампании нет — выберите другого или бросайте без героя.');
  }

  app.get<{ Params: { campaignId: string } }>(
    '/campaigns/:campaignId/roll-macros',
    { schema: { params: campaignParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      await membership(db, campaignId, userId);
      const rows = (await db.query(`SELECT ${COLUMNS} FROM roll_macros WHERE campaign_id=$1 AND user_id=$2 ORDER BY position, created_at`, [campaignId, userId])).rows;
      return { macros: rows.map(view) };
    },
  );

  app.post<{ Params: { campaignId: string }; Body: MacroBody }>(
    '/campaigns/:campaignId/roll-macros',
    { schema: { params: campaignParams, body: objectSchema(fields, ['label', 'formula']) } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const body = request.body;
      const formula = checkFormula(body.formula!);
      const created = await db.transaction(async q => {
        await membership(q, campaignId, userId, true);
        await checkCharacter(q, campaignId, body.characterId);
        const count = Number((await q.query('SELECT count(*)::int AS n FROM roll_macros WHERE campaign_id=$1 AND user_id=$2', [campaignId, userId])).rows[0].n);
        if (count >= MAX_MACROS) reject(400, `Своих кнопок бросков не больше ${MAX_MACROS} — удалите ненужные.`);
        return (await q.query(
          `INSERT INTO roll_macros (campaign_id, user_id, label, formula, character_id, hidden, position) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${COLUMNS}`,
          [campaignId, userId, body.label!.trim(), formula, body.characterId ?? null, body.hidden === true, count],
        )).rows[0];
      });
      return reply.code(201).send(view(created));
    },
  );

  app.put<{ Params: { campaignId: string; macroId: string }; Body: MacroBody }>(
    '/campaigns/:campaignId/roll-macros/:macroId',
    { schema: { params: macroParams, body: { ...objectSchema(fields, []), minProperties: 1 } } },
    async request => {
      const userId = await auth(request);
      const { campaignId, macroId } = request.params;
      const body = request.body;
      const formula = body.formula === undefined ? null : checkFormula(body.formula);
      const updated = await db.transaction(async q => {
        await membership(q, campaignId, userId, true);
        await checkCharacter(q, campaignId, body.characterId);
        const row = (await q.query(
          `UPDATE roll_macros SET label=COALESCE($4, label), formula=COALESCE($5, formula),
             character_id=CASE WHEN $6::boolean THEN $7::uuid ELSE character_id END, hidden=COALESCE($8, hidden)
           WHERE campaign_id=$1 AND user_id=$2 AND id=$3 RETURNING ${COLUMNS}`,
          [campaignId, userId, macroId, body.label?.trim() ?? null, formula, body.characterId !== undefined, body.characterId ?? null, body.hidden ?? null],
        )).rows[0];
        if (!row) reject(404, 'Такой кнопки уже нет — обновите список.');
        return row;
      });
      return view(updated);
    },
  );

  app.delete<{ Params: { campaignId: string; macroId: string } }>(
    '/campaigns/:campaignId/roll-macros/:macroId',
    { schema: { params: macroParams } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, macroId } = request.params;
      await db.transaction(async q => {
        await membership(q, campaignId, userId, true);
        const gone = (await q.query('DELETE FROM roll_macros WHERE campaign_id=$1 AND user_id=$2 AND id=$3 RETURNING position', [campaignId, userId, macroId])).rows[0];
        if (!gone) reject(404, 'Такой кнопки уже нет — обновите список.');
        await q.query('UPDATE roll_macros SET position=position-1 WHERE campaign_id=$1 AND user_id=$2 AND position > $3', [campaignId, userId, gone.position]);
      });
      return reply.code(204).send();
    },
  );
}
