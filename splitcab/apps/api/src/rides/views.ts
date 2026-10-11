import { haversineKm, PLACES, type LatLng, type MatchView, type MeView, type PaymentView, type RouteStop, type TripView } from '@splitcab/core';
import type { Queryable } from '../db';
import { notFound } from '../errors';
import { acceptedAt, getMatch, getPayment, partnerTripId, type MatchRow, type TripRow, type UserRow } from './rows';

const iso = (d: Date | number) => new Date(d).toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

export function ratingAvg(u: Pick<UserRow, 'rating_sum' | 'rating_count'>): number | null {
  return u.rating_count > 0 ? Math.round((u.rating_sum / u.rating_count) * 10) / 10 : null;
}

export function meView(u: UserRow): MeView {
  return {
    id: u.id,
    phone: u.phone ?? '',
    firstName: u.first_name,
    termsAcceptedAt: isoOrNull(u.terms_accepted_at),
    profileComplete: Boolean(u.first_name && u.terms_accepted_at),
    paymentMethod: u.payment_method_id ? { brand: u.payment_method_brand ?? 'card', last4: u.payment_method_last4 ?? '' } : null,
    ratingAvg: ratingAvg(u),
    ridesCompleted: u.rides_completed,
  };
}

// The most recent match this trip was part of, including ones that fell through.
async function latestMatch(q: Queryable, tripId: string, currentMatchId: string | null): Promise<MatchRow | null> {
  if (currentMatchId) return getMatch(q, currentMatchId);
  const { rows } = await q.query<MatchRow>(
    'SELECT * FROM matches WHERE trip_a = $1 OR trip_b = $1 ORDER BY proposed_at DESC LIMIT 1',
    [tripId],
  );
  return rows[0] ?? null;
}

const FIVE_MIN = 5 * 60_000;

// A coarse description of someone else's stop: the nearest well-known place, or a distance band. Never their
// exact address, which could be their home.
function areaLabel(point: LatLng, from: LatLng): string {
  let best: { label: string; km: number } | null = null;
  for (const p of PLACES) {
    const km = haversineKm(point, p);
    if (km <= 2.5 && (!best || km < best.km)) best = { label: p.label, km };
  }
  if (best) return `${best.label.replace(/ \(.*\)$/, '')} area`;
  const km = Math.max(0.5, Math.round(haversineKm(point, from) * 2) / 2);
  return `About ${km} km from you`;
}

async function matchView(q: Queryable, trip: TripRow, m: MatchRow): Promise<MatchView> {
  const otherId = partnerTripId(m, trip.id);
  const { rows } = await q.query<TripRow & { u_first_name: string | null; u_rating_sum: number; u_rating_count: number; u_rides: number; u_deleted: Date | null }>(
    `SELECT t.*, u.first_name AS u_first_name, u.rating_sum AS u_rating_sum, u.rating_count AS u_rating_count,
            u.rides_completed AS u_rides, u.deleted_at AS u_deleted
     FROM trips t JOIN users u ON u.id = t.user_id WHERE t.id = $1`,
    [otherId],
  );
  const other = rows[0]!;
  const extras = await q.query<{ rated: boolean; blocked: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM ratings WHERE match_id = $1 AND rater_id = $2) AS rated,
            EXISTS (SELECT 1 FROM blocks WHERE blocker_id = $2 AND blocked_id = $3) AS blocked`,
    [m.id, trip.user_id, other.user_id],
  );
  const plan = m.plan;
  const me = plan.riders[trip.id]!;
  const partnerPlan = plan.riders[otherId]!;
  // The partner's exact stops stay approximate until both people have said yes.
  const revealed = m.status === 'confirmed' || m.status === 'completed';
  const youBook = m.booker_trip_id === trip.id;
  const s = m.settlement;
  const myOrigin = { lat: trip.origin_lat, lng: trip.origin_lng };
  const myDest = { lat: trip.dest_lat, lng: trip.dest_lng };
  // A stop at the partner's place, shown before both accept. When it's no walk from your own place, it's
  // effectively yours, so show your own place rather than theirs.
  const hiddenStop = (stop: RouteStop, mine: boolean): { label: string; lat: number | null; lng: number | null } => {
    const pickup = stop.kind === 'pickup';
    const walk = pickup ? me.walkToPickupMin : me.walkFromDropMin;
    if (mine && walk === 0) return pickup ? { label: trip.origin_label, ...myOrigin } : { label: trip.dest_label, ...myDest };
    if (mine && pickup) return { label: `Meeting point, about ${walk} min walk`, lat: null, lng: null };
    if (mine) return { label: `Shared drop-off, about ${walk} min walk from your destination`, lat: null, lng: null };
    return { label: areaLabel(stop, pickup ? myOrigin : myDest), lat: null, lng: null };
  };

  return {
    id: m.id,
    status: m.status,
    proposedAt: iso(m.proposed_at),
    expiresAt: iso(m.expires_at),
    confirmedAt: isoOrNull(m.confirmed_at),
    endedAt: isoOrNull(m.ended_at),
    cancelledByPartner: m.cancelled_by_trip_id === otherId,
    cancelledByMe: m.cancelled_by_trip_id === trip.id,
    youAccepted: Boolean(acceptedAt(m, trip.id)),
    partnerAccepted: Boolean(acceptedAt(m, otherId)),
    youBook,
    youRated: extras.rows[0]!.rated,
    youBlocked: extras.rows[0]!.blocked,
    partner: {
      firstName: other.u_deleted ? 'Former member' : (other.u_first_name ?? 'Traveller'),
      ratingAvg: ratingAvg({ rating_sum: other.u_rating_sum, rating_count: other.u_rating_count }),
      ridesCompleted: other.u_rides,
      seats: other.seats,
    },
    plan: {
      startAt: iso(revealed ? plan.startAt : Math.round(plan.startAt / FIVE_MIN) * FIVE_MIN),
      fare: plan.fare,
      totalKm: revealed ? plan.totalKm : Math.round(plan.totalKm),
      totalMin: plan.totalMin,
      savingsPct: plan.savingsPct,
      meetUp: plan.meetUp,
      you: {
        soloFare: me.soloFare,
        share: me.share,
        fee: me.fee,
        savings: me.savings,
        detourPct: me.detourPct,
        pickupAt: iso(me.pickupAt),
        dropoffAt: iso(me.dropoffAt),
        walkToPickupMin: me.walkToPickupMin,
        walkFromDropMin: me.walkFromDropMin,
      },
      partner: { share: partnerPlan.share },
      route: plan.route.map((stop) => {
        const mine = stop.tripIds.includes(trip.id);
        // A stop sits at the first listed rider's own origin or destination. Before both accept, only that
        // rider sees its exact place, even when the other rider shares the stop (meeting point, shared drop-off).
        const visible = revealed || stop.tripIds[0] === trip.id;
        const place = visible ? { label: stop.label, lat: stop.lat, lng: stop.lng } : hiddenStop(stop, mine);
        return {
          kind: stop.kind,
          you: mine,
          partner: stop.tripIds.includes(otherId),
          ...place,
          at: iso(visible ? stop.at : Math.round(stop.at / FIVE_MIN) * FIVE_MIN),
        };
      }),
    },
    settlement: s
      ? { actualFare: s.actualFare, youOwe: youBook ? 0 : s.partnerOwes, owedToYou: youBook ? s.partnerOwes : 0, at: iso(s.at) }
      : null,
  };
}

export async function tripView(q: Queryable, trip: TripRow): Promise<TripView> {
  const payment = trip.payment_id ? await getPayment(q, trip.payment_id) : null;
  const match = await latestMatch(q, trip.id, trip.match_id);
  return {
    id: trip.id,
    status: trip.status,
    origin: { label: trip.origin_label, lat: trip.origin_lat, lng: trip.origin_lng },
    destination: { label: trip.dest_label, lat: trip.dest_lat, lng: trip.dest_lng },
    timeMode: trip.time_mode,
    time: iso(trip.target_time),
    flexMin: trip.flex_min,
    seats: trip.seats,
    searchUntil: iso(trip.search_until),
    soloFare: trip.solo_fare,
    createdAt: iso(trip.created_at),
    payment: payment ? { id: payment.id, status: payment.status, amount: payment.amount, currency: payment.currency } : null,
    paymentAction:
      payment?.status === 'requires_action' && payment.client_secret && trip.status === 'pending_payment'
        ? { clientSecret: payment.client_secret }
        : null,
    match: match ? await matchView(q, trip, match) : null,
  };
}

export async function tripViewById(q: Queryable, userId: string, tripId: string): Promise<TripView> {
  const { rows } = await q.query<TripRow>('SELECT * FROM trips WHERE id = $1 AND user_id = $2', [tripId, userId]);
  if (!rows[0]) throw notFound('Trip not found.');
  return tripView(q, rows[0]);
}

export async function listTripViews(q: Queryable, userId: string, scope: 'active' | 'past'): Promise<TripView[]> {
  const active = ['pending_payment', 'searching', 'proposed', 'confirmed'];
  const { rows } = await q.query<TripRow>(
    `SELECT * FROM trips WHERE user_id = $1 AND (status = ANY($2::text[])) = $3 ORDER BY target_time ${scope === 'active' ? 'ASC' : 'DESC'} LIMIT 50`,
    [userId, active, scope === 'active'],
  );
  return Promise.all(rows.map((t) => tripView(q, t)));
}

export async function listPaymentViews(q: Queryable, userId: string): Promise<PaymentView[]> {
  const { rows } = await q.query<{
    id: string;
    trip_id: string;
    status: PaymentView['status'];
    amount: number;
    currency: string;
    origin_label: string;
    dest_label: string;
    target_time: Date;
    history: { status: PaymentView['status']; at: string }[];
  }>(
    `SELECT p.id, p.trip_id, p.status, p.amount, p.currency, t.origin_label, t.dest_label, t.target_time,
            COALESCE((SELECT json_agg(json_build_object('status', e.status, 'at', e.at) ORDER BY e.id)
                      FROM payment_events e WHERE e.payment_id = p.id), '[]') AS history
     FROM payments p JOIN trips t ON t.id = p.trip_id
     WHERE p.user_id = $1 AND p.status <> 'pending'
     ORDER BY p.created_at DESC LIMIT 100`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    tripId: r.trip_id,
    status: r.status,
    amount: r.amount,
    currency: r.currency,
    trip: { from: r.origin_label, to: r.dest_label, time: iso(r.target_time) },
    history: r.history.map((h) => ({ status: h.status, at: iso(new Date(h.at)) })),
  }));
}
