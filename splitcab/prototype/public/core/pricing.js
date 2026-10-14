import { CONFIG } from './config.js';
import { roadKm, driveMinutes } from './geo.js';

export const round2 = (n) => Math.round(n * 100) / 100;

const localParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: CONFIG.timeZone,
  weekday: 'short',
  hour: 'numeric',
  hourCycle: 'h23',
});

// Which NTA tariff a taxi starting at `at` runs on. Public holidays (premium all day) aren't modelled yet.
export function tariffAt(at, fare = CONFIG.fare) {
  const parts = Object.fromEntries(localParts.formatToParts(new Date(at)).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour);
  const day = parts.weekday;
  if ((day === 'Sat' || day === 'Sun') && hour < 4) return fare.tariffs.special;
  if (day === 'Sun' || hour >= 20 || hour < 8) return fare.tariffs.premium;
  return fare.tariffs.standard;
}

// Metered fare estimate. The meter runs on distance or time, whichever is faster, so take the larger of the two.
export function estimateFare({ km, minutes, passengers = 1, at, booked = true }, fare = CONFIG.fare) {
  const t = tariffAt(at, fare);
  const billableKm = Math.max(0, km - t.initialKm);
  const billableMin = Math.max(0, minutes - t.initialMin);
  const kmOnA = Math.min(billableKm, Math.max(0, fare.tariffBFromKm - t.initialKm));
  const shareOnA = billableKm > 0 ? kmOnA / billableKm : 1;
  const byDistance = kmOnA * t.a.perKm + (billableKm - kmOnA) * t.b.perKm;
  const byTime = billableMin * (shareOnA * t.a.perMin + (1 - shareOnA) * t.b.perMin);
  const extras = Math.max(0, passengers - 1) * fare.extraPassenger + (booked ? fare.bookingFee : 0);
  return round2(t.initial + Math.max(byDistance, byTime) + extras);
}

export function soloEstimate(origin, destination, { at, passengers = 1 }) {
  const km = roadKm(origin, destination);
  const minutes = driveMinutes(km);
  return { km, minutes, fare: estimateFare({ km, minutes, passengers, at }), tariff: tariffAt(at).label };
}

// Each rider pays the shared fare in proportion to what they'd have paid alone,
// so both save the same percentage and nobody subsidises the other.
export function splitProportional(totalFare, soloFares) {
  const soloTotal = soloFares.reduce((sum, f) => sum + f, 0);
  const shares = soloFares.map((f) => round2((totalFare * f) / soloTotal));
  // Put any rounding cent on the larger share so the shares always add up to the fare.
  const drift = round2(totalFare - shares.reduce((sum, s) => sum + s, 0));
  if (drift !== 0) {
    const i = soloFares.indexOf(Math.max(...soloFares));
    shares[i] = round2(shares[i] + drift);
  }
  return shares;
}
