import { CONFIG, type Config } from './config';
import { roadKm, driveMinutes, walkMinutes } from './geo';
import { estimateFare, splitProportional, soloEstimate, type SoloEstimate } from './pricing';
import type { Place, RiderPlan, SharedPlan, TripLike } from './types';

const MINUTE = 60_000;
const STOP_DWELL_MIN = 2;

type Key = 'a' | 'b';

// The four ways one taxi can serve two trips: who is picked up first, who is dropped first.
const ORDERINGS: [Key, Key, Key, Key][] = [
  ['a', 'b', 'a', 'b'],
  ['a', 'b', 'b', 'a'],
  ['b', 'a', 'a', 'b'],
  ['b', 'a', 'b', 'a'],
];

export interface SoloWindow {
  ideal: number;
  start: number;
  end: number;
  solo: SoloEstimate;
}

// When the taxi would ideally leave this trip's pickup if they rode alone, and the window either side.
// "Leave around" is flexible both ways. "Arrive by" is a deadline: up to flexMin early, never late.
export function soloWindow(trip: Pick<TripLike, 'origin' | 'destination' | 'timeMode' | 'time' | 'flexMin' | 'seats'>): SoloWindow {
  const minutes = driveMinutes(roadKm(trip.origin, trip.destination));
  const ideal = trip.timeMode === 'arrive' ? trip.time - minutes * MINUTE : trip.time;
  const solo = soloEstimate(trip.origin, trip.destination, { at: ideal, passengers: trip.seats });
  const flex = trip.flexMin * MINUTE;
  return { ideal, start: ideal - flex, end: trip.timeMode === 'arrive' ? ideal : ideal + flex, solo };
}

// The last moment it's worth searching for a partner for this trip.
export function searchDeadline(trip: Parameters<typeof soloWindow>[0], cfg: Config = CONFIG): number {
  return soloWindow(trip).end - cfg.stopSearchingMinutesBefore * MINUTE;
}

interface Stop {
  riders: Key[];
  kind: 'pickup' | 'dropoff';
  place: Place;
  km: number;
  min: number;
}

function buildRoute(trips: Record<Key, TripLike>, order: [Key, Key, Key, Key], m: Config['matching']) {
  const [first, second, d1, d2] = order;

  // Pickups a short walk apart become one meeting point at the first rider's pickup.
  const pickupGap = roadKm(trips[first].origin, trips[second].origin);
  if (pickupGap > m.maxPickupGapKm) return null;
  const meetUp = pickupGap <= m.walkToMeetKm;
  const stops: Stop[] = [{ riders: [first], kind: 'pickup', place: trips[first].origin, km: 0, min: 0 }];
  if (meetUp) stops[0]!.riders.push(second);
  else stops.push({ riders: [second], kind: 'pickup', place: trips[second].origin, km: 0, min: 0 });

  const dropGap = roadKm(trips[d1].destination, trips[d2].destination);
  const sharedDrop = dropGap <= m.walkToMeetKm;
  stops.push({ riders: [d1], kind: 'dropoff', place: trips[d1].destination, km: 0, min: 0 });
  if (sharedDrop) stops[stops.length - 1]!.riders.push(d2);
  else stops.push({ riders: [d2], kind: 'dropoff', place: trips[d2].destination, km: 0, min: 0 });

  let km = 0;
  let min = 0;
  for (let i = 1; i < stops.length; i++) {
    const leg = roadKm(stops[i - 1]!.place, stops[i]!.place);
    km += leg;
    min += driveMinutes(leg) + (i < stops.length - 1 ? STOP_DWELL_MIN : 0);
    stops[i]!.km = km;
    stops[i]!.min = min;
  }

  return {
    stops,
    km,
    min,
    meetUp,
    sharedDrop,
    walkToPickupKm: { [first]: 0, [second]: meetUp ? pickupGap : 0 } as Record<Key, number>,
    walkFromDropKm: { [d1]: 0, [d2]: sharedDrop ? dropGap : 0 } as Record<Key, number>,
  };
}

function stopFor(stops: Stop[], key: Key, kind: Stop['kind']): Stop {
  return stops.find((s) => s.kind === kind && s.riders.includes(key))!;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Can these two trips share a taxi, and if so what's the best plan? Returns null when they can't.
export function planSharedRide(tripA: TripLike, tripB: TripLike, now: number, cfg: Config = CONFIG): SharedPlan | null {
  const m = cfg.matching;
  if (tripA.riderId === tripB.riderId) return null;
  if (tripA.seats + tripB.seats > m.taxiSeats) return null;

  const trips: Record<Key, TripLike> = { a: tripA, b: tripB };
  const solo: Record<Key, SoloEstimate> = { a: soloWindow(tripA).solo, b: soloWindow(tripB).solo };
  let best: SharedPlan | null = null;

  for (const order of ORDERINGS) {
    const route = buildRoute(trips, order, m);
    if (!route) continue;

    const legs = {} as Record<Key, { pickup: Stop; drop: Stop; detour: number }>;
    let maxDetour = 0;
    let feasible = true;
    for (const key of ['a', 'b'] as const) {
      const pickup = stopFor(route.stops, key, 'pickup');
      const drop = stopFor(route.stops, key, 'dropoff');
      const detour = Math.max(0, (drop.km - pickup.km) / solo[key].km - 1);
      if (detour > m.maxDetour) feasible = false;
      maxDetour = Math.max(maxDetour, detour);
      legs[key] = { pickup, drop, detour };
    }
    if (!feasible) continue;

    // Each rider's own time target pins down when the taxi must leave the first stop.
    let lo = now + m.minLeadMinutes * MINUTE;
    let hi = Infinity;
    const ideals: number[] = [];
    for (const key of ['a', 'b'] as const) {
      const t = trips[key];
      const offset = (t.timeMode === 'arrive' ? legs[key].drop.min : legs[key].pickup.min) * MINUTE;
      const ideal = t.time - offset;
      ideals.push(ideal);
      lo = Math.max(lo, ideal - t.flexMin * MINUTE);
      // Arrive-by riders can be early but never late.
      hi = Math.min(hi, t.timeMode === 'arrive' ? ideal : ideal + t.flexMin * MINUTE);
    }
    if (lo > hi) continue;
    const mean = (ideals[0]! + ideals[1]!) / 2;
    const startAt = Math.round(Math.min(hi, Math.max(lo, mean)) / MINUTE) * MINUTE;
    const avgDeviationMin = ideals.reduce((sum, i) => sum + Math.abs(i - startAt), 0) / 2 / MINUTE;

    const extraStops = route.stops.length - 2;
    const passengers = tripA.seats + tripB.seats;
    const fare = estimateFare({ km: route.km, minutes: route.min, passengers, at: startAt }, cfg.fare);
    const [shareA, shareB] = splitProportional(fare, [solo.a.fare, solo.b.fare]) as [number, number];
    const savingsPct = 1 - fare / (solo.a.fare + solo.b.fare);
    if (savingsPct < m.minSavingsPct) continue;
    if (solo.a.fare - shareA - cfg.matchFee < m.minNetSavings) continue;
    if (solo.b.fare - shareB - cfg.matchFee < m.minNetSavings) continue;

    const score = savingsPct * 100 - avgDeviationMin * 0.5 - maxDetour * 20;
    if (best && score <= best.score) continue;

    const shares: Record<Key, number> = { a: shareA, b: shareB };
    const riderPlan = (key: Key): RiderPlan => ({
      soloFare: solo[key].fare,
      share: shares[key],
      fee: cfg.matchFee,
      savings: solo[key].fare - shares[key] - cfg.matchFee,
      detourPct: round2(legs[key].detour),
      pickupAt: startAt + Math.round(legs[key].pickup.min) * MINUTE,
      dropoffAt: startAt + Math.round(legs[key].drop.min) * MINUTE,
      walkToPickupMin: Math.round(walkMinutes(route.walkToPickupKm[key])),
      walkFromDropMin: Math.round(walkMinutes(route.walkFromDropKm[key])),
    });

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
      riders: { [tripA.id]: riderPlan('a'), [tripB.id]: riderPlan('b') },
    };
  }
  return best;
}

// Best partner for `trip` among `candidates`, or null.
export function findBestMatch<T extends TripLike>(trip: TripLike, candidates: T[], now: number, cfg: Config = CONFIG) {
  let best: { other: T; plan: SharedPlan } | null = null;
  for (const other of candidates) {
    if (other.id === trip.id) continue;
    const plan = planSharedRide(trip, other, now, cfg);
    if (plan && (!best || plan.score > best.plan.score)) best = { other, plan };
  }
  return best;
}

// Settle the real fare at the agreed ratio. Returns what the non-booker owes the booker, in cents.
export function settleFare(actualFare: number, plan: Pick<SharedPlan, 'fare' | 'riders'>, partnerTripId: string): number {
  const partnerShare = plan.riders[partnerTripId]?.share ?? 0;
  return Math.round((actualFare * partnerShare) / plan.fare);
}
