import { PLACES, placeById } from './places.js';

const MINUTE = 60_000;
const NAMES = ['Aoife', 'Cian', 'Niamh', 'Darragh', 'Saoirse', 'Oisín', 'Ciara', 'Seán', 'Emma', 'Jack', 'Priya', 'Tomás', 'Sophie', 'Luca'];

// Popular routes simulated travelers are taking, so a first-time visitor has someone to match with.
const ROUTES = [
  ['spire', 'dub'], ['stephens-green', 'dub'], ['trinity', 'dub'], ['heuston', 'dub'], ['grand-canal', 'dub'],
  ['rathmines', 'dub'], ['ranelagh', 'dub'], ['smithfield', 'dub'], ['ucd', 'dub'], ['dun-laoghaire', 'dub'],
  ['sandyford', 'dub'], ['dub', 'spire'], ['dub', 'grand-canal'], ['dub', 'heuston'],
  ['temple-bar', '3arena'], ['ranelagh', 'aviva'], ['spire', 'croke-park'],
  ['cork-city', 'cork-airport'], ['kent', 'cork-airport'], ['cork-airport', 'cork-city'],
  ['eyre-square', 'shannon'], ['limerick', 'shannon'], ['ul', 'shannon'],
];

const pick = (rand, list) => list[Math.floor(rand() * list.length)];

// Small deterministic PRNG so a seeded demo looks the same each time.
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Move a point roughly `km` in a random direction.
function jitter(place, km, rand) {
  const angle = rand() * 2 * Math.PI;
  const dLat = (km / 111) * Math.cos(angle);
  const dLng = (km / (111 * Math.cos((place.lat * Math.PI) / 180))) * Math.sin(angle);
  return { lat: place.lat + dLat, lng: place.lng + dLng };
}

function simRider(service, rand, now) {
  return service.createRider(
    { name: pick(rand, NAMES), simulated: true, rating: Math.round((4.6 + rand() * 0.4) * 10) / 10, tripsTaken: 1 + Math.floor(rand() * 40) },
    now,
  );
}

export function seedDemo(service, now, { trips = 36, seed = 7 } = {}) {
  const rand = mulberry32(seed);
  const roundTo5 = (t) => Math.round(t / (5 * MINUTE)) * 5 * MINUTE;
  for (let i = 0; i < trips; i++) {
    const [from, to] = ROUTES[i % ROUTES.length];
    const origin = placeById(from);
    const destination = placeById(to);
    const rider = simRider(service, rand, now);
    service.postTrip(
      rider.id,
      {
        origin: { label: origin.label, ...jitter(origin, rand() * 0.4, rand) },
        destination: { label: destination.label, lat: destination.lat, lng: destination.lng },
        timeMode: rand() < 0.7 ? 'depart' : 'arrive',
        // Spread across the next 12 hours.
        time: roundTo5(now + (45 + rand() * 11 * 60) * MINUTE),
        flexMin: pick(rand, [30, 30, 45, 60]),
        seats: rand() < 0.85 ? 1 : 2,
      },
      now,
    );
  }
}

// Demo control: post a trip from a simulated traveler a short walk from yours, going the same way.
// The normal matching rules still decide whether you're paired.
export function addNearbyTraveler(service, trip, now) {
  const rand = Math.random;
  const rider = simRider(service, rand, now);
  return service.postTrip(
    rider.id,
    {
      origin: { label: nearestLabel(trip.origin), ...jitter(trip.origin, 0.2 + rand() * 0.6, rand) },
      destination: { ...trip.destination },
      timeMode: trip.timeMode,
      time: trip.time + Math.round(rand() * 10) * MINUTE,
      flexMin: 30,
      seats: 1,
    },
    now,
  );
}

function nearestLabel(point) {
  let best = PLACES[0];
  let bestD = Infinity;
  for (const p of PLACES) {
    const d = (p.lat - point.lat) ** 2 + (p.lng - point.lng) ** 2;
    if (d < bestD) [best, bestD] = [p, d];
  }
  return best.label;
}
