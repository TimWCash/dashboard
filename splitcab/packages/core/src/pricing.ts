import { CONFIG, type Tariff } from './config';
import { roadKm, driveMinutes } from './geo';
import type { LatLng } from './types';

const localParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: CONFIG.timeZone,
  weekday: 'short',
  hour: 'numeric',
  hourCycle: 'h23',
});

// Which NTA tariff a taxi starting at `at` (epoch ms) runs on. Public holidays (premium all day) aren't modelled yet.
export function tariffAt(at: number, fare = CONFIG.fare): Tariff {
  const parts = Object.fromEntries(localParts.formatToParts(new Date(at)).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour);
  const day = parts.weekday;
  if ((day === 'Sat' || day === 'Sun') && hour < 4) return fare.tariffs.special;
  if (day === 'Sun' || hour >= 20 || hour < 8) return fare.tariffs.premium;
  return fare.tariffs.standard;
}

export interface FareInput {
  km: number;
  minutes: number;
  at: number;
  passengers?: number;
  booked?: boolean;
}

// Metered fare estimate in cents. The meter runs on distance or time, whichever is faster, so take the larger of the two.
export function estimateFare({ km, minutes, at, passengers = 1, booked = true }: FareInput, fare = CONFIG.fare): number {
  const t = tariffAt(at, fare);
  const billableKm = Math.max(0, km - t.initialKm);
  const billableMin = Math.max(0, minutes - t.initialMin);
  const kmOnA = Math.min(billableKm, Math.max(0, fare.tariffBFromKm - t.initialKm));
  const shareOnA = billableKm > 0 ? kmOnA / billableKm : 1;
  const byDistance = kmOnA * t.a.perKm + (billableKm - kmOnA) * t.b.perKm;
  const byTime = billableMin * (shareOnA * t.a.perMin + (1 - shareOnA) * t.b.perMin);
  const extras = Math.max(0, passengers - 1) * fare.extraPassenger + (booked ? fare.bookingFee : 0);
  return Math.round(t.initial + Math.max(byDistance, byTime) + extras);
}

export interface SoloEstimate {
  km: number;
  minutes: number;
  fare: number;
  tariff: Tariff['id'];
  tariffLabel: string;
}

export function soloEstimate(origin: LatLng, destination: LatLng, { at, passengers = 1 }: { at: number; passengers?: number }): SoloEstimate {
  const km = roadKm(origin, destination);
  const minutes = driveMinutes(km);
  const tariff = tariffAt(at);
  return { km, minutes, fare: estimateFare({ km, minutes, passengers, at }), tariff: tariff.id, tariffLabel: tariff.label };
}

// Each rider pays the shared fare in proportion to what they'd have paid alone, so both save the same
// percentage and nobody subsidises the other. Works in whole cents; shares always add up to the total.
export function splitProportional(total: number, soloFares: number[]): number[] {
  const soloTotal = soloFares.reduce((sum, f) => sum + f, 0);
  const shares = soloFares.map((f) => Math.round((total * f) / soloTotal));
  const drift = total - shares.reduce((sum, s) => sum + s, 0);
  if (drift !== 0) {
    const i = soloFares.indexOf(Math.max(...soloFares));
    shares[i] = (shares[i] ?? 0) + drift;
  }
  return shares;
}

export interface SameTripQuote extends SoloEstimate {
  // Each rider's share of the one taxi.
  share: number;
  matchFee: number;
  // What each rider saves against going alone, after the match fee.
  savings: number;
}

// What a trip costs shared when the other rider makes the same trip: one meter with an extra passenger, split
// in half. A partner with a different stop adds some distance, so this is the best case; the app quotes the
// exact shares for a real match.
export function sameTripQuote(origin: LatLng, destination: LatLng, at: number): SameTripQuote {
  const solo = soloEstimate(origin, destination, { at });
  const total = estimateFare({ km: solo.km, minutes: solo.minutes, at, passengers: 2 });
  const [share = total] = splitProportional(total, [solo.fare, solo.fare]);
  return { ...solo, share, matchFee: CONFIG.matchFee, savings: solo.fare - share - CONFIG.matchFee };
}

const zoneParts = (timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });

// The moment a wall-clock date and time ("2026-10-13", "18:30") happen in Ireland, whatever the device's time zone.
export function irishTime(date: string, time: string, timeZone: string = CONFIG.timeZone): number {
  const [y = 0, mo = 1, d = 1] = date.split('-').map(Number);
  const [h = 0, mi = 0] = time.split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const fmt = zoneParts(timeZone);
  const offset = (at: number) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(at)).map((x) => [x.type, Number(x.value)]));
    return Date.UTC(p.year ?? 0, (p.month ?? 1) - 1, p.day ?? 1, p.hour ?? 0, p.minute ?? 0) - at;
  };
  // The offset at the first guess can be an hour out next to a clock change, so check it at the second.
  const guess = wall - offset(wall);
  return wall - offset(guess);
}

export function formatMoney(cents: number, locale: string = CONFIG.locale, currency: string = CONFIG.currency): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}
