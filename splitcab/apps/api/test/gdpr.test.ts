import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Db } from '../src/db';
import { deleteUser, exportUser } from '../src/ops';
import { MIN, get, harness, post, refresh, resetDb, rider, testDb, trip, type Harness, type Rider } from './helpers';

let db: Db;
let h: Harness;
const DAY = 24 * 60 * MIN;

beforeAll(async () => {
  db = await testDb();
});
beforeEach(async () => {
  await resetDb(db);
  h = await harness(db);
});
afterAll(async () => {
  await db.end();
});

// Two riders share a ride, settle it, chat, rate and report, so every kind of record exists.
async function sharedRide(): Promise<{ ana: Rider; ben: Rider; matchId: string; tripIds: string[] }> {
  const ana = await rider(h, 'Ana');
  const ben = await rider(h, 'Ben');
  const a = await post(h, ana, trip('stephens-green', 'dub'));
  const b = await post(h, ben, trip('trinity', 'dub'));
  const matchId = b.match!.id;
  await h.call('POST', `/v1/matches/${matchId}/respond`, { token: ana.token, body: { accept: true } });
  await h.call('POST', `/v1/matches/${matchId}/respond`, { token: ben.token, body: { accept: true } });
  await h.runJobs();
  await h.call('POST', `/v1/matches/${matchId}/messages`, { token: ana.token, body: { text: 'See you at the gate' } });
  const booker = (await get(h, ana, a.id)).match!.youBook ? ana : ben;
  await h.call('POST', `/v1/matches/${matchId}/complete`, { token: booker.token, body: { actualFare: 3000 } });
  await h.call('POST', `/v1/matches/${matchId}/rating`, { token: ana.token, body: { stars: 5 } });
  await h.call('POST', `/v1/matches/${matchId}/report`, { token: ben.token, body: { reason: 'other', details: 'Was late' } });
  await h.runJobs();
  return { ana, ben, matchId, tripIds: [a.id, b.id] };
}

const count = async (table: string) => (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!.n;

describe('terms and privacy policy versions', () => {
  test('a new version is put to people before their next trip, and their agreement is recorded', async () => {
    const ana = await rider(h, 'Ana');
    const updated = await harness(db, { env: { TERMS_VERSION: '2027-01-01' } });
    updated.clock.now = h.clock.now;
    const me = (await updated.call('GET', '/v1/me', { token: ana.token })).json;
    expect(me).toMatchObject({ profileComplete: false, termsUpdated: true });
    expect((await updated.call('POST', '/v1/trips', { token: ana.token, body: trip('stephens-green', 'dub') })).json.error.code).toBe('terms_updated');

    const accepted = await updated.call('PATCH', '/v1/me', { token: ana.token, body: { acceptTerms: true } });
    expect(accepted.json).toMatchObject({ profileComplete: true, termsUpdated: false });
    expect((await updated.call('GET', '/v1/me/export', { token: ana.token })).json.profile.termsVersion).toBe('2027-01-01');
  });
});

describe('storage limitation', () => {
  test('use of the app is noted at most once a day', async () => {
    const ana = await rider(h, 'Ana');
    h.advance(3 * DAY);
    await refresh(h, ana);
    await h.call('GET', '/v1/me', { token: ana.token });
    const { rows } = await db.query<{ last_active_at: Date }>('SELECT last_active_at FROM users WHERE id = $1', [ana.userId]);
    expect(rows[0]!.last_active_at.getTime()).toBe(h.clock.now);
  });

  test('after a year, exact pickup and drop-off places become a rough area, in trips and ride plans', async () => {
    const { matchId, tripIds } = await sharedRide();
    h.advance(364 * DAY);
    await h.rides.purgeOldData();
    expect((await db.query('SELECT origin_label FROM trips WHERE id = $1', [tripIds[0]])).rows[0].origin_label).toBe("St Stephen's Green");

    h.advance(2 * DAY);
    await h.rides.purgeOldData();
    const trips = (await db.query('SELECT id, origin_label, dest_label, origin_lat, blurred_at FROM trips WHERE id = ANY($1) ORDER BY origin_label', [tripIds])).rows;
    expect(trips.map((t) => [t.origin_label, t.dest_label])).toEqual([
      ["St Stephen's Green area", 'Dublin Airport T1 area'],
      ['Trinity College area', 'Dublin Airport T1 area'],
    ]);
    for (const t of trips) {
      expect(Math.abs(t.origin_lat * 100 - Math.round(t.origin_lat * 100))).toBeLessThan(1e-6);
      expect(t.blurred_at).not.toBeNull();
    }
    const plan = (await db.query('SELECT plan FROM matches WHERE id = $1', [matchId])).rows[0].plan;
    expect(plan.route.map((s: { label: string }) => s.label).every((l: string) => l.endsWith(' area'))).toBe(true);
    expect((await db.query('SELECT count(*)::int AS n FROM messages')).rows[0].n).toBe(0);
  });

  test('safety report details are cleared after two years', async () => {
    await sharedRide();
    h.advance(2 * 365 * DAY + DAY);
    await h.rides.purgeOldData();
    const { rows } = await db.query('SELECT reason, details FROM reports');
    expect(rows).toEqual([{ reason: 'other', details: null }]);
  });

  test('accounts unused for two years are deleted; active ones stay', async () => {
    const ana = await rider(h, 'Ana');
    h.advance(2 * 365 * DAY - 2 * DAY);
    const ben = await rider(h, 'Ben');
    h.advance(3 * DAY);
    await h.rides.purgeOldData();
    const { rows } = await db.query<{ id: string; phone: string | null; deleted_at: Date | null }>('SELECT id, phone, deleted_at FROM users');
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(ana.userId)).toMatchObject({ phone: null });
    expect(byId.get(ana.userId)!.deleted_at).not.toBeNull();
    expect(byId.get(ben.userId)!.deleted_at).toBeNull();
  });

  test('trip, payment and receipt records are deleted after six years', async () => {
    await sharedRide();
    expect(await count('payments')).toBe(2);
    h.advance(6 * 365 * DAY);
    await h.rides.purgeOldData();
    expect(await count('trips')).toBe(2);

    h.advance(5 * DAY);
    await h.rides.purgeOldData();
    for (const table of ['trips', 'matches', 'payments', 'payment_events', 'ratings', 'messages', 'reports']) {
      expect(await count(table), table).toBe(0);
    }
    // Both accounts went unused for years, so they were deleted too. The deleted rows (no name, number or card)
    // go six years after deletion.
    expect((await db.query('SELECT count(*)::int AS n FROM users WHERE deleted_at IS NULL')).rows[0].n).toBe(0);
  });
});

describe('requests made by email', () => {
  test('support can export or delete one person\'s data by phone number', async () => {
    const ana = await rider(h, 'Ana');
    const data = (await exportUser(h, '087 123 ' + ana.phone.slice(-4))) as { profile: { phone: string; firstName: string } };
    expect(data.profile).toMatchObject({ phone: ana.phone, firstName: 'Ana' });
    await deleteUser(h, ana.phone);
    expect((await h.call('GET', '/v1/me', { token: ana.token })).status).toBe(401);
    await expect(exportUser(h, ana.phone)).rejects.toThrow(/No account/);
  });
});
