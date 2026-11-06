import type { Queryable } from '../db.ts';
import { objectSchema, reject, uuid, type SceneFeatureContext } from '../tabletop/scene-feature.ts';
import { TABLE_PRESETS, entryFor, rollCount, tableProblems, type TableEntry } from '../../../../packages/domain/world/roll-tables.ts';
import { findMonster } from '../../../../packages/domain/world/bestiary.ts';
import { parseFormula } from '../../../../packages/domain/dice/dice.ts';

export type RollTableContext = SceneFeatureContext & {
  rollDie: (sides: number) => number;
  insertRoll: (
    q: Queryable, campaignId: string, userId: string, characterId: string | null, label: string | null, formula: string,
    results: number[], modifier: number, total: number, hidden: boolean, breakdown?: unknown[] | null, outcome?: Record<string, unknown> | null,
  ) => Promise<any>;
};

const COLUMNS = 'id, name, formula, entries, secret, revision, updated_at';

const entriesSchema = {
  type: 'array', minItems: 1, maxItems: 100,
  items: objectSchema({
    from: { type: 'integer', minimum: 1, maximum: 1000 },
    to: { type: 'integer', minimum: 1, maximum: 1000 },
    text: { type: 'string', maxLength: 500 },
    monsters: {
      type: 'array', maxItems: 4,
      items: objectSchema({ index: { type: 'string', minLength: 1, maxLength: 64 }, count: { type: 'string', minLength: 1, maxLength: 12 } }),
    },
  }, ['from', 'to', 'text']),
};
const nameSchema = { type: 'string', minLength: 1, maxLength: 120, pattern: '\\S' };
const formulaSchema = { type: 'string', minLength: 3, maxLength: 12 };

function assertTable(formula: string, entries: TableEntry[]) {
  const problems = tableProblems(formula, entries);
  if (problems.length) reject(400, problems.slice(0, 4).join(' '));
}

export function registerRollTableRoutes(ctx: RollTableContext) {
  const { app, db, auth, membership, canManage, notifyCampaign, rollDie, insertRoll } = ctx;
  const campaignParams = objectSchema({ campaignId: uuid });
  const tableParams = objectSchema({ campaignId: uuid, tableId: uuid });

  async function assertManager(q: Queryable, campaignId: string, userId: string) {
    const member = await membership(q, campaignId, userId, true);
    if (!(await canManage(q, member, userId))) reject(403, 'Таблицы случайностей ведёт мастер.');
  }

  app.get<{ Params: { campaignId: string } }>(
    '/campaigns/:campaignId/tables',
    { schema: { params: campaignParams } },
    async request => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      return db.transaction(async q => {
        await assertManager(q, campaignId, userId);
        const tables = (await q.query(`SELECT ${COLUMNS} FROM roll_tables WHERE campaign_id=$1 ORDER BY name, id`, [campaignId])).rows;
        return { tables, presets: TABLE_PRESETS.map(preset => ({ id: preset.id, name: preset.name, formula: preset.formula })) };
      });
    },
  );

  app.post<{ Params: { campaignId: string }; Body: { name?: string; formula?: string; entries?: TableEntry[]; secret?: boolean; preset?: string } }>(
    '/campaigns/:campaignId/tables',
    {
      schema: {
        params: campaignParams,
        body: objectSchema({ name: nameSchema, formula: formulaSchema, entries: entriesSchema, secret: { type: 'boolean' }, preset: { type: 'string', maxLength: 64 } }, []),
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId } = request.params;
      const body = request.body;
      let table: { name: string; formula: string; entries: TableEntry[]; secret: boolean };
      if (body.preset) {
        const preset = TABLE_PRESETS.find(entry => entry.id === body.preset);
        if (!preset) reject(400, 'Такой готовой таблицы нет.');
        table = { name: body.name?.trim() || preset.name, formula: preset.formula, entries: preset.entries, secret: body.secret ?? preset.secret };
      } else {
        if (!body.name || !body.formula || !body.entries) reject(400, 'Нужны название, кость и строки таблицы.');
        table = { name: body.name.trim(), formula: body.formula.trim(), entries: body.entries, secret: body.secret ?? false };
      }
      assertTable(table.formula, table.entries);

      const created = await db.transaction(async q => {
        await assertManager(q, campaignId, userId);
        return (
          await q.query(
            `INSERT INTO roll_tables (campaign_id, name, formula, entries, secret, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${COLUMNS}`,
            [campaignId, table.name, table.formula, JSON.stringify(table.entries), table.secret, userId],
          )
        ).rows[0];
      });
      return reply.code(201).send({ table: created });
    },
  );

  app.put<{ Params: { campaignId: string; tableId: string }; Body: { name?: string; formula?: string; entries?: TableEntry[]; secret?: boolean; revision: number } }>(
    '/campaigns/:campaignId/tables/:tableId',
    {
      schema: {
        params: tableParams,
        body: objectSchema({
          name: nameSchema, formula: formulaSchema, entries: entriesSchema, secret: { type: 'boolean' }, revision: { type: 'integer', minimum: 1 },
        }, ['revision']),
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, tableId } = request.params;
      const body = request.body;
      const table = await db.transaction(async q => {
        await assertManager(q, campaignId, userId);
        const current = (await q.query(`SELECT ${COLUMNS} FROM roll_tables WHERE campaign_id=$1 AND id=$2 FOR UPDATE`, [campaignId, tableId])).rows[0];
        if (!current) reject(404, 'Таблицы нет.');
        if (current.revision !== body.revision) reject(409, 'Таблицу уже изменили — перечитайте её.');
        const formula = body.formula?.trim() ?? current.formula;
        const entries = body.entries ?? current.entries;
        assertTable(formula, entries);
        return (
          await q.query(
            `UPDATE roll_tables SET name=$3, formula=$4, entries=$5, secret=$6, revision=revision+1, updated_at=now()
             WHERE campaign_id=$1 AND id=$2 RETURNING ${COLUMNS}`,
            [campaignId, tableId, body.name?.trim() ?? current.name, formula, JSON.stringify(entries), body.secret ?? current.secret],
          )
        ).rows[0];
      });
      return { table };
    },
  );

  app.delete<{ Params: { campaignId: string; tableId: string } }>(
    '/campaigns/:campaignId/tables/:tableId',
    { schema: { params: tableParams } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, tableId } = request.params;
      await db.transaction(async q => {
        await assertManager(q, campaignId, userId);
        const deleted = await q.query('DELETE FROM roll_tables WHERE campaign_id=$1 AND id=$2 RETURNING id', [campaignId, tableId]);
        if (!deleted.rows[0]) reject(404, 'Таблицы нет.');
      });
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { campaignId: string; tableId: string } }>(
    '/campaigns/:campaignId/tables/:tableId/roll',
    { schema: { params: tableParams } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, tableId } = request.params;
      const result = await db.transaction(async q => {
        await assertManager(q, campaignId, userId);
        const table = (await q.query(`SELECT ${COLUMNS} FROM roll_tables WHERE campaign_id=$1 AND id=$2`, [campaignId, tableId])).rows[0];
        if (!table) reject(404, 'Таблицы нет.');
        const parsed = parseFormula(table.formula)!;
        const results = Array.from({ length: parsed.count }, () => rollDie(parsed.sides));
        const total = results.reduce((sum, value) => sum + value, 0);
        const entry = entryFor(table.entries as TableEntry[], total);
        const monsters = (entry?.monsters ?? []).flatMap(monster => {
          const known = findMonster(monster.index);
          return known ? [{ index: monster.index, nameRu: known.nameRu, count: rollCount(monster.count, rollDie) }] : [];
        });
        const roll = await insertRoll(
          q, campaignId, userId, null, `Таблица: ${table.name}`.slice(0, 100), table.formula, results, 0, total, table.secret, null,
          { kind: 'table', text: entry?.text ?? '—', ...(monsters.length ? { monsters } : {}) },
        );
        return { roll, entry: entry ? { from: entry.from, to: entry.to, text: entry.text } : null, monsters };
      });
      void notifyCampaign(campaignId, { type: 'rolls' });
      return reply.code(201).send(result);
    },
  );
}
