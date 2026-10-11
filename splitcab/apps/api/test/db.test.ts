import { afterAll, describe, expect, it } from 'vitest';
import { createPool } from '../src/db';
import { TEST_DB } from './helpers';

describe('database pool', () => {
  const direct = createPool({ DATABASE_URL: TEST_DB, DATABASE_SSL: false, DATABASE_POOL_MAX: 1 });
  const pooled = createPool({ DATABASE_URL: TEST_DB, DATABASE_SSL: false, DATABASE_POOL_MAX: 1, DATABASE_TRANSACTION_POOLER: true });
  afterAll(() => Promise.all([direct.end(), pooled.end()]));

  it('sets query timeouts on each connection', async () => {
    const { rows } = await direct.query<{ statement_timeout: string }>('SHOW statement_timeout');
    expect(rows[0]!.statement_timeout).toBe('10s');
  });

  it('leaves them to the database role behind a transaction pooler, which drops connection settings', async () => {
    const { rows } = await pooled.query<{ statement_timeout: string }>('SHOW statement_timeout');
    expect(rows[0]!.statement_timeout).toBe('0');
  });
});
