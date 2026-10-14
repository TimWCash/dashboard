import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { loadConfig } from '../src/config';
import type { Db } from '../src/db';
import { MIN, get, harness, post, resetDb, rider, testDb, trip, type Harness } from './helpers';

let db: Db;
let h: Harness;
const demo = { DEMO_MODE: 'true', OTP_PROVIDER: 'demo', DEMO_PARTNER_AFTER_S: '45' };

beforeAll(async () => {
  db = await testDb();
});
beforeEach(async () => {
  await resetDb(db);
  h = await harness(db, { env: demo });
});
afterAll(async () => {
  await db.end();
});

describe('the public demo', () => {
  test('two people looking at the same time are matched with each other', async () => {
    const ana = await rider(h, 'Ana');
    const ben = await rider(h, 'Ben');
    await post(h, ana, trip('stephens-green', 'dub'));
    const b = await post(h, ben, trip('trinity', 'dub'));
    expect(b.status).toBe('proposed');
    expect(b.match!.partner.firstName).toBe('Ana');
  });

  test('someone left on their own gets the pretend partner after the wait, once', async () => {
    const ana = await rider(h, 'Ana');
    const a = await post(h, ana, trip('stephens-green', 'dub'));
    h.advance(30_000);
    await h.rides.sweep();
    expect((await get(h, ana, a.id)).status).toBe('searching');
    h.advance(20_000);
    await h.rides.sweep();
    const proposed = await get(h, ana, a.id);
    expect(proposed.match!.partner.firstName).toBe('Alex');

    await h.call('POST', `/v1/matches/${proposed.match!.id}/respond`, { token: ana.token, body: { accept: false } });
    h.advance(MIN);
    await h.rides.sweep();
    expect((await get(h, ana, a.id)).status).toBe('searching');
    // The pretend traveller's pretend payment doesn't stay looking like a hold.
    const { rows } = await db.query("SELECT p.status FROM payments p JOIN users u ON u.id = p.user_id WHERE u.is_demo");
    expect(rows.map((r) => r.status)).toEqual(['released']);
  });

  test('every trip that can be posted gets the pretend partner, short or long', async () => {
    const pairs = [
      ['temple-bar', 'dundrum'],
      ['stephens-green', 'dcu'],
      ['heuston', 'dun-laoghaire'],
      ['smithfield', 'ucd'],
      ['temple-bar', 'rathmines'],
      ['cork-city', 'cork-airport'],
      ['eyre-square', 'salthill'],
    ];
    let posted = 0;
    for (const [from, to] of pairs) {
      const r = await rider(h, `R${from}`);
      const res = await h.call('POST', '/v1/trips', { token: r.token, body: trip(from!, to!) });
      if (res.status !== 201) {
        // Too short to save the minimum, which the person is told before posting.
        expect(res.json.error.code).toBe('not_worth_sharing');
        continue;
      }
      posted++;
      h.advance(50_000);
      await h.rides.sweep();
      expect((await get(h, r, res.json.id)).match?.partner.firstName, `${from} to ${to}`).toBe('Alex');
    }
    expect(posted).toBeGreaterThanOrEqual(4);
  });

  test('someone matched with a visitor who has left gets the pretend partner instead', async () => {
    const ben = await rider(h, 'Ben');
    const gone = await post(h, ben, trip('trinity', 'dub'));
    const ana = await rider(h, 'Ana');
    const a = await post(h, ana, trip('stephens-green', 'dub'));
    expect(a.match!.partner.firstName).toBe('Ben');
    expect(Date.parse(a.match!.expiresAt) - h.clock.now).toBe(3 * MIN);
    await h.call('POST', `/v1/matches/${a.match!.id}/respond`, { token: ana.token, body: { accept: true } });

    h.advance(3 * MIN);
    await h.rides.sweep();
    expect((await get(h, ana, a.id)).status).toBe('searching');
    expect((await get(h, ben, gone.id)).status).toBe('expired');

    h.advance(45_000);
    await h.rides.sweep();
    expect((await get(h, ana, a.id)).match!.partner.firstName).toBe('Alex');
  });

  test('two friends can try again with new trips straight after one falls through', async () => {
    const ana = await rider(h, 'Ana');
    const ben = await rider(h, 'Ben');
    await post(h, ana, trip('stephens-green', 'dub'));
    const b = await post(h, ben, trip('trinity', 'dub'));
    await h.call('POST', `/v1/matches/${b.match!.id}/respond`, { token: ben.token, body: { accept: false } });
    await h.call('POST', `/v1/trips/${b.id}/cancel`, { token: ben.token });
    const again = await post(h, ben, trip('trinity', 'dub'));
    expect(again.match?.partner.firstName).toBe('Ana');
  });

  test('"Skip to after the ride" finishes the ride for both people', async () => {
    const ana = await rider(h, 'Ana');
    const ben = await rider(h, 'Ben');
    const a = await post(h, ana, trip('stephens-green', 'dub'));
    const b = await post(h, ben, trip('trinity', 'dub'));
    const matchId = b.match!.id;
    await h.call('POST', `/v1/matches/${matchId}/respond`, { token: ana.token, body: { accept: true } });
    await h.call('POST', `/v1/matches/${matchId}/respond`, { token: ben.token, body: { accept: true } });
    const finished = await h.call('POST', `/v1/matches/${matchId}/demo-finish`, { token: ana.token });
    expect(Date.parse(finished.json.match.plan.you.dropoffAt)).toBeLessThan(h.clock.now);
    expect(Date.parse((await get(h, ben, b.id)).match!.plan.you.pickupAt)).toBeLessThan(h.clock.now);
    const booker = finished.json.match.youBook ? ana : ben;
    expect((await h.call('POST', `/v1/matches/${matchId}/complete`, { token: booker.token, body: { actualFare: 3000 } })).json.status).toBe('completed');

    const real = await harness(db);
    expect((await real.call('POST', `/v1/matches/${matchId}/demo-finish`, { token: ana.token })).status).toBe(404);
  });

  test('sign-in codes work whichever server instance checks them', async () => {
    const other = await harness(db, { env: demo });
    const start = await h.call('POST', '/v1/auth/otp/start', { body: { phone: '087 444 1234' } });
    expect(start.json.devCode).toMatch(/^\d{6}$/);
    const verify = await other.call('POST', '/v1/auth/otp/verify', { body: { phone: '087 444 1234', code: start.json.devCode } });
    expect(verify.status).toBe(200);
  });

  test('the app is told who runs the demo, for its privacy notice', async () => {
    expect((await h.call('GET', '/v1/config')).json.demo).toEqual({ operator: null });
    const named = await harness(db, { env: { ...demo, DEMO_OPERATOR: 'Example Ltd' } });
    expect((await named.call('GET', '/v1/config')).json.demo).toEqual({ operator: 'Example Ltd' });
    expect((await (await harness(db)).call('GET', '/v1/config')).json.demo).toBeNull();
  });

  test('demo accounts are deleted after a day without use', async () => {
    const ana = await rider(h, 'Ana');
    h.advance(23 * 60 * MIN);
    await h.rides.purgeOldData();
    expect((await db.query('SELECT 1 FROM users WHERE id = $1 AND deleted_at IS NULL', [ana.userId])).rowCount).toBe(1);
    h.advance(2 * 60 * MIN);
    await h.rides.purgeOldData();
    const { rows } = await db.query<{ phone: string | null; deleted_at: Date | null }>('SELECT phone, deleted_at FROM users WHERE id = $1', [ana.userId]);
    expect(rows[0]?.phone ?? null).toBeNull();
  });

  test('demo mode refuses live payments and can run with NODE_ENV=production', () => {
    const base = { DATABASE_URL: 'postgres://x', JWT_SECRET: 'a-secret-that-is-long-enough-for-hs256', TRUST_PROXY_HOPS: '1', ...demo };
    expect(loadConfig({ ...base, NODE_ENV: 'production' }).DEMO_MODE).toBe(true);
    expect(() => loadConfig({ ...base, PAYMENTS_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'sk_live_1', STRIPE_PUBLISHABLE_KEY: 'pk', STRIPE_WEBHOOK_SECRET: 'w' })).toThrow(/DEMO_MODE/);
    expect(() => loadConfig({ ...base, DEMO_MODE: 'false' })).toThrow(/OTP_PROVIDER=demo needs DEMO_MODE/);
  });
});
