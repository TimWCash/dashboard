import { haversineKm, PLACES, RETENTION, type LatLng, type SharedPlan } from '@splitcab/core';
import type { Queryable } from '../db';
import type { TripRow } from './rows';

const DAY = 86_400_000;

export { RETENTION };

export const daysAgo = (now: number, days: number) => new Date(now - days * DAY);

// The nearest well-known place, for describing a location without giving it away.
export function nearestArea(point: LatLng, withinKm = 2.5): string | null {
  let best: { label: string; km: number } | null = null;
  for (const p of PLACES) {
    const km = haversineKm(point, p);
    if (km <= withinKm && (!best || km < best.km)) best = { label: p.label.replace(/ \(.*\)$/, ''), km };
  }
  return best?.label ?? null;
}

export const areaName = (point: LatLng) => {
  const area = nearestArea(point);
  return area ? `${area} area` : 'Elsewhere in Ireland';
};

// Rounds to two decimal places: about a kilometre, enough for accounting and disputes but not to find
// anyone's front door.
const blur = (n: number) => Math.round(n * 100) / 100;

// Replaces trips' exact places with a rough area, in the trips themselves and in the ride plans that copy them.
export async function blurTrips(tx: Queryable, tripIds: string[], now: number, label: (point: LatLng) => string) {
  if (!tripIds.length) return;
  const { rows } = await tx.query<TripRow>('SELECT * FROM trips WHERE id = ANY($1) FOR UPDATE', [tripIds]);
  for (const t of rows) {
    const origin = { lat: t.origin_lat, lng: t.origin_lng };
    const dest = { lat: t.dest_lat, lng: t.dest_lng };
    await tx.query(
      `UPDATE trips SET origin_label = $2, dest_label = $3, origin_lat = $4, origin_lng = $5, dest_lat = $6, dest_lng = $7, blurred_at = $8
       WHERE id = $1`,
      [t.id, label(origin), label(dest), blur(origin.lat), blur(origin.lng), blur(dest.lat), blur(dest.lng), new Date(now)],
    );
  }
  const ids = new Set(tripIds);
  const { rows: plans } = await tx.query<{ id: string; plan: SharedPlan }>(
    'SELECT id, plan FROM matches WHERE trip_a = ANY($1) OR trip_b = ANY($1) FOR UPDATE',
    [tripIds],
  );
  for (const { id, plan } of plans) {
    // A stop sits at its first listed rider's own place.
    const route = plan.route.map((s) => (ids.has(s.tripIds[0]!) ? { ...s, label: label(s), lat: blur(s.lat), lng: blur(s.lng) } : s));
    await tx.query('UPDATE matches SET plan = $2 WHERE id = $1', [id, { ...plan, route }]);
  }
}

// Deletes trips older than the cutoff with everything that hangs off them: matches, payments, ratings and
// messages. A match goes only when both its trips are old enough.
export async function deleteOldRecords(tx: Queryable, cutoff: Date, activeStatuses: readonly string[]) {
  const { rows } = await tx.query<{ id: string }>('SELECT id FROM trips WHERE target_time < $1 AND status <> ALL($2) LIMIT 1000', [cutoff, activeStatuses]);
  if (!rows.length) return 0;
  const old = new Set(rows.map((r) => r.id));
  const { rows: linked } = await tx.query<{ id: string; trip_a: string; trip_b: string; booker_trip_id: string; cancelled_by_trip_id: string | null }>(
    'SELECT id, trip_a, trip_b, booker_trip_id, cancelled_by_trip_id FROM matches WHERE trip_a = ANY($1) OR trip_b = ANY($1)',
    [[...old]],
  );
  const tripsOf = (m: (typeof linked)[number]) => [m.trip_a, m.trip_b, m.booker_trip_id, m.cancelled_by_trip_id].filter((t): t is string => Boolean(t));
  const { rows: partners } = await tx.query<{ id: string }>('SELECT id FROM trips WHERE id = ANY($1) AND target_time < $2 AND status <> ALL($3)', [
    linked.flatMap(tripsOf),
    new Date(cutoff.getTime() + DAY),
    activeStatuses,
  ]);
  for (const p of partners) old.add(p.id);
  const keep = linked.filter((m) => !tripsOf(m).every((t) => old.has(t)));
  for (const m of keep) for (const t of tripsOf(m)) old.delete(t);
  const trips = [...old];
  const matches = linked.filter((m) => !keep.includes(m)).map((m) => m.id);

  await tx.query('UPDATE trips SET match_id = NULL, payment_id = NULL WHERE id = ANY($1)', [trips]);
  await tx.query('UPDATE trips SET match_id = NULL WHERE match_id = ANY($1)', [matches]);
  await tx.query('DELETE FROM messages WHERE match_id = ANY($1) OR trip_id = ANY($2)', [matches, trips]);
  await tx.query('DELETE FROM ratings WHERE match_id = ANY($1)', [matches]);
  await tx.query('UPDATE reports SET match_id = NULL WHERE match_id = ANY($1)', [matches]);
  await tx.query('DELETE FROM payment_events WHERE payment_id IN (SELECT id FROM payments WHERE trip_id = ANY($1))', [trips]);
  await tx.query('DELETE FROM payments WHERE trip_id = ANY($1)', [trips]);
  await tx.query('DELETE FROM trip_exclusions WHERE trip_id = ANY($1) OR other_trip_id = ANY($1)', [trips]);
  await tx.query('DELETE FROM matches WHERE id = ANY($1)', [matches]);
  await tx.query('DELETE FROM trips WHERE id = ANY($1)', [trips]);
  return trips.length;
}
