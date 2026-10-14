import { CONFIG } from '@splitcab/core';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Db } from '../src/db';
import { handleGatewayEvent } from '../src/jobs/handlers';
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
      // NTA fares don't apply in Northern Ireland.
      [{ ...trip('stephens-green', 'dub'), destination: { label: 'Belfast', lat: 54.597, lng: -5.93 } }, 400, 'outside_service_area'],
      [trip('stephens-green', 'trinity'), 400, 'trip_too_short'],
      // A midday hop across Dublin can't save either rider €4, whoever they share with.
      [trip('temple-bar', 'rathmines'), 400, 'not_worth_sharing'],
      [trip('stephens-green', 'dub', { inMin: 61 * 24 * 60 }), 400, 'too_far_ahead'],
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

  test('starts looking only when the rider asks to, and records when they did', async () => {
    const ana = await rider(h, 'Ana');
    const { startNow: _, ...withoutConsent } = trip('stephens-green', 'dub');
    const refused = await h.call('POST', '/v1/trips', { token: ana.token, body: withoutConsent });
    expect(refused.status).toBe(400);
    expect(refused.json.error.message).toMatch(/start looking for a match straight away/);

    const t = await post(h, ana, trip('stephens-green', 'dub'));
    const { rows } = await db.query<{ start_now_at: Date }>('SELECT start_now_at FROM trips WHERE id = $1', [t.id]);
    expect(rows[0]!.start_now_at.getTime()).toBe(h.clock.now);
    const exported = await h.call('GET', '/v1/me/export', { token: ana.token });
    expect(exported.json.trips[0].start_now_at).toBeTruthy();
  });

  test('limits how many trips one person can post in a day', async () => {
    const ana = await rider(h, 'Ana');
    for (let i = 0; i < 20; i++) {
      const t = await post(h, ana, trip('stephens-green', 'dub', { inMin: 60 + i }));
      await h.call('POST', `/v1/trips/${t.id}/cancel`, { token: ana.token });
    }
    const res = await h.call('POST', '/v1/trips', { token: ana.token, body: trip('stephens-green', 'dub') });
    expect(res.status).toBe(429);
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
    expect(partnerStop.label).toBe('Trinity College area');
    expect(partnerStop.lat).toBeNull();
    // Both are going to the airport, so the shared drop-off is simply each person's own destination.
    for (const view of [av, await get(h, ben, b.id)]) expect(view.match!.plan.route.at(-1)!.label).toBe('Dublin Airport T1 (taxi rank)');
    expect(av.match!.plan.you.savings).toBeGreaterThan(0);
    expect(av.match!.plan.you.share + av.match!.plan.partner.share).toBe(av.match!.plan.fare);
    expect(h.push.sent.some((m) => m.to === 'ExponentPushToken[Ana]' && /found someone/.test(m.title))).toBe(false);
    await h.runJobs();
    expect(h.push.sent.filter((m) => /found someone/.test(m.title)).map((m) => m.to).sort()).toEqual(['ExponentPushToken[Ana]', 'ExponentPushToken[Ben]']);
    // Pickup is about an hour away, so they have until 45 minutes before it to answer.
    expect(h.push.sent.find((m) => /found someone/.test(m.title))!.body).toMatch(/^Ana is heading your way\. You have \d+ minutes to accept\.$|^Ben is heading your way\. You have \d+ minutes to accept\.$/);

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

  test('paying back: the person who owes gets the booker\'s Revtag, and saying they\'ve paid tells the booker', async () => {
    const ana = await rider(h, 'Ana');
    const ben = await rider(h, 'Ben');
    const a = await post(h, ana, trip('stephens-green', 'dub'));
    const b = await post(h, ben, trip('trinity', 'dub'));
    const matchId = b.match!.id;
    await h.call('POST', `/v1/matches/${matchId}/respond`, { token: ana.token, body: { accept: true } });
    await h.call('POST', `/v1/matches/${matchId}/respond`, { token: ben.token, body: { accept: true } });
    await h.runJobs();
    const booker = (await get(h, ana, a.id)).match!.youBook ? ana : ben;
    const payer = booker === ana ? ben : ana;
    const payerTrip = booker === ana ? b.id : a.id;
    await h.call('PATCH', '/v1/me', { token: booker.token, body: { revtag: '@Booker123' } });

    // Nothing to pay before the fare is in.
    expect((await h.call('POST', `/v1/matches/${matchId}/paid`, { token: payer.token })).json.error.code).toBe('not_settled');
    h.clock.now = Date.parse((await get(h, booker, booker === ana ? a.id : b.id)).match!.plan.startAt) + 60 * MIN;
    await refresh(h, ana);
    await refresh(h, ben);
    await h.call('POST', `/v1/matches/${matchId}/complete`, { token: booker.token, body: { actualFare: 3000 } });

    const owes = (await get(h, payer, payerTrip)).match!.settlement!;
    expect(owes).toMatchObject({ bookerRevtag: 'booker123', paidAt: null });
    expect(owes.youOwe).toBeGreaterThan(0);
    const bookerView = (await h.call('GET', '/v1/trips?scope=past', { token: booker.token })).json[0].match.settlement;
    expect(bookerView.bookerRevtag).toBeNull();

    expect((await h.call('POST', `/v1/matches/${matchId}/paid`, { token: booker.token })).status).toBe(403);
    const paid = await h.call('POST', `/v1/matches/${matchId}/paid`, { token: payer.token });
    expect(paid.json.match.settlement.paidAt).not.toBeNull();
    // Saying so twice doesn't notify twice.
    await h.call('POST', `/v1/matches/${matchId}/paid`, { token: payer.token });
    await h.runJobs();
    const name = booker === ana ? 'Ana' : 'Ben';
    expect(h.push.sent.filter((m) => m.title === 'Paid' && m.to === `ExponentPushToken[${name}]`)).toHaveLength(1);
    expect((await h.call('GET', '/v1/trips?scope=past', { token: booker.token })).json[0].match.settlement.paidAt).not.toBeNull();
  });

  test('when the fare is split, both riders get a receipt for their side', async () => {
    const ana = await rider(h, 'Ana');
    const ben = await rider(h, 'Ben');
    const eve = await rider(h, 'Eve');
    const a = await post(h, ana, trip('stephens-green', 'dub'));
    const b = await post(h, ben, trip('trinity', 'dub'));
    const matchId = b.match!.id;
    expect((await h.call('GET', `/v1/trips/${a.id}/receipt`, { token: ana.token })).json.error.code).toBe('no_receipt');
    await h.call('POST', `/v1/matches/${matchId}/respond`, { token: ana.token, body: { accept: true } });
    await h.call('POST', `/v1/matches/${matchId}/respond`, { token: ben.token, body: { accept: true } });
    await h.runJobs();
    const anaBooks = (await get(h, ana, a.id)).match!.youBook;
    const [booker, other, bookerTrip, otherTrip] = anaBooks ? [ana, ben, a.id, b.id] : [ben, ana, b.id, a.id];
    await h.call('POST', `/v1/matches/${matchId}/complete`, { token: booker.token, body: { actualFare: 3000 } });
    await h.runJobs();

    const mine = (await h.call('GET', `/v1/trips/${bookerTrip}/receipt`, { token: booker.token })).json;
    const theirs = (await h.call('GET', `/v1/trips/${otherTrip}/receipt`, { token: other.token })).json;
    expect(mine.fare.meterTotal).toBe(3000);
    expect(mine.fare.yourShare + mine.fare.partnerShare).toBe(3000);
    expect(theirs.fare.yourShare).toBe(mine.fare.partnerShare);
    expect(mine.ride.youBooked).toBe(true);
    expect(theirs.settleUp.youOwe).toBe(mine.settleUp.owedToYou);
    expect(mine.matchFee).toEqual({ amount: CONFIG.matchFee, status: 'captured' });
    expect(mine.number).toMatch(/^SC-[0-9A-F]{8}$/);
    expect(mine.merchant.name).toBe('SplitCab');
    // Only your own receipt.
    expect((await h.call('GET', `/v1/trips/${bookerTrip}/receipt`, { token: eve.token })).status).toBe(404);

    const titles = (name: string) => h.push.sent.filter((m) => m.to === `ExponentPushToken[${name}]`).map((m) => [m.title, m.body]);
    expect(titles(anaBooks ? 'Ana' : 'Ben')).toContainEqual(['Your receipt', expect.stringMatching(/owes you €/)]);
    expect(titles(anaBooks ? 'Ben' : 'Ana')).toContainEqual(['Fare split', expect.stringMatching(/Your receipt is in the app/)]);
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
    const proposed = (await get(h, ana, a.id)).match!;
    // Planned two hours ahead, so they have until 45 minutes before pickup to answer, not just 10 minutes.
    const expiresAt = Date.parse(proposed.expiresAt);
    const { plan } = (await db.query<{ plan: { startAt: number } }>('SELECT plan FROM matches WHERE id = $1', [proposed.id])).rows[0]!;
    expect(expiresAt).toBe(plan.startAt - CONFIG.accept.beforePickupMinutes * MIN);
    h.advance(expiresAt - h.clock.now - MIN);
    await h.rides.sweep();
    await refresh(h, ana);
    expect((await get(h, ana, a.id)).status).toBe('proposed');
    h.advance(2 * MIN);
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

  test('a shared meeting point stays hidden from the rider who walks to it until both accept', async () => {
    const ana = await rider(h, 'Ana');
    const ben = await rider(h, 'Ben');
    const a = await post(h, ana, trip('dub', 'stephens-green'));
    const b = await post(h, ben, trip('dub-t2', 'trinity'));
    expect(b.status).toBe('proposed');
    const shared = async (r: typeof ana, id: string) => (await get(h, r, id)).match!.plan.route.find((s) => s.kind === 'pickup' && s.you && s.partner)!;
    const stops = [await shared(ana, a.id), await shared(ben, b.id)];
    const hidden = stops.filter((s) => s.lat === null);
    expect(hidden).toHaveLength(1);
    expect(hidden[0]!.label).toMatch(/^Meeting point, about \d+ min walk$/);
  });

  test('once the pickup time has passed, a confirmed ride stays charged', async () => {
    const ana = await rider(h, 'Ana');
    const ben = await rider(h, 'Ben');
    const a = await post(h, ana, trip('stephens-green', 'dub'));
    const b = await post(h, ben, trip('trinity', 'dub'));
    await h.call('POST', `/v1/matches/${b.match!.id}/respond`, { token: ana.token, body: { accept: true } });
    await h.call('POST', `/v1/matches/${b.match!.id}/respond`, { token: ben.token, body: { accept: true } });
    await h.runJobs();
    h.clock.now = Date.parse((await get(h, ana, a.id)).match!.plan.startAt) + MIN;
    await refresh(h, ana);
    const cancel = await h.call('POST', `/v1/trips/${a.id}/cancel`, { token: ana.token });
    expect(cancel.json.error.code).toBe('pickup_passed');
    // Blocking still works, but after the ride it doesn't undo the fees.
    expect((await h.call('POST', `/v1/matches/${b.match!.id}/block`, { token: ana.token })).status).toBe(200);
    await h.runJobs();
    expect(await paymentStatus(a.payment!.id)).toBe('captured');
    expect(await paymentStatus(b.payment!.id)).toBe('captured');
  });

  test('a ride nobody settles closes itself six hours after the last drop-off', async () => {
    const ana = await rider(h, 'Ana');
    const ben = await rider(h, 'Ben');
    const a = await post(h, ana, trip('stephens-green', 'dub'));
    const b = await post(h, ben, trip('trinity', 'dub'));
    await h.call('POST', `/v1/matches/${b.match!.id}/respond`, { token: ana.token, body: { accept: true } });
    await h.call('POST', `/v1/matches/${b.match!.id}/respond`, { token: ben.token, body: { accept: true } });
    const lastStop = (await get(h, ana, a.id)).match!.plan.route.at(-1)!;
    h.clock.now = Date.parse(lastStop.at) + 6 * 60 * MIN - MIN;
    await h.rides.sweep();
    const statuses = async () => (await db.query('SELECT status FROM trips WHERE id = ANY($1) ORDER BY status', [[a.id, b.id]])).rows.map((r) => r.status);
    expect(await statuses()).toEqual(['confirmed', 'confirmed']);
    h.advance(2 * MIN);
    await h.rides.sweep();
    expect(await statuses()).toEqual(['completed', 'completed']);
    expect((await db.query('SELECT rides_completed FROM users WHERE id = $1', [ana.userId])).rows[0].rides_completed).toBe(1);
  });

  test('releasing a hold that was in fact captured refunds it instead', async () => {
    const ana = await rider(h, 'Ana');
    const a = await post(h, ana, trip('stephens-green', 'dub'));
    // A capture that reached Stripe but was never recorded here.
    const ref = (await db.query('SELECT provider_ref FROM payments WHERE id = $1', [a.payment!.id])).rows[0].provider_ref;
    await h.gateway.capture(ref);
    await h.call('POST', `/v1/trips/${a.id}/cancel`, { token: ana.token });
    await h.runJobs();
    expect(await paymentStatus(a.payment!.id)).toBe('refunded');
    expect(h.gateway.calls.map((c) => c.op)).toEqual(['authorize', 'capture', 'refund']);
  });

  test('a capture reported after the hold was released is refunded', async () => {
    const ana = await rider(h, 'Ana');
    const a = await post(h, ana, trip('stephens-green', 'dub'));
    await h.call('POST', `/v1/trips/${a.id}/cancel`, { token: ana.token });
    await h.runJobs();
    expect(await paymentStatus(a.payment!.id)).toBe('released');
    const ref = (await db.query('SELECT provider_ref FROM payments WHERE id = $1', [a.payment!.id])).rows[0].provider_ref;
    await handleGatewayEvent(h.deps, h.rides, { id: 'evt_late', type: 'payment.captured', ref });
    await h.runJobs();
    expect(await paymentStatus(a.payment!.id)).toBe('refunded');
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
    const riders = await Promise.all(Array.from({ length: 12 }, (_, i) => rider(h, `Rider ${'ABCDEFGHIJKL'[i]}`)));
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

  test('after a declined proposal, the same two people are not paired again for a day', async () => {
    const ana = await rider(h, 'Ana');
    const ben = await rider(h, 'Ben');
    await post(h, ana, trip('stephens-green', 'dub'));
    const b = await post(h, ben, trip('trinity', 'dub'));
    await h.call('POST', `/v1/matches/${b.match!.id}/respond`, { token: ana.token, body: { accept: false } });
    await h.call('POST', `/v1/trips/${b.id}/cancel`, { token: ben.token });
    // Reposting doesn't get Ben a fresh look at Ana's trip.
    const b2 = await post(h, ben, trip('trinity', 'dub', { inMin: 65 }));
    expect(b2.status).toBe('searching');
    const cara = await rider(h, 'Cara');
    expect((await post(h, cara, trip('temple-bar', 'dub'))).status).toBe('proposed');
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
