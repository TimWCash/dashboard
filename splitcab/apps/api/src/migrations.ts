import type { Db } from './db';

export interface Migration {
  name: string;
  sql: string;
}

// Applies the migrations that haven't run yet, in order, each in its own transaction. A transaction-scoped
// lock stops two instances applying the same one, and works through transaction-mode connection poolers.
export async function applyMigrations(db: Db, migrations: Migration[], log: (msg: string) => void = () => {}): Promise<string[]> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const applied: string[] = [];
  for (const { name, sql } of [...migrations].sort((a, b) => a.name.localeCompare(b.name))) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(72431000)');
      const { rowCount } = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
      if (rowCount) {
        await client.query('COMMIT');
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
      await client.query('COMMIT');
      applied.push(name);
      log(`Applied migration ${name}`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw new Error(`Migration ${name} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  return applied;
}
