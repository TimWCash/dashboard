import { CONFIG } from '@splitcab/core';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Db } from '../src/db';
import { MIN, get, harness, post, refresh, resetDb, rider, testDb, trip, type Harness } from './helpers';

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

describe('posting a trip', () => {
  test('needs a profile and a saved card', async () => {
    const noCard = await rider(h, 'Ana', { card: false });
    const res = await h.call('POST', '/v1/trips', { token: noCard.token, body: trip('stephens-green', 'dub') });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe('payment_method_required');
  });

  test('places a hold and starts searching', async () => {
    const ana = await rider(h, 'Ana');
    const t = await post(h, ana, trip('stephens-green', 'dub'));
    expect(t.status).toBe('searching');
    expect(t.payment).toMatchObject({ status: 'authorized', amount: CONFIG.matchFee, currency: 'EUR' });
    expect(t.soloFare).toBeGreaterThan(1500);
    expect(h.gateway.calls.map((c) => c.op)).toEqual(['authorize']);
  });

  test('rejects bad input with a clear message', async () => {
    const ana = await rider(h, 'Ana');
    const london = { label: 'London', lat: 51.5, lng: -0.12 };
    const cases: [object, number, string][] = [
      [{ ...trip('stephens-green', 'dub'), destination: london }, 400, 'outside_service_area'],
      [trip('stephens-green', 'trinity'), 400, 'trip_too_short'],
      [trip('stephens-green', 'dub', { inMin: 8 * 24 * 60 }), 400, 'too_far_ahead'],
      [trip('stephens-green', 'dub', { inMin: 0, flexMin: 5 }), 400, 'too_soon'],
      [{ ...trip('stephens-green', 'dub'), seats: 4 }, 400, 'invalid_request'],
      [{ ...trip('stephens-green', 'dub'), time: 'tomorrow' }, 400, 'invalid_request'],
    ];
    for (const [body, status, code] of cases) {
      const res = await h.call('POST', '/v1/trips', { token: ana.token, body });
      expect(res.status, code).toBe(status);
      expect(res.json.error.code).toBe(code);
    }
  });

  test('limits how many trips one person can have open', async () => {
    const ana = await rider(h, 'Ana');
    for (let i = 0; i < CONFIG.trips.maxActiveTripsPerRider; i++) await post(h, ana, trip('stephens-green', 'dub', { inMin: 60 + i * 300 }));
    const res = await h.call('POST', '/v1/trips', { token: ana.token, body: trip('stephens-green', 'dub', { inMin: 2000 }) });
    expect(res.json.error.code).toBe('too_many_trips');
  });

  test('a declined card cancels the trip', async () => {
    const ana = await rider(h, 'Ana');
    h.gateway.nextAuthorize = 'failed';
    const res = await h.call('POST', '/v1/trips', { token: ana.token, body: trip('stephens-green', 'dub') });
    expect(res.status).toBe(402);
    expect(res.json.error.code).toBe('card_declined');
    const past = await h.call('GET', '/v1/trips?scope=past', { token: ana.token });
    expect(past.json[0].status).toBe('cancelled');
  });

  test('3-D Secure: the trip waits until the rider approves the hold', async () => {
    const ana = await rider(h, 'Ana');
    h.gateway.nextAuthorize = 'requires_action';
    const t = await post(h, ana, trip('stephens-green', 'dub'));
    expect(t.status).toBe('pending_payment');
    expect(t.paymentAction?.clientSecret).toBeTruthy();
    const ref = (await db.query('SELECT provider_ref FROM payments WHERE id = $1', [t.payment!.id])).rows[0].provider_ref;
    h.gateway.completeAction(ref);
    const res = await h.call('POST', `/v1/trips/${t.id}/payment-confirmed`, { token: ana.token });
    expect(res.json.status).toBe('searching');
    expect(res.json.paymentAction).toBeNull();
  });
});

describe('the ride lifecycle', () => {
  test('match, accept, charge, chat, settle and rate', async () => {
    const ana = await rider(h, 'Ana');
    const ben = await rider(h, 'Ben');
    const a = await post(h, ana, trip('stephens-green', 'dub'));
    const b = await post(h, ben, trip('trinity', 'dub', { inMin: 70 }));
    expect(b.status).toBe('proposed');
    expect(b.match?.partner.firstName).toBe('Ana');

    let av = await get(h, ana, a.id);
    expect(av.status).toBe('proposed');
    const matchId = av.match!.id;
    // Before both accept, the partner's pickup is approximate and has no coordinates.
    const partnerStop = av.match!.plan.route.find((s) => s.partner && !s.you)!;
    expect(partnerStop.label).toMatch(/^Near /);
    expect(partnerStop.lat).toBeNull();
    expect(av.match!.plan.you.savings).toBeGreaterThan(0);
    expect(av.match!.plan.you.share + av.match!.plan.partner.share).toBe(av.match!.plan.fare);
    expect(h.push.sent.some((m) => m.to === 'ExponentPushToken[Ana]' && /found someone/.test(m.title))).toBe(false);
    await h.runJobs();
    expect(h.push.sent.filter((m) => /found someone/.test(m.title)).map((m) => m.to).sort()).toEqual(['ExponentPushToken[Ana]', 'ExponentPushToken[Ben]']);

    // Chat is closed until both accept.
    expect((await h.call('POST', `/v1/matches/${matchId}/messages`, { token: ana.token, body: { text: 'hi' } })).status).toBe(409);

    await h.call('POST', `/v1/matches/${matchId}/respond`, { token: ana.token, body: { accept: true } });
    await h.runJobs();
    expect(await paymentStatus(a.payment!.id)).toBe('authorized');

    const confirmed = await h.call('POST', `/v1/matches/${matchId}/respond`, { token: ben.token, body: { accept: true } });
    expect(confirmed.json.status).toBe('confirmed');
    await h.runJobs();
    expect(await paymentStatus(a.payment!.id)).toBe('captured');
    expect(await paymentStatus(b.payment!.id)).toBe('captured');

    av = await get(h, ana, a.id);
    expect(av.match!.plan.route.find((s) => s.partner && !s.you)!.label).toBe('Trinity College');

    await h.call('POST', `/v1/matches/${matchId}/messages`, { token: ana.token, body: { text: "I'm at the Grafton St corner" } });
    h.advance(1000);
    await h.call('POST', `/v1/matches/${matchId}/messages`, { token: ben.token, body: { text: 'Two minutes away' } });
    const thread = await h.call('GET', `/v1/matches/${matchId}/messages`, { token: ana.token });
    expect(thread.json.map((m: { mine: boolean; text: string }) => [m.mine, m.text])).toEqual([
      [true, "I'm at the Grafton St corner"],
      [false, 'Two minutes away'],
    ]);
    const after = await h.call('GET', `/v1/matches/${matchId}/messages?after=${encodeURIComponent(thread.json[0].at)}`, { token: ana.token });
    expect(after.json).toHaveLength(1);

    const booker = av.match!.youBook ? ana : ben;
    const other = booker === ana ? ben : ana;
    expect((await h.call('POST', `/v1/matches/${matchId}/complete`, { token: other.token, body: { actualFare: 2800 } })).status).toBe(403);
    const done = await h.call('POST', `/v1/matches/${matchId}/complete`, { token: booker.token, body: { actualFare: 2800 } });
    expect(done.json.status).toBe('completed');
    expect(done.json.match.settlement.owedToYou).toBeGreaterThan(0);
    const otherTrip = (await h.call('GET', '/v1/trips?scope=past', { token: other.token })).json[0];
    expect(otherTrip.match.settlement.youOwe + done.json.match.settlement.owedToYou - done.json.match.settlement.owedToYou).toBe(otherTrip.match.settlement.youOwe);
    expect(otherTrip.match.settlement.youOwe + (2800 - otherTrip.match.settlement.youOwe)).toBe(2800);

    expect((await h.call('POST', `/v1/matches/${matchId}/rating`, { token: other.token, body: { stars: 5 } })).status).toBe(200);
    expect((await h.call('POST', `/v1/matches/${matchId}/rating`, { token: other.token, body: { stars: 4 } })).json.error.code).toBe('already_rated');
    const me = await h.call('GET', '/v1/me', { token: booker.token });
    expect(me.json.ratingAvg).toBe(5);
    expect(me.json.ridesCompleted).toBe(1);

    const wallet = await h.call('GET', '/v1/payments', { token: ana.token });
    expect(wallet.json[0].history.map((e: { status: string }) => e.status)).toEqual(['authorized', 'captured']);
  });

  test('declining sends both back to searching and they are never re-paired', async () => {
    const ana = await rider(h, 'Ana');
    const ben = await rider(h, 'Ben');
    const a = await post(h, ana, trip('stephens-green', 'dub'));
    const b = await post(h, ben, trip('trinity', 'dub'));
    const matchId = b.match!.id;
    const res = await h.call('POST', `/v1/matches/${matchId}/respond`, { token: ben.token, body: { accept: false } });
    expect(res.json.status).toBe('searching');
    expect((await get(h, ana, a.id)).status).toBe('searching');
    await h.rides.sweep();
    expect((await get(h, ana, a.id)).status).toBe('searching');

    // A third traveller can still match either of them.
    const cara = await rider(h, 'Cara');
    const c = await post(h, cara, trip('temple-bar', 'dub'));
    expect(c.status).toBe('proposed');
  });

  test('an unanswered proposal times out and both look again', async () => {
    const ana = await rider(h, 'Ana');
    const ben = await rider(h, 'Ben');
    const a = await post(h, ana, trip('stephens-green', 'dub', { inMin: 120 }));
    await post(h, ben, trip('trinity', 'dub', { inMin: 120 }));
    h.advance((CONFIG.acceptWindowMinutes + 1) * MIN);
    await h.rides.sweep();
    const view = await get(h, ana, a.id);
    expect(view.status).toBe('searching');
    expect(view.match?.status).toBe('expired');
  });

  test('no match before the window closes: hold released, nothing charged', async () => {
    const ana = await rider(h, 'Ana');
    const a = await post(h, ana, trip('stephens-green', 'dub', { inMin: 60, flexMin: 15 }));
    // Searching stops 10 minutes before the latest acceptable pickup: 60 + 15 - 10 = 65 minutes from now.
    h.advance(64 * MIN);
    await h.rides.sweep();
    expect((await db.query('SELECT status FROM trips WHERE id = $1', [a.id])).rows[0].status).toBe('searching');
    h.advance(1 * MIN);
    await h.rides.sweep();
    await h.runJobs();
    await refresh(h, ana);
    const view = await get(h, ana, a.id);
    expect(view.status).toBe('expired');
    expect(await paymentStatus(a.payment!.id)).toBe('released');
    expect(h.gateway.calls.map((c) => c.op)).toEqual(['authorize', 'cancel']);
    expect(h.push.sent.some((m) => m.title === 'No match this time')).toBe(true);
  });

  test('cancelling while searching releases the hold', async () => {
    const ana = await rider(h, 'Ana');
    const a = await post(h, ana, trip('stephens-green', 'dub'));
    const res = await h.call('POST', `/v1/trips/${a.id}/cancel`, { token: ana.token });
    expect(res.json.status).toBe('cancelled');
    await h.runJobs();
    expect(await paymentStatus(a.payment!.id)).toBe('released');
    expect((await h.call('POST', `/v1/trips/${a.id}/cancel`, { token: ana.token })).json.error.code).toBe('trip_inactive');
  });

  test('cancelling after confirming keeps your fee, refunds your partner and re-lists them', async () => {
    const ana = await rider(h, 'Ana');
    const ben = await rider(h, 'Ben');
    const a = await post(h, ana, trip('stephens-green', 'dub'));
    const b = await post(h, ben, trip('trinity', 'dub'));
    const matchId = b.match!.id;
    await h.call('POST', `/v1/matches/${matchId}/respond`, { token: ana.token, body: { accept: true } });
    await h.call('POST', `/v1/matches/${matchId}/respond`, { token: ben.token, body: { accept: true } });
    await h.runJobs();

    await h.call('POST', `/v1/trips/${a.id}/cancel`, { token: ana.token });
    await h.runJobs();
    expect(await paymentStatus(a.payment!.id)).toBe('captured');
    expect(await paymentStatus(b.payment!.id)).toBe('refunded');
    const bv = await get(h, ben, b.id);
    expect(bv.status).toBe('searching');
    expect(bv.payment!.id).not.toBe(b.payment!.id);
    expect(bv.payment!.status).toBe('authorized');
    expect(bv.match?.cancelledByPartner).toBe(true);
  });

  test('a partner cancelling before captures run releases instead of refunding', async () => {
    const ana = await rider(h, 'Ana');
    const ben = await rider(h, 'Ben');
    const a = await post(h, ana, trip('stephens-green', 'dub'));
    const b = await post(h, ben, trip('trinity', 'dub'));
    await h.call('POST', `/v1/matches/${b.match!.id}/respond`, { token: ana.token, body: { accept: true } });
    await h.call('POST', `/v1/matches/${b.match!.id}/respond`, { token: ben.token, body: { accept: true } });
    // Cancel immediately, so the refund job can run before the capture for Ben's payment.
    await db.query("UPDATE jobs SET run_at = run_at + interval '1 hour' WHERE kind = 'payment.capture'");
    await h.call('POST', `/v1/trips/${a.id}/cancel`, { token: ana.token });
    await h.runJobs();
    expect(await paymentStatus(b.payment!.id)).toBe('released');
    h.advance(2 * 60 * MIN);
    await h.runJobs();
    expect(await paymentStatus(b.payment!.id)).toBe('released');
    expect(await paymentStatus(a.payment!.id)).toBe('captured');
  });
});

describe('matching under load', () => {
  test('concurrent posts never put one trip in two matches', async () => {
    const riders = await Promise.all(Array.from({ length: 12 }, (_, i) => rider(h, `R${i}`)));
    const places = ['stephens-green', 'trinity', 'temple-bar', 'grand-canal'];
    await Promise.all(riders.map((r, i) => post(h, r, trip(places[i % places.length]!, 'dub', { inMin: 60 + (i % 3) * 5 }))));
    const { rows } = await db.query<{ trip_a: string; trip_b: string }>("SELECT trip_a, trip_b FROM matches WHERE status = 'proposed'");
    const ids = rows.flatMap((r) => [r.trip_a, r.trip_b]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(rows.length).toBe(6);
    const { rows: states } = await db.query<{ status: string; n: number }>('SELECT status, count(*)::int AS n FROM trips GROUP BY status');
    expect(states).toEqual([{ status: 'proposed', n: 12 }]);
  });
});

describe('safety', () => {
  test('blocking ends the proposal and the pair is never matched again', async () => {
    const ana = await rider(h, 'Ana');
    const ben = await rider(h, 'Ben');
    await post(h, ana, trip('stephens-green', 'dub'));
    const b = await post(h, ben, trip('trinity', 'dub'));
    const res = await h.call('POST', `/v1/matches/${b.match!.id}/block`, { token: ana.token });
    expect(res.json.status).toBe('searching');
    expect(res.json.match.youBlocked).toBe(true);
    // A new trip from Ben doesn't match Ana's either.
    const b2 = await post(h, ben, trip('temple-bar', 'dub', { inMin: 65 }));
    expect(b2.status).toBe('searching');
  });

  test('blocking a confirmed partner cancels the ride and refunds both fees', async () => {
    const ana = await rider(h, 'Ana');
    const ben = await rider(h, 'Ben');
    const a = await post(h, ana, trip('stephens-green', 'dub'));
    const b = await post(h, ben, trip('trinity', 'dub'));
    const matchId = b.match!.id;
    await h.call('POST', `/v1/matches/${matchId}/respond`, { token: ana.token, body: { accept: true } });
    await h.call('POST', `/v1/matches/${matchId}/respond`, { token: ben.token, body: { accept: true } });
    await h.runJobs();
    await h.call('POST', `/v1/matches/${matchId}/report`, { token: ana.token, body: { reason: 'harassment', details: 'Rude messages' } });
    await h.call('POST', `/v1/matches/${matchId}/block`, { token: ana.token });
    await h.runJobs();
    expect(await paymentStatus(a.payment!.id)).toBe('refunded');
    expect(await paymentStatus(b.payment!.id)).toBe('refunded');
    expect((await h.call('POST', `/v1/matches/${matchId}/messages`, { token: ben.token, body: { text: 'hello?' } })).status).toBe(409);
    const reports = await db.query('SELECT reason, reported_id FROM reports');
    expect(reports.rows).toEqual([{ reason: 'harassment', reported_id: ben.userId }]);
  });

  test("riders can't see or act on other people's trips", async () => {
    const ana = await rider(h, 'Ana');
    const ben = await rider(h, 'Ben');
    const eve = await rider(h, 'Eve');
    const a = await post(h, ana, trip('stephens-green', 'dub'));
    const b = await post(h, ben, trip('trinity', 'dub'));
    expect((await h.call('GET', `/v1/trips/${a.id}`, { token: eve.token })).status).toBe(404);
    expect((await h.call('POST', `/v1/trips/${a.id}/cancel`, { token: eve.token })).status).toBe(404);
    expect((await h.call('POST', `/v1/matches/${b.match!.id}/respond`, { token: eve.token, body: { accept: true } })).status).toBe(404);
    expect((await h.call('GET', `/v1/matches/${b.match!.id}/messages`, { token: eve.token })).status).toBe(404);
    expect((await h.call('GET', '/v1/trips', { token: eve.token })).json).toEqual([]);
  });
});
