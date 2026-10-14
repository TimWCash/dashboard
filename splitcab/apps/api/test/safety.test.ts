import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Db } from '../src/db';
import { openReports, suspendUser, unsuspendUser } from '../src/ops';
import { get, harness, post, resetDb, rider, testDb, trip, type Harness, type Rider } from './helpers';

let db: Db;
let h: Harness;

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

const paymentStatus = async (paymentId: string) =>
  (await db.query<{ status: string }>('SELECT status FROM payments WHERE id = $1', [paymentId])).rows[0]!.status;

// Two riders who've both accepted a shared taxi. Returns the match and each rider's trip.
async function shared(x: Rider, xFrom: string, y: Rider, yFrom: string, inMin: number) {
  const tx = await post(h, x, trip(xFrom, 'dub', { inMin }));
  const ty = await post(h, y, trip(yFrom, 'dub', { inMin }));
  const matchId = ty.match!.id;
  for (const r of [x, y]) expect((await h.call('POST', `/v1/matches/${matchId}/respond`, { token: r.token, body: { accept: true } })).status).toBe(200);
  await h.runJobs();
  return { matchId, tx, ty };
}

const report = (r: Rider, matchId: string, reason: string, details?: string) =>
  h.call('POST', `/v1/matches/${matchId}/report`, { token: r.token, body: { reason, details } });

const paused = async (r: Rider) => (await h.call('GET', '/v1/me', { token: r.token })).json.paused as boolean;

describe('safety reports', () => {
  test('every report is announced straight away, without names, numbers or what was written', async () => {
    const ana = await rider(h, 'Ana');
    const ben = await rider(h, 'Ben');
    const { matchId } = await shared(ana, 'stephens-green', ben, 'trinity', 60);
    expect((await report(ana, matchId, 'harassment', 'Kept texting me about where I live')).status).toBe(204);
    await h.runJobs();
    expect(h.alerts.sent).toHaveLength(1);
    const alert = h.alerts.sent[0]!;
    expect(alert).toMatch(/^New safety report \([0-9a-f]{8}\): harassment or abusive messages\. See it with: npm run ops/);
    for (const secret of ['Ana', 'Ben', ana.phone, ben.phone, 'texting']) expect(alert).not.toContain(secret);
    // One report on its own doesn't pause anyone.
    expect(await paused(ben)).toBe(false);
  });

  test('reports from two different people pause the account: no new trips, matches or messages', async () => {
    const ana = await rider(h, 'Ana');
    const ben = await rider(h, 'Ben');
    const cara = await rider(h, 'Cara');

    // Ben shares a taxi with Ana, and the ride is settled.
    const first = await shared(ana, 'stephens-green', ben, 'trinity', 60);
    const booker = (await get(h, ana, first.tx.id)).match!.youBook ? ana : ben;
    expect((await h.call('POST', `/v1/matches/${first.matchId}/complete`, { token: booker.token, body: { actualFare: 2600 } })).status).toBe(200);
    await report(ana, first.matchId, 'unsafe');

    // Ben has a ride with Cara this evening and a trip tomorrow still searching.
    const second = await shared(ben, 'trinity', cara, 'temple-bar', 600);
    const tomorrow = await post(h, ben, trip('trinity', 'dub', { inMin: 1500 }));
    expect(tomorrow.status).toBe('searching');
    expect(await paused(ben)).toBe(false);

    await report(cara, second.matchId, 'harassment');
    await h.runJobs();
    expect(await paused(ben)).toBe(true);

    // The ride that hasn't happened is cancelled and both fees refunded; Cara looks for someone else.
    expect(await paymentStatus(second.tx.payment!.id)).toBe('refunded');
    expect(await paymentStatus(second.ty.payment!.id)).toBe('refunded');
    expect((await get(h, cara, second.ty.id)).status).toBe('searching');
    // His other trip is cancelled and its hold released.
    expect((await get(h, ben, tomorrow.id)).status).toBe('cancelled');
    expect(await paymentStatus(tomorrow.payment!.id)).toBe('released');
    // The settled ride stays settled.
    expect((await get(h, ben, first.ty.id)).status).toBe('completed');

    const posting = await h.call('POST', '/v1/trips', { token: ben.token, body: trip('trinity', 'dub', { inMin: 2000 }) });
    expect(posting.status).toBe(403);
    expect(posting.json.error.code).toBe('account_paused');
    expect(posting.json.error.message).toContain('support@splitcab.ie');
    const message = await h.call('POST', `/v1/matches/${first.matchId}/messages`, { token: ben.token, body: { text: 'hello' } });
    expect(message.json.error.code).toBe('account_paused');
    // Nobody is matched with him while he's paused.
    const dan = await rider(h, 'Dan');
    expect((await post(h, dan, trip('temple-bar', 'dub', { inMin: 1500 }))).status).toBe('searching');

    expect(h.alerts.sent.at(-1)).toMatch(/2 people have open reports about this account\. The account is paused\./);
    // He can still see his data, including that he's paused.
    expect((await h.call('GET', '/v1/me/export', { token: ben.token })).json.profile.pausedAt).toBeTruthy();
  });

  test('one person reporting again and again, or someone never accepted, does not pause anyone', async () => {
    const ana = await rider(h, 'Ana');
    const ben = await rider(h, 'Ben');
    const { matchId } = await shared(ana, 'stephens-green', ben, 'trinity', 60);
    for (let i = 0; i < 3; i++) await report(ana, matchId, 'unsafe');
    // Dan was only ever proposed to Ben; neither of them accepted.
    const dan = await rider(h, 'Dan');
    const later = await post(h, ben, trip('trinity', 'dub', { inMin: 600 }));
    const d = await post(h, dan, trip('temple-bar', 'dub', { inMin: 600 }));
    expect(d.match?.id).toBeTruthy();
    await report(dan, d.match!.id, 'unsafe');
    expect(await paused(ben)).toBe(false);
    expect((await get(h, ben, later.id)).status).toBe('proposed');
  });

  test('deleting a paused account and signing up again with the same number keeps the pause', async () => {
    const ben = await rider(h, 'Ben');
    await suspendUser(h, ben.phone, 'Looking into reports');
    expect((await h.call('DELETE', '/v1/me', { token: ben.token })).status).toBe(204);
    const { rows } = await db.query('SELECT phone_hash FROM paused_numbers');
    expect(rows).toHaveLength(1);
    expect(rows[0].phone_hash).not.toContain(ben.phone.replace('+', ''));

    const start = await h.call('POST', '/v1/auth/otp/start', { body: { phone: ben.phone } });
    const again = await h.call('POST', '/v1/auth/otp/verify', { body: { phone: ben.phone, code: start.json.devCode } });
    expect(again.json.user.paused).toBe(true);
    // Someone else signing up isn't affected.
    expect(await paused(await rider(h, 'Cara'))).toBe(false);
  });

  test('support can pause someone by hand, list open reports and lift the pause', async () => {
    const ana = await rider(h, 'Ana');
    const ben = await rider(h, 'Ben');
    const { matchId } = await shared(ana, 'stephens-green', ben, 'trinity', 60);
    await report(ana, matchId, 'payment', 'Never paid me back');

    const open = await openReports(h);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ reason: 'payment', details: 'Never paid me back', reportedPaused: false, openReportsAboutThem: 1 });
    expect(open[0]!.reported).toContain('Ben');

    await suspendUser(h, ben.phone, 'Looking into a payment report');
    expect(await paused(ben)).toBe(true);
    expect((await openReports(h))[0]!.reportedPaused).toBe(true);

    await unsuspendUser(h, ben.phone);
    expect(await paused(ben)).toBe(false);
    expect(await openReports(h)).toHaveLength(0);
    expect((await post(h, ben, trip('trinity', 'dub', { inMin: 600 }))).status).toBe('searching');
  });
});
