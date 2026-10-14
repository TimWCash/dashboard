import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSharedRide, findBestMatch } from '../public/core/matching.js';
import { splitProportional, estimateFare, tariffAt } from '../public/core/pricing.js';
import { haversineKm } from '../public/core/geo.js';
import { placeById } from '../public/core/places.js';
import { CONFIG } from '../public/core/config.js';

const MIN = 60_000;
// Tuesday 13 October 2026, 10:00 in Dublin (IST, UTC+1): standard daytime tariff.
const NOW = Date.UTC(2026, 9, 13, 9, 0);
const p = (id) => ({ ...placeById(id) });

function trip(id, from, to, { at = NOW + 60 * MIN, mode = 'depart', flex = 30, seats = 1, rider = id } = {}) {
  return { id, riderId: rider, origin: p(from), destination: p(to), timeMode: mode, time: at, flexMin: flex, seats };
}

test('haversine is about right for a known distance', () => {
  // The Spire to Dublin Airport is roughly 8.7 km as the crow flies.
  const km = haversineKm(p('spire'), p('dub'));
  assert.ok(km > 7.5 && km < 10, `got ${km}`);
});

test('picks the NTA tariff from Dublin local time', () => {
  assert.equal(tariffAt(Date.UTC(2026, 9, 13, 9, 0)).label, 'standard rate'); // Tue 10:00 IST
  assert.equal(tariffAt(Date.UTC(2026, 9, 13, 19, 30)).label, 'night/Sunday rate'); // Tue 20:30 IST
  assert.equal(tariffAt(Date.UTC(2026, 9, 13, 6, 30)).label, 'night/Sunday rate'); // Tue 07:30 IST
  assert.equal(tariffAt(Date.UTC(2026, 9, 11, 12, 0)).label, 'night/Sunday rate'); // Sun 13:00 IST
  assert.equal(tariffAt(Date.UTC(2026, 9, 10, 1, 0)).label, 'late weekend rate'); // Sat 02:00 IST
  assert.equal(tariffAt(Date.UTC(2026, 11, 15, 10, 0)).label, 'standard rate'); // Tue 10:00 GMT, winter time
});

test('fare estimate follows the NTA structure', () => {
  const day = NOW;
  // 10 km by distance: €4.40 initial (covers 0.5 km) + 9.5 km × €1.32 + €3 booking fee.
  assert.equal(estimateFare({ km: 10, minutes: 20, at: day }), 19.94);
  // Not booked through an app: no booking fee. One extra passenger: +€1.
  assert.equal(estimateFare({ km: 10, minutes: 20, at: day, booked: false, passengers: 2 }), 17.94);
  // Past 14.5 km the higher Tariff B applies: 14 km × €1.32 + 5.5 km × €1.72.
  assert.equal(estimateFare({ km: 20, minutes: 30, at: day, booked: false }), round(4.4 + 14 * 1.32 + 5.5 * 1.72));
  // Stuck in traffic, the time rate wins: 3 km in 30 min.
  assert.equal(estimateFare({ km: 3, minutes: 30, at: day, booked: false }), round(4.4 + (30 - 85 / 60) * 0.47));
});

function round(n) {
  return Math.round(n * 100) / 100;
}

test('fare split always adds up to the fare and is proportional', () => {
  const shares = splitProportional(41.37, [30.11, 20.07]);
  assert.equal(Math.round((shares[0] + shares[1]) * 100), 4137);
  assert.ok(shares[0] > shares[1]);
});

test('two people going from nearby to the airport at the same time are matched and both save', () => {
  const a = trip('a', 'stephens-green', 'dub');
  const b = trip('b', 'trinity', 'dub', { at: NOW + 70 * MIN });
  const plan = planSharedRide(a, b, NOW);
  assert.ok(plan, 'expected a plan');
  assert.ok(plan.savingsPct >= CONFIG.matching.minSavingsPct);
  for (const id of ['a', 'b']) {
    const r = plan.riders[id];
    assert.ok(r.savings > 0, `${id} should save money`);
    assert.ok(r.share < r.soloFare);
    assert.ok(r.detourPct <= CONFIG.matching.maxDetour);
  }
  assert.equal(Math.round((plan.riders.a.share + plan.riders.b.share) * 100), Math.round(plan.fare * 100));
  // Both are headed to the airport, so there's one shared drop-off.
  assert.equal(plan.route.filter((s) => s.kind === 'dropoff').length, 1);
  // Pickup time honours both people's windows.
  for (const t of [a, b]) {
    const pickup = plan.riders[t.id].pickupAt;
    assert.ok(Math.abs(pickup - t.time) <= t.flexMin * MIN, `${t.id} pickup outside window`);
  }
});

test('opposite directions are not matched', () => {
  const a = trip('a', 'spire', 'dub');
  const b = trip('b', 'dub', 'spire');
  assert.equal(planSharedRide(a, b, NOW), null);
});

test('destinations in different directions are not matched', () => {
  const a = trip('a', 'stephens-green', 'dub');
  const b = trip('b', 'stephens-green', 'dun-laoghaire');
  assert.equal(planSharedRide(a, b, NOW), null);
});

test('times that do not overlap are not matched', () => {
  const a = trip('a', 'stephens-green', 'dub', { at: NOW + 60 * MIN, flex: 15 });
  const b = trip('b', 'trinity', 'dub', { at: NOW + 180 * MIN, flex: 15 });
  assert.equal(planSharedRide(a, b, NOW), null);
});

test('arrive-by trips are matched on arrival time', () => {
  // Both want to be at the airport around the same time.
  const a = trip('a', 'rathmines', 'dub', { mode: 'arrive', at: NOW + 120 * MIN, flex: 20 });
  const b = trip('b', 'ranelagh', 'dub', { mode: 'arrive', at: NOW + 125 * MIN, flex: 20 });
  const plan = planSharedRide(a, b, NOW);
  assert.ok(plan);
  for (const t of [a, b]) {
    assert.ok(Math.abs(plan.riders[t.id].dropoffAt - t.time) <= t.flexMin * MIN);
  }
});

test('long regional trips match too', () => {
  const a = trip('a', 'eyre-square', 'shannon');
  const b = trip('b', 'uni-galway', 'shannon', { at: NOW + 75 * MIN });
  const plan = planSharedRide(a, b, NOW);
  assert.ok(plan);
  assert.ok(plan.riders.a.savings > 20, `expected big savings on a long trip, got ${plan.riders.a.savings}`);
});

test('too many people for one taxi are not matched', () => {
  const a = trip('a', 'stephens-green', 'dub', { seats: 2 });
  const b = trip('b', 'trinity', 'dub', { seats: 3 });
  assert.equal(planSharedRide(a, b, NOW), null);
});

test('the same person is never matched with themselves', () => {
  const a = trip('a', 'stephens-green', 'dub', { rider: 'r1' });
  const b = trip('b', 'trinity', 'dub', { rider: 'r1' });
  assert.equal(planSharedRide(a, b, NOW), null);
});

test('pickups a short walk apart meet at one spot instead of adding a stop', () => {
  const a = trip('a', 'stephens-green', 'dub');
  const b = { ...trip('b', 'stephens-green', 'dub'), origin: { label: 'Dawson Street', lat: 53.3405, lng: -6.2578 } };
  const plan = planSharedRide(a, b, NOW);
  assert.ok(plan);
  assert.equal(plan.meetUp, true);
  assert.equal(plan.route.length, 2);
  const walker = plan.riders[plan.bookerTripId === 'a' ? 'b' : 'a'];
  assert.ok(walker.walkToPickupMin > 0);
});

test('pickup must be in the future', () => {
  const a = trip('a', 'stephens-green', 'dub', { at: NOW - 60 * MIN, flex: 15 });
  const b = trip('b', 'trinity', 'dub', { at: NOW - 60 * MIN, flex: 15 });
  assert.equal(planSharedRide(a, b, NOW), null);
});

test('findBestMatch prefers the closer, better-timed partner', () => {
  const me = trip('me', 'stephens-green', 'dub', { at: NOW + 60 * MIN });
  const far = trip('far', 'heuston', 'dub', { at: NOW + 85 * MIN });
  const close = trip('close', 'trinity', 'dub', { at: NOW + 62 * MIN });
  const best = findBestMatch(me, [far, close], NOW);
  assert.equal(best.other.id, 'close');
});
