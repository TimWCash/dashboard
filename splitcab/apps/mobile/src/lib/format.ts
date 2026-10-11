import { formatMoney, type TripView } from '@splitcab/core';

export const money = (cents: number) => formatMoney(cents);
export const pct = (n: number) => `${Math.round(n * 100)}%`;

const pad = (n: number) => String(n).padStart(2, '0');
const dayFmt = new Intl.DateTimeFormat('en-IE', { weekday: 'short', day: 'numeric', month: 'short' });

// Always 24-hour with a leading zero ("02:00", "14:30"), so a time can't be misread as am/pm.
export const clock = (iso: string | number | Date) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function dayWord(d: Date) {
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'today';
  if (d.toDateString() === tomorrow.toDateString()) return 'tomorrow';
  return dayFmt.format(d);
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// "Today 01:58", "Tomorrow 07:15", "Sat 11 Oct, 09:00"
export function when(iso: string | number | Date) {
  const d = new Date(iso);
  const day = dayWord(d);
  return day === 'today' || day === 'tomorrow' ? `${capital(day)} ${clock(d)}` : `${day}, ${clock(d)}`;
}

// "Leave today between 01:30 and 02:30" / "Arrive by 08:00 tomorrow" / for past trips "Sat 11 Oct, 01:58".
export function tripTimeLine(t: Pick<TripView, 'timeMode' | 'time' | 'flexMin' | 'seats' | 'status'>) {
  const time = new Date(t.time);
  const people = t.seats > 1 ? ` · ${t.seats} people` : '';
  const past = ['completed', 'expired', 'cancelled'].includes(t.status);
  if (past) return `${capital(when(time))}${people}`;
  if (t.timeMode === 'arrive') {
    return `Arrive by ${clock(time)} ${dayWord(time)}${people}`;
  }
  const from = new Date(time.getTime() - t.flexMin * 60_000);
  const to = new Date(time.getTime() + t.flexMin * 60_000);
  return `Leave ${dayWord(time)} between ${clock(from)} and ${clock(to)}${people}`;
}

export function countdown(untilIso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((new Date(untilIso).getTime() - now) / 1000));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

// Parses what someone types for a fare ("26.40", "€26,40") into cents.
export function parseEuro(input: string): number | null {
  const clean = input.replace(/[€\s]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

// "+353 87 555 0101" for Irish mobiles; other numbers as given.
export function formatPhone(e164: string) {
  const m = /^\+353(8\d)(\d{3})(\d{4})$/.exec(e164);
  return m ? `+353 ${m[1]} ${m[2]} ${m[3]}` : e164;
}
