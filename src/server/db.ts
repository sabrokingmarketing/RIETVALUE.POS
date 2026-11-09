import "server-only";
import { Pool, types, type PoolClient, type QueryResultRow } from "pg";

// Keep DATE as 'YYYY-MM-DD' text (business dates must not shift by time zone),
// and return bigint/numeric aggregates as JS numbers (all values are far below 2^53).
types.setTypeParser(1082, (v: string) => v);
types.setTypeParser(20, (v: string) => Number(v));
types.setTypeParser(1700, (v: string) => Number(v));

declare global {
  // eslint-disable-next-line no-var
  var __nurseryPool: Pool | undefined;
}

export function getPool(): Pool {
  if (!globalThis.__nurseryPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    globalThis.__nurseryPool = new Pool({ connectionString, max: 10 });
  }
  return globalThis.__nurseryPool;
}

export type Db = Pick<PoolClient, "query">;

export async function q<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
  db: Db = getPool(),
): Promise<T[]> {
  const res = await db.query<T>(sql, params);
  return res.rows;
}

export async function q1<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
  db: Db = getPool(),
): Promise<T | undefined> {
  const rows = await q<T>(sql, params, db);
  return rows[0];
}

/** Run fn inside one database transaction. Rolls back on any thrown error. */
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** SQL expression for today's business date in South Africa. */
export const BUSINESS_DATE_SQL = "(now() AT TIME ZONE 'Africa/Johannesburg')::date";
