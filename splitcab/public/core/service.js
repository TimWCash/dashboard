import { CONFIG } from './config.js';
import { findBestMatch, soloWindow } from './matching.js';
import { roadKm } from './geo.js';
import { round2 } from './pricing.js';

const MINUTE = 60_000;
const ACTIVE = new Set(['searching', 'proposed', 'confirmed']);
const SIM_ACCEPT_DELAY_MS = 4_000;
const SIM_REPLY_DELAY_MS = 3_000;
const SIM_REPLIES = [
  'Sounds good, see you there!',
  "Great, I'll be ready a few minutes early.",
  "Perfect. I'm wearing a green jacket.",
  'Thanks for sorting this out!',
];

export class ServiceError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function createState() {
  return { riders: {}, trips: {}, matches: {}, payments: {}, messages: {} };
}

const newId = (prefix) => `${prefix}_${globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;

function validPlace(p) {
  return (
    p &&
    typeof p.label === 'string' &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180
  );
}

// All trip, match and payment rules. Pure state in, state out, so the same code runs
// on the server and, in demo mode, entirely in the browser.
export class TripService {
  constructor(state = createState(), cfg = CONFIG) {
    this.state = state;
    this.cfg = cfg;
  }

  // ---- riders ----------------------------------------------------------------

  createRider({ name, simulated = false, rating = null, tripsTaken = 0 }, now) {
    const clean = String(name ?? '').trim().slice(0, 40);
    if (!clean) throw new ServiceError('Please enter your first name.');
    const rider = { id: newId('rdr'), name: clean, simulated, rating, tripsTaken, createdAt: now };
    this.state.riders[rider.id] = rider;
    return rider;
  }

  rider(riderId) {
    const rider = this.state.riders[riderId];
    if (!rider) throw new ServiceError('Unknown traveler.', 401);
    return rider;
  }

  // ---- payments (simulated card holds) -----------------------------------------
  // In production these map to a card authorisation with manual capture: authorise when the
  // trip is posted, capture when the match is confirmed, cancel the authorisation otherwise.

  authorize(riderId, tripId, now) {
    const payment = {
      id: newId('pay'),
      riderId,
      tripId,
      amount: this.cfg.matchFee,
      status: 'authorized',
      history: [{ status: 'authorized', at: now }],
    };
    this.state.payments[payment.id] = payment;
    return payment;
  }

  setPayment(paymentId, status, now) {
    const payment = this.state.payments[paymentId];
    if (!payment || payment.status === status) return;
    payment.status = status;
    payment.history.push({ status, at: now });
  }

  // ---- trips -------------------------------------------------------------------

  postTrip(riderId, input, now) {
    this.rider(riderId);
    const { origin, destination, timeMode, time, flexMin, seats } = input ?? {};
    if (!validPlace(origin) || !validPlace(destination)) throw new ServiceError('Choose where you are leaving from and going to.');
    if (roadKm(origin, destination) < 1) throw new ServiceError('Pickup and destination are too close together to share a ride.');
    if (timeMode !== 'depart' && timeMode !== 'arrive') throw new ServiceError('Choose "leave at" or "arrive by".');
    if (!Number.isFinite(time)) throw new ServiceError('Choose a time.');
    if (!Number.isInteger(flexMin) || flexMin < 5 || flexMin > 120) throw new ServiceError('Flexibility must be between 5 and 120 minutes.');
    if (!Number.isInteger(seats) || seats < 1 || seats > this.cfg.matching.taxiSeats - 1) {
      throw new ServiceError(`Party size must be between 1 and ${this.cfg.matching.taxiSeats - 1}.`);
    }

    const trip = {
      id: newId('trp'),
      riderId,
      origin: { label: origin.label, lat: origin.lat, lng: origin.lng },
      destination: { label: destination.label, lat: destination.lat, lng: destination.lng },
      timeMode,
      time,
      flexMin,
      seats,
      status: 'searching',
      createdAt: now,
      matchId: null,
      declined: [],
    };
    const window = soloWindow(trip);
    trip.soloFare = window.solo.fare;
    trip.searchUntil = window.end - this.cfg.stopSearchingMinutesBefore * MINUTE;
    if (trip.searchUntil <= now) {
      throw new ServiceError('That time is too soon to find someone. Pick a later time or allow more flexibility.');
    }

    this.state.trips[trip.id] = trip;
    trip.paymentId = this.authorize(riderId, trip.id, now).id;
    this.tryMatch(trip, now);
    return trip;
  }

  ownTrip(riderId, tripId) {
    const trip = this.state.trips[tripId];
    if (!trip || trip.riderId !== riderId) throw new ServiceError('Trip not found.', 404);
    return trip;
  }

  cancelTrip(riderId, tripId, now) {
    const trip = this.ownTrip(riderId, tripId);
    if (!ACTIVE.has(trip.status)) throw new ServiceError('This trip is no longer active.');
    const match = trip.matchId ? this.state.matches[trip.matchId] : null;

    if (trip.status === 'confirmed') {
      // Late cancellation: the canceller's fee stays charged; the partner is refunded and goes back to searching.
      match.status = 'cancelled';
      match.endedAt = now;
      match.cancelledBy = trip.id;
      const partner = this.partnerTrip(match, trip.id);
      this.setPayment(partner.paymentId, 'refunded', now);
      partner.declined.push(trip.id);
      this.reopen(partner, now, { newHold: true });
      trip.status = 'cancelled';
      return trip;
    }

    if (match) this.unwind(match, 'cancelled', now, trip.id);
    this.setPayment(trip.paymentId, 'released', now);
    trip.status = 'cancelled';
    return trip;
  }

  // ---- matching ----------------------------------------------------------------

  tryMatch(trip, now) {
    if (trip.status !== 'searching') return null;
    const simulated = (t) => this.state.riders[t.riderId].simulated;
    const candidates = Object.values(this.state.trips).filter(
      (t) =>
        t.status === 'searching' &&
        t.riderId !== trip.riderId &&
        !(simulated(t) && simulated(trip)) &&
        !trip.declined.includes(t.id) &&
        !t.declined.includes(trip.id),
    );
    const best = findBestMatch(trip, candidates, now, this.cfg);
    if (!best) return null;
    return this.propose(trip, best.other, best.plan, now);
  }

  propose(a, b, plan, now) {
    const match = {
      id: newId('mtc'),
      tripIds: [a.id, b.id],
      status: 'proposed',
      plan,
      accepted: {},
      proposedAt: now,
      expiresAt: Math.min(now + this.cfg.acceptWindowMinutes * MINUTE, a.searchUntil, b.searchUntil),
    };
    this.state.matches[match.id] = match;
    for (const t of [a, b]) {
      t.status = 'proposed';
      t.matchId = match.id;
    }
    return match;
  }

  partnerTrip(match, tripId) {
    return this.state.trips[match.tripIds.find((id) => id !== tripId)];
  }

  ownMatch(riderId, matchId) {
    const match = this.state.matches[matchId];
    const trip = match && match.tripIds.map((id) => this.state.trips[id]).find((t) => t.riderId === riderId);
    if (!trip) throw new ServiceError('Match not found.', 404);
    return { match, trip };
  }

  respond(riderId, matchId, accept, now) {
    const { match, trip } = this.ownMatch(riderId, matchId);
    if (match.status !== 'proposed') throw new ServiceError('This match is no longer waiting for an answer.');
    if (!accept) {
      this.unwind(match, 'declined', now, trip.id);
      return match;
    }
    match.accepted[trip.id] = now;
    if (match.tripIds.every((id) => match.accepted[id])) this.confirm(match, now);
    return match;
  }

  confirm(match, now) {
    match.status = 'confirmed';
    match.confirmedAt = now;
    for (const id of match.tripIds) {
      const t = this.state.trips[id];
      t.status = 'confirmed';
      this.setPayment(t.paymentId, 'captured', now);
    }
    this.state.messages[match.id] = [];
  }

  // A proposal fell through. Everyone still travelling goes back to searching, and the pair won't be re-proposed.
  unwind(match, reason, now, byTripId = null) {
    match.status = reason;
    match.endedAt = now;
    const [a, b] = match.tripIds.map((id) => this.state.trips[id]);
    a.declined.push(b.id);
    b.declined.push(a.id);
    for (const t of [a, b]) {
      t.matchId = null;
      if (t.id === byTripId && reason === 'cancelled') continue;
      this.reopen(t, now);
    }
  }

  reopen(trip, now, { newHold = false } = {}) {
    trip.matchId = null;
    if (now >= trip.searchUntil) {
      trip.status = 'expired';
      if (!newHold) this.setPayment(trip.paymentId, 'released', now);
      return;
    }
    trip.status = 'searching';
    if (newHold) trip.paymentId = this.authorize(trip.riderId, trip.id, now).id;
    this.tryMatch(trip, now);
  }

  // ---- after confirmation --------------------------------------------------------

  sendMessage(riderId, matchId, text, now) {
    const { match, trip } = this.ownMatch(riderId, matchId);
    if (match.status !== 'confirmed' && match.status !== 'completed') {
      throw new ServiceError('You can message your travel partner once you are both confirmed.');
    }
    const clean = String(text ?? '').trim().slice(0, 500);
    if (!clean) throw new ServiceError('Message is empty.');
    const message = { id: newId('msg'), tripId: trip.id, text: clean, at: now };
    this.state.messages[match.id].push(message);
    return message;
  }

  // The rider who booked the cab enters what it actually cost; the split follows the agreed ratio.
  completeMatch(riderId, matchId, actualFare, now) {
    const { match, trip } = this.ownMatch(riderId, matchId);
    if (match.status !== 'confirmed') throw new ServiceError('Only a confirmed ride can be settled.');
    if (trip.id !== match.plan.bookerTripId) throw new ServiceError('The person who booked the taxi enters the final fare.', 403);
    if (!Number.isFinite(actualFare) || actualFare <= 0 || actualFare > 1000) throw new ServiceError('Enter the fare shown on your receipt.');

    const partner = this.partnerTrip(match, trip.id);
    const partnerOwes = round2((actualFare * match.plan.riders[partner.id].share) / match.plan.fare);
    match.status = 'completed';
    match.endedAt = now;
    match.settlement = {
      actualFare: round2(actualFare),
      paidBy: trip.id,
      owedBy: partner.id,
      amount: partnerOwes,
      bookerShare: round2(actualFare - partnerOwes),
    };
    for (const t of [trip, partner]) {
      t.status = 'completed';
      const r = this.state.riders[t.riderId];
      r.tripsTaken = (r.tripsTaken ?? 0) + 1;
    }
    return match;
  }

  // ---- clock -------------------------------------------------------------------

  // Advance time-based state. Returns true if anything changed.
  tick(now) {
    let changed = false;
    for (const match of Object.values(this.state.matches)) {
      if (match.status === 'proposed') {
        for (const id of match.tripIds) {
          const t = this.state.trips[id];
          if (!match.accepted[id] && this.state.riders[t.riderId].simulated && now - match.proposedAt >= SIM_ACCEPT_DELAY_MS) {
            this.respond(t.riderId, match.id, true, now);
            changed = true;
          }
        }
        if (match.status === 'proposed' && now >= match.expiresAt) {
          this.unwind(match, 'expired', now);
          changed = true;
        }
      }
      if (match.status === 'confirmed' && this.simReply(match, now)) changed = true;
    }
    for (const trip of Object.values(this.state.trips)) {
      if (trip.status === 'searching' && now >= trip.searchUntil) {
        trip.status = 'expired';
        this.setPayment(trip.paymentId, 'released', now);
        changed = true;
      }
    }
    return changed;
  }

  simReply(match, now) {
    const thread = this.state.messages[match.id] ?? [];
    const last = thread[thread.length - 1];
    if (!last || now - last.at < SIM_REPLY_DELAY_MS) return false;
    const sender = this.state.riders[this.state.trips[last.tripId].riderId];
    if (sender.simulated) return false;
    const sim = this.partnerTrip(match, last.tripId);
    if (!this.state.riders[sim.riderId].simulated) return false;
    const text = SIM_REPLIES[thread.filter((m) => m.tripId === sim.id).length % SIM_REPLIES.length];
    thread.push({ id: newId('msg'), tripId: sim.id, text, at: now });
    return true;
  }

  // ---- what one rider is allowed to see ----------------------------------------------

  viewFor(riderId, now) {
    const rider = this.rider(riderId);
    const trips = Object.values(this.state.trips)
      .filter((t) => t.riderId === riderId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((t) => this.tripView(t));
    const payments = Object.values(this.state.payments)
      .filter((p) => p.riderId === riderId)
      .sort((a, b) => b.history[0].at - a.history[0].at)
      .map((p) => ({ ...p, trip: this.tripSummary(this.state.trips[p.tripId]) }));
    return { now, rider, trips, payments, fee: this.cfg.matchFee };
  }

  tripSummary(t) {
    return { id: t.id, from: t.origin.label, to: t.destination.label, time: t.time, timeMode: t.timeMode };
  }

  tripView(trip) {
    const { declined, ...own } = trip;
    const view = { ...own, payment: this.state.payments[trip.paymentId] };
    // Show the most recent match this trip was part of, including ones that fell through.
    const match = Object.values(this.state.matches)
      .filter((m) => m.tripIds.includes(trip.id))
      .sort((a, b) => b.proposedAt - a.proposedAt)[0];
    if (!match) return view;

    const partner = this.partnerTrip(match, trip.id);
    const partnerRider = this.state.riders[partner.riderId];
    const revealed = match.status === 'confirmed' || match.status === 'completed';
    view.match = {
      id: match.id,
      status: match.status,
      proposedAt: match.proposedAt,
      expiresAt: match.expiresAt,
      confirmedAt: match.confirmedAt,
      endedAt: match.endedAt,
      cancelledByPartner: match.cancelledBy === partner.id,
      cancelledByMe: match.cancelledBy === trip.id,
      youAccepted: Boolean(match.accepted[trip.id]),
      partnerAccepted: Boolean(match.accepted[partner.id]),
      youBook: match.plan.bookerTripId === trip.id,
      partner: {
        name: partnerRider.name,
        rating: partnerRider.rating,
        tripsTaken: partnerRider.tripsTaken,
        seats: partner.seats,
      },
      plan: {
        startAt: match.plan.startAt,
        fare: match.plan.fare,
        totalKm: match.plan.totalKm,
        totalMin: match.plan.totalMin,
        savingsPct: match.plan.savingsPct,
        meetUp: match.plan.meetUp,
        you: match.plan.riders[trip.id],
        partner: { share: match.plan.riders[partner.id].share },
        // Partner's exact stops stay approximate until both people have said yes.
        route: match.plan.route.map((s) => ({
          kind: s.kind,
          you: s.tripIds.includes(trip.id),
          partner: s.tripIds.includes(partner.id),
          label: revealed || s.tripIds.includes(trip.id) ? s.label : `Near ${s.label}`,
          lat: revealed || s.tripIds.includes(trip.id) ? s.lat : undefined,
          lng: revealed || s.tripIds.includes(trip.id) ? s.lng : undefined,
          at: s.at,
        })),
      },
      settlement: match.settlement ?? null,
      messages: revealed
        ? (this.state.messages[match.id] ?? []).map((m) => ({ id: m.id, mine: m.tripId === trip.id, text: m.text, at: m.at }))
        : [],
    };
    return view;
  }
}
