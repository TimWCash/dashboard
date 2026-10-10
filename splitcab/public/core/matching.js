import { CONFIG } from './config.js';
import { roadKm, driveMinutes, walkMinutes } from './geo.js';
import { estimateFare, splitProportional, soloEstimate, round2 } from './pricing.js';

const MINUTE = 60_000;
const STOP_DWELL_MIN = 2;

// The four ways one cab can serve two trips: who is picked up first, who is dropped first.
const ORDERINGS = [
  ['a', 'b', 'a', 'b'],
  ['a', 'b', 'b', 'a'],
  ['b', 'a', 'a', 'b'],
  ['b', 'a', 'b', 'a'],
];

// When the cab would ideally leave this trip's pickup if they rode alone, and how far either side they'll go.
export function soloWindow(trip) {
  const minutes = driveMinutes(roadKm(trip.origin, trip.destination));
  const ideal = trip.timeMode === 'arrive' ? trip.time - minutes * MINUTE : trip.time;
  const solo = soloEstimate(trip.origin, trip.destination, { at: ideal, passengers: trip.seats });
  const flex = trip.flexMin * MINUTE;
  return { ideal, start: ideal - flex, end: ideal + flex, solo };
}

function buildRoute(trips, order, cfg) {
  const [first, second] = order;
  const stops = [];

  // Pickups a short walk apart become one meeting point at the first rider's pickup.
  const pickupGap = roadKm(trips[first].origin, trips[second].origin);
  if (pickupGap > cfg.maxPickupGapKm) return null;
  const meetUp = pickupGap <= cfg.walkToMeetKm;
  stops.push({ riders: [first], kind: 'pickup', place: trips[first].origin });
  if (meetUp) {
    stops[0].riders.push(second);
  } else {
    stops.push({ riders: [second], kind: 'pickup', place: trips[second].origin });
  }

  const [d1, d2] = [order[2], order[3]];
  const dropGap = roadKm(trips[d1].destination, trips[d2].destination);
  const sharedDrop = dropGap <= cfg.walkToMeetKm;
  stops.push({ riders: [d1], kind: 'dropoff', place: trips[d1].destination });
  if (sharedDrop) {
    stops[stops.length - 1].riders.push(d2);
  } else {
    stops.push({ riders: [d2], kind: 'dropoff', place: trips[d2].destination });
  }

  let km = 0;
  let min = 0;
  stops[0].km = 0;
  stops[0].min = 0;
  for (let i = 1; i < stops.length; i++) {
    const leg = roadKm(stops[i - 1].place, stops[i].place);
    km += leg;
    min += driveMinutes(leg) + (i < stops.length - 1 ? STOP_DWELL_MIN : 0);
    stops[i].km = km;
    stops[i].min = min;
  }

  return {
    stops,
    km,
    min,
    meetUp,
    sharedDrop,
    walkToPickupKm: { [first]: 0, [second]: meetUp ? pickupGap : 0 },
    walkFromDropKm: { [d1]: 0, [d2]: sharedDrop ? dropGap : 0 },
  };
}

function stopFor(route, key, kind) {
  return route.stops.find((s) => s.kind === kind && s.riders.includes(key));
}

// Can these two trips share a cab, and if so what's the best plan? Returns null when they can't.
export function planSharedRide(tripA, tripB, now, cfg = CONFIG) {
  const m = cfg.matching;
  if (tripA.riderId === tripB.riderId) return null;
  if (tripA.seats + tripB.seats > m.taxiSeats) return null;

  const trips = { a: tripA, b: tripB };
  const solo = { a: soloWindow(tripA).solo, b: soloWindow(tripB).solo };
  let best = null;

  for (const order of ORDERINGS) {
    const route = buildRoute(trips, order, m);
    if (!route) continue;

    const riders = {};
    let maxDetour = 0;
    let feasible = true;
    for (const key of ['a', 'b']) {
      const pickup = stopFor(route, key, 'pickup');
      const drop = stopFor(route, key, 'dropoff');
      const rideKm = drop.km - pickup.km;
      const detour = Math.max(0, rideKm / solo[key].km - 1);
      if (detour > m.maxDetour) feasible = false;
      maxDetour = Math.max(maxDetour, detour);
      riders[key] = { pickup, drop, rideKm, detour };
    }
    if (!feasible) continue;

    // Each rider's own time target pins down when the cab must leave the first stop.
    let lo = now + m.minLeadMinutes * MINUTE;
    let hi = Infinity;
    const ideals = [];
    for (const key of ['a', 'b']) {
      const t = trips[key];
      const offset = (t.timeMode === 'arrive' ? riders[key].drop.min : riders[key].pickup.min) * MINUTE;
      const ideal = t.time - offset;
      ideals.push(ideal);
      lo = Math.max(lo, ideal - t.flexMin * MINUTE);
      hi = Math.min(hi, ideal + t.flexMin * MINUTE);
    }
    if (lo > hi) continue;
    const mean = (ideals[0] + ideals[1]) / 2;
    const startAt = Math.round(Math.min(hi, Math.max(lo, mean)) / MINUTE) * MINUTE;
    const avgDeviationMin = ideals.reduce((sum, i) => sum + Math.abs(i - startAt), 0) / 2 / MINUTE;

    const extraStops = route.stops.length - 2;
    const passengers = tripA.seats + tripB.seats;
    const fare = estimateFare({ km: route.km, minutes: route.min, passengers, at: startAt }, cfg.fare);
    const [shareA, shareB] = splitProportional(fare, [solo.a.fare, solo.b.fare]);
    const savingsPct = 1 - fare / (solo.a.fare + solo.b.fare);
    if (savingsPct < m.minSavingsPct) continue;
    const net = { a: solo.a.fare - shareA - cfg.matchFee, b: solo.b.fare - shareB - cfg.matchFee };
    if (net.a < m.minNetSavings || net.b < m.minNetSavings) continue;

    const score = savingsPct * 100 - avgDeviationMin * 0.5 - maxDetour * 20;
    if (best && score <= best.score) continue;

    const shares = { a: shareA, b: shareB };
    best = {
      score,
      startAt,
      fare,
      totalKm: round2(route.km),
      totalMin: Math.round(route.min),
      extraStops,
      savingsPct: round2(savingsPct),
      meetUp: route.meetUp,
      sharedDrop: route.sharedDrop,
      bookerTripId: trips[order[0]].id,
      route: route.stops.map((s) => ({
        kind: s.kind,
        tripIds: s.riders.map((k) => trips[k].id),
        label: s.place.label,
        lat: s.place.lat,
        lng: s.place.lng,
        at: startAt + Math.round(s.min) * MINUTE,
      })),
      riders: Object.fromEntries(
        ['a', 'b'].map((key) => [
          trips[key].id,
          {
            soloFare: solo[key].fare,
            share: shares[key],
            fee: cfg.matchFee,
            savings: round2(solo[key].fare - shares[key] - cfg.matchFee),
            detourPct: round2(riders[key].detour),
            pickupAt: startAt + Math.round(riders[key].pickup.min) * MINUTE,
            dropoffAt: startAt + Math.round(riders[key].drop.min) * MINUTE,
            walkToPickupMin: Math.round(walkMinutes(route.walkToPickupKm[key])),
            walkFromDropMin: Math.round(walkMinutes(route.walkFromDropKm[key])),
          },
        ]),
      ),
    };
  }
  return best;
}

// Best partner for `trip` among `candidates`, or null.
export function findBestMatch(trip, candidates, now, cfg = CONFIG) {
  let best = null;
  for (const other of candidates) {
    if (other.id === trip.id) continue;
    const plan = planSharedRide(trip, other, now, cfg);
    if (plan && (!best || plan.score > best.plan.score)) best = { other, plan };
  }
  return best;
}
