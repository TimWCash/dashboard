import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TripService, ServiceError } from '../public/core/service.js';
import { seedDemo, addNearbyTraveler } from '../public/core/demo.js';
import { placeById } from '../public/core/places.js';
import { CONFIG } from '../public/core/config.js';

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 13, 9, 0);
const place = (id) => ({ ...placeById(id) });

function setup() {
  const svc = new TripService();
  const ana = svc.createRider({ name: 'Ana' }, NOW);
  const ben = svc.createRider({ name: 'Ben' }, NOW);
  const req = (from, to, extra = {}) => ({
    origin: place(from),
    destination: place(to),
    timeMode: 'depart',
    time: NOW + 60 * MIN,
    flexMin: 30,
    seats: 1,
    ...extra,
  });
  return { svc, ana, ben, req };
}

const paymentOf = (svc, trip) => svc.state.payments[trip.paymentId];

test('posting a trip only places a hold', () => {
  const { svc, ana, req } = setup();
  const trip = svc.postTrip(ana.id, req('stephens-green', 'dub'), NOW);
  assert.equal(trip.status, 'searching');
  assert.equal(paymentOf(svc, trip).status, 'authorized');
  assert.equal(paymentOf(svc, trip).amount, CONFIG.matchFee);
});

test('a compatible second trip produces a proposal; fees are charged only when both accept', () => {
  const { svc, ana, ben, req } = setup();
  const a = svc.postTrip(ana.id, req('stephens-green', 'dub'), NOW);
  const b = svc.postTrip(ben.id, req('trinity', 'dub'), NOW);
  assert.equal(a.status, 'proposed');
  assert.equal(b.status, 'proposed');
  assert.equal(a.matchId, b.matchId);

  svc.respond(ana.id, a.matchId, true, NOW + MIN);
  assert.equal(paymentOf(svc, a).status, 'authorized', 'no charge until both accept');

  svc.respond(ben.id, b.matchId, true, NOW + 2 * MIN);
  assert.equal(a.status, 'confirmed');
  assert.equal(paymentOf(svc, a).status, 'captured');
  assert.equal(paymentOf(svc, b).status, 'captured');
});

test('declining sends both back to searching and they are not re-proposed to each other', () => {
  const { svc, ana, ben, req } = setup();
  const a = svc.postTrip(ana.id, req('stephens-green', 'dub'), NOW);
  const b = svc.postTrip(ben.id, req('trinity', 'dub'), NOW);
  svc.respond(ben.id, b.matchId, false, NOW + MIN);
  assert.equal(a.status, 'searching');
  assert.equal(b.status, 'searching');
  assert.equal(paymentOf(svc, a).status, 'authorized');
  assert.equal(svc.tryMatch(a, NOW + 2 * MIN), null);
});

test('no match before the window closes means the hold is released and nothing is charged', () => {
  const { svc, ana, req } = setup();
  const a = svc.postTrip(ana.id, req('stephens-green', 'dub'), NOW);
  svc.tick(a.searchUntil - 1);
  assert.equal(a.status, 'searching');
  svc.tick(a.searchUntil);
  assert.equal(a.status, 'expired');
  assert.equal(paymentOf(svc, a).status, 'released');
});

test('an unanswered proposal expires and both go back to searching', () => {
  const { svc, ana, ben, req } = setup();
  const a = svc.postTrip(ana.id, req('stephens-green', 'dub'), NOW);
  const b = svc.postTrip(ben.id, req('trinity', 'dub'), NOW);
  const match = svc.state.matches[a.matchId];
  svc.tick(match.expiresAt);
  assert.equal(match.status, 'expired');
  assert.equal(a.status, 'searching');
  assert.equal(b.status, 'searching');
});

test('cancelling while searching releases the hold', () => {
  const { svc, ana, req } = setup();
  const a = svc.postTrip(ana.id, req('stephens-green', 'dub'), NOW);
  svc.cancelTrip(ana.id, a.id, NOW + MIN);
  assert.equal(a.status, 'cancelled');
  assert.equal(paymentOf(svc, a).status, 'released');
});

test('cancelling after confirming keeps your fee, refunds your partner and re-lists their trip', () => {
  const { svc, ana, ben, req } = setup();
  const a = svc.postTrip(ana.id, req('stephens-green', 'dub'), NOW);
  const b = svc.postTrip(ben.id, req('trinity', 'dub'), NOW);
  svc.respond(ana.id, a.matchId, true, NOW);
  svc.respond(ben.id, b.matchId, true, NOW);
  const benFirstPayment = b.paymentId;

  svc.cancelTrip(ana.id, a.id, NOW + MIN);
  assert.equal(a.status, 'cancelled');
  assert.equal(paymentOf(svc, a).status, 'captured');
  assert.equal(svc.state.payments[benFirstPayment].status, 'refunded');
  assert.equal(b.status, 'searching');
  assert.notEqual(b.paymentId, benFirstPayment);
  assert.equal(paymentOf(svc, b).status, 'authorized');
});

test('the booker settles the real fare and the partner owes their agreed share of it', () => {
  const { svc, ana, ben, req } = setup();
  const a = svc.postTrip(ana.id, req('stephens-green', 'dub'), NOW);
  const b = svc.postTrip(ben.id, req('trinity', 'dub'), NOW);
  svc.respond(ana.id, a.matchId, true, NOW);
  svc.respond(ben.id, b.matchId, true, NOW);
  const match = svc.state.matches[a.matchId];
  const booker = match.plan.bookerTripId === a.id ? { rider: ana, trip: a } : { rider: ben, trip: b };
  const other = booker.trip === a ? { rider: ben, trip: b } : { rider: ana, trip: a };

  assert.throws(() => svc.completeMatch(other.rider.id, match.id, 70, NOW), ServiceError);
  svc.completeMatch(booker.rider.id, match.id, 70, NOW + 90 * MIN);
  const s = match.settlement;
  const ratio = match.plan.riders[other.trip.id].share / match.plan.fare;
  assert.equal(s.amount, Math.round(70 * ratio * 100) / 100);
  assert.equal(Math.round((s.amount + s.bookerShare) * 100), 7000);
  assert.equal(a.status, 'completed');
});

test('messages are only allowed after both confirm', () => {
  const { svc, ana, ben, req } = setup();
  const a = svc.postTrip(ana.id, req('stephens-green', 'dub'), NOW);
  svc.postTrip(ben.id, req('trinity', 'dub'), NOW);
  assert.throws(() => svc.sendMessage(ana.id, a.matchId, 'hi', NOW), ServiceError);
  svc.respond(ana.id, a.matchId, true, NOW);
  svc.respond(ben.id, a.matchId, true, NOW);
  svc.sendMessage(ana.id, a.matchId, 'See you at the corner', NOW);
  const view = svc.viewFor(ben.id, NOW).trips[0];
  assert.equal(view.match.messages[0].text, 'See you at the corner');
  assert.equal(view.match.messages[0].mine, false);
});

test("a rider's view hides the partner's exact stops until both confirm", () => {
  const { svc, ana, ben, req } = setup();
  const a = svc.postTrip(ana.id, req('stephens-green', 'dub'), NOW);
  svc.postTrip(ben.id, req('trinity', 'dub'), NOW);
  const before = svc.viewFor(ana.id, NOW).trips[0].match.plan.route.find((s) => s.partner && !s.you);
  assert.match(before.label, /^Near /);
  assert.equal(before.lat, undefined);
  svc.respond(ana.id, a.matchId, true, NOW);
  svc.respond(ben.id, a.matchId, true, NOW);
  const after = svc.viewFor(ana.id, NOW).trips[0].match.plan.route.find((s) => s.partner && !s.you);
  assert.equal(after.label, 'Trinity College');
  assert.ok(Number.isFinite(after.lat));
  // Other riders' trips never appear in my view.
  assert.equal(svc.viewFor(ana.id, NOW).trips.length, 1);
  assert.equal(svc.viewFor(ana.id, NOW).payments.length, 1);
});

test('one rider cannot act on another rider’s trip or match', () => {
  const { svc, ana, ben, req } = setup();
  const eve = svc.createRider({ name: 'Eve' }, NOW);
  const a = svc.postTrip(ana.id, req('stephens-green', 'dub'), NOW);
  svc.postTrip(ben.id, req('trinity', 'dub'), NOW);
  assert.throws(() => svc.cancelTrip(eve.id, a.id, NOW), ServiceError);
  assert.throws(() => svc.respond(eve.id, a.matchId, true, NOW), ServiceError);
});

test('rejects trips that are too soon, too short or oversized', () => {
  const { svc, ana, req } = setup();
  assert.throws(() => svc.postTrip(ana.id, req('stephens-green', 'dub', { time: NOW, flexMin: 5 }), NOW), /too soon/);
  assert.throws(() => svc.postTrip(ana.id, req('stephens-green', 'stephens-green'), NOW), /too close/);
  assert.throws(() => svc.postTrip(ana.id, req('stephens-green', 'dub', { seats: 4 }), NOW), /Party size/);
});

test('demo: simulated travelers never match each other, accept automatically, and reply to messages', () => {
  const svc = new TripService();
  seedDemo(svc, NOW);
  const proposed = Object.values(svc.state.matches);
  assert.equal(proposed.length, 0, 'seeded travelers should be left for real users');

  const me = svc.createRider({ name: 'Me' }, NOW);
  const mine = svc.postTrip(me.id, {
    origin: place('eyre-square'), destination: place('shannon'), timeMode: 'depart', time: NOW + 3 * 60 * MIN, flexMin: 30, seats: 1,
  }, NOW);
  if (mine.status === 'searching') addNearbyTraveler(svc, mine, NOW);
  assert.equal(mine.status, 'proposed');

  svc.respond(me.id, mine.matchId, true, NOW + 1000);
  svc.tick(NOW + 5000);
  assert.equal(mine.status, 'confirmed');

  svc.sendMessage(me.id, mine.matchId, 'Hi!', NOW + 6000);
  svc.tick(NOW + 10_000);
  const msgs = svc.viewFor(me.id, NOW + 10_000).trips[0].match.messages;
  assert.equal(msgs.length, 2);
  assert.equal(msgs[1].mine, false);
});
