import type { PaymentStatus, SharedPlan, TimeMode, TripLike, TripStatus, MatchStatus } from '@splitcab/core';
import type { Queryable } from '../db';
import { notFound, unauthorized } from '../errors';

export interface UserRow {
  id: string;
  phone: string | null;
  first_name: string | null;
  terms_accepted_at: Date | null;
  stripe_customer_id: string | null;
  payment_method_id: string | null;
  payment_method_brand: string | null;
  payment_method_last4: string | null;
  push_token: string | null;
  rating_sum: number;
  rating_count: number;
  rides_completed: number;
  created_at: Date;
  deleted_at: Date | null;
  is_demo: boolean;
  is_reviewer: boolean;
  revtag: string | null;
  terms_version: string | null;
  last_active_at: Date;
  suspended_at: Date | null;
  suspended_reason: string | null;
}

export interface TripRow {
  id: string;
  user_id: string;
  origin_label: string;
  origin_lat: number;
  origin_lng: number;
  dest_label: string;
  dest_lat: number;
  dest_lng: number;
  time_mode: TimeMode;
  target_time: Date;
  flex_min: number;
  seats: number;
  status: TripStatus;
  search_until: Date;
  search_from: Date | null;
  solo_fare: number;
  match_id: string | null;
  payment_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface Settlement {
  actualFare: number;
  partnerOwes: number;
  bookerShare: number;
  at: number;
  paidAt?: number;
  // Nobody entered the meter total; the shares are the accepted estimates.
  estimated?: boolean;
}

export interface MatchRow {
  id: string;
  trip_a: string;
  trip_b: string;
  status: MatchStatus;
  plan: SharedPlan;
  booker_trip_id: string;
  a_accepted_at: Date | null;
  b_accepted_at: Date | null;
  proposed_at: Date;
  expires_at: Date;
  confirmed_at: Date | null;
  ended_at: Date | null;
  cancelled_by_trip_id: string | null;
  settlement: Settlement | null;
  answer_reminded_at: Date | null;
  fare_reminders: number;
}

export interface PaymentRow {
  id: string;
  user_id: string;
  trip_id: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  provider_ref: string | null;
  client_secret: string | null;
  failure: string | null;
  created_at: Date;
  updated_at: Date;
}

export const toTripLike = (r: TripRow): TripLike => ({
  id: r.id,
  riderId: r.user_id,
  origin: { label: r.origin_label, lat: r.origin_lat, lng: r.origin_lng },
  destination: { label: r.dest_label, lat: r.dest_lat, lng: r.dest_lng },
  timeMode: r.time_mode,
  time: r.target_time.getTime(),
  flexMin: r.flex_min,
  seats: r.seats,
});

export const partnerTripId = (m: MatchRow, tripId: string) => (m.trip_a === tripId ? m.trip_b : m.trip_a);
export const acceptedAt = (m: MatchRow, tripId: string) => (m.trip_a === tripId ? m.a_accepted_at : m.b_accepted_at);

export async function getUser(q: Queryable, userId: string): Promise<UserRow> {
  const { rows } = await q.query<UserRow>('SELECT * FROM users WHERE id = $1', [userId]);
  const user = rows[0];
  if (!user || user.deleted_at) throw unauthorized();
  return user;
}

export async function getTrip(q: Queryable, tripId: string, { lock = false } = {}): Promise<TripRow | null> {
  const { rows } = await q.query<TripRow>(`SELECT * FROM trips WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [tripId]);
  return rows[0] ?? null;
}

export async function getOwnTrip(q: Queryable, userId: string, tripId: string, opts = {}): Promise<TripRow> {
  const trip = await getTrip(q, tripId, opts);
  if (!trip || trip.user_id !== userId) throw notFound('Trip not found.');
  return trip;
}

export async function getMatch(q: Queryable, matchId: string, { lock = false } = {}): Promise<MatchRow | null> {
  const { rows } = await q.query<MatchRow>(`SELECT * FROM matches WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [matchId]);
  return rows[0] ?? null;
}

export async function getPayment(q: Queryable, paymentId: string, { lock = false } = {}): Promise<PaymentRow | null> {
  const { rows } = await q.query<PaymentRow>(`SELECT * FROM payments WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [paymentId]);
  return rows[0] ?? null;
}

export async function setPaymentStatus(q: Queryable, paymentId: string, status: PaymentStatus, now: number, extra: { failure?: string } = {}) {
  await q.query(
    `UPDATE payments SET status = $2, updated_at = $3, failure = COALESCE($4, failure),
       client_secret = CASE WHEN $2 = 'requires_action' THEN client_secret ELSE NULL END
     WHERE id = $1`,
    [paymentId, status, new Date(now), extra.failure ?? null],
  );
  await q.query('INSERT INTO payment_events (payment_id, status, at) VALUES ($1, $2, $3)', [paymentId, status, new Date(now)]);
}
