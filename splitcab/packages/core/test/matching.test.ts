import { describe, expect, test } from 'vitest';
import {
  CONFIG,
  acceptDeadline,
  bestCaseSavings,
  estimateFare,
  findBestMatch,
  haversineKm,
  inServiceArea,
  irishTime,
  planSharedRide,
  placeById,
  rideSavings,
  sameTripQuote,
  soloFareFor,
  searchKnownPlaces,
  searchDeadline,
  settleFare,
  splitProportional,
  tariffAt,
  type TripLike,
} from '../src';

const MIN = 60_000;
// Tuesday 13 October 2026, 10:00 in Dublin (IST, UTC+1): standard daytime tariff.
const NOW = Date.UTC(2026, 9, 13, 9, 0);
const p = (id: string) => {
  const place = placeById(id);
  if (!place) throw new Error(`unknown place ${id}`);
  return { label: place.label, lat: place.lat, lng: place.lng };
};

function trip(
  id: string,
  from: string,
  to: string,
  { at = NOW + 60 * MIN, mode = 'depart' as const, flex = 30, seats = 1, rider = id }: Partial<{ at: number; mode: 'depart' | 'arrive'; flex: number; seats: number; rider: string }> = {},
): TripLike {
  return { id, riderId: rider, origin: p(from), destination: p(to), timeMode: mode, time: at, flexMin: flex, seats };
}

describe('geo', () => {
  test('haversine is about right for a known distance', () => {
    // The Spire to Dublin Airport is roughly 8.7 km as the crow flies.
    const km = haversineKm(p('spire'), p('dub'));
    expect(km).toBeGreaterThan(7.5);
    expect(km).toBeLessThan(10);
  });
});

describe('service area', () => {
  test('trips run in the Republic of Ireland, not in Northern Ireland or abroad', () => {
    const republic = {
      Dublin: [53.349, -6.26],
      Cork: [51.898, -8.471],
      Galway: [53.271, -9.049],
      Dundalk: [54.004, -6.405],
      Carlingford: [54.042, -6.187],
      Monaghan: [54.249, -6.968],
      Clones: [54.18, -7.231],
      Cavan: [53.991, -7.36],
      Letterkenny: [54.95, -7.733],
      Buncrana: [55.133, -7.453],
      Moville: [55.189, -7.04],
      'Malin Head': [55.381, -7.373],
      Bundoran: [54.478, -8.281],
      // Right on the border, where the border data is about a kilometre out.
      Lifford: [54.834, -7.48],
      Blacklion: [54.291, -7.877],
    };
    const northernIreland = {
      Belfast: [54.597, -5.93],
      Derry: [54.997, -7.309],
      Newry: [54.176, -6.349],
      Armagh: [54.35, -6.653],
      Enniskillen: [54.344, -7.632],
      Omagh: [54.6, -7.3],
      Dungannon: [54.503, -6.767],
      Lisburn: [54.516, -6.058],
      Coleraine: [55.133, -6.668],
      Portrush: [55.204, -6.652],
      'Rathlin Island': [55.29, -6.19],
      Larne: [54.851, -5.823],
    };
    for (const [name, [lat, lng]] of Object.entries(republic)) expect(inServiceArea({ lat: lat!, lng: lng! }), name).toBe(true);
    for (const [name, [lat, lng]] of Object.entries(northernIreland)) expect(inServiceArea({ lat: lat!, lng: lng! }), name).toBe(false);
    expect(inServiceArea({ lat: 51.5, lng: -0.12 }), 'London').toBe(false);
    expect(inServiceArea({ lat: 55.95, lng: -3.19 }), 'Edinburgh').toBe(false);
  });
});

describe('fares', () => {
  test('picks the NTA tariff from Dublin local time', () => {
    expect(tariffAt(Date.UTC(2026, 9, 13, 9, 0)).id).toBe('standard'); // Tue 10:00 IST
    expect(tariffAt(Date.UTC(2026, 9, 13, 19, 30)).id).toBe('premium'); // Tue 20:30 IST
    expect(tariffAt(Date.UTC(2026, 9, 13, 6, 30)).id).toBe('premium'); // Tue 07:30 IST
    expect(tariffAt(Date.UTC(2026, 9, 11, 12, 0)).id).toBe('premium'); // Sun 13:00 IST
    expect(tariffAt(Date.UTC(2026, 9, 10, 1, 0)).id).toBe('special'); // Sat 02:00 IST
    expect(tariffAt(Date.UTC(2026, 11, 15, 10, 0)).id).toBe('standard'); // Tue 10:00 GMT, winter time
  });

  test('estimate follows the NTA structure, in cents', () => {
    // 10 km by distance: €4.40 initial (covers 0.5 km) + 9.5 km × €1.32 + €3 booking fee.
    expect(estimateFare({ km: 10, minutes: 20, at: NOW })).toBe(1994);
    // Not booked through an app: no booking fee. One extra passenger: +€1.
    expect(estimateFare({ km: 10, minutes: 20, at: NOW, booked: false, passengers: 2 })).toBe(1794);
    // Past 14.5 km the higher Tariff B applies.
    expect(estimateFare({ km: 20, minutes: 30, at: NOW, booked: false })).toBe(Math.round(440 + 14 * 132 + 5.5 * 172));
    // Stuck in traffic, the time rate wins: 3 km in 30 min.
    expect(estimateFare({ km: 3, minutes: 30, at: NOW, booked: false })).toBe(Math.round(440 + (30 - 85 / 60) * 47));
  });

  test('split always adds up to the fare and is proportional', () => {
    const shares = splitProportional(4137, [3011, 2007]);
    expect(shares[0]! + shares[1]!).toBe(4137);
    expect(shares[0]!).toBeGreaterThan(shares[1]!);
    for (const total of [1, 99, 1001, 2999]) {
      const s = splitProportional(total, [1234, 4321]);
      expect(s.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  test('settlement applies the agreed ratio to the real fare', () => {
    const plan = { fare: 4000, riders: { a: { share: 2500 }, b: { share: 1500 } } } as never;
    expect(settleFare(3000, plan, 'b')).toBe(1125);
  });
});

describe('website estimate', () => {
  test('two riders making the same trip each pay half of one meter with an extra passenger', () => {
    const q = sameTripQuote(p('stephens-green'), p('dub'), NOW);
    const total = estimateFare({ km: q.km, minutes: q.minutes, at: NOW, passengers: 2 });
    expect(Math.abs(q.share * 2 - total)).toBeLessThanOrEqual(1);
    expect(q.share).toBeLessThan(q.fare);
    expect(q.savings).toBe(q.fare - q.share - CONFIG.matchFee);
    expect(q.savings).toBeGreaterThan(0);
  });

  test('a night trip is quoted at the night rate', () => {
    const day = sameTripQuote(p('stephens-green'), p('dub'), NOW);
    const night = sameTripQuote(p('stephens-green'), p('dub'), Date.UTC(2026, 9, 13, 22, 0));
    expect(night.tariff).toBe('premium');
    expect(night.fare).toBeGreaterThan(day.fare);
  });

  test('Irish time is right in summer and winter time, and next to the clock change', () => {
    expect(irishTime('2026-10-13', '10:00')).toBe(NOW);
    expect(irishTime('2026-12-01', '10:00')).toBe(Date.UTC(2026, 11, 1, 10, 0));
    // Clocks go back at 02:00 IST on 25 October 2026; 03:00 that morning is winter time.
    expect(irishTime('2026-10-25', '03:00')).toBe(Date.UTC(2026, 9, 25, 3, 0));
    expect(irishTime('2026-10-25', '00:30')).toBe(Date.UTC(2026, 9, 24, 23, 30));
  });
});

describe('matching', () => {
  test('two people going from nearby to the airport at the same time are matched and both save', () => {
    const a = trip('a', 'stephens-green', 'dub');
    const b = trip('b', 'trinity', 'dub', { at: NOW + 70 * MIN });
    const plan = planSharedRide(a, b, NOW);
    expect(plan).not.toBeNull();
    expect(plan!.savingsPct).toBeGreaterThanOrEqual(CONFIG.matching.minSavingsPct);
    for (const id of ['a', 'b']) {
      const r = plan!.riders[id]!;
      expect(r.savings).toBeGreaterThanOrEqual(CONFIG.matching.minNetSavings);
      expect(r.share).toBeLessThan(r.soloFare);
      expect(r.detourPct).toBeLessThanOrEqual(CONFIG.matching.maxDetour);
      expect(Number.isInteger(r.share)).toBe(true);
    }
    expect(plan!.riders.a!.share + plan!.riders.b!.share).toBe(plan!.fare);
    expect(plan!.route.filter((s) => s.kind === 'dropoff')).toHaveLength(1);
    for (const t of [a, b]) {
      expect(Math.abs(plan!.riders[t.id]!.pickupAt - t.time)).toBeLessThanOrEqual(t.flexMin * MIN);
    }
  });

  test('opposite directions are not matched', () => {
    expect(planSharedRide(trip('a', 'spire', 'dub'), trip('b', 'dub', 'spire'), NOW)).toBeNull();
  });

  test('destinations in different directions are not matched', () => {
    expect(planSharedRide(trip('a', 'stephens-green', 'dub'), trip('b', 'stephens-green', 'dun-laoghaire'), NOW)).toBeNull();
  });

  test('times that do not overlap are not matched', () => {
    const a = trip('a', 'stephens-green', 'dub', { at: NOW + 60 * MIN, flex: 15 });
    const b = trip('b', 'trinity', 'dub', { at: NOW + 180 * MIN, flex: 15 });
    expect(planSharedRide(a, b, NOW)).toBeNull();
  });

  test('arrive-by trips are matched on arrival time', () => {
    const a = trip('a', 'rathmines', 'dub', { mode: 'arrive', at: NOW + 120 * MIN, flex: 20 });
    const b = trip('b', 'ranelagh', 'dub', { mode: 'arrive', at: NOW + 125 * MIN, flex: 20 });
    const plan = planSharedRide(a, b, NOW);
    expect(plan).not.toBeNull();
    for (const t of [a, b]) {
      const drop = plan!.riders[t.id]!.dropoffAt;
      // Never late, and no earlier than they allowed.
      expect(drop).toBeLessThanOrEqual(t.time);
      expect(t.time - drop).toBeLessThanOrEqual(t.flexMin * MIN);
    }
  });

  test('arrive-by riders are never matched into arriving late', () => {
    // B needs to arrive 20 minutes before A, and won't be late; A can't be 20+ minutes early with 10 minutes' flexibility.
    const a = trip('a', 'rathmines', 'dub', { mode: 'arrive', at: NOW + 120 * MIN, flex: 10 });
    const b = trip('b', 'ranelagh', 'dub', { mode: 'arrive', at: NOW + 100 * MIN, flex: 10 });
    expect(planSharedRide(a, b, NOW)).toBeNull();
  });

  test('long regional trips match with large savings', () => {
    const plan = planSharedRide(trip('a', 'eyre-square', 'shannon'), trip('b', 'uni-galway', 'shannon', { at: NOW + 75 * MIN }), NOW);
    expect(plan).not.toBeNull();
    expect(plan!.riders.a!.savings).toBeGreaterThan(2000);
  });

  test('too many people for one taxi are not matched', () => {
    expect(planSharedRide(trip('a', 'stephens-green', 'dub', { seats: 2 }), trip('b', 'trinity', 'dub', { seats: 3 }), NOW)).toBeNull();
  });

  test('the same person is never matched with themselves', () => {
    expect(planSharedRide(trip('a', 'stephens-green', 'dub', { rider: 'r1' }), trip('b', 'trinity', 'dub', { rider: 'r1' }), NOW)).toBeNull();
  });

  test('pickups a short walk apart meet at one spot instead of adding a stop', () => {
    const a = trip('a', 'stephens-green', 'dub');
    const b = { ...trip('b', 'stephens-green', 'dub'), origin: { label: 'Dawson Street', lat: 53.3405, lng: -6.2578 } };
    const plan = planSharedRide(a, b, NOW);
    expect(plan?.meetUp).toBe(true);
    expect(plan!.route).toHaveLength(2);
    const walker = plan!.riders[plan!.bookerTripId === 'a' ? 'b' : 'a']!;
    expect(walker.walkToPickupMin).toBeGreaterThan(0);
  });

  test('pickup must be in the future', () => {
    const a = trip('a', 'stephens-green', 'dub', { at: NOW - 60 * MIN, flex: 15 });
    const b = trip('b', 'trinity', 'dub', { at: NOW - 60 * MIN, flex: 15 });
    expect(planSharedRide(a, b, NOW)).toBeNull();
  });

  test('findBestMatch prefers the closer, better-timed partner', () => {
    const me = trip('me', 'stephens-green', 'dub');
    const far = trip('far', 'heuston', 'dub', { at: NOW + 85 * MIN });
    const close = trip('close', 'trinity', 'dub', { at: NOW + 62 * MIN });
    expect(findBestMatch(me, [far, close], NOW)?.other.id).toBe('close');
  });

  test('short hops that would save less than the minimum are not matched', () => {
    // Temple Bar to Rathmines at midday saves each rider about €3 after the fee, even with the same trip.
    const a = trip('a', 'temple-bar', 'rathmines');
    const b = trip('b', 'temple-bar', 'rathmines', { at: NOW + 65 * MIN });
    expect(bestCaseSavings(a)).toBeLessThan(CONFIG.matching.minNetSavings);
    expect(planSharedRide(a, b, NOW)).toBeNull();
    // At 02:30 on a Saturday the late weekend rate makes the same hop worth sharing.
    const sat = Date.UTC(2026, 9, 17, 1, 30);
    const night = trip('a', 'temple-bar', 'rathmines', { at: sat });
    expect(bestCaseSavings(night)).toBeGreaterThanOrEqual(CONFIG.matching.minNetSavings);
    expect(planSharedRide(night, trip('b', 'temple-bar', 'rathmines', { at: sat + 5 * MIN }), sat - 60 * MIN)).not.toBeNull();
  });

  test('the best case is never less than what a real match saves', () => {
    const pairs: [TripLike, TripLike][] = [
      [trip('a', 'stephens-green', 'dub'), trip('b', 'trinity', 'dub', { at: NOW + 70 * MIN })],
      [trip('a', 'eyre-square', 'shannon'), trip('b', 'uni-galway', 'shannon', { at: NOW + 75 * MIN })],
      [trip('a', 'rathmines', 'dub', { mode: 'arrive', at: NOW + 120 * MIN, flex: 20 }), trip('b', 'ranelagh', 'dub', { mode: 'arrive', at: NOW + 125 * MIN, flex: 20 })],
    ];
    for (const [a, b] of pairs) {
      const plan = planSharedRide(a, b, NOW)!;
      expect(plan).not.toBeNull();
      expect(plan.riders.a!.savings).toBeLessThanOrEqual(bestCaseSavings(a));
      expect(plan.riders.b!.savings).toBeLessThanOrEqual(bestCaseSavings(b));
    }
  });

  test('the time to accept grows with how far ahead the trip is', () => {
    const { minMinutes, beforePickupMinutes, maxHours } = CONFIG.accept;
    // Leaving in 20 minutes: the usual 10 minutes.
    expect(acceptDeadline(NOW, NOW + 20 * MIN)).toBe(NOW + minMinutes * MIN);
    // Leaving in 3 hours: until 45 minutes before pickup.
    expect(acceptDeadline(NOW, NOW + 180 * MIN)).toBe(NOW + (180 - beforePickupMinutes) * MIN);
    // Matched at 21:00 for a 05:00 pickup: still open at 04:15, after a night's sleep.
    expect(acceptDeadline(NOW, NOW + 8 * 60 * MIN)).toBe(NOW + (8 * 60 - beforePickupMinutes) * MIN);
    // Days ahead: at most 12 hours.
    expect(acceptDeadline(NOW, NOW + 3 * 24 * 60 * MIN)).toBe(NOW + maxHours * 60 * MIN);
  });

  test('search deadline is before the latest acceptable pickup', () => {
    const t = trip('a', 'stephens-green', 'dub', { at: NOW + 60 * MIN, flex: 30 });
    expect(searchDeadline(t)).toBe(NOW + (60 + 30 - CONFIG.stopSearchingMinutesBefore) * MIN);
    // For arrive-by, the latest pickup is the one that gets you there exactly on time.
    const arrive = { ...t, timeMode: 'arrive' as const };
    expect(searchDeadline(arrive)).toBeLessThan(NOW + 60 * MIN);
  });
});

describe('what a rider saved', () => {
  test('a meter above the estimate keeps the quoted percentage instead of shrinking the saving', () => {
    const planned = { soloFare: 3000, share: 1700 };
    // The meter came in 20% higher, so their share did too.
    const share = 2040;
    expect(soloFareFor(planned, share)).toBe(3600);
    expect(rideSavings(planned, share, 199)).toBe(3600 - 2040 - 199);
    expect((soloFareFor(planned, share) - share) / soloFareFor(planned, share)).toBeCloseTo((3000 - 1700) / 3000, 4);
    // Exactly as estimated: the saving that was quoted.
    expect(rideSavings(planned, 1700, 199)).toBe(3000 - 1700 - 199);
  });
});

describe('places', () => {
  test('search finds places by prefix, word and accent-insensitively', () => {
    expect(searchKnownPlaces('dub')[0]?.id).toBe('dub');
    expect(searchKnownPlaces('green').map((p) => p.id)).toContain('stephens-green');
    expect(searchKnownPlaces('dun laoghaire')[0]?.id).toBe('dun-laoghaire');
    expect(searchKnownPlaces('zzzz')).toHaveLength(0);
  });
});
