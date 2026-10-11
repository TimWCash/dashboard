import {
  CONFIG,
  boxAround,
  findBestMatch,
  isValidLatLng,
  roadKm,
  searchDeadline,
  settleFare,
  soloWindow,
  type Place,
  type ReportReason,
  type SharedPlan,
  type TripInput,
} from '@splitcab/core';
import { lockMatching, withTx, type Tx } from '../db';
import { createModerator } from '../moderation';
import type { Deps } from '../deps';
import { AppError, badRequest, conflict, forbidden, notFound } from '../errors';
import { enqueue } from '../jobs/queue';
import { notify } from '../notifications';
import type { AuthorizeResult } from '../providers/payments';
import {
  getMatch,
  getOwnTrip,
  getPayment,
  getTrip,
  getUser,
  partnerTripId,
  setPaymentStatus,
  toTripLike,
  type MatchRow,
  type TripRow,
  type UserRow,
} from './rows';

const MINUTE = 60_000;
const ACTIVE = ['pending_payment', 'searching', 'proposed', 'confirmed'];
// A hold the rider never authenticated is abandoned after this long.
const PENDING_PAYMENT_TIMEOUT_MS = 30 * MINUTE;
const MAX_TRIPS_PER_DAY = 20;
// After a match falls through, the same two people aren't proposed to each other again for this long.
const PAIR_COOLDOWN_MS = 24 * 60 * MINUTE;
// A confirmed ride nobody settled is closed this long after its last drop-off.
const AUTO_COMPLETE_AFTER_MS = 6 * 60 * MINUTE;

function inServiceArea(p: Place) {
  const a = CONFIG.trips.serviceArea;
  return p.lat >= a.minLat && p.lat <= a.maxLat && p.lng >= a.minLng && p.lng <= a.maxLng;
}

function cleanPlace(p: Place): Place {
  return { label: p.label.trim().slice(0, 120), lat: p.lat, lng: p.lng };
}

export class RideService {
  private moderate: ReturnType<typeof createModerator>;

  constructor(private deps: Deps) {
    this.moderate = createModerator(deps.config.BLOCKED_TERMS.split(','));
  }

  private now() {
    return this.deps.clock();
  }

  private tx<T>(fn: (tx: Tx) => Promise<T>) {
    return withTx(this.deps.db, async (tx) => {
      await lockMatching(tx);
      return fn(tx);
    });
  }

  // ---- posting a trip ----------------------------------------------------------------

  async postTrip(userId: string, input: TripInput): Promise<string> {
    const now = this.now();
    const user = await getUser(this.deps.db, userId);
    if (!user.first_name || !user.terms_accepted_at) throw conflict('profile_incomplete', 'Finish setting up your profile first.');
    if (!user.payment_method_id || !user.stripe_customer_id) throw conflict('payment_method_required', 'Add a card before posting a trip.');

    const origin = cleanPlace(input.origin);
    const destination = cleanPlace(input.destination);
    if (!isValidLatLng(origin) || !isValidLatLng(destination) || !origin.label || !destination.label) {
      throw badRequest('invalid_place', 'Choose where you are leaving from and going to.');
    }
    if (!inServiceArea(origin) || !inServiceArea(destination)) throw badRequest('outside_service_area', 'SplitCab is only available in Ireland for now.');
    // Labels are shown to the other traveller once matched, so they go through the same filter as chat.
    if (!this.moderate(origin.label).ok || !this.moderate(destination.label).ok) {
      throw badRequest('invalid_place', 'Choose the pickup and destination from the search results.');
    }
    if (roadKm(origin, destination) < CONFIG.trips.minTripKm) {
      throw badRequest('trip_too_short', 'Pickup and destination are too close together to share a taxi.');
    }
    const time = Date.parse(input.time);
    if (!Number.isFinite(time)) throw badRequest('invalid_time', 'Choose a time.');
    if (time > now + CONFIG.trips.maxDaysAhead * 24 * 60 * MINUTE) {
      throw badRequest('too_far_ahead', `You can post trips up to ${CONFIG.trips.maxDaysAhead} days ahead.`);
    }
    const like = { origin, destination, timeMode: input.timeMode, time, flexMin: input.flexMin, seats: input.seats };
    const searchUntil = searchDeadline(like);
    if (searchUntil <= now + MINUTE) {
      throw badRequest('too_soon', 'That time is too soon to find someone. Pick a later time or allow more flexibility.');
    }
    const soloFare = soloWindow(like).solo.fare;

    const { tripId, paymentId } = await this.tx(async (tx) => {
      const { rows: active } = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM trips WHERE user_id = $1 AND status = ANY($2)', [
        userId,
        ACTIVE,
      ]);
      if ((active[0]?.n ?? 0) >= CONFIG.trips.maxActiveTripsPerRider) {
        throw conflict('too_many_trips', `You can have up to ${CONFIG.trips.maxActiveTripsPerRider} trips open at once.`);
      }
      // Posting and abandoning trips over and over is how someone would probe where other people travel from.
      const { rows: today } = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM trips WHERE user_id = $1 AND created_at > $2', [
        userId,
        new Date(now - 86_400_000),
      ]);
      if ((today[0]?.n ?? 0) >= MAX_TRIPS_PER_DAY) throw new AppError(429, 'rate_limited', "You've posted a lot of trips today. Try again tomorrow.");
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO trips (user_id, origin_label, origin_lat, origin_lng, dest_label, dest_lat, dest_lng, time_mode, target_time,
                            flex_min, seats, status, search_until, solo_fare, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending_payment', $12, $13, $14, $14) RETURNING id`,
        [
          userId,
          origin.label,
          origin.lat,
          origin.lng,
          destination.label,
          destination.lat,
          destination.lng,
          input.timeMode,
          new Date(time),
          input.flexMin,
          input.seats,
          new Date(searchUntil),
          soloFare,
          new Date(now),
        ],
      );
      const tripId = rows[0]!.id;
      const paymentId = await this.createPayment(tx, userId, tripId, now);
      return { tripId, paymentId };
    });

    // The card call happens outside any transaction. If we crash before recording the result, the
    // webhook (or the sweeper's timeout) reconciles it.
    const result = await this.deps.payments.authorize({
      amount: CONFIG.matchFee,
      currency: CONFIG.currency,
      customerId: user.stripe_customer_id,
      paymentMethodId: user.payment_method_id,
      offSession: false,
      idempotencyKey: `authorize:${paymentId}`,
      metadata: { paymentId, tripId, userId },
    });
    await this.applyAuthorization(paymentId, result);
    if (result.status === 'failed') throw new AppError(402, 'card_declined', result.failure ?? 'Your card was declined.');
    return tripId;
  }

  private async createPayment(tx: Tx, userId: string, tripId: string, now: number): Promise<string> {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO payments (user_id, trip_id, amount, currency, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'pending', $5, $5) RETURNING id`,
      [userId, tripId, CONFIG.matchFee, CONFIG.currency, new Date(now)],
    );
    const paymentId = rows[0]!.id;
    await tx.query('UPDATE trips SET payment_id = $2 WHERE id = $1', [tripId, paymentId]);
    return paymentId;
  }

  // Records the outcome of placing a hold, and starts searching once it's in place.
  async applyAuthorization(paymentId: string, result: AuthorizeResult, { offSession = false } = {}) {
    await this.tx(async (tx) => {
      const now = this.now();
      const payment = await getPayment(tx, paymentId, { lock: true });
      if (!payment) return;
      if (!payment.provider_ref) await tx.query('UPDATE payments SET provider_ref = $2 WHERE id = $1', [paymentId, result.ref]);
      if (payment.status !== 'pending' && payment.status !== 'requires_action') return;
      const trip = await getTrip(tx, payment.trip_id, { lock: true });
      if (!trip) return;
      const stillWanted = trip.status === 'pending_payment' && trip.payment_id === payment.id;

      if (result.status === 'authorized') {
        await setPaymentStatus(tx, paymentId, 'authorized', now);
        if (!stillWanted) {
          // The rider cancelled (or the trip lapsed) while the hold was being placed.
          await enqueue(tx, now, 'payment.cancel', { paymentId });
        } else if (now >= trip.search_until.getTime()) {
          await this.setTrip(tx, trip.id, { status: 'expired' }, now);
          await enqueue(tx, now, 'payment.cancel', { paymentId });
        } else {
          await this.setTrip(tx, trip.id, { status: 'searching' }, now);
          const match = await this.tryMatch(tx, { ...trip, status: 'searching' }, now);
          if (!match && (await this.isReviewer(tx, trip.user_id))) await this.addReviewCompanion(tx, { ...trip, status: 'searching' }, now);
        }
      } else if (result.status === 'requires_action') {
        await tx.query('UPDATE payments SET client_secret = $2 WHERE id = $1', [paymentId, result.clientSecret ?? null]);
        await setPaymentStatus(tx, paymentId, 'requires_action', now);
        if (offSession && stillWanted) await notify(tx, now, trip.user_id, { kind: 'payment_action_required' }, { tripId: trip.id });
      } else if (result.status === 'failed') {
        await setPaymentStatus(tx, paymentId, 'failed', now, { failure: result.failure });
        if (stillWanted) {
          await this.setTrip(tx, trip.id, { status: 'cancelled' }, now);
          if (offSession) await notify(tx, now, trip.user_id, { kind: 'payment_failed' }, { tripId: trip.id });
        }
      }
    });
  }

  // Called by the app after the rider completes 3-D Secure.
  async confirmPayment(userId: string, tripId: string) {
    const trip = await getOwnTrip(this.deps.db, userId, tripId);
    if (trip.status !== 'pending_payment' || !trip.payment_id) return;
    const payment = await getPayment(this.deps.db, trip.payment_id);
    if (!payment?.provider_ref || payment.status !== 'requires_action') return;
    const result = await this.deps.payments.retrieve(payment.provider_ref);
    await this.applyAuthorization(payment.id, result);
  }

  // Background job: place a new hold without the rider in the app (after their partner cancelled).
  async authorizeOffSession(paymentId: string) {
    const payment = await getPayment(this.deps.db, paymentId);
    if (!payment || payment.status !== 'pending') return;
    const user = await this.deps.db.query<UserRow>('SELECT * FROM users WHERE id = $1', [payment.user_id]).then((r) => r.rows[0]);
    if (!user || user.deleted_at || !user.payment_method_id || !user.stripe_customer_id) {
      await this.applyAuthorization(paymentId, { ref: `none_${paymentId}`, status: 'failed', failure: 'No card on file.' }, { offSession: true });
      return;
    }
    const result = await this.deps.payments.authorize({
      amount: payment.amount,
      currency: payment.currency,
      customerId: user.stripe_customer_id,
      paymentMethodId: user.payment_method_id,
      offSession: true,
      idempotencyKey: `authorize:${paymentId}`,
      metadata: { paymentId, tripId: payment.trip_id, userId: user.id },
    });
    await this.applyAuthorization(paymentId, result, { offSession: true });
  }

  // ---- matching -------------------------------------------------------------------------

  private async setTrip(tx: Tx, tripId: string, fields: { status: TripRow['status']; match_id?: string | null }, now: number) {
    if ('match_id' in fields) {
      await tx.query('UPDATE trips SET status = $2, match_id = $3, updated_at = $4 WHERE id = $1', [tripId, fields.status, fields.match_id, new Date(now)]);
    } else {
      await tx.query('UPDATE trips SET status = $2, updated_at = $3 WHERE id = $1', [tripId, fields.status, new Date(now)]);
    }
  }

  // Looks for the best partner for a searching trip and proposes the match. Caller holds the matching lock.
  private async tryMatch(tx: Tx, trip: TripRow, now: number): Promise<MatchRow | null> {
    if (trip.status !== 'searching') return null;
    // Demo travellers and the store review account only ever match each other.
    if (await this.isDemo(tx, trip.user_id)) return null;
    if (await this.isReviewer(tx, trip.user_id)) return null;
    const box = boxAround({ lat: trip.origin_lat, lng: trip.origin_lng }, CONFIG.matching.maxPickupGapKm / CONFIG.geo.circuity);
    // Coarse prefilters only; the matching engine makes the real decision.
    const { rows: candidates } = await tx.query<TripRow>(
      `SELECT t.* FROM trips t
       WHERE t.status = 'searching' AND t.id <> $1 AND t.user_id <> $2 AND t.search_until > $3
         AND t.seats + $4 <= $5
         AND t.origin_lat BETWEEN $6 AND $7 AND t.origin_lng BETWEEN $8 AND $9
         AND abs(extract(epoch FROM t.target_time - $10::timestamptz)) <= (t.flex_min + $11) * 60 + 4 * 3600
         AND NOT EXISTS (SELECT 1 FROM users du WHERE du.id = t.user_id AND (du.is_demo OR du.is_reviewer))
         AND NOT EXISTS (
           SELECT 1 FROM matches pm JOIN trips pa ON pa.id = pm.trip_a JOIN trips pb ON pb.id = pm.trip_b
           WHERE pm.status IN ('declined', 'expired', 'cancelled') AND pm.ended_at > $12
             AND ((pa.user_id = $2 AND pb.user_id = t.user_id) OR (pb.user_id = $2 AND pa.user_id = t.user_id)))
         AND NOT EXISTS (SELECT 1 FROM trip_exclusions e WHERE e.trip_id = $1 AND e.other_trip_id = t.id)
         AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $2 AND b.blocked_id = t.user_id)
                                                OR (b.blocker_id = t.user_id AND b.blocked_id = $2))
       ORDER BY abs(extract(epoch FROM t.target_time - $10::timestamptz))
       LIMIT 200`,
      [
        trip.id,
        trip.user_id,
        new Date(now),
        trip.seats,
        CONFIG.matching.taxiSeats,
        box.minLat,
        box.maxLat,
        box.minLng,
        box.maxLng,
        trip.target_time,
        trip.flex_min,
        new Date(now - PAIR_COOLDOWN_MS),
      ],
    );
    if (!candidates.length) return null;
    const best = findBestMatch(toTripLike(trip), candidates.map(toTripLike), now);
    if (!best) return null;
    const other = candidates.find((c) => c.id === best.other.id)!;
    return this.propose(tx, trip, other, best.plan, now);
  }

  private async propose(tx: Tx, a: TripRow, b: TripRow, plan: SharedPlan, now: number): Promise<MatchRow> {
    const expiresAt = Math.min(now + CONFIG.acceptWindowMinutes * MINUTE, a.search_until.getTime(), b.search_until.getTime());
    const { rows } = await tx.query<MatchRow>(
      `INSERT INTO matches (trip_a, trip_b, status, plan, booker_trip_id, proposed_at, expires_at)
       VALUES ($1, $2, 'proposed', $3, $4, $5, $6) RETURNING *`,
      [a.id, b.id, plan, plan.bookerTripId, new Date(now), new Date(expiresAt)],
    );
    const match = rows[0]!;
    // A demo traveller (store review only) says yes straight away.
    for (const [t, column] of [
      [a, 'a_accepted_at'],
      [b, 'b_accepted_at'],
    ] as const) {
      if (await this.isDemo(tx, t.user_id)) {
        await tx.query(`UPDATE matches SET ${column} = $2 WHERE id = $1`, [match.id, new Date(now)]);
        match[column] = new Date(now);
      }
    }
    const names = await this.firstNames(tx, [a.user_id, b.user_id]);
    for (const [mine, theirs] of [
      [a, b],
      [b, a],
    ] as const) {
      await this.setTrip(tx, mine.id, { status: 'proposed', match_id: match.id }, now);
      await notify(tx, now, mine.user_id, { kind: 'match_found', partner: names.get(theirs.user_id) ?? 'Someone' }, { tripId: mine.id });
    }
    return match;
  }

  private async firstNames(tx: Tx, userIds: string[]) {
    const { rows } = await tx.query<{ id: string; first_name: string | null }>('SELECT id, first_name FROM users WHERE id = ANY($1)', [userIds]);
    return new Map(rows.map((r) => [r.id, r.first_name ?? 'Your match']));
  }

  // Loads a match and the caller's side of it, locked for update.
  private async memberMatch(tx: Tx, userId: string, matchId: string) {
    const match = await getMatch(tx, matchId, { lock: true });
    if (!match) throw notFound('Match not found.');
    const [a, b] = await Promise.all([getTrip(tx, match.trip_a, { lock: true }), getTrip(tx, match.trip_b, { lock: true })]);
    const mine = a?.user_id === userId ? a : b?.user_id === userId ? b : null;
    if (!mine || !a || !b) throw notFound('Match not found.');
    const partner = mine.id === a.id ? b : a;
    return { match, mine, partner };
  }

  async respond(userId: string, matchId: string, accept: boolean): Promise<string> {
    return this.tx(async (tx) => {
      const now = this.now();
      const { match, mine, partner } = await this.memberMatch(tx, userId, matchId);
      if (match.status !== 'proposed') throw conflict('match_closed', 'This match is no longer waiting for an answer.');
      if (now >= match.expires_at.getTime()) {
        await this.unwind(tx, match, 'expired', now);
        return mine.id;
      }
      if (!accept) {
        await this.unwind(tx, match, 'declined', now, mine.id);
        return mine.id;
      }
      const column = match.trip_a === mine.id ? 'a_accepted_at' : 'b_accepted_at';
      await tx.query(`UPDATE matches SET ${column} = $2 WHERE id = $1`, [match.id, new Date(now)]);
      const partnerAccepted = match.trip_a === mine.id ? match.b_accepted_at : match.a_accepted_at;
      const names = await this.firstNames(tx, [mine.user_id, partner.user_id]);
      if (partnerAccepted) {
        await this.confirm(tx, match, [mine, partner], names, now);
      } else {
        await notify(tx, now, partner.user_id, { kind: 'partner_accepted', partner: names.get(mine.user_id)! }, { tripId: partner.id });
      }
      return mine.id;
    });
  }

  private async confirm(tx: Tx, match: MatchRow, trips: TripRow[], names: Map<string, string>, now: number) {
    await tx.query("UPDATE matches SET status = 'confirmed', confirmed_at = $2 WHERE id = $1", [match.id, new Date(now)]);
    for (const t of trips) {
      const other = trips.find((x) => x.id !== t.id)!;
      await this.setTrip(tx, t.id, { status: 'confirmed' }, now);
      if (t.payment_id) await enqueue(tx, now, 'payment.capture', { paymentId: t.payment_id });
      await notify(
        tx,
        now,
        t.user_id,
        {
          kind: 'match_confirmed',
          partner: names.get(other.user_id)!,
          youBook: match.booker_trip_id === t.id,
          pickupAt: match.plan.riders[t.id]!.pickupAt,
        },
        { tripId: t.id },
      );
    }
  }

  // A proposal fell through. Everyone still travelling goes back to searching, and the pair won't be re-proposed.
  private async unwind(tx: Tx, match: MatchRow, reason: 'declined' | 'expired' | 'cancelled', now: number, byTripId?: string) {
    await tx.query('UPDATE matches SET status = $2, ended_at = $3, cancelled_by_trip_id = $4 WHERE id = $1', [
      match.id,
      reason,
      new Date(now),
      reason === 'cancelled' ? (byTripId ?? null) : null,
    ]);
    await tx.query('INSERT INTO trip_exclusions (trip_id, other_trip_id) VALUES ($1, $2), ($2, $1) ON CONFLICT DO NOTHING', [match.trip_a, match.trip_b]);
    for (const id of [match.trip_a, match.trip_b]) {
      const trip = (await getTrip(tx, id, { lock: true }))!;
      await tx.query('UPDATE trips SET match_id = NULL WHERE id = $1', [id]);
      if (id === byTripId && reason === 'cancelled') continue;
      if (id !== byTripId) await notify(tx, now, trip.user_id, { kind: 'match_fell_through' }, { tripId: id });
      await this.reopen(tx, { ...trip, match_id: null }, now);
    }
  }

  // Back to searching, or expired if it's too late to find anyone.
  private async reopen(tx: Tx, trip: TripRow, now: number, { newHold = false } = {}) {
    if (await this.isDemo(tx, trip.user_id)) {
      await this.setTrip(tx, trip.id, { status: 'cancelled', match_id: null }, now);
      return;
    }
    if (now >= trip.search_until.getTime()) {
      await this.setTrip(tx, trip.id, { status: 'expired', match_id: null }, now);
      if (!newHold && trip.payment_id) await enqueue(tx, now, 'payment.cancel', { paymentId: trip.payment_id });
      await notify(tx, now, trip.user_id, { kind: 'trip_expired' }, { tripId: trip.id });
      return;
    }
    if (newHold) {
      // Their previous fee is being refunded, so a fresh hold is needed before they can be matched again.
      const paymentId = await this.createPayment(tx, trip.user_id, trip.id, now);
      await this.setTrip(tx, trip.id, { status: 'pending_payment', match_id: null }, now);
      await enqueue(tx, now, 'payment.authorize', { paymentId });
      return;
    }
    await this.setTrip(tx, trip.id, { status: 'searching', match_id: null }, now);
    await this.tryMatch(tx, { ...trip, status: 'searching', match_id: null }, now);
  }

  // ---- cancelling ----------------------------------------------------------------------

  async cancelTrip(userId: string, tripId: string): Promise<void> {
    await this.tx(async (tx) => {
      const trip = await getOwnTrip(tx, userId, tripId, { lock: true });
      await this.cancelLocked(tx, trip, this.now());
    });
  }

  private async cancelLocked(tx: Tx, trip: TripRow, now: number) {
    switch (trip.status) {
      case 'pending_payment':
      case 'searching':
        await this.setTrip(tx, trip.id, { status: 'cancelled' }, now);
        if (trip.payment_id) await enqueue(tx, now, 'payment.cancel', { paymentId: trip.payment_id });
        return;
      case 'proposed': {
        const match = (await getMatch(tx, trip.match_id!, { lock: true }))!;
        await this.unwind(tx, match, 'cancelled', now, trip.id);
        await this.setTrip(tx, trip.id, { status: 'cancelled', match_id: null }, now);
        if (trip.payment_id) await enqueue(tx, now, 'payment.cancel', { paymentId: trip.payment_id });
        return;
      }
      case 'confirmed': {
        // Late cancellation: the canceller's fee stays charged; the partner is refunded and re-listed.
        const match = (await getMatch(tx, trip.match_id!, { lock: true }))!;
        if (now >= match.plan.startAt) {
          throw conflict('pickup_passed', "The pickup time has passed, so this trip can't be cancelled. If something went wrong, report it from Safety.");
        }
        const partner = (await getTrip(tx, partnerTripId(match, trip.id), { lock: true }))!;
        await this.endConfirmed(tx, match, trip, partner, now, { refundCanceller: false });
        return;
      }
      default:
        throw conflict('trip_inactive', 'This trip is no longer active.');
    }
  }

  private async endConfirmed(tx: Tx, match: MatchRow, canceller: TripRow, partner: TripRow, now: number, opts: { refundCanceller: boolean }) {
    await tx.query("UPDATE matches SET status = 'cancelled', ended_at = $2, cancelled_by_trip_id = $3 WHERE id = $1", [match.id, new Date(now), canceller.id]);
    await tx.query('INSERT INTO trip_exclusions (trip_id, other_trip_id) VALUES ($1, $2), ($2, $1) ON CONFLICT DO NOTHING', [canceller.id, partner.id]);
    const names = await this.firstNames(tx, [canceller.user_id]);
    if (partner.payment_id) await enqueue(tx, now, 'payment.refund', { paymentId: partner.payment_id });
    await notify(tx, now, partner.user_id, { kind: 'partner_cancelled', partner: names.get(canceller.user_id)!, refunded: true }, { tripId: partner.id });
    await this.reopen(tx, { ...partner, match_id: null }, now, { newHold: true });
    if (opts.refundCanceller) {
      if (canceller.payment_id) await enqueue(tx, now, 'payment.refund', { paymentId: canceller.payment_id });
      await this.reopen(tx, { ...canceller, match_id: null }, now, { newHold: true });
    } else {
      await this.setTrip(tx, canceller.id, { status: 'cancelled', match_id: null }, now);
    }
  }

  // ---- after confirmation -----------------------------------------------------------------

  async sendMessage(userId: string, matchId: string, text: string) {
    const body = text.trim();
    if (!body || body.length > 500) throw badRequest('invalid_message', 'Messages must be between 1 and 500 characters.');
    const verdict = this.moderate(body);
    if (!verdict.ok) {
      throw badRequest(
        'message_blocked',
        verdict.reason === 'link' ? "Links can't be sent in chat. Agree where to meet in words instead." : "That message can't be sent. Please keep it friendly.",
      );
    }
    return withTx(this.deps.db, async (tx) => {
      const now = this.now();
      const { match, mine, partner } = await this.memberMatch(tx, userId, matchId);
      if (match.status !== 'confirmed' && match.status !== 'completed') {
        throw conflict('chat_closed', 'You can message your travel partner once you have both accepted.');
      }
      const { rows: blocked } = await tx.query('SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)', [
        mine.user_id,
        partner.user_id,
      ]);
      if (blocked.length) throw forbidden("You can't message this person.");
      const { rows } = await tx.query<{ id: string; created_at: Date }>(
        'INSERT INTO messages (match_id, trip_id, body, created_at) VALUES ($1, $2, $3, $4) RETURNING id, created_at',
        [match.id, mine.id, body, new Date(now)],
      );
      const names = await this.firstNames(tx, [mine.user_id]);
      await notify(tx, now, partner.user_id, { kind: 'new_message', partner: names.get(mine.user_id)!, text: body }, { tripId: partner.id, matchId: match.id });
      return { id: rows[0]!.id, mine: true, text: body, at: rows[0]!.created_at.toISOString() };
    });
  }

  async listMessages(userId: string, matchId: string, after?: string) {
    const match = await getMatch(this.deps.db, matchId);
    if (!match) throw notFound('Match not found.');
    const { rows: trips } = await this.deps.db.query<{ id: string }>('SELECT id FROM trips WHERE id = ANY($1) AND user_id = $2', [
      [match.trip_a, match.trip_b],
      userId,
    ]);
    const mine = trips[0];
    if (!mine) throw notFound('Match not found.');
    if (match.status !== 'confirmed' && match.status !== 'completed') return [];
    const afterDate = after && Number.isFinite(Date.parse(after)) ? new Date(after) : new Date(0);
    const { rows } = await this.deps.db.query<{ id: string; trip_id: string; body: string; created_at: Date }>(
      'SELECT id, trip_id, body, created_at FROM messages WHERE match_id = $1 AND created_at > $2 ORDER BY created_at, id LIMIT 200',
      [match.id, afterDate],
    );
    return rows.map((r) => ({ id: r.id, mine: r.trip_id === mine.id, text: r.body, at: r.created_at.toISOString() }));
  }

  // The rider who booked the taxi enters what it actually cost; the split follows the agreed ratio.
  async complete(userId: string, matchId: string, actualFare: number): Promise<string> {
    if (!Number.isInteger(actualFare) || actualFare < 100 || actualFare > 100_000) {
      throw badRequest('invalid_fare', 'Enter the total on your receipt, between €1 and €1,000.');
    }
    return this.tx(async (tx) => {
      const now = this.now();
      const { match, mine, partner } = await this.memberMatch(tx, userId, matchId);
      if (match.status !== 'confirmed') throw conflict('match_not_confirmed', 'Only a confirmed ride can be settled.');
      if (match.booker_trip_id !== mine.id) throw forbidden('The person who booked the taxi enters the final fare.');
      const partnerOwes = settleFare(actualFare, match.plan, partner.id);
      const settlement = { actualFare, partnerOwes, bookerShare: actualFare - partnerOwes, at: now };
      await tx.query("UPDATE matches SET status = 'completed', ended_at = $2, settlement = $3 WHERE id = $1", [match.id, new Date(now), settlement]);
      for (const t of [mine, partner]) {
        await this.setTrip(tx, t.id, { status: 'completed' }, now);
        await tx.query('UPDATE users SET rides_completed = rides_completed + 1 WHERE id = $1', [t.user_id]);
      }
      // Both riders get their receipt.
      const names = await this.firstNames(tx, [mine.user_id, partner.user_id]);
      await notify(tx, now, partner.user_id, { kind: 'settled', partner: names.get(mine.user_id)!, youOwe: partnerOwes }, { tripId: partner.id });
      await notify(tx, now, mine.user_id, { kind: 'receipt', partner: names.get(partner.user_id)!, owedToYou: partnerOwes }, { tripId: mine.id });
      return mine.id;
    });
  }

  // The person who owes the booker says they've paid. The money goes between them directly (Revolut or cash);
  // this just lets the booker know.
  async markPaid(userId: string, matchId: string): Promise<string> {
    return withTx(this.deps.db, async (tx) => {
      const now = this.now();
      const { match, mine, partner } = await this.memberMatch(tx, userId, matchId);
      const s = match.settlement;
      if (match.status !== 'completed' || !s) throw conflict('not_settled', 'The booker enters the meter total first.');
      if (match.booker_trip_id === mine.id) throw forbidden("Your travel partner marks this when they've paid you.");
      if (s.partnerOwes <= 0) throw conflict('nothing_owed', "You don't owe anything for this ride.");
      if (!s.paidAt) {
        await tx.query('UPDATE matches SET settlement = $2 WHERE id = $1', [match.id, { ...s, paidAt: now }]);
        const names = await this.firstNames(tx, [mine.user_id]);
        await notify(tx, now, partner.user_id, { kind: 'paid', partner: names.get(mine.user_id)!, amount: s.partnerOwes }, { tripId: partner.id });
      }
      return mine.id;
    });
  }

  async rate(userId: string, matchId: string, stars: number): Promise<string> {
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw badRequest('invalid_rating', 'Choose between 1 and 5 stars.');
    return withTx(this.deps.db, async (tx) => {
      const { match, mine, partner } = await this.memberMatch(tx, userId, matchId);
      if (match.status !== 'completed') throw conflict('not_completed', 'You can rate your travel partner after the ride.');
      const { rowCount } = await tx.query(
        'INSERT INTO ratings (match_id, rater_id, ratee_id, stars, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
        [match.id, mine.user_id, partner.user_id, stars, new Date(this.now())],
      );
      if (rowCount !== 1) throw conflict('already_rated', "You've already rated this ride.");
      await tx.query('UPDATE users SET rating_sum = rating_sum + $2, rating_count = rating_count + 1 WHERE id = $1', [partner.user_id, stars]);
      return mine.id;
    });
  }

  // ---- safety ----------------------------------------------------------------------------

  async report(userId: string, matchId: string, reason: ReportReason, details?: string) {
    await withTx(this.deps.db, async (tx) => {
      const { match, partner } = await this.memberMatch(tx, userId, matchId);
      await tx.query('INSERT INTO reports (reporter_id, reported_id, match_id, reason, details, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [
        userId,
        partner.user_id,
        match.id,
        reason,
        details?.trim().slice(0, 1000) || null,
        new Date(this.now()),
      ]);
    });
    this.deps.log.warn({ matchId, reason }, 'user report filed');
  }

  // Blocking ends any open match with that person. A confirmed ride is cancelled with both fees refunded,
  // since nobody should pay to get away from someone they feel unsafe with.
  async blockPartner(userId: string, matchId: string): Promise<string> {
    return this.tx(async (tx) => {
      const now = this.now();
      const { match, mine, partner } = await this.memberMatch(tx, userId, matchId);
      await tx.query('INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [
        mine.user_id,
        partner.user_id,
        new Date(now),
      ]);
      if (match.status === 'proposed') await this.unwind(tx, match, 'declined', now, mine.id);
      // Before pickup, blocking cancels the ride and refunds both fees. After pickup the ride has happened,
      // so blocking only stops future matches and messages.
      else if (match.status === 'confirmed' && now < match.plan.startAt) await this.endConfirmed(tx, match, mine, partner, now, { refundCanceller: true });
      return mine.id;
    });
  }

  // ---- account ----------------------------------------------------------------------------

  async deleteAccount(userId: string) {
    await this.tx(async (tx) => {
      const now = this.now();
      const user = await getUser(tx, userId);
      const { rows: active } = await tx.query<TripRow>('SELECT * FROM trips WHERE user_id = $1 AND status = ANY($2) FOR UPDATE', [userId, ACTIVE]);
      for (const trip of active) await this.cancelLocked(tx, trip, now);
      await tx.query(
        `UPDATE users SET phone = NULL, first_name = NULL, push_token = NULL, payment_method_id = NULL,
           payment_method_brand = NULL, payment_method_last4 = NULL, revtag = NULL, deleted_at = $2 WHERE id = $1`,
        [userId, new Date(now)],
      );
      await tx.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
      // Trips stay for accounting and disputes, but without where the person lives or goes.
      await tx.query(
        `UPDATE trips SET origin_label = 'Removed', dest_label = 'Removed',
           origin_lat = round(origin_lat::numeric, 2), origin_lng = round(origin_lng::numeric, 2),
           dest_lat = round(dest_lat::numeric, 2), dest_lng = round(dest_lng::numeric, 2)
         WHERE user_id = $1`,
        [userId],
      );
      // Matched rides keep a copy of each stop in the plan; blur the ones at this person's own places too.
      const { rows: plans } = await tx.query<{ id: string; plan: SharedPlan }>(
        `SELECT DISTINCT m.id, m.plan FROM matches m JOIN trips t ON t.id IN (m.trip_a, m.trip_b) WHERE t.user_id = $1`,
        [userId],
      );
      const theirs = new Set((await tx.query<{ id: string }>('SELECT id FROM trips WHERE user_id = $1', [userId])).rows.map((r) => r.id));
      const blur = (n: number) => Math.round(n * 100) / 100;
      for (const { id, plan } of plans) {
        const route = plan.route.map((s) => (theirs.has(s.tripIds[0]!) ? { ...s, label: 'Removed', lat: blur(s.lat), lng: blur(s.lng) } : s));
        await tx.query('UPDATE matches SET plan = $2 WHERE id = $1', [id, { ...plan, route }]);
      }
      await tx.query('UPDATE reports SET details = NULL WHERE reporter_id = $1', [userId]);
      if (user.stripe_customer_id) await enqueue(tx, now, 'customer.delete', { customerId: user.stripe_customer_id });
    });
  }

  // ---- store review account ------------------------------------------------------------------

  private async isDemo(tx: Tx, userId: string) {
    const { rows } = await tx.query<{ is_demo: boolean }>('SELECT is_demo FROM users WHERE id = $1', [userId]);
    return rows[0]?.is_demo ?? false;
  }

  private async isReviewer(tx: Tx, userId: string) {
    const { rows } = await tx.query<{ is_reviewer: boolean }>('SELECT is_reviewer FROM users WHERE id = $1', [userId]);
    return rows[0]?.is_reviewer ?? false;
  }

  // App reviewers can't find a real stranger to match with, so their trips get a demo travel partner
  // who joins a little further along the same route and accepts straight away. Demo travellers never
  // match anyone else and no real payment is involved.
  private async addReviewCompanion(tx: Tx, trip: TripRow, now: number) {
    const along = (a: number, b: number) => a + (b - a) * 0.3;
    const origin = { label: 'On your way', lat: along(trip.origin_lat, trip.dest_lat), lng: along(trip.origin_lng, trip.dest_lng) };
    const destination = { label: trip.dest_label, lat: trip.dest_lat, lng: trip.dest_lng };
    const like = { origin, destination, timeMode: trip.time_mode, time: trip.target_time.getTime(), flexMin: 30, seats: 1 };
    const searchUntil = searchDeadline(like);
    if (searchUntil <= now) return;
    const { rows: users } = await tx.query<{ id: string }>(
      `INSERT INTO users (first_name, terms_accepted_at, is_demo, rating_sum, rating_count, rides_completed, created_at)
       VALUES ('Alex', $1, true, 48, 10, 12, $1) RETURNING id`,
      [new Date(now)],
    );
    const demoUserId = users[0]!.id;
    const { rows } = await tx.query<TripRow>(
      `INSERT INTO trips (user_id, origin_label, origin_lat, origin_lng, dest_label, dest_lat, dest_lng, time_mode, target_time,
                          flex_min, seats, status, search_until, solo_fare, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 30, 1, 'searching', $10, $11, $12, $12) RETURNING *`,
      [demoUserId, origin.label, origin.lat, origin.lng, destination.label, destination.lat, destination.lng, trip.time_mode, trip.target_time, new Date(searchUntil), soloWindow(like).solo.fare, new Date(now)],
    );
    const companion = rows[0]!;
    const { rows: pay } = await tx.query<{ id: string }>(
      `INSERT INTO payments (user_id, trip_id, amount, currency, status, provider_ref, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'authorized', $5, $6, $6) RETURNING id`,
      [demoUserId, companion.id, CONFIG.matchFee, CONFIG.currency, `pi_test_demo_${companion.id}`, new Date(now)],
    );
    await tx.query('UPDATE trips SET payment_id = $2 WHERE id = $1', [companion.id, pay[0]!.id]);
    const plan = findBestMatch(toTripLike(trip), [toTripLike({ ...companion, payment_id: pay[0]!.id })], now);
    if (plan) await this.propose(tx, trip, { ...companion, payment_id: pay[0]!.id }, plan.plan, now);
    else await this.setTrip(tx, companion.id, { status: 'cancelled' }, now);
  }

  // ---- clock-driven work ---------------------------------------------------------------------

  // Expires stale proposals and trips, closes rides nobody settled, and retries matching for everyone still
  // searching. Matching runs in small transactions so the lock is never held for long.
  async sweep(): Promise<void> {
    await this.tx(async (tx) => {
      const now = this.now();
      const at = new Date(now);
      const { rows: stale } = await tx.query<MatchRow>("SELECT * FROM matches WHERE status = 'proposed' AND expires_at <= $1 FOR UPDATE", [at]);
      for (const match of stale) await this.unwind(tx, match, 'expired', now);

      const { rows: lapsed } = await tx.query<TripRow>("SELECT * FROM trips WHERE status = 'searching' AND search_until <= $1 FOR UPDATE", [at]);
      for (const trip of lapsed) {
        await this.setTrip(tx, trip.id, { status: 'expired' }, now);
        if (trip.payment_id) await enqueue(tx, now, 'payment.cancel', { paymentId: trip.payment_id });
        await notify(tx, now, trip.user_id, { kind: 'trip_expired' }, { tripId: trip.id });
      }

      const { rows: abandoned } = await tx.query<TripRow>(
        "SELECT * FROM trips WHERE status = 'pending_payment' AND (search_until <= $1 OR updated_at <= $2) FOR UPDATE",
        [at, new Date(now - PENDING_PAYMENT_TIMEOUT_MS)],
      );
      for (const trip of abandoned) {
        await this.setTrip(tx, trip.id, { status: 'cancelled' }, now);
        if (trip.payment_id) await enqueue(tx, now, 'payment.cancel', { paymentId: trip.payment_id });
      }

      // Rides nobody settled: close them some hours after the last drop-off so they don't stay open forever.
      const { rows: unsettled } = await tx.query<MatchRow>("SELECT * FROM matches WHERE status = 'confirmed' FOR UPDATE");
      for (const match of unsettled) {
        const lastStop = match.plan.route[match.plan.route.length - 1];
        if (!lastStop || now < lastStop.at + AUTO_COMPLETE_AFTER_MS) continue;
        await tx.query("UPDATE matches SET status = 'completed', ended_at = $2 WHERE id = $1", [match.id, at]);
        for (const id of [match.trip_a, match.trip_b]) {
          const { rows } = await tx.query<{ user_id: string }>("UPDATE trips SET status = 'completed', updated_at = $2 WHERE id = $1 RETURNING user_id", [id, at]);
          await tx.query('UPDATE users SET rides_completed = rides_completed + 1 WHERE id = $1', [rows[0]!.user_id]);
        }
      }
    });

    // Safety net: anything missed when it was posted gets another chance, a few trips per transaction.
    const { rows } = await this.deps.db.query<{ id: string }>("SELECT id FROM trips WHERE status = 'searching' ORDER BY created_at LIMIT 1000");
    for (let i = 0; i < rows.length; i += 20) {
      const batch = rows.slice(i, i + 20).map((r) => r.id);
      await this.tx(async (tx) => {
        const now = this.now();
        for (const id of batch) {
          const fresh = await getTrip(tx, id);
          if (fresh?.status === 'searching') await this.tryMatch(tx, fresh, now);
        }
      });
    }
  }

  // Data minimisation: chat and sign-in bookkeeping don't need to live forever.
  async purgeOldData(messageRetentionDays = 90) {
    const now = this.now();
    await this.deps.db.query('DELETE FROM messages WHERE created_at < $1', [new Date(now - messageRetentionDays * 86_400_000)]);
    await this.deps.db.query('DELETE FROM otp_requests WHERE created_at < $1', [new Date(now - 86_400_000)]);
    await this.deps.db.query('DELETE FROM refresh_tokens WHERE expires_at < $1 OR revoked_at < $1', [new Date(now - 7 * 86_400_000)]);
    await this.deps.db.query('DELETE FROM jobs WHERE done_at < $1', [new Date(now - 30 * 86_400_000)]);
  }
}
