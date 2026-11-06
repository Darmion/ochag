// JSON.stringify calls toJSON before the replacer: Dates arrive as ISO strings (fine as is), Buffers as {type:'Buffer', data} — re-encode those as base64.
export function replacer(_key: string, value: unknown) {
  if (value && typeof value === 'object' && (value as any).type === 'Buffer' && Array.isArray((value as any).data)) {
    return {$buffer: Buffer.from((value as any).data).toString('base64')};
  }
  return value;
}

export function reviver(_key: string, value: unknown) {
  if (value && typeof value === 'object' && typeof (value as any).$buffer === 'string') {
    return Buffer.from((value as any).$buffer, 'base64');
  }
  return value;
}

// pg cannot tell where a parameter goes, so the column kind comes from the schema: jsonb is always serialized, real array columns get JS arrays.
export type ColumnKind = 'json' | 'array' | 'plain';

type Queryable = {query: (sql: string, values?: unknown[]) => Promise<{rows: any[]}>};

export async function columnKinds(client: Queryable, table: string): Promise<Map<string, ColumnKind>> {
  const rows = (await client.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1`,
    [table],
  )).rows;
  return new Map(rows.map(row => [
    row.column_name as string,
    row.data_type === 'jsonb' || row.data_type === 'json' ? 'json' : row.data_type === 'ARRAY' ? 'array' : 'plain',
  ]));
}

export function toParam(value: unknown, kind: ColumnKind): unknown {
  if (value === null || value instanceof Buffer) return value;
  if (kind === 'array') return Array.isArray(value) ? value : null;
  if (kind === 'json' || typeof value === 'object') return JSON.stringify(value);
  return value;
}

export function parentsFirst(rows: Array<Record<string, unknown>>) {
  const byId = new Map(rows.map(row => [String(row.id), row]));
  const depth = (row: Record<string, unknown>, guard = 0): number =>
    row.parent_object_id && byId.has(String(row.parent_object_id)) && guard < 100
      ? 1 + depth(byId.get(String(row.parent_object_id))!, guard + 1)
      : 0;
  return [...rows].sort((a, b) => depth(a) - depth(b));
}

export async function restoreRows(
  client: Queryable,
  stored: Record<string, Array<Record<string, unknown>>>,
  tables: readonly string[],
  late: Readonly<Record<string, readonly string[]>>,
) {
  await client.query(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);

  for (const table of tables) {
    const rows = table === 'scene_objects' ? parentsFirst(stored[table] ?? []) : stored[table] ?? [];
    if (rows.length === 0) continue;

    const columns = Object.keys(rows[0]!);
    const kinds = await columnKinds(client, table);
    const deferred = late[table] ?? [];
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const insertSql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;

    for (const row of rows) {
      await client.query(insertSql, columns.map(column => deferred.includes(column) ? null : toParam(row[column], kinds.get(column) ?? 'plain')));
    }
  }

  for (const [table, columns] of Object.entries(late)) {
    if (!tables.includes(table)) continue;
    const kinds = await columnKinds(client, table);
    for (const row of stored[table] ?? []) {
      const present = columns.filter(column => row[column] !== null && row[column] !== undefined);
      if (!present.length) continue;
      await client.query(
        `UPDATE ${table} SET ${present.map((column, i) => `${column}=$${i + 2}`).join(', ')} WHERE id=$1`,
        [row.id, ...present.map(column => toParam(row[column], kinds.get(column) ?? 'plain'))],
      );
    }
  }
}
