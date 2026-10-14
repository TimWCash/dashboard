import {
  CONFIG,
  acceptDeadline,
  bestCaseSavings,
  boxAround,
  findBestMatch,
  formatMoney,
  inServiceArea,
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
import { phoneHash } from '../auth/phone';
import { createModerator } from '../moderation';
import type { Deps } from '../deps';
import { AppError, badRequest, conflict, forbidden, notFound } from '../errors';
import { enqueue } from '../jobs/queue';
import { notify } from '../notifications';
import { areaName, blurTrips, daysAgo, deleteOldRecords, RETENTION } from './retention';
import type { AuthorizeResult } from '../providers/payments';
import {
  acceptedAt,
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
const ACTIVE = ['scheduled', 'pending_payment', 'searching', 'proposed', 'confirmed'];
const DAY = 24 * 60 * 60_000;
// A hold the rider never authenticated is abandoned after this long.
const PENDING_PAYMENT_TIMEOUT_MS = 30 * MINUTE;
const MAX_TRIPS_PER_DAY = 20;
// After a match falls through, the same two people aren't proposed to each other again for this long.
const PAIR_COOLDOWN_MS = 24 * 60 * MINUTE;
// A confirmed ride nobody settled is closed this long after its last drop-off, split at the estimate.
const AUTO_COMPLETE_AFTER_MS = CONFIG.settle.closeAfterHours * 60 * MINUTE;
// A planned trip whose hold needs the rider's bank to approve it gets this long, since they weren't in the app.
const SCHEDULED_HOLD_TIMEOUT_MS = 24 * 60 * MINUTE;
// How long people have to accept a proposal in the public demo.
const DEMO_ACCEPT_WINDOW_MIN = 3;

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

  private paused() {
    return new AppError(403, 'account_paused', `Your account is paused while we look into a report. If you think this is a mistake, email ${this.deps.config.SUPPORT_EMAIL}.`);
  }

  private async isPaused(tx: Tx, userId: string) {
    const { rows } = await tx.query<{ suspended_at: Date | null }>('SELECT suspended_at FROM users WHERE id = $1', [userId]);
    return Boolean(rows[0]?.suspended_at);
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
    if (user.suspended_at) throw this.paused();
    if (!user.first_name || !user.terms_accepted_at) throw conflict('profile_incomplete', 'Finish setting up your profile first.');
    if (user.terms_version !== this.deps.config.TERMS_VERSION) throw conflict('terms_updated', 'Please read and accept the updated Terms and Privacy Policy first.');
    if (!user.payment_method_id || !user.stripe_customer_id) throw conflict('payment_method_required', 'Add a card before posting a trip.');

    const origin = cleanPlace(input.origin);
    const destination = cleanPlace(input.destination);
    if (!isValidLatLng(origin) || !isValidLatLng(destination) || !origin.label || !destination.label) {
      throw badRequest('invalid_place', 'Choose where you are leaving from and going to.');
    }
    if (!inServiceArea(origin) || !inServiceArea(destination)) throw badRequest('outside_service_area', 'SplitCab is only available in the Republic of Ireland for now.');
    // Labels are shown to the other traveller once matched, so they go through the same filter as chat.
    if (!this.moderate(origin.label).ok || !this.moderate(destination.label).ok) {
      throw badRequest('invalid_place', 'Choose the pickup and destination from the search results.');
    }
    if (roadKm(origin, destination) < CONFIG.trips.minTripKm) {
      throw badRequest('trip_too_short', 'Pickup and destination are too close together to share a taxi.');
    }
    const time = Date.parse(input.time);
    if (!Number.isFinite(time)) throw badRequest('invalid_time', 'Choose a time.');
    if (time > now + CONFIG.trips.maxPlanDaysAhead * DAY) {
      throw badRequest('too_far_ahead', `You can plan trips up to ${CONFIG.trips.maxPlanDaysAhead} days ahead.`);
    }
    // A card hold only lasts about a week, so a trip further ahead is saved and starts searching (placing the hold)
    // maxDaysAhead days before.
    const searchFrom = time - CONFIG.trips.maxDaysAhead * DAY;
    const scheduled = searchFrom > now;
    const like = { origin, destination, timeMode: input.timeMode, time, flexMin: input.flexMin, seats: input.seats };
    const searchUntil = searchDeadline(like);
    if (searchUntil <= now + MINUTE) {
      throw badRequest('too_soon', 'That time is too soon to find someone. Pick a later time or allow more flexibility.');
    }
    if (bestCaseSavings(like) < CONFIG.matching.minNetSavings) {
      throw badRequest(
        'not_worth_sharing',
        `Sharing this trip would save you less than ${formatMoney(CONFIG.matching.minNetSavings)}, so we don't match it. Sharing pays on longer trips, like to or from the airport.`,
      );
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
                            flex_min, seats, status, search_until, solo_fare, created_at, updated_at, start_now_at, search_from)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $15, $12, $13, $14, $14, $14, $16) RETURNING id`,
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
          scheduled ? 'scheduled' : 'pending_payment',
          scheduled ? new Date(searchFrom) : null,
        ],
      );
      const tripId = rows[0]!.id;
      if (scheduled) return { tripId, paymentId: null };
      const paymentId = await this.createPayment(tx, userId, tripId, now);
      return { tripId, paymentId };
    });
    if (!paymentId) return tripId;

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
    if (await this.isPaused(tx, trip.user_id)) return null;
    // Both trips must still be searching long enough for the pair to answer.
    const answerBy = now + CONFIG.accept.minAnswerMinutes * MINUTE;
    if (trip.search_until.getTime() < answerBy) return null;
    const box = boxAround({ lat: trip.origin_lat, lng: trip.origin_lng }, CONFIG.matching.maxPickupGapKm / CONFIG.geo.circuity);
    // Coarse prefilters only; the matching engine makes the real decision.
    const { rows: candidates } = await tx.query<TripRow>(
      `SELECT t.* FROM trips t
       WHERE t.status = 'searching' AND t.id <> $1 AND t.user_id <> $2 AND t.search_until > $3
         AND t.seats + $4 <= $5
         AND t.origin_lat BETWEEN $6 AND $7 AND t.origin_lng BETWEEN $8 AND $9
         AND abs(extract(epoch FROM t.target_time - $10::timestamptz)) <= (t.flex_min + $11) * 60 + 4 * 3600
         AND NOT EXISTS (SELECT 1 FROM users du WHERE du.id = t.user_id AND (du.is_demo OR du.is_reviewer OR du.suspended_at IS NOT NULL))
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
        new Date(answerBy),
        trip.seats,
        CONFIG.matching.taxiSeats,
        box.minLat,
        box.maxLat,
        box.minLng,
        box.maxLng,
        trip.target_time,
        trip.flex_min,
        // The demo lets two friends try again straight away with new trips.
        new Date(now - (this.deps.config.DEMO_MODE ? 0 : PAIR_COOLDOWN_MS)),
      ],
    );
    if (!candidates.length) return null;
    const best = findBestMatch(toTripLike(trip), candidates.map(toTripLike), now);
    if (!best) return null;
    const other = candidates.find((c) => c.id === best.other.id)!;
    return this.propose(tx, trip, other, best.plan, now);
  }

  private async propose(tx: Tx, a: TripRow, b: TripRow, plan: SharedPlan, now: number): Promise<MatchRow> {
    // The public demo gives three minutes: whoever's on the other end is either there now or has closed the page.
    const deadline = this.deps.config.DEMO_MODE ? now + DEMO_ACCEPT_WINDOW_MIN * MINUTE : acceptDeadline(now, plan.startAt);
    const expiresAt = Math.min(deadline, a.search_until.getTime(), b.search_until.getTime());
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
      await notify(tx, now, mine.user_id, { kind: 'match_found', partner: names.get(theirs.user_id) ?? 'Someone', acceptBy: expiresAt, now }, { tripId: mine.id });
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
      if (accept && (await this.isPaused(tx, userId))) throw this.paused();
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
      // In the public demo, someone who let a proposal lapse has almost certainly left, so they aren't offered to
      // the next visitor.
      const accepted = id === match.trip_a ? match.a_accepted_at : match.b_accepted_at;
      if (reason === 'expired' && !accepted && this.deps.config.DEMO_MODE) {
        await this.setTrip(tx, id, { status: 'expired', match_id: null }, now);
        if (trip.payment_id) await enqueue(tx, now, 'payment.cancel', { paymentId: trip.payment_id });
        continue;
      }
      await this.reopen(tx, { ...trip, match_id: null }, now);
    }
  }

  // Back to searching, or expired if it's too late to find anyone.
  private async reopen(tx: Tx, trip: TripRow, now: number, { newHold = false } = {}) {
    if (await this.isDemo(tx, trip.user_id)) {
      await this.setTrip(tx, trip.id, { status: 'cancelled', match_id: null }, now);
      await this.releasePretendPayment(tx, trip.payment_id, now);
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
      case 'scheduled':
        await this.setTrip(tx, trip.id, { status: 'cancelled' }, now);
        return;
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
      if (await this.isPaused(tx, userId)) throw this.paused();
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
      // A ride closed at the estimate can still be given its real meter total, until the other person has paid.
      const correcting = match.status === 'completed' && Boolean(match.settlement?.estimated) && !match.settlement?.paidAt;
      if (match.status !== 'confirmed' && !correcting) throw conflict('match_not_confirmed', 'Only a confirmed ride can be settled.');
      if (match.booker_trip_id !== mine.id) throw forbidden('The person who booked the taxi enters the final fare.');
      const partnerOwes = settleFare(actualFare, match.plan, partner.id);
      const settlement = { actualFare, partnerOwes, bookerShare: actualFare - partnerOwes, at: now };
      await tx.query("UPDATE matches SET status = 'completed', ended_at = COALESCE(ended_at, $2), settlement = $3 WHERE id = $1", [
        match.id,
        new Date(now),
        settlement,
      ]);
      if (!correcting) {
        for (const t of [mine, partner]) {
          await this.setTrip(tx, t.id, { status: 'completed' }, now);
          await tx.query('UPDATE users SET rides_completed = rides_completed + 1 WHERE id = $1', [t.user_id]);
        }
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

  // Every report is announced to whoever runs SplitCab straight away. Reports from enough different people pause
  // the reported account until someone has looked into them.
  async report(userId: string, matchId: string, reason: ReportReason, details?: string) {
    await this.tx(async (tx) => {
      const now = this.now();
      const { match, partner } = await this.memberMatch(tx, userId, matchId);
      const { rows } = await tx.query<{ id: string }>(
        'INSERT INTO reports (reporter_id, reported_id, match_id, reason, details, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [userId, partner.user_id, match.id, reason, details?.trim().slice(0, 1000) || null, new Date(now)],
      );
      if (await this.reportsWarrantPause(tx, partner.user_id, now)) await this.suspendLocked(tx, partner.user_id, 'Reported by several people', now);
      await enqueue(tx, now, 'report.alert', { reportId: rows[0]!.id });
    });
    this.deps.log.warn({ matchId, reason }, 'user report filed');
  }

  // Counts different people, so one person reporting over and over can't pause someone. Only reports from people
  // who were matched with them and both accepted count, and only ones nobody has dealt with yet.
  private async reportsWarrantPause(tx: Tx, userId: string, now: number) {
    const { pauseAfterSeriousReports, pauseAfterReports, reportWindowDays } = CONFIG.safety;
    const { rows } = await tx.query<{ serious: number; total: number }>(
      `SELECT count(DISTINCT r.reporter_id) FILTER (WHERE r.reason IN ('unsafe', 'harassment'))::int AS serious,
              count(DISTINCT r.reporter_id)::int AS total
       FROM reports r JOIN matches m ON m.id = r.match_id
       WHERE r.reported_id = $1 AND r.resolved_at IS NULL AND r.created_at > $2 AND m.confirmed_at IS NOT NULL`,
      [userId, daysAgo(now, reportWindowDays)],
    );
    const { serious = 0, total = 0 } = rows[0] ?? {};
    return serious >= pauseAfterSeriousReports || total >= pauseAfterReports;
  }

  // Support pauses an account by hand (npm run ops -- suspend).
  async suspend(userId: string, reason: string) {
    await this.tx((tx) => this.suspendLocked(tx, userId, reason.trim().slice(0, 300) || 'Paused by support', this.now()));
  }

  // Lifts a pause once the reports have been looked into, and marks them dealt with so they don't count again.
  async unsuspend(userId: string) {
    await withTx(this.deps.db, async (tx) => {
      const at = new Date(this.now());
      await tx.query('UPDATE users SET suspended_at = NULL, suspended_reason = NULL WHERE id = $1', [userId]);
      await tx.query('UPDATE reports SET resolved_at = $2 WHERE reported_id = $1 AND resolved_at IS NULL', [userId, at]);
    });
  }

  // A paused account's open trips are cancelled and their holds released, a proposal falls through, and a ride
  // that hasn't started is cancelled with both match fees refunded, as when someone is blocked. A ride that has
  // started or finished stays, so it can still be settled.
  private async suspendLocked(tx: Tx, userId: string, reason: string, now: number) {
    const { rowCount } = await tx.query('UPDATE users SET suspended_at = $2, suspended_reason = $3 WHERE id = $1 AND suspended_at IS NULL', [
      userId,
      new Date(now),
      reason,
    ]);
    if (!rowCount) return;
    const { rows: active } = await tx.query<TripRow>('SELECT * FROM trips WHERE user_id = $1 AND status = ANY($2) FOR UPDATE', [userId, ACTIVE]);
    for (const trip of active) {
      if (trip.status !== 'confirmed') {
        await this.cancelLocked(tx, trip, now);
        continue;
      }
      const match = (await getMatch(tx, trip.match_id!, { lock: true }))!;
      if (now >= match.plan.startAt) continue;
      const partner = (await getTrip(tx, partnerTripId(match, trip.id), { lock: true }))!;
      await this.endConfirmed(tx, match, trip, partner, now, { refundCanceller: false });
      if (trip.payment_id) await enqueue(tx, now, 'payment.refund', { paymentId: trip.payment_id });
    }
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
      for (const trip of active) {
        // A ride that has started stays, so the other person can still settle it. Everything else is cancelled.
        if (trip.status === 'confirmed' && now >= (await getMatch(tx, trip.match_id!))!.plan.startAt) continue;
        await this.cancelLocked(tx, trip, now);
      }
      if (user.suspended_at && user.phone) {
        await tx.query(
          'INSERT INTO paused_numbers (phone_hash, paused_at, created_at) VALUES ($1, $2, $3) ON CONFLICT (phone_hash) DO UPDATE SET paused_at = EXCLUDED.paused_at, created_at = EXCLUDED.created_at',
          [phoneHash(this.deps.config.JWT_SECRET, user.phone), user.suspended_at, new Date(now)],
        );
      }
      await tx.query(
        `UPDATE users SET phone = NULL, first_name = NULL, push_token = NULL, payment_method_id = NULL,
           payment_method_brand = NULL, payment_method_last4 = NULL, revtag = NULL, deleted_at = $2 WHERE id = $1`,
        [userId, new Date(now)],
      );
      await tx.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
      // Trips stay for accounting and disputes, but without where the person lives or goes, here and in the
      // matched ride plans that copy their stops.
      const { rows: theirs } = await tx.query<{ id: string }>('SELECT id FROM trips WHERE user_id = $1', [userId]);
      await blurTrips(
        tx,
        theirs.map((r) => r.id),
        now,
        () => 'Removed',
      );
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
    const destination = { label: trip.dest_label, lat: trip.dest_lat, lng: trip.dest_lng };
    const along = (a: number, b: number) => a + (b - a) * 0.3;
    const onTheWay = { label: 'On your way', lat: along(trip.origin_lat, trip.dest_lat), lng: along(trip.origin_lng, trip.dest_lng) };
    const sameStart = { label: trip.origin_label, lat: trip.origin_lat, lng: trip.origin_lng };
    const likeFrom = (origin: Place) => ({ origin, destination, timeMode: trip.time_mode, time: trip.target_time.getTime(), flexMin: 30, seats: 1 });
    // Joining along the way shows off a shared route, but on a shorter trip it can save less than the minimum. The
    // same trip always saves the most, and every posted trip can save the minimum that way.
    const origin = [onTheWay, sameStart].find((o) => findBestMatch(toTripLike(trip), [{ ...likeFrom(o), id: 'companion', riderId: 'companion' }], now));
    if (!origin) return;
    const like = likeFrom(origin);
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
    else {
      await this.setTrip(tx, companion.id, { status: 'cancelled' }, now);
      await this.releasePretendPayment(tx, pay[0]!.id, now);
    }
  }

  // A demo traveller's payment was never a real hold; mark it released so nothing looks left on hold.
  private async releasePretendPayment(tx: Tx, paymentId: string | null, now: number) {
    if (!paymentId) return;
    const payment = await getPayment(tx, paymentId, { lock: true });
    if (payment?.status === 'authorized') await setPaymentStatus(tx, paymentId, 'released', now);
  }

  // The public demo's "Skip to after the ride": moves a confirmed ride into the past, for both riders, so the
  // fare can be entered straight away.
  async demoFinishRide(userId: string, matchId: string): Promise<string> {
    if (!this.deps.config.DEMO_MODE) throw notFound('Not found.');
    return this.tx(async (tx) => {
      const now = this.now();
      const { match, mine, partner } = await this.memberMatch(tx, userId, matchId);
      if (match.status !== 'confirmed') throw conflict('match_not_confirmed', 'Only a confirmed ride can be finished.');
      const lastStop = match.plan.route[match.plan.route.length - 1]!;
      const shift = lastStop.at + MINUTE - now;
      if (shift <= 0) return mine.id;
      const plan = {
        ...match.plan,
        startAt: match.plan.startAt - shift,
        route: match.plan.route.map((s) => ({ ...s, at: s.at - shift })),
        riders: Object.fromEntries(
          Object.entries(match.plan.riders).map(([id, r]) => [id, { ...r, pickupAt: r.pickupAt - shift, dropoffAt: r.dropoffAt - shift }]),
        ),
      };
      await tx.query('UPDATE matches SET plan = $2 WHERE id = $1', [match.id, plan]);
      await tx.query(
        `UPDATE trips SET target_time = target_time - make_interval(secs => $2::double precision / 1000),
           search_until = search_until - make_interval(secs => $2::double precision / 1000)
         WHERE id = ANY($1)`,
        [[mine.id, partner.id], shift],
      );
      return mine.id;
    });
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

      // Planned trips whose search opens now: place the hold without the rider in the app, then look for a match.
      const { rows: opening } = await tx.query<TripRow>("SELECT * FROM trips WHERE status = 'scheduled' AND search_from <= $1 FOR UPDATE", [at]);
      for (const trip of opening) {
        if (now >= trip.search_until.getTime()) {
          await this.setTrip(tx, trip.id, { status: 'expired' }, now);
          continue;
        }
        const paymentId = await this.createPayment(tx, trip.user_id, trip.id, now);
        await this.setTrip(tx, trip.id, { status: 'pending_payment' }, now);
        await enqueue(tx, now, 'payment.authorize', { paymentId });
        await notify(tx, now, trip.user_id, { kind: 'search_started', to: trip.dest_label, tripAt: trip.target_time.getTime() }, { tripId: trip.id });
      }

      const { rows: abandoned } = await tx.query<TripRow>(
        `SELECT * FROM trips WHERE status = 'pending_payment'
           AND (search_until <= $1 OR (updated_at <= $2 AND search_from IS NULL) OR updated_at <= $3) FOR UPDATE`,
        [at, new Date(now - PENDING_PAYMENT_TIMEOUT_MS), new Date(now - SCHEDULED_HOLD_TIMEOUT_MS)],
      );
      for (const trip of abandoned) {
        await this.setTrip(tx, trip.id, { status: 'cancelled' }, now);
        if (trip.payment_id) await enqueue(tx, now, 'payment.cancel', { paymentId: trip.payment_id });
      }

      // A proposal with a long time to answer: remind whoever hasn't answered, once, before it lapses.
      const { reminderMinutesBefore, remindIfOverMinutes } = CONFIG.accept;
      const { rows: unanswered } = await tx.query<MatchRow>(
        `SELECT * FROM matches WHERE status = 'proposed' AND answer_reminded_at IS NULL AND expires_at > $1 AND expires_at <= $2
           AND expires_at - proposed_at > make_interval(mins => $3) FOR UPDATE`,
        [at, new Date(now + reminderMinutesBefore * MINUTE), remindIfOverMinutes],
      );
      for (const match of unanswered) {
        await tx.query('UPDATE matches SET answer_reminded_at = $2 WHERE id = $1', [match.id, at]);
        const trips = await Promise.all([getTrip(tx, match.trip_a), getTrip(tx, match.trip_b)]);
        const names = await this.firstNames(tx, trips.map((t) => t!.user_id));
        for (const t of trips) {
          const other = trips.find((x) => x!.id !== t!.id)!;
          if (acceptedAt(match, t!.id)) continue;
          await notify(
            tx,
            now,
            t!.user_id,
            { kind: 'answer_reminder', partner: names.get(other.user_id)!, partnerAccepted: Boolean(acceptedAt(match, other.id)), acceptBy: match.expires_at.getTime() },
            { tripId: t!.id },
          );
        }
      }

      // Rides nobody has settled: remind the booker to enter the meter total, then close them at the estimate both
      // people accepted, so the other person still knows what they owe. The booker can correct it until they're paid.
      const { rows: unsettled } = await tx.query<MatchRow>("SELECT * FROM matches WHERE status = 'confirmed' FOR UPDATE");
      for (const match of unsettled) {
        const lastStop = match.plan.route[match.plan.route.length - 1];
        if (!lastStop || now < lastStop.at) continue;
        const bookerId = match.booker_trip_id;
        const partnerId = partnerTripId(match, bookerId);
        const [booker, partner] = await Promise.all([getTrip(tx, bookerId), getTrip(tx, partnerId)]);
        const names = await this.firstNames(tx, [booker!.user_id, partner!.user_id]);
        const remindAt = CONFIG.settle.reminderMinutes[match.fare_reminders];
        if (now < lastStop.at + AUTO_COMPLETE_AFTER_MS) {
          if (remindAt !== undefined && now >= lastStop.at + remindAt * MINUTE) {
            await tx.query('UPDATE matches SET fare_reminders = fare_reminders + 1 WHERE id = $1', [match.id]);
            await notify(tx, now, booker!.user_id, { kind: 'fare_reminder', partner: names.get(partner!.user_id)! }, { tripId: bookerId, matchId: match.id });
          }
          continue;
        }
        // Nobody to pay back if the booker has deleted their account.
        const { rows: bookerRows } = await tx.query<{ deleted_at: Date | null }>('SELECT deleted_at FROM users WHERE id = $1', [booker!.user_id]);
        const bookerGone = Boolean(bookerRows[0]?.deleted_at);
        const partnerOwes = match.plan.riders[partnerId]!.share;
        const settlement = bookerGone ? null : { actualFare: match.plan.fare, partnerOwes, bookerShare: match.plan.fare - partnerOwes, at: now, estimated: true };
        await tx.query("UPDATE matches SET status = 'completed', ended_at = $2, settlement = $3 WHERE id = $1", [match.id, at, settlement]);
        for (const id of [match.trip_a, match.trip_b]) {
          const { rows } = await tx.query<{ user_id: string }>("UPDATE trips SET status = 'completed', updated_at = $2 WHERE id = $1 RETURNING user_id", [id, at]);
          await tx.query('UPDATE users SET rides_completed = rides_completed + 1 WHERE id = $1', [rows[0]!.user_id]);
        }
        if (settlement && partnerOwes > 0) {
          await notify(tx, now, partner!.user_id, { kind: 'settled_at_estimate', partner: names.get(booker!.user_id)!, youOwe: partnerOwes }, { tripId: partnerId });
          await notify(tx, now, booker!.user_id, { kind: 'estimate_used', partner: names.get(partner!.user_id)!, owedToYou: partnerOwes }, { tripId: bookerId });
        }
      }
    });

    // The public demo: anyone still searching after a short wait gets the pretend travel partner, once per trip
    // (so declining them means waiting for a real person).
    if (this.deps.config.DEMO_MODE) {
      const { rows: waiting } = await this.deps.db.query<{ id: string }>(
        `SELECT t.id FROM trips t JOIN users u ON u.id = t.user_id
         WHERE t.status = 'searching' AND t.updated_at <= $1 AND NOT u.is_demo
           AND NOT EXISTS (
             SELECT 1 FROM matches m JOIN trips o ON o.id IN (m.trip_a, m.trip_b) AND o.id <> t.id JOIN users ou ON ou.id = o.user_id
             WHERE t.id IN (m.trip_a, m.trip_b) AND ou.is_demo)
         ORDER BY t.updated_at LIMIT 20`,
        [new Date(this.now() - this.deps.config.DEMO_PARTNER_AFTER_S * 1000)],
      );
      for (const { id } of waiting) {
        await this.tx(async (tx) => {
          const fresh = await getTrip(tx, id, { lock: true });
          if (fresh?.status === 'searching') await this.addReviewCompanion(tx, fresh, this.now());
        });
      }
    }

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

  // Storage limitation (GDPR Art. 5(1)(e)): nothing is kept longer than RETENTION says. Runs every few hours;
  // each step works in batches, so a backlog clears over a few runs.
  async purgeOldData() {
    const now = this.now();
    const db = this.deps.db;
    await db.query('DELETE FROM messages WHERE created_at < $1', [daysAgo(now, RETENTION.messagesDays)]);
    await this.deps.db.query('DELETE FROM otp_requests WHERE created_at < $1', [new Date(now - 86_400_000)]);
    await this.deps.db.query('DELETE FROM refresh_tokens WHERE expires_at < $1 OR revoked_at < $1', [new Date(now - 7 * 86_400_000)]);
    await this.deps.db.query('DELETE FROM jobs WHERE done_at < $1', [new Date(now - 30 * 86_400_000)]);
    await db.query('DELETE FROM webhook_events WHERE received_at < $1', [daysAgo(now, 90)]);

    // Exact places become a rough area after a year.
    const { rows: aging } = await db.query<{ id: string }>(
      'SELECT id FROM trips WHERE blurred_at IS NULL AND target_time < $1 AND status <> ALL($2) LIMIT 500',
      [daysAgo(now, RETENTION.exactPlacesDays), ACTIVE],
    );
    if (aging.length) {
      await withTx(db, (tx) =>
        blurTrips(
          tx,
          aging.map((r) => r.id),
          now,
          areaName,
        ),
      );
    }

    await db.query('UPDATE reports SET details = NULL WHERE details IS NOT NULL AND created_at < $1', [daysAgo(now, RETENTION.reportDetailsDays)]);
    await db.query('DELETE FROM paused_numbers WHERE created_at < $1', [daysAgo(now, RETENTION.pausedNumberDays)]);

    // Accounts nobody has used for two years. The public demo keeps them for a day: people try it with their
    // real number, and nothing there is worth keeping.
    const idleDays = this.deps.config.DEMO_MODE ? 1 : RETENTION.inactiveAccountDays;
    const { rows: idle } = await db.query<{ id: string }>(
      `SELECT id FROM users u WHERE deleted_at IS NULL AND NOT is_demo AND last_active_at < $1
         AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.user_id = u.id AND t.status = ANY($2))
       LIMIT 100`,
      [daysAgo(now, idleDays), ACTIVE],
    );
    for (const { id } of idle) await this.deleteAccount(id);

    // Trip, payment and receipt records after six years, then what's left of deleted accounts.
    const cutoff = daysAgo(now, RETENTION.recordsDays);
    await withTx(db, (tx) => deleteOldRecords(tx, cutoff, ACTIVE));
    await db.query('DELETE FROM reports WHERE created_at < $1', [cutoff]);
    await db.query(
      `DELETE FROM blocks b WHERE EXISTS (
         SELECT 1 FROM users u WHERE u.id IN (b.blocker_id, b.blocked_id) AND (u.deleted_at < $1 OR u.is_demo))`,
      [cutoff],
    );
    await db.query(
      `DELETE FROM users u WHERE (u.deleted_at < $1 OR (u.is_demo AND u.created_at < $1))
         AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.user_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.user_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM ratings r WHERE u.id IN (r.rater_id, r.ratee_id))
         AND NOT EXISTS (SELECT 1 FROM reports r WHERE u.id IN (r.reporter_id, r.reported_id))`,
      [cutoff],
    );
  }
}
