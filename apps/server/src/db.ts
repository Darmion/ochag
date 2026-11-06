import pg from 'pg';
export type Row = Record<string, any>;
export interface Queryable {
  query<T extends Row = Row>(sql: string, values?: any[]): Promise<{rows: T[]}>;
}
export interface Database extends Queryable {
  transaction<T>(fn: (client: Queryable) => Promise<T>): Promise<T>;
}
export function postgresDatabase(pool: pg.Pool): Database {
  return {
    query: (sql, values) => pool.query(sql, values),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    },
  };
}
export function poolFromEnvironment(runtime = true) {
  const password = runtime ? process.env.APP_DB_PASSWORD : process.env.POSTGRES_PASSWORD;
  if (!password) throw new Error(runtime ? 'APP_DB_PASSWORD is required. Run npm run db:provision.' : 'POSTGRES_PASSWORD is required');
  return new pg.Pool({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 5432),
    database: 'ttrpg', user: runtime ? 'ttrpg_app' : 'ttrpg_dev', password,
    max: 10, connectionTimeoutMillis: 5000, statement_timeout: 10000,
  });
}
