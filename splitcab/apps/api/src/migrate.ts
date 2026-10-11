import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './db';
import { applyMigrations } from './migrations';

// Migrations live next to the package so they ship with both `tsx` (src/) and the bundled build (dist/).
const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

// Applies any .sql files in migrations/ that haven't run yet, in filename order.
export async function migrate(db: Db, log: (msg: string) => void = () => {}): Promise<string[]> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql'));
  const migrations = await Promise.all(files.map(async (name) => ({ name, sql: await readFile(path.join(MIGRATIONS_DIR, name), 'utf8') })));
  return applyMigrations(db, migrations, log);
}
