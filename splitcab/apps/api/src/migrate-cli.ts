import { createPool } from './db';
import { migrate } from './migrate';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const db = createPool({ DATABASE_URL: url, DATABASE_SSL: process.env.DATABASE_SSL === 'true', DATABASE_POOL_MAX: 1 });
try {
  const applied = await migrate(db, console.log);
  console.log(applied.length ? `Done: ${applied.length} migration(s) applied.` : 'Database is up to date.');
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await db.end();
}
