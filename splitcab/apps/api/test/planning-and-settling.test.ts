import { CONFIG } from '@splitcab/core';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Db } from '../src/db';
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

const paymentStatus = async (paymentId: string) =>
  (await db.query<{ status: string }>('SELECT status FROM payments WHERE id = $1', [paymentId])).rows[0]!.status;
const pushesTo = (r: Rider, title: RegExp) => h.push.sent.filter((m) => m.to === `ExponentPushToken[${nameOf.get(r)}]` && title.test(m.title));
const nameOf = new Map<Rider, string>();
async function person(name: string) {
  const r = await rider(h, name);
  nameOf.set(r, name);
  return r;
}

// Two people who have both accepted a shared taxi to the airport.
async function sharedRide(inMin = 60) {
  const ana = await person('Ana');
  const ben = await person('Ben');
  const a = await post(h, ana, trip('stephens-green', 'dub', { inMin }));
  const b = await post(h, ben, trip('trinity', 'dub', { inMin }));
  const matchId = b.match!.id;
  for (const r of [ana, ben]) await h.call('POST', `/v1/matches/${matchId}/respond`, { token: r.token, body: { accept: true } });
  await h.runJobs();
  const plan = (await db.query('SELECT plan, booker_trip_id FROM matches WHERE id = $1', [matchId])).rows[0];
  const anaBooks = plan.booker_trip_id === a.id;
  return { ana, ben, a, b, matchId, plan: plan.plan, booker: anaBooks ? ana : ben, partner: anaBooks ? ben : ana, bookerTrip: anaBooks ? a : b, partnerTrip: anaBooks ? b : a };
}

describe('planning weeks ahead', () => {
  test('a trip more than 6 days away is saved, then starts searching with its hold 6 days before', async () => {
    const ana = await person('Ana');
    const t = await post(h, ana, trip('stephens-green', 'dub', { inMin: 20 * 24 * 60 }));
    expect(t.status).toBe('scheduled');
    expect(t.payment).toBeNull();
    expect(Date.parse(t.searchFrom!)).toBe(Date.parse(t.time) - CONFIG.trips.maxDaysAhead * DAY);
    expect(h.gateway.calls).toEqual([]);
    expect((await h.call('GET', '/v1/trips?scope=active', { token: ana.token })).json.map((x: { id: string }) => x.id)).toEqual([t.id]);

    // Nothing happens until the search opens.
    h.clock.now = Date.parse(t.searchFrom!) - MIN;
    await h.rides.sweep();
    await h.runJobs();
    await refresh(h, ana);
    expect((await get(h, ana, t.id)).status).toBe('scheduled');

    h.advance(2 * MIN);
    await h.rides.sweep();
    await h.runJobs();
    const opened = await get(h, ana, t.id);
    expect(opened.status).toBe('searching');
    expect(opened.payment?.status).toBe('authorized');
    expect(pushesTo(ana, /Looking for someone/)).toHaveLength(1);

    // From then on it matches like any other trip, and the hold is captured well within its 7 days.
    const ben = await person('Ben');
    const b = await post(h, ben, trip('trinity', 'dub', { inMin: 20 * 24 * 60 }));
    expect(b.status).toBe('proposed');
  });

  test('a planned trip can be cancelled before its search starts, with nothing to release', async () => {
    const ana = await person('Ana');
    const t = await post(h, ana, trip('stephens-green', 'dub', { inMin: 10 * 24 * 60 }));
    const res = await h.call('POST', `/v1/trips/${t.id}/cancel`, { token: ana.token });
    expect(res.json.status).toBe('cancelled');
    h.clock.now = Date.parse(t.searchFrom!) + MIN;
    await h.rides.sweep();
    await h.runJobs();
    expect(h.gateway.calls).toEqual([]);
  });

  test('when the bank wants to approve a planned hold, the rider gets a day to do it', async () => {
    const ana = await person('Ana');
    const t = await post(h, ana, trip('stephens-green', 'dub', { inMin: 10 * 24 * 60 }));
    h.clock.now = Date.parse(t.searchFrom!) + MIN;
    h.gateway.nextAuthorize = 'requires_action';
    await h.rides.sweep();
    await h.runJobs();
    await refresh(h, ana);
    expect((await get(h, ana, t.id)).paymentAction).toBeTruthy();
    expect(pushesTo(ana, /Confirm your card/)).toHaveLength(1);
    h.advance(2 * 60 * MIN);
    await h.rides.sweep();
    await refresh(h, ana);
    expect((await get(h, ana, t.id)).status).toBe('pending_payment');
    h.advance(23 * 60 * MIN);
    await h.rides.sweep();
    await refresh(h, ana);
    expect((await get(h, ana, t.id)).status).toBe('cancelled');
  });

  test('plans more than 60 days ahead are refused', async () => {
    const ana = await person('Ana');
    const res = await h.call('POST', '/v1/trips', { token: ana.token, body: trip('stephens-green', 'dub', { inMin: 61 * 24 * 60 }) });
    expect(res.json.error.code).toBe('too_far_ahead');
    expect(res.json.error.message).toMatch(/60 days/);
  });
});

describe('answering a match', () => {
  test('a match is never offered with less than five minutes to answer it', async () => {
    const ana = await person('Ana');
    const a = await post(h, ana, trip('stephens-green', 'dub', { inMin: 60, flexMin: 15 }));
    // Ana stops searching 65 minutes from now. Ben turns up 64 minutes in.
    h.advance(64 * MIN);
    const ben = await person('Ben');
    const b = await post(h, ben, trip('trinity', 'dub', { inMin: 80, flexMin: 30 }));
    expect(b.status).toBe('searching');
    await refresh(h, ana);
    expect((await get(h, ana, a.id)).status).toBe('searching');
  });

  test('with a long time to answer, whoever has not answered is reminded once, 30 minutes before it lapses', async () => {
    const ana = await person('Ana');
    const ben = await person('Ben');
    await post(h, ana, trip('stephens-green', 'dub', { inMin: 4 * 60 }));
    const b = await post(h, ben, trip('trinity', 'dub', { inMin: 4 * 60 }));
    const m = b.match!;
    await h.call('POST', `/v1/matches/${m.id}/respond`, { token: ana.token, body: { accept: true } });
    h.clock.now = Date.parse(m.expiresAt) - 31 * MIN;
    await h.rides.sweep();
    await h.runJobs();
    expect(pushesTo(ben, /Ana said yes/)).toHaveLength(0);
    h.advance(2 * MIN);
    await h.rides.sweep();
    await h.rides.sweep();
    await h.runJobs();
    const reminders = pushesTo(ben, /Ana said yes/);
    expect(reminders).toHaveLength(1);
    expect(reminders[0]!.body).toMatch(/^Answer by \d{2}:\d{2}, or the match with Ana lapses\.$/);
    // Ana already said yes, so she isn't nagged.
    expect(h.push.sent.filter((p) => p.to === 'ExponentPushToken[Ana]' && /Still want to share|said yes/.test(p.title))).toHaveLength(0);
  });
});

describe('settling up', () => {
  test('the booker is reminded to enter the fare; if they never do, the ride is split at the estimate', async () => {
    const { plan, booker, partner, bookerTrip, partnerTrip, matchId } = await sharedRide();
    const lastDrop = plan.route.at(-1).at;
    const reminders = () => pushesTo(booker, /How much was the taxi/).length;

    h.clock.now = lastDrop + 29 * MIN;
    await h.rides.sweep();
    await h.runJobs();
    expect(reminders()).toBe(0);
    h.clock.now = lastDrop + 31 * MIN;
    await h.rides.sweep();
    await h.rides.sweep();
    await h.runJobs();
    expect(reminders()).toBe(1);
    h.clock.now = lastDrop + 181 * MIN;
    await h.rides.sweep();
    await h.runJobs();
    expect(reminders()).toBe(2);
    h.clock.now = lastDrop + CONFIG.settle.closeAfterHours * 60 * MIN + MIN;
    await h.rides.sweep();
    await h.runJobs();
    expect(reminders()).toBe(2);

    // Closed at the estimate both accepted, and both are told.
    await refresh(h, partner);
    const pv = await get(h, partner, partnerTrip.id);
    expect(pv.status).toBe('completed');
    expect(pv.match!.settlement).toMatchObject({ estimated: true, youOwe: plan.riders[partnerTrip.id].share, actualFare: plan.fare });
    expect(pushesTo(partner, /Your share of the taxi/)[0]!.body).toMatch(/didn't enter the meter total, so we've used the estimate: you owe/);
    expect(pushesTo(booker, /We split the fare for you/)).toHaveLength(1);
    const receipt = (await h.call('GET', `/v1/trips/${partnerTrip.id}/receipt`, { token: partner.token })).json;
    expect(receipt.fare.meterTotal).toBeNull();
    expect(receipt.fare.yourShare).toBe(plan.riders[partnerTrip.id].share);

    // The booker can still put in the real meter total, until they've been paid.
    await refresh(h, booker);
    const corrected = await h.call('POST', `/v1/matches/${matchId}/complete`, { token: booker.token, body: { actualFare: plan.fare + 300 } });
    expect(corrected.status).toBe(200);
    expect(corrected.json.match.settlement.estimated).toBe(false);
    expect(corrected.json.match.settlement.actualFare).toBe(plan.fare + 300);
    expect((await db.query('SELECT rides_completed FROM users WHERE id = $1', [booker.userId])).rows[0].rides_completed).toBe(1);
    await h.call('POST', `/v1/matches/${matchId}/paid`, { token: partner.token });
    const late = await h.call('POST', `/v1/matches/${matchId}/complete`, { token: booker.token, body: { actualFare: plan.fare } });
    expect(late.status).toBe(409);
  });

  test('a fare entered in time needs no reminder', async () => {
    const { plan, booker, matchId } = await sharedRide();
    h.clock.now = plan.route.at(-1).at + 5 * MIN;
    await refresh(h, booker);
    await h.call('POST', `/v1/matches/${matchId}/complete`, { token: booker.token, body: { actualFare: plan.fare } });
    h.clock.now += 7 * 60 * MIN;
    await h.rides.sweep();
    await h.runJobs();
    expect(pushesTo(booker, /How much was the taxi/)).toHaveLength(0);
  });
});

describe('deleting your account', () => {
  test('during a ride: the account goes, and the ride stays for the other person to settle', async () => {
    const { plan, booker, partner, partnerTrip, bookerTrip } = await sharedRide();
    h.clock.now = plan.startAt + 5 * MIN;
    await refresh(h, partner);
    expect((await h.call('DELETE', '/v1/me', { token: partner.token })).status).toBe(204);
    await refresh(h, booker);
    const view = await get(h, booker, bookerTrip.id);
    expect(view.status).toBe('confirmed');
    expect(view.match!.partner.firstName).toBe('Former member');
    // The booker can still record the fare; the partner's trip stays on record for the accounts.
    const done = await h.call('POST', `/v1/matches/${view.match!.id}/complete`, { token: booker.token, body: { actualFare: plan.fare } });
    expect(done.status).toBe(200);
    expect((await db.query('SELECT status FROM trips WHERE id = $1', [partnerTrip.id])).rows[0].status).toBe('completed');
  });

  test('when the booker has left, a ride nobody settled closes without asking anyone to pay', async () => {
    const { plan, booker, partner, partnerTrip } = await sharedRide();
    h.clock.now = plan.startAt + 5 * MIN;
    await refresh(h, booker);
    expect((await h.call('DELETE', '/v1/me', { token: booker.token })).status).toBe(204);
    h.clock.now = plan.route.at(-1).at + CONFIG.settle.closeAfterHours * 60 * MIN + MIN;
    await h.rides.sweep();
    await h.runJobs();
    await refresh(h, partner);
    const view = await get(h, partner, partnerTrip.id);
    expect(view.status).toBe('completed');
    expect(view.match!.settlement).toBeNull();
    expect(pushesTo(partner, /Your share of the taxi/)).toHaveLength(0);
  });
});
