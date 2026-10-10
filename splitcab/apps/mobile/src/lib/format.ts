import { formatMoney, type TripView } from '@splitcab/core';

export const money = (cents: number) => formatMoney(cents);
export const pct = (n: number) => `${Math.round(n * 100)}%`;

const clockFmt = new Intl.DateTimeFormat('en-IE', { hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('en-IE', { weekday: 'short', day: 'numeric', month: 'short' });

export const clock = (iso: string | number | Date) => clockFmt.format(new Date(iso));

// "Today 18:30", "Tomorrow 07:15", "Fri 17 Oct, 09:00"
export function when(iso: string | number | Date) {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86_400_000);
  if (d.toDateString() === today.toDateString()) return `Today ${clock(d)}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow ${clock(d)}`;
  return `${dayFmt.format(d)}, ${clock(d)}`;
}

export function tripTimeLine(t: Pick<TripView, 'timeMode' | 'time' | 'flexMin' | 'seats'>) {
  const verb = t.timeMode === 'arrive' ? 'Arrive' : 'Leave';
  const people = t.seats === 1 ? '1 traveller' : `${t.seats} travellers`;
  return `${verb} ~${when(t.time)} ± ${t.flexMin} min · ${people}`;
}

export function countdown(untilIso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((new Date(untilIso).getTime() - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Parses what someone types for a fare ("26.40", "€26,40") into cents.
export function parseEuro(input: string): number | null {
  const clean = input.replace(/[€\s]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}
