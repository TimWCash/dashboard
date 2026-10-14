import pg from 'pg';
import type { AppConfig } from './config';

// Return bigint counts as numbers and timestamps as Date objects (the pg defaults for timestamptz).
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export type Db = pg.Pool;
export type Tx = pg.PoolClient;
export type Queryable = Pick<pg.Pool, 'query'>;

type PoolConfig = Pick<AppConfig, 'DATABASE_URL' | 'DATABASE_SSL' | 'DATABASE_POOL_MAX'> &
  Partial<Pick<AppConfig, 'DATABASE_SSL_CA' | 'DATABASE_TRANSACTION_POOLER'>>;

export function createPool(config: PoolConfig): Db {
  return new pg.Pool({
    connectionString: config.DATABASE_URL,
    ssl: config.DATABASE_SSL_CA ? { ca: config.DATABASE_SSL_CA, rejectUnauthorized: true } : config.DATABASE_SSL ? { rejectUnauthorized: true } : undefined,
    max: config.DATABASE_POOL_MAX,
    // A transaction pooler hands each transaction to any server connection, so these come from the role there.
    ...(config.DATABASE_TRANSACTION_POOLER ? {} : { statement_timeout: 10_000, idle_in_transaction_session_timeout: 30_000 }),
  });
}

export async function withTx<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Every change to trip or match state takes this lock first. It serialises matching so two trips can
// never be paired with the same partner at once. Matching takes milliseconds, which is plenty of
// headroom at launch scale; shard the key by region if it ever becomes a bottleneck.
const MATCHING_LOCK = 72_431_001;

export async function lockMatching(tx: Tx): Promise<void> {
  await tx.query('SELECT pg_advisory_xact_lock($1)', [MATCHING_LOCK]);
}
