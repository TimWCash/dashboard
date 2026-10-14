// Randomised end-to-end simulations against the real API and Postgres (the database the API tests use).
// Each world is a group of travellers with their own habits, who:
// - post trips, from minutes to weeks ahead;
// - answer, ignore or decline matches, and cancel;
// - block and report each other;
// - ride, settle, pay back (or don't) and delete their accounts;
// - have cards declined or abandon 3-D Secure, while the payment provider fails now and then.
// The clock moves on, and the sweeper and job worker run. After every other step it checks rules that must always
// hold. At the end of each world it lets time run out and checks where every euro ended up.
//
//   TEST_DATABASE_URL=postgres://... npm run simulate -w @splitcab/api -- --worlds 100 [--seed 1] [--out report.json]
//
// Exits with an error if any rule was broken. Each finding names its world's seed, so it can be replayed with
// --seed <seed> --worlds 1.
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { CONFIG, PLACES, type TripView } from '@splitcab/core';
import { TestGateway, type PaymentGateway } from '../src/providers/payments';
import { harness, resetDb, testDb, type Harness } from '../test/helpers';

const MIN = 60_000;
const HOUR = 60 * MIN;
const { values: args } = parseArgs({ options: { worlds: { type: 'string', default: '20' }, seed: { type: 'string', default: '1' }, out: { type: 'string' } } });
const worlds = Number(args.worlds);
const firstSeed = Number(args.seed);

// ---- seeded randomness --------------------------------------------------------------------------------------
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let R = rng(1);
const rand = () => R();
const chance = (p: number) => R() < p;
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(R() * xs.length)]!;
const between = (lo: number, hi: number) => lo + R() * (hi - lo);
const intBetween = (lo: number, hi: number) => Math.floor(between(lo, hi + 1));

// ---- a payment gateway that sometimes fails, like a real one -------------------------------------------------
class FlakyGateway implements PaymentGateway {
  readonly mode = 'test' as const;
  failRate = 0;
  injected = 0;
  clock: () => number = () => 0;
  private authorizedAt = new Map<string, number>();
  constructor(public inner: TestGateway) {}
  private maybeFail(op: string) {
    if (chance(this.failRate)) {
      this.injected++;
      throw new Error(`Injected ${op} failure`);
    }
  }
  createCustomer(userId: string) {
    return this.inner.createCustomer(userId);
  }
  modeFor() {
    return this.inner.modeFor();
  }
  createSetup() {
    return this.inner.createSetup();
  }
  defaultCard() {
    return this.inner.defaultCard();
  }
  async authorize(input: Parameters<TestGateway['authorize']>[0]) {
    const result = await this.inner.authorize(input);
    if (!this.authorizedAt.has(result.ref)) this.authorizedAt.set(result.ref, this.clock());
    return result;
  }
  // A card authorisation lapses after 7 days; capturing it then fails for good (Stripe: charge_expired_for_capture).
  private expired(ref: string) {
    const at = this.authorizedAt.get(ref);
    return at !== undefined && this.clock() - at > 7 * 24 * HOUR;
  }
  retrieve(ref: string) {
    return this.inner.retrieve(ref);
  }
  // Fails either before Stripe did anything, or after (the response was lost), so retries must be idempotent.
  async capture(ref: string, key?: string) {
    if (this.expired(ref) && this.inner.intents.get(ref)?.status === 'authorized') {
      this.inner.intents.get(ref)!.status = 'released';
      throw new Error('charge_expired_for_capture: the authorization expired');
    }
    if (chance(this.failRate / 2)) {
      await this.inner.capture(ref);
      this.injected++;
      throw new Error('Injected lost capture response');
    }
    this.maybeFail('capture');
    return this.inner.capture(ref);
  }
  async cancel(ref: string, key?: string) {
    this.maybeFail('cancel');
    return this.inner.cancel(ref);
  }
  async refund(ref: string, key?: string) {
    this.maybeFail('refund');
    return this.inner.refund(ref);
  }
  deleteCustomer() {
    return this.inner.deleteCustomer();
  }
  parseWebhook(...args: Parameters<TestGateway['parseWebhook']>) {
    return this.inner.parseWebhook(...args);
  }
}

// ---- results ------------------------------------------------------------------------------------------------
type Finding = { world: number; seed: number; kind: string; detail: string; recent: string[] };
const findings: Finding[] = [];
const stats: Record<string, number> = {};
const bump = (k: string, n = 1) => (stats[k] = (stats[k] ?? 0) + n);
const samples: Record<string, number[]> = {};
const sample = (k: string, v: number) => (samples[k] ??= []).push(v);

// ---- the world ----------------------------------------------------------------------------------------------
interface Persona {
  acceptProb: number;
  // Minutes until they look at a proposal; Infinity means never.
  responseMin: () => number;
  // Chance of cancelling a given trip while it's planned or searching, at some moment before it ends.
  cancelsTrip: number;
  lateCancelProb: number;
  completes3ds: number;
  paysBack: number;
  blocks: number;
  reports: number;
  rates: number;
  // Chance of deleting their account at some moment.
  deletes: number;
  bookerSettles: number;
  meterNoise: number;
}

interface Rider {
  i: number;
  name: string;
  phone: string;
  token: string;
  refresh: string;
  userId: string;
  persona: Persona;
  plans: { postAt: number; body: Record<string, unknown>; retry?: boolean }[];
  seenProposal: Map<string, number>;
  deleted: boolean;
  rode: boolean;
  deleteAt: number;
  cancelAt: Map<string, number>;
  actedOn: Set<string>;
}

const DUBLIN = PLACES.filter((p) => !['cork-airport', 'shannon', 'cork-city', 'kent', 'ucc', 'eyre-square', 'salthill', 'uni-galway', 'limerick', 'ul'].includes(p.id));
const AIRPORTS = ['dub', 'dub-t2'];
const place = (id: string) => {
  const p = PLACES.find((x) => x.id === id)!;
  return { label: p.label, lat: p.lat, lng: p.lng };
};

function persona(): Persona {
  const kind = pick(['keen', 'keen', 'normal', 'normal', 'normal', 'flaky', 'slow', 'difficult']);
  const base: Persona = {
    acceptProb: 0.85,
    responseMin: () => (chance(0.9) ? between(0.5, 8) : between(8, 120)),
    cancelsTrip: 0.1,
    lateCancelProb: 0.04,
    completes3ds: 0.8,
    paysBack: 0.9,
    blocks: 0.01,
    reports: 0.03,
    rates: 0.6,
    deletes: 0.02,
    bookerSettles: 0.85,
    meterNoise: 0.12,
  };
  if (kind === 'keen') return { ...base, acceptProb: 0.97, responseMin: () => between(0.2, 3), lateCancelProb: 0.01, paysBack: 0.98 };
  if (kind === 'flaky') return { ...base, acceptProb: 0.6, cancelsTrip: 0.4, lateCancelProb: 0.2, paysBack: 0.6, completes3ds: 0.5 };
  if (kind === 'slow') return { ...base, responseMin: () => (chance(0.3) ? Infinity : between(20, 600)) };
  if (kind === 'difficult') return { ...base, acceptProb: 0.5, blocks: 0.1, reports: 0.3, paysBack: 0.4, deletes: 0.15, meterNoise: 0.4 };
  return base;
}

// A trip someone might want, by kind of world.
function tripBody(scenario: string, postAt: number): Record<string, unknown> {
  let from: string, to: string;
  if (scenario === 'airport') {
    const city = pick(DUBLIN.filter((p) => !AIRPORTS.includes(p.id))).id;
    [from, to] = chance(0.7) ? [city, pick(AIRPORTS)] : [pick(AIRPORTS), city];
  } else if (scenario === 'regional') {
    [from, to] = pick([
      ['cork-city', 'cork-airport'], ['kent', 'cork-airport'], ['ucc', 'cork-airport'], ['eyre-square', 'shannon'], ['uni-galway', 'shannon'],
      ['limerick', 'shannon'], ['ul', 'shannon'], ['eyre-square', 'salthill'], ['cork-city', 'ucc'],
    ] as const);
  } else if (scenario === 'nightlife') {
    from = pick(['temple-bar', '3arena', 'croke-park', 'aviva', 'spire', 'smithfield']);
    to = pick(['rathmines', 'ranelagh', 'dundrum', 'sandyford', 'drumcondra', 'dcu', 'ucd', 'swords', 'blanchardstown', 'tallaght', 'dun-laoghaire', 'howth']);
  } else {
    from = pick(PLACES).id;
    to = pick(PLACES).id;
  }
  const origin = place(from);
  let destination = place(to);
  // Odd inputs a real client could send.
  if (scenario === 'edge' && chance(0.3)) {
    destination = pick([
      { label: 'Belfast City Hall', lat: 54.596, lng: -5.93 },
      { label: 'London', lat: 51.5, lng: -0.12 },
      { label: 'Nowhere', lat: 91, lng: 0 },
      { label: '', lat: 53.35, lng: -6.26 },
      { label: 'visit scam.ly now', lat: 53.35, lng: -6.26 },
      { label: 'Lifford', lat: 54.834, lng: -7.48 },
    ]);
  }
  const roll = rand();
  const lead =
    roll < 0.5
      ? between(20, 150) * MIN
      : roll < 0.72
        ? between(3, 30) * HOUR
        : roll < 0.88
          ? between(7, 42) * 24 * HOUR
          : roll < 0.97
            ? between(5, 7) * 24 * HOUR
            : between(61, 90) * 24 * HOUR;
  const flex = scenario === 'edge' && chance(0.2) ? pick([0, 7, 500]) : pick([15, 30, 30, 60]);
  return {
    origin,
    destination,
    timeMode: chance(0.75) ? 'depart' : 'arrive',
    time: new Date(postAt + lead).toISOString(),
    flexMin: flex,
    seats: scenario === 'edge' && chance(0.2) ? pick([0, 4, 9]) : chance(0.85) ? 1 : pick([2, 3]),
    startNow: scenario === 'edge' && chance(0.1) ? false : true,
  };
}

async function runWorld(index: number, seed: number) {
  R = rng(seed);
  const recent: string[] = [];
  const log = (s: string) => {
    recent.push(s);
    if (recent.length > 40) recent.shift();
  };
  const seenFindings = new Set<string>();
  const fail = (kind: string, detail: string) => {
    const key = `${kind}|${detail.replace(/^(t\+\d+m|end): /, '')}`;
    if (seenFindings.has(key)) return;
    seenFindings.add(key);
    findings.push({ world: index, seed, kind, detail, recent: [...recent] });
    bump(`finding:${kind}`);
  };

  const demo = chance(0.15);
  const concurrent = chance(0.3);
  const scenario = pick(['airport', 'airport', 'airport', 'nightlife', 'regional', 'mixed', 'edge']);
  const gateway = new FlakyGateway(new TestGateway());
  gateway.failRate = chance(0.4) ? pick([0.05, 0.15, 0.3]) : 0;
  const h: Harness = await harness(db, { payments: gateway, env: demo ? { DEMO_MODE: 'true', DEMO_PARTNER_AFTER_S: '45' } : {} });
  // Any day of the week and time of day, so every tariff is exercised.
  const start = Date.UTC(2026, 9, 12 + intBetween(0, 6), intBetween(0, 23), intBetween(0, 59));
  h.clock.now = start;
  bump(`scenario:${scenario}`);
  if (demo) bump('worlds:demo');
  if (concurrent) bump('worlds:concurrent');

  // Every API call goes through here: 5xx is always a finding; an expired access token is refreshed once.
  async function call(r: Rider, method: string, url: string, body?: unknown, what = '') {
    let res = await h.call(method, url, { token: r.token, body });
    if (res.status === 401 && !r.deleted) {
      const ref = await h.call('POST', '/v1/auth/refresh', { body: { refreshToken: r.refresh } });
      if (ref.status === 200) {
        r.token = ref.json.accessToken;
        r.refresh = ref.json.refreshToken;
        res = await h.call(method, url, { token: r.token, body });
      }
    }
    log(`${new Date(h.clock.now).toISOString().slice(5, 16)} ${r.name} ${method} ${url.replace(/[0-9a-f-]{36}/g, (m) => m.slice(0, 6))} ${what} → ${res.status}${res.status >= 400 ? ` ${res.json?.error?.code ?? ''}` : ''}`);
    if (method === 'DELETE' && url === '/v1/me' && res.status !== 204) fail('cannot_delete_account', `${res.status} ${res.json?.error?.message ?? ''}`);
    if (res.status >= 500) fail('server_error', `${method} ${url} ${what}: ${res.status} ${JSON.stringify(res.json)}`);
    if (res.status >= 400) bump(`http:${res.status}:${res.json?.error?.code ?? 'unknown'}`);
    return res;
  }

  const aheadTrips = new Set<string>();
  gateway.clock = () => h.clock.now;

  // ---- people ----
  const riders: Rider[] = [];
  const n = intBetween(2, scenario === 'edge' ? 6 : 14);
  for (let i = 0; i < n; i++) {
    const phone = `0872${String(index % 1000).padStart(3, '0')}${String(i).padStart(3, '0')}`;
    const otp = await h.call('POST', '/v1/auth/otp/start', { body: { phone } });
    if (otp.status !== 200) {
      fail('signup', `otp start ${otp.status} ${JSON.stringify(otp.json)}`);
      continue;
    }
    const verify = await h.call('POST', '/v1/auth/otp/verify', { body: { phone, code: otp.json.devCode } });
    const name = ['Aoife', 'Cian', 'Niamh', 'Sean', 'Ciara', 'Darragh', 'Orla', 'Conor', 'Siobhan', 'Eoin', 'Roisin', 'Padraig', 'Sinead', 'Liam', 'Grainne', 'Tadhg'][i]!;
    const r: Rider = {
      i,
      name,
      phone: otp.json.phone,
      token: verify.json.accessToken,
      refresh: verify.json.refreshToken,
      userId: verify.json.user.id,
      persona: persona(),
      plans: [],
      seenProposal: new Map(),
      deleted: false,
      deleteAt: Infinity,
      cancelAt: new Map(),
      rode: false,
      actedOn: new Set(),
    };
    await call(r, 'PATCH', '/v1/me', { firstName: name, acceptTerms: true, pushToken: `ExponentPushToken[${name}]` });
    if (chance(0.95)) {
      await call(r, 'POST', '/v1/payments/setup');
      await call(r, 'POST', '/v1/payments/method/refresh');
    }
    if (chance(0.5)) await call(r, 'PATCH', '/v1/me', { revtag: `rider${index}x${i}` });
    if (chance(r.persona.deletes)) r.deleteAt = start + between(0, 7 * 24) * HOUR;
    const trips = chance(0.7) ? 1 : chance(0.7) ? 2 : 3;
    for (let k = 0; k < trips; k++) {
      const postAt = start + between(0, 4) * HOUR;
      r.plans.push({ postAt, body: tripBody(scenario, postAt) });
    }
    riders.push(r);
  }
  bump('riders', riders.length);

  // ---- per-step rules ----
  async function checkInvariants(stage: string) {
    const q = <T extends Record<string, any>,>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
    const bad = async (kind: string, sql: string, params: unknown[] = []) => {
      const rows = await q<Record<string, unknown>>(sql, params);
      for (const row of rows.slice(0, 3)) fail(kind, `${stage}: ${JSON.stringify(row)}`);
    };
    // A trip's status agrees with its match.
    await bad(
      'trip_match_mismatch',
      `SELECT t.id, t.status, m.status AS match_status FROM trips t LEFT JOIN matches m ON m.id = t.match_id
       WHERE (t.status = 'proposed' AND (m.status IS DISTINCT FROM 'proposed'))
          OR (t.status = 'confirmed' AND (m.status IS DISTINCT FROM 'confirmed'))
          OR (t.status IN ('scheduled', 'searching', 'pending_payment', 'expired') AND t.match_id IS NOT NULL)`,
    );
    // A live match's trips both point at it.
    await bad(
      'match_trip_mismatch',
      `SELECT m.id, m.status, a.status AS a_status, b.status AS b_status FROM matches m JOIN trips a ON a.id = m.trip_a JOIN trips b ON b.id = m.trip_b
       WHERE m.status IN ('proposed', 'confirmed') AND (a.match_id IS DISTINCT FROM m.id OR b.match_id IS DISTINCT FROM m.id OR a.status <> m.status OR b.status <> m.status)`,
    );
    // Nobody is matched with themselves, someone they blocked, or while paused.
    await bad(
      'bad_pair',
      `SELECT m.id FROM matches m JOIN trips a ON a.id = m.trip_a JOIN trips b ON b.id = m.trip_b
       WHERE a.user_id = b.user_id
          OR EXISTS (SELECT 1 FROM blocks k WHERE k.created_at < m.proposed_at AND ((k.blocker_id = a.user_id AND k.blocked_id = b.user_id) OR (k.blocker_id = b.user_id AND k.blocked_id = a.user_id)))
          OR EXISTS (SELECT 1 FROM users u WHERE u.id IN (a.user_id, b.user_id) AND u.suspended_at < m.proposed_at AND NOT u.is_demo)`,
    );
    // The plan adds up and is worth it for both, and nobody is over-booked.
    const plans = await q<{ id: string; status: string; plan: any; a_seats: number; b_seats: number; expires_at: Date; proposed_at: Date; a_until: Date; b_until: Date; a_demo: boolean; b_demo: boolean }>(
      `SELECT m.id, m.status, m.plan, a.seats AS a_seats, b.seats AS b_seats, m.expires_at, m.proposed_at, a.search_until AS a_until, b.search_until AS b_until,
              ua.is_demo AS a_demo, ub.is_demo AS b_demo
       FROM matches m JOIN trips a ON a.id = m.trip_a JOIN trips b ON b.id = m.trip_b JOIN users ua ON ua.id = a.user_id JOIN users ub ON ub.id = b.user_id`,
    );
    for (const m of plans) {
      const riders = Object.values(m.plan.riders) as any[];
      const sum = riders.reduce((s, r) => s + r.share, 0);
      if (sum !== m.plan.fare) fail('shares_dont_add_up', `${stage}: match ${m.id.slice(0, 8)} shares ${sum} fare ${m.plan.fare}`);
      for (const r of riders) if (r.savings < CONFIG.matching.minNetSavings) fail('saving_below_minimum', `${stage}: match ${m.id.slice(0, 8)} saving ${r.savings}`);
      if (m.a_seats + m.b_seats > CONFIG.matching.taxiSeats) fail('too_many_seats', `${stage}: ${m.a_seats}+${m.b_seats}`);
      if (m.status === 'proposed' && m.expires_at.getTime() > Math.min(m.a_until.getTime(), m.b_until.getTime())) fail('expires_after_search', `${stage}: match ${m.id.slice(0, 8)}`);
      if (!demo && m.expires_at.getTime() - m.proposed_at.getTime() < CONFIG.accept.minAnswerMinutes * MIN) {
        fail('answer_window_too_short', `match ${m.id.slice(0, 8)}: ${Math.round((m.expires_at.getTime() - m.proposed_at.getTime()) / 1000)}s`);
      }
      if (m.expires_at.getTime() <= m.proposed_at.getTime()) fail('expires_before_proposed', `${stage}: match ${m.id.slice(0, 8)} ${m.expires_at.toISOString()} <= ${m.proposed_at.toISOString()}`);
    }
    // Every trip that's looking or matched has a hold in place (or being placed).
    await bad(
      'live_trip_without_hold',
      `SELECT t.id, t.status, p.status AS payment FROM trips t LEFT JOIN payments p ON p.id = t.payment_id
       WHERE t.status IN ('searching', 'proposed') AND (p.status IS DISTINCT FROM 'authorized')`,
    );
    // Charged only for a match both accepted.
    await bad(
      'charged_without_confirmed_match',
      `SELECT p.id, t.status FROM payments p JOIN trips t ON t.id = p.trip_id
       WHERE p.status = 'captured' AND NOT EXISTS (SELECT 1 FROM matches m WHERE t.id IN (m.trip_a, m.trip_b) AND m.confirmed_at IS NOT NULL)`,
    );
    // Settling: shares add up to the meter.
    await bad(
      'settlement_mismatch',
      `SELECT id, settlement FROM matches WHERE settlement IS NOT NULL
         AND ((settlement->>'partnerOwes')::int + (settlement->>'bookerShare')::int) <> (settlement->>'actualFare')::int`,
    );
    // A planned trip never holds money before its search opens.
    await bad('scheduled_trip_has_hold', "SELECT id FROM trips WHERE status = 'scheduled' AND payment_id IS NOT NULL");
    await bad('job_failed_permanently', `SELECT id, kind, last_error FROM jobs WHERE failed_at IS NOT NULL`);
  }

  // ---- what each person does on each step ----
  async function act(r: Rider) {
    if (r.deleted) return;
    const now = h.clock.now;
    if (now >= r.deleteAt) {
      r.deleteAt = Infinity;
      const res = await call(r, 'DELETE', '/v1/me', undefined, 'delete account');
      if (res.status === 204) {
        r.deleted = true;
        bump('accounts:deleted');
        return;
      }
    }
    // Post trips when they planned to.
    for (const plan of r.plans.filter((p) => p.postAt <= now)) {
      r.plans.splice(r.plans.indexOf(plan), 1);
      const res = await call(r, 'POST', '/v1/trips', plan.body, `${(plan.body.origin as any).label}→${(plan.body.destination as any).label}`);
      bump(res.status === 201 ? 'trips:posted' : `trips:refused:${res.json?.error?.code}`);
      const leadDays = (Date.parse(plan.body.time as string) - now) / (24 * HOUR);
      if (leadDays > 3) {
        bump(`ahead:${leadDays > 7 ? 'weeks' : '3-7_days'}:${res.status === 201 ? 'posted' : res.json?.error?.code}`);
        if (res.status === 201) aheadTrips.add(res.json.id);
      }
      if (plan.retry) bump(`ahead:retry:${res.status === 201 ? 'posted' : res.json?.error?.code}`);
      if (res.json?.error?.code === 'too_far_ahead') {
        // Some come back when the app lets them; most planners won't.
        if (chance(0.5)) {
          const tripAt = Date.parse(plan.body.time as string);
          r.plans.push({ postAt: Math.max(now + MIN, tripAt - between(1, 6) * 24 * HOUR), body: plan.body, retry: true });
          bump('ahead:came_back_later');
        } else bump('ahead:gave_up');
      }
      if (res.status === 201 && res.json.status === 'pending_payment') bump('trips:3ds');
    }
    const list = await call(r, 'GET', '/v1/trips?scope=active');
    if (list.status !== 200) return;
    for (const t of list.json as TripView[]) {
      const m = t.match;
      if (t.status === 'pending_payment' && t.paymentAction && !r.actedOn.has(`3ds:${t.id}`)) {
        r.actedOn.add(`3ds:${t.id}`);
        if (chance(r.persona.completes3ds)) {
          const ref = t.paymentAction.clientSecret.replace(/_secret$/, '');
          gateway.inner.completeAction(ref);
          await call(r, 'POST', `/v1/trips/${t.id}/payment-confirmed`);
        } else bump('3ds:abandoned');
      } else if (t.status === 'searching' || t.status === 'scheduled') {
        if (!r.cancelAt.has(t.id)) r.cancelAt.set(t.id, chance(r.persona.cancelsTrip) ? now + rand() * Math.max(0, Date.parse(t.searchUntil) - now) : Infinity);
        if (now >= r.cancelAt.get(t.id)!) {
          r.cancelAt.set(t.id, Infinity);
          await call(r, 'POST', `/v1/trips/${t.id}/cancel`, undefined, `cancel ${t.status}`);
        }
      } else if (t.status === 'proposed' && m) {
        if (!m.youAccepted) {
          if (!r.seenProposal.has(m.id)) r.seenProposal.set(m.id, Date.parse(m.proposedAt) + r.persona.responseMin() * MIN);
          const at = r.seenProposal.get(m.id)!;
          if (at <= now) {
            r.seenProposal.set(m.id, Infinity);
            const accept = chance(r.persona.acceptProb);
            sample('respond_after_min', (now - Date.parse(m.proposedAt)) / MIN);
            await call(r, 'POST', `/v1/matches/${m.id}/respond`, { accept }, accept ? 'accept' : 'decline');
          }
        } else if (chance(0.01)) await call(r, 'POST', `/v1/trips/${t.id}/cancel`, undefined, 'cancel while waiting');
      } else if (t.status === 'confirmed' && m) {
        r.rode = true;
        const pickup = Date.parse(m.plan.you.pickupAt);
        const lastDrop = Math.max(...m.plan.route.map((s) => Date.parse(s.at)));
        if (now < pickup) {
          if (!r.actedOn.has(`late:${m.id}`)) {
            r.actedOn.add(`late:${m.id}`);
            if (chance(r.persona.lateCancelProb)) await call(r, 'POST', `/v1/trips/${t.id}/cancel`, undefined, 'late cancel');
            else if (chance(r.persona.blocks)) await call(r, 'POST', `/v1/matches/${m.id}/block`, undefined, 'block before ride');
          }
          if (chance(0.15)) {
            const text = pick(["I'm here", 'Running 5 min late', 'How will I recognise you?', 'pay me at scam.ly', 'see you soon', '']);
            await call(r, 'POST', `/v1/matches/${m.id}/messages`, { text }, `msg "${text}"`);
          }
        } else if (now > lastDrop && m.youBook && !r.actedOn.has(`settle:${m.id}`)) {
          r.actedOn.add(`settle:${m.id}`);
          if (chance(r.persona.bookerSettles)) {
            let fare = Math.round(m.plan.fare * (1 + (rand() * 2 - 1) * r.persona.meterNoise));
            if (chance(0.03)) fare = pick([0, 50, 99, 100_001, Math.round(m.plan.fare / 100)]);
            const res = await call(r, 'POST', `/v1/matches/${m.id}/complete`, { actualFare: fare }, `meter ${fare}`);
            if (res.status === 200) sample('meter_vs_estimate', fare / m.plan.fare);
          } else bump('rides:never_settled_by_booker');
          // The other person sometimes tries to enter the fare too.
          if (chance(0.05)) bump('abuse:attempted');
        }
        if (demo && now < pickup && chance(0.2)) await call(r, 'POST', `/v1/matches/${m.id}/demo-finish`);
      }
    }
    // Finished rides: pay back, rate, report.
    if (!r.rode) return;
    const past = await call(r, 'GET', '/v1/trips?scope=past');
    if (past.status !== 200) return;
    for (const t of past.json as TripView[]) {
      const m = t.match;
      if (t.status !== 'completed' || !m) continue;
      const s = m.settlement;
      if (s && s.youOwe > 0 && !s.paidAt && !r.actedOn.has(`pay:${m.id}`)) {
        r.actedOn.add(`pay:${m.id}`);
        if (chance(r.persona.paysBack)) await call(r, 'POST', `/v1/matches/${m.id}/paid`);
        else bump('debts:never_paid');
      }
      if (!m.youRated && !r.actedOn.has(`rate:${m.id}`)) {
        r.actedOn.add(`rate:${m.id}`);
        if (chance(r.persona.rates)) await call(r, 'POST', `/v1/matches/${m.id}/rating`, { stars: intBetween(1, 5) });
      }
      if (!r.actedOn.has(`report:${m.id}`)) {
        r.actedOn.add(`report:${m.id}`);
        if (chance(r.persona.reports)) {
          await call(r, 'POST', `/v1/matches/${m.id}/report`, { reason: pick(['no_show', 'unsafe', 'harassment', 'payment', 'other']), details: 'sim' });
          bump('reports:filed');
        }
        if (s && s.owedToYou > 0 && !s.paidAt && chance(0.5)) await call(r, 'POST', `/v1/matches/${m.id}/report`, { reason: 'payment' }, 'unpaid');
        const receipt = await call(r, 'GET', `/v1/trips/${t.id}/receipt`);
        if (receipt.status === 200) {
          if (receipt.json.fare.savings < 0) fail('negative_receipt_saving', JSON.stringify(receipt.json.fare));
          if (receipt.json.fare.yourShare + receipt.json.fare.partnerShare !== (receipt.json.fare.meterTotal ?? m.plan.fare)) {
            fail('receipt_shares_dont_add_up', JSON.stringify(receipt.json.fare));
          }
        } else if (receipt.status !== 409) fail('receipt_unavailable', `${receipt.status}`);
      }
    }
    // Now and then, try something that should be refused: someone else's match, nonsense ids.
    if (chance(0.02)) {
      const other = pick(riders);
      const theirs = (await h.call('GET', '/v1/trips?scope=active', { token: other.token })).json;
      const mid = Array.isArray(theirs) ? theirs.find((x: TripView) => x.match)?.match?.id : undefined;
      if (mid && other !== r) {
        const res = await call(r, 'POST', `/v1/matches/${mid}/respond`, { accept: true }, 'not my match');
        // A rider who is the other half of this match may legitimately respond.
        const mine = (await call(r, 'GET', '/v1/trips?scope=active')).json as TripView[];
        if (res.status === 200 && !mine.some((x) => x.match?.id === mid)) fail('acted_on_someone_elses_match', mid);
      }
    }
  }

  // ---- privacy check on what people see ----
  async function checkViews(r: Rider) {
    if (r.deleted) return;
    const list = await call(r, 'GET', '/v1/trips?scope=active');
    if (list.status !== 200) return;
    const text = JSON.stringify(list.json);
    for (const other of riders) if (other !== r && text.includes(other.phone.slice(-7))) fail('phone_leaked', `${r.name} sees ${other.name}'s number`);
    for (const t of list.json as TripView[]) {
      if (t.status !== 'proposed' || !t.match) continue;
      for (const s of t.match.plan.route) if (s.partner && !s.you && (s.lat !== null || s.lng !== null)) fail('exact_stop_before_accept', `${t.match.id}`);
    }
  }

  // ---- support pauses someone now and then ----
  const supportPauses = chance(0.1);

  // ---- run the clock ----
  let stepMin = 5;
  const lastTrip = Math.max(start, ...riders.flatMap((r) => r.plans.map((p) => Date.parse(p.body.time as string))));
  const end = Math.max(start + 40 * HOUR, Math.min(lastTrip, start + 45 * 24 * HOUR) + 30 * HOUR);
  async function nextEvent(now: number) {
    const times: number[] = [now + 12 * HOUR];
    for (const r of riders) {
      if (!r.deleted) times.push(r.deleteAt, ...r.cancelAt.values());
      for (const p of r.plans) times.push(p.postAt);
      for (const v of r.seenProposal.values()) if (Number.isFinite(v)) times.push(v);
    }
    const { rows } = await db.query<{ t: Date; open: boolean }>(
      `SELECT expires_at AS t, true AS open FROM matches WHERE status = 'proposed'
       UNION ALL SELECT expires_at - make_interval(mins => ${CONFIG.accept.reminderMinutesBefore}), true FROM matches WHERE status = 'proposed'
       UNION ALL SELECT search_from, false FROM trips WHERE status = 'scheduled'
       UNION ALL SELECT search_until, true FROM trips WHERE status IN ('searching', 'pending_payment')
       UNION ALL SELECT run_at, false FROM jobs WHERE done_at IS NULL AND failed_at IS NULL`,
    );
    for (const row of rows) times.push(row.t.getTime());
    const { rows: rides } = await db.query<{ plan: any }>("SELECT plan FROM matches WHERE status = 'confirmed'");
    for (const m of rides) {
      for (const s of m.plan.route) times.push(s.at, s.at + MIN);
      const lastDrop = m.plan.route.at(-1).at;
      for (const r of CONFIG.settle.reminderMinutes) times.push(lastDrop + r * MIN + MIN);
      times.push(lastDrop + CONFIG.settle.closeAfterHours * HOUR + MIN);
    }
    // Searching trips get another look every half hour, and the demo's pretend partner arrives after 45 seconds.
    // A trip that's only planned, or a job waiting to retry, doesn't need the half-hourly look.
    const searching = rows.some((row) => row.open);
    if (searching) times.push(now + (demo ? 1 : 30) * MIN);
    return Math.min(...times.filter((t) => t > now));
  }
  let tick = 0;
  while (h.clock.now < end) {
    const proposals = (await db.query<{ id: string }>("SELECT id FROM matches WHERE status = 'proposed'")).rows;
    const unseen = proposals.some((m) => !riders.some((r) => r.seenProposal.has(m.id)));
    const next = unseen ? h.clock.now + MIN : await nextEvent(h.clock.now);
    stepMin = Math.max(1, Math.round((next - h.clock.now) / MIN));
    h.clock.now += stepMin * MIN;
    bump('ticks');
    const order = riders.filter((r) => !r.deleted).sort(() => rand() - 0.5);
    if (concurrent) await Promise.all(order.map((r) => act(r)));
    else for (const r of order) await act(r);
    if (supportPauses && chance(0.01)) {
      const target = pick(riders);
      if (!target.deleted) {
        log(`support pauses ${target.name}`);
        await h.rides.suspend(target.userId, 'sim');
        bump('support:paused');
      }
    }
    await h.rides.sweep();
    await h.runJobs();
    if (chance(0.1)) for (const r of riders) await checkViews(r);
    if (++tick % 2 === 0) await checkInvariants(`t+${Math.round((h.clock.now - start) / MIN)}m`);
  }

  // ---- drain: three more days, everyone stops ----
  for (let k = 0; k < 18; k++) {
    h.clock.now += 4 * HOUR;
    await h.rides.sweep();
    // Jobs that failed wait before retrying; run them a few times.
    for (let j = 0; j < 3; j++) {
      h.clock.now += 30 * MIN;
      await h.runJobs();
    }
  }
  await h.rides.purgeOldData();
  await h.runJobs();
  await checkInvariants('end');

  // ---- where did every euro go? ----
  const q = <T extends Record<string, any>,>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows);
  const stuck = await q<{ id: string; status: string }>("SELECT id, status FROM trips WHERE status IN ('pending_payment', 'searching', 'proposed', 'confirmed')");
  for (const t of stuck.slice(0, 3)) fail('trip_never_finished', `${t.id.slice(0, 8)} ${t.status}`);
  const live = await q<{ id: string; status: string }>("SELECT id, status FROM matches WHERE status IN ('proposed', 'confirmed')");
  for (const m of live.slice(0, 3)) fail('match_never_finished', `${m.id.slice(0, 8)} ${m.status}`);
  const pending = await q<{ id: string; kind: string; attempts: number }>('SELECT id, kind, attempts FROM jobs WHERE done_at IS NULL AND failed_at IS NULL');
  for (const j of pending.slice(0, 3)) fail('job_never_ran', `${j.kind} after ${j.attempts} attempts`);

  const payments = await q<{ id: string; status: string; provider_ref: string | null; trip_status: string; trip_id: string; is_demo: boolean }>(
    `SELECT p.id, p.status, p.provider_ref, t.status AS trip_status, t.id AS trip_id, u.is_demo
     FROM payments p JOIN trips t ON t.id = p.trip_id JOIN users u ON u.id = p.user_id`,
  );
  const refunds = new Set(gateway.inner.calls.filter((c) => c.op === 'refund').map((c) => c.ref));
  for (const p of payments) {
    bump(`fees:${p.status}`);
    if (!['captured', 'refunded', 'released', 'failed'].includes(p.status)) {
      if (p.is_demo) fail('pretend_payment_left_on_hold', `payment ${p.id.slice(0, 8)} ${p.status} (trip ${p.trip_status})`);
      else fail('hold_left_open', `payment ${p.id.slice(0, 8)} ${p.status} (trip ${p.trip_status})`);
    }
    if (!p.provider_ref || p.is_demo) continue;
    const g = gateway.inner.intents.get(p.provider_ref);
    if (!g) continue;
    // What Stripe would show against what we recorded.
    const gw = g.status === 'captured' ? (refunds.has(p.provider_ref) ? 'refunded' : 'captured') : g.status;
    const ok =
      (p.status === 'captured' && gw === 'captured') ||
      (p.status === 'refunded' && gw === 'refunded') ||
      (p.status === 'released' && (gw === 'released' || gw === 'requires_action' || gw === 'failed')) ||
      (p.status === 'failed' && gw === 'failed');
    if (!ok) fail('gateway_disagrees', `payment ${p.id.slice(0, 8)}: ours ${p.status}, gateway ${gw} (trip ${p.trip_status})`);
    if (gw === 'authorized') fail('card_hold_never_released', `payment ${p.id.slice(0, 8)} trip ${p.trip_status}`);
    if (gw === 'requires_action' && p.status !== 'released' && p.status !== 'failed') fail('3ds_left_open', p.id);
  }
  // Fee kept although the person didn't cancel and the ride didn't happen.
  const unfair = await q<{ id: string }>(
    `SELECT p.id FROM payments p JOIN trips t ON t.id = p.trip_id JOIN users u ON u.id = t.user_id
     WHERE p.status = 'captured' AND t.status <> 'completed' AND NOT u.is_demo
       AND NOT EXISTS (SELECT 1 FROM matches m WHERE m.cancelled_by_trip_id = t.id)`,
  );
  for (const p of unfair.slice(0, 3)) fail('kept_fee_without_ride', p.id.slice(0, 8));

  // ---- what happened, for the product view ----
  const matches = await q<{ status: string; confirmed_at: Date | null; plan: any; settlement: any; booker_trip_id: string; proposed_at: Date; expires_at: Date; a_accepted_at: Date | null; b_accepted_at: Date | null; demo: boolean; booker_deleted: boolean }>(
    `SELECT m.status, m.confirmed_at, m.plan, m.settlement, m.booker_trip_id, m.proposed_at, m.expires_at, m.a_accepted_at, m.b_accepted_at,
            (ua.is_demo OR ub.is_demo) AS demo,
            (SELECT u.deleted_at IS NOT NULL FROM trips bt JOIN users u ON u.id = bt.user_id WHERE bt.id = m.booker_trip_id) AS booker_deleted
     FROM matches m JOIN trips a ON a.id = m.trip_a JOIN trips b ON b.id = m.trip_b JOIN users ua ON ua.id = a.user_id JOIN users ub ON ub.id = b.user_id`,
  );
  for (const m of matches) {
    bump(`matches:${m.status}`);
    const windowMin = (m.expires_at.getTime() - m.proposed_at.getTime()) / MIN;
    if (!demo) {
      sample('answer_window_min', windowMin);
      if (windowMin < 5) bump('matches:window_under_5_min');
      if (m.status === 'expired') {
        sample('expired_window_min', windowMin);
        bump(m.a_accepted_at || m.b_accepted_at ? 'matches:expired_one_had_accepted' : 'matches:expired_nobody_answered');
      }
    }
    if (m.confirmed_at) bump('matches:confirmed_ever');
    if (m.status === 'completed') {
      for (const r of Object.values(m.plan.riders) as any[]) sample('saving_eur', r.savings / 100);
      // Who gets out last: if it isn't the booker, someone else ends up paying the driver at a rank.
      const lastDrop = m.plan.route[m.plan.route.length - 1];
      if (!lastDrop.tripIds.includes(m.booker_trip_id)) bump('rides:booker_not_last_out');
      bump('rides:completed');
      if (!m.settlement) {
        bump('rides:closed_without_settlement');
        if (!m.booker_deleted) fail('closed_without_settlement', `match booked by an account that still exists`);
      } else if (m.settlement.estimated) bump('rides:settled_at_estimate');
      else if (m.settlement.partnerOwes > 0 && !m.settlement.paidAt) bump('rides:share_never_marked_paid');
    }
  }
  const tripRows = await q<{ id: string; status: string; user_id: string }>('SELECT id, status, user_id FROM trips');
  for (const t of tripRows) {
    bump(`trips:final:${t.status}`);
    if (aheadTrips.has(t.id)) bump(`ahead:final:${t.status}`);
  }
  const expiredCaptures = await q<{ n: number }>("SELECT count(*)::int AS n FROM jobs WHERE kind = 'payment.capture' AND last_error LIKE '%charge_expired%'");
  if (expiredCaptures[0]!.n) fail('hold_expired_before_capture', `${expiredCaptures[0]!.n} capture attempts on lapsed authorisations`);
  const paused = await q<{ n: number }>('SELECT count(*)::int AS n FROM users WHERE suspended_at IS NOT NULL');
  bump('accounts:paused', paused[0]!.n);
  bump('gateway:injected_failures', gateway.injected);
  bump('worlds');
}

const db = await testDb();
const t0 = Date.now();
for (let w = 0; w < worlds; w++) {
  const seed = firstSeed + w;
  await resetDb(db);
  try {
    await runWorld(seed, seed * 7919);
  } catch (err) {
    findings.push({ world: seed, seed, kind: 'simulator_crash', detail: String((err as Error).stack ?? err).slice(0, 1500), recent: [] });
  }
  if ((w + 1) % 10 === 0) console.error(`${w + 1}/${worlds} worlds, ${findings.length} findings, ${Math.round((Date.now() - t0) / 1000)}s`);
}
await db.end();

// ---- report ----
if (args.out) writeFileSync(args.out, JSON.stringify({ worlds, stats, samples, findings }, null, 1));
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
console.log(`${worlds} worlds (seeds ${firstSeed}-${firstSeed + worlds - 1}), ${stats.riders ?? 0} travellers, ${Math.round((Date.now() - t0) / 1000)}s`);
for (const k of Object.keys(stats).sort()) if (!k.startsWith('finding:')) console.log(`  ${k}: ${stats[k]}`);
for (const [k, v] of Object.entries(samples)) if (v.length) console.log(`  ${k}: median ${median(v).toFixed(2)} (n=${v.length})`);
const kinds = new Map<string, Finding[]>();
for (const f of findings) kinds.set(f.kind, [...(kinds.get(f.kind) ?? []), f]);
console.log(findings.length ? `\n${findings.length} FINDINGS` : '\nNo rules broken.');
for (const [kind, fs] of kinds) {
  console.log(`\n${kind}: ${fs.length}, in worlds ${[...new Set(fs.map((f) => f.world))].slice(0, 10).join(', ')} (replay: --seed <world> --worlds 1)`);
  for (const f of fs.slice(0, 2)) {
    console.log(`  ${f.detail.slice(0, 500)}`);
    for (const line of f.recent.slice(-10)) console.log(`    ${line}`);
  }
}
process.exit(findings.length ? 1 : 0);
