import Stripe from 'stripe';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Db } from '../src/db';
import { StripeGateway } from '../src/providers/payments';
import { MIN, harness, post, resetDb, rider, testDb, trip, type Harness } from './helpers';
import { ReviewAwareGateway, TestGateway } from '../src/providers/payments';

let db: Db;
let h: Harness;

beforeAll(async () => {
  db = await testDb();
});
beforeEach(async () => {
  await resetDb(db);
  h = await harness(db);
});
afterAll(async () => {
  await db.end();
});

describe('sign in', () => {
  test('a texted code signs you in and normalises Irish numbers', async () => {
    const start = await h.call('POST', '/v1/auth/otp/start', { body: { phone: '087 765 4321' } });
    expect(start.json.phone).toBe('+353877654321');
    const verify = await h.call('POST', '/v1/auth/otp/verify', { body: { phone: '+353 87 765 4321', code: start.json.devCode } });
    expect(verify.status).toBe(200);
    expect(verify.json.user).toMatchObject({ phone: '+353877654321', profileComplete: false, paymentMethod: null });
    const me = await h.call('GET', '/v1/me', { token: verify.json.accessToken });
    expect(me.json.id).toBe(verify.json.user.id);
  });

  test('wrong codes and bad numbers are rejected', async () => {
    expect((await h.call('POST', '/v1/auth/otp/start', { body: { phone: '12' } })).json.error.code).toBe('invalid_phone');
    await h.call('POST', '/v1/auth/otp/start', { body: { phone: '0871111111' } });
    const bad = await h.call('POST', '/v1/auth/otp/verify', { body: { phone: '0871111111', code: '000000' } });
    expect(bad.status).toBe(400);
    expect(bad.json.error.code).toBe('invalid_code');
  });

  test('only Irish and UK numbers can sign in', async () => {
    const fr = await h.call('POST', '/v1/auth/otp/start', { body: { phone: '+33 6 12 34 56 78' } });
    expect(fr.json.error.code).toBe('unsupported_country');
    // GB covers every +44 number, including the Channel Islands and the Isle of Man.
    for (const phone of ['+44 7400 123456', '+44 7911 123456']) expect((await h.call('POST', '/v1/auth/otp/start', { body: { phone } })).status, phone).toBe(200);
  });

  test('too many wrong codes lock the number for an hour, across new codes', async () => {
    const phone = '0873333333';
    let code = '';
    for (let round = 0; round < 2; round++) {
      code = (await h.call('POST', '/v1/auth/otp/start', { body: { phone } })).json.devCode;
      for (let i = 0; i < 5; i++) expect((await h.call('POST', '/v1/auth/otp/verify', { body: { phone, code: '000000' } })).status).toBe(400);
    }
    code = (await h.call('POST', '/v1/auth/otp/start', { body: { phone } })).json.devCode;
    expect((await h.call('POST', '/v1/auth/otp/verify', { body: { phone, code } })).status).toBe(429);
    h.advance(61 * MIN);
    code = (await h.call('POST', '/v1/auth/otp/start', { body: { phone } })).json.devCode;
    expect((await h.call('POST', '/v1/auth/otp/verify', { body: { phone, code } })).status).toBe(200);
  });

  test('code requests are throttled per number', async () => {
    for (let i = 0; i < 5; i++) expect((await h.call('POST', '/v1/auth/otp/start', { body: { phone: '0872222222' } })).status).toBe(200);
    expect((await h.call('POST', '/v1/auth/otp/start', { body: { phone: '0872222222' } })).status).toBe(429);
  });

  test('access tokens expire; refresh tokens rotate and reuse revokes the session', async () => {
    const ana = await rider(h, 'Ana');
    h.advance(16 * MIN);
    expect((await h.call('GET', '/v1/me', { token: ana.token })).status).toBe(401);
    const r1 = await h.call('POST', '/v1/auth/refresh', { body: { refreshToken: ana.refreshToken } });
    expect(r1.status).toBe(200);
    expect((await h.call('GET', '/v1/me', { token: r1.json.accessToken })).status).toBe(200);
    // Replaying the old token looks like theft: it fails and kills the newer token too.
    expect((await h.call('POST', '/v1/auth/refresh', { body: { refreshToken: ana.refreshToken } })).status).toBe(401);
    expect((await h.call('POST', '/v1/auth/refresh', { body: { refreshToken: r1.json.refreshToken } })).status).toBe(401);
  });

  test('signing out ends the session', async () => {
    const ana = await rider(h, 'Ana');
    expect((await h.call('POST', '/v1/auth/logout', { token: ana.token, body: { refreshToken: ana.refreshToken } })).status).toBe(204);
    expect((await h.call('POST', '/v1/auth/refresh', { body: { refreshToken: ana.refreshToken } })).status).toBe(401);
  });

  test('requests without a valid token are refused', async () => {
    expect((await h.call('GET', '/v1/me')).status).toBe(401);
    expect((await h.call('GET', '/v1/me', { token: 'not-a-jwt' })).status).toBe(401);
  });
});

describe('profile and account', () => {
  test('profile update validates input', async () => {
    const ana = await rider(h, 'Ana', { card: false });
    expect((await h.call('PATCH', '/v1/me', { token: ana.token, body: { firstName: '' } })).status).toBe(400);
    expect((await h.call('PATCH', '/v1/me', { token: ana.token, body: { pushToken: 'javascript:alert(1)' } })).status).toBe(400);
    const ok = await h.call('PATCH', '/v1/me', { token: ana.token, body: { firstName: 'Áine' } });
    expect(ok.json).toMatchObject({ firstName: 'Áine', profileComplete: true });
    // The name is shown to strangers: real names pass, links, numbers and abuse don't.
    for (const firstName of ["Seán O'Brien", 'Mary-Kate', 'Zoë']) {
      expect((await h.call('PATCH', '/v1/me', { token: ana.token, body: { firstName } })).status, firstName).toBe(200);
    }
    for (const firstName of ['www.pay-me.ie', 'Call 0871234567', 'Bitch']) {
      expect((await h.call('PATCH', '/v1/me', { token: ana.token, body: { firstName } })).status, firstName).toBe(400);
    }
  });

  test('saving a card in test mode records a test card', async () => {
    const ana = await rider(h, 'Ana');
    const me = await h.call('GET', '/v1/me', { token: ana.token });
    expect(me.json.paymentMethod).toEqual({ brand: 'visa', last4: '4242' });
  });

  test('export returns your data; deleting the account cancels trips and signs you out', async () => {
    const ana = await rider(h, 'Ana');
    const t = await post(h, ana, trip('stephens-green', 'dub'));
    const exported = await h.call('GET', '/v1/me/export', { token: ana.token });
    expect(exported.json.profile.firstName).toBe('Ana');
    expect(exported.json.trips).toHaveLength(1);

    expect((await h.call('DELETE', '/v1/me', { token: ana.token })).status).toBe(204);
    await h.runJobs();
    const { rows } = await db.query('SELECT phone, first_name, deleted_at FROM users WHERE id = $1', [ana.userId]);
    expect(rows[0].phone).toBeNull();
    expect(rows[0].first_name).toBeNull();
    expect(rows[0].deleted_at).not.toBeNull();
    expect((await db.query('SELECT status FROM trips WHERE id = $1', [t.id])).rows[0].status).toBe('cancelled');
    expect((await db.query('SELECT status FROM payments WHERE id = $1', [t.payment!.id])).rows[0].status).toBe('released');
    expect((await h.call('GET', '/v1/me', { token: ana.token })).status).toBe(401);
    expect((await h.call('POST', '/v1/auth/refresh', { body: { refreshToken: ana.refreshToken } })).status).toBe(401);

    // The same number can sign up again as a fresh account.
    const again = await h.call('POST', '/v1/auth/otp/start', { body: { phone: ana.phone } });
    const verify = await h.call('POST', '/v1/auth/otp/verify', { body: { phone: ana.phone, code: again.json.devCode } });
    expect(verify.json.user.id).not.toBe(ana.userId);
  });
});

describe('deleting an account', () => {
  test("blurs where that person travelled, including in a former partner's ride", async () => {
    const ana = await rider(h, 'Ana');
    const ben = await rider(h, 'Ben');
    const a = await post(h, ana, trip('stephens-green', 'dub'));
    const b = await post(h, ben, trip('trinity', 'dub'));
    expect((await h.call('DELETE', '/v1/me', { token: ana.token })).status).toBe(204);

    const row = (await db.query('SELECT origin_label, dest_label, origin_lat, origin_lng FROM trips WHERE id = $1', [a.id])).rows[0];
    expect([row.origin_label, row.dest_label]).toEqual(['Removed', 'Removed']);
    for (const n of [row.origin_lat, row.origin_lng]) expect(Math.abs(n * 100 - Math.round(n * 100))).toBeLessThan(1e-6);

    const plan = (await db.query('SELECT plan FROM matches WHERE id = $1', [b.match!.id])).rows[0].plan;
    const stop = (tripId: string) => plan.route.find((s: { tripIds: string[] }) => s.tripIds[0] === tripId);
    expect(stop(a.id).label).toBe('Removed');
    expect(stop(b.id).label).toBe('Trinity College');
  });
});

describe('places and config', () => {
  test('built-in place search and details', async () => {
    const ana = await rider(h, 'Ana', { card: false });
    const res = await h.call('GET', '/v1/places/autocomplete?q=dublin%20air', { token: ana.token });
    expect(res.json[0]).toMatchObject({ id: 'k:dub', primary: 'Dublin Airport T1 (taxi rank)' });
    const place = await h.call('GET', '/v1/places/details?id=k:dub', { token: ana.token });
    expect(place.json).toMatchObject({ label: 'Dublin Airport T1 (taxi rank)' });
    expect((await h.call('GET', '/v1/places/details?id=k:nowhere', { token: ana.token })).status).toBe(404);
  });

  test('public config exposes what the app needs and no secrets', async () => {
    const res = await h.call('GET', '/v1/config');
    expect(res.json).toMatchObject({ currency: 'EUR', matchFee: 199, paymentsMode: 'test', placesProvider: 'builtin' });
    expect(JSON.stringify(res.json)).not.toMatch(/sk_|whsec_|secret/i);
  });
});

describe('Stripe webhooks', () => {
  const secret = 'whsec_test_secret';
  const stripe = new Stripe('sk_test_dummy');

  async function signedPost(wh: Harness, event: object, sig?: string) {
    const payload = JSON.stringify(event);
    const header = sig ?? stripe.webhooks.generateTestHeaderString({ payload, secret });
    return wh.call('POST', '/v1/webhooks/stripe', { body: payload, headers: { 'content-type': 'application/json', 'stripe-signature': header } });
  }

  test('rejects unsigned or tampered events', async () => {
    const wh = await harness(db, { payments: new StripeGateway('sk_test_dummy', secret) });
    const res = await signedPost(wh, { id: 'evt_1', type: 'payment_intent.succeeded', data: { object: { id: 'pi_1' } } }, 't=1,v1=bad');
    expect(res.status).toBe(400);
  });

  test('an authorisation webhook rescues a trip whose result was never recorded', async () => {
    // Ana posts a trip normally, then we simulate a crash right after Stripe placed the hold.
    const ana = await rider(h, 'Ana');
    const t = await post(h, ana, trip('stephens-green', 'dub'));
    await db.query("UPDATE trips SET status = 'pending_payment' WHERE id = $1", [t.id]);
    await db.query("UPDATE payments SET status = 'pending', provider_ref = NULL WHERE id = $1", [t.payment!.id]);

    const wh = await harness(db, { payments: new StripeGateway('sk_test_dummy', secret) });
    wh.clock.now = h.clock.now;
    const event = {
      id: 'evt_auth_1',
      object: 'event',
      type: 'payment_intent.amount_capturable_updated',
      data: { object: { id: 'pi_live_123', object: 'payment_intent', status: 'requires_capture', metadata: { paymentId: t.payment!.id } } },
    };
    expect((await signedPost(wh, event)).status).toBe(200);
    const { rows } = await db.query('SELECT p.status, p.provider_ref, t.status AS trip_status FROM payments p JOIN trips t ON t.id = p.trip_id WHERE p.id = $1', [
      t.payment!.id,
    ]);
    expect(rows[0]).toEqual({ status: 'authorized', provider_ref: 'pi_live_123', trip_status: 'searching' });
    // Stripe retries are ignored.
    expect((await signedPost(wh, event)).json.duplicate).toBe(true);
  });
});

describe('store review account', () => {
  const env = { REVIEW_PHONE: '087 000 0001', REVIEW_CODE: '246810' };

  async function reviewer(rh: Harness) {
    const start = await rh.call('POST', '/v1/auth/otp/start', { body: { phone: env.REVIEW_PHONE } });
    expect(start.json.devCode).toBeUndefined();
    const verify = await rh.call('POST', '/v1/auth/otp/verify', { body: { phone: env.REVIEW_PHONE, code: env.REVIEW_CODE } });
    expect(verify.status).toBe(200);
    const token = verify.json.accessToken as string;
    await rh.call('PATCH', '/v1/me', { token, body: { firstName: 'Reviewer', acceptTerms: true } });
    const setup = await rh.call('POST', '/v1/payments/setup', { token });
    expect(setup.json.mode).toBe('test');
    await rh.call('POST', '/v1/payments/method/refresh', { token });
    return token;
  }

  test('signs in with the fixed code and gets a demo partner who accepts straight away', async () => {
    const rh = await harness(db, { env });
    const token = await reviewer(rh);
    const posted = await rh.call('POST', '/v1/trips', { token, body: trip('stephens-green', 'dub') });
    expect(posted.json.status).toBe('proposed');
    expect(posted.json.match.partner.firstName).toBe('Alex');
    expect(posted.json.match.partnerAccepted).toBe(true);
    expect(posted.json.match.youBook).toBe(true);

    const accepted = await rh.call('POST', `/v1/matches/${posted.json.match.id}/respond`, { token, body: { accept: true } });
    expect(accepted.json.status).toBe('confirmed');
    await rh.runJobs();
    const done = await rh.call('POST', `/v1/matches/${posted.json.match.id}/complete`, { token, body: { actualFare: 3000 } });
    expect(done.json.status).toBe('completed');
  });

  test('the review account stays one even after REVIEW_PHONE changes', async () => {
    const rh = await harness(db, { env });
    await reviewer(rh);
    // A later deploy drops the review settings; the same number signs in with a normal code.
    const start = await h.call('POST', '/v1/auth/otp/start', { body: { phone: env.REVIEW_PHONE } });
    const verify = await h.call('POST', '/v1/auth/otp/verify', { body: { phone: env.REVIEW_PHONE, code: start.json.devCode } });
    const { rows } = await db.query('SELECT is_reviewer FROM users WHERE id = $1', [verify.json.user.id]);
    expect(rows[0].is_reviewer).toBe(true);
  });

  test('the review account and demo travellers never match real people', async () => {
    const rh = await harness(db, { env });
    const token = await reviewer(rh);
    const posted = await rh.call('POST', '/v1/trips', { token, body: trip('stephens-green', 'dub') });
    await rh.call('POST', `/v1/matches/${posted.json.match.id}/respond`, { token, body: { accept: false } });
    const { rows } = await db.query("SELECT t.status FROM trips t JOIN users u ON u.id = t.user_id WHERE u.is_demo");
    expect(rows.map((r) => r.status)).toEqual(['cancelled']);
    // A real traveller going the same way is never matched with the reviewer or the demo partner.
    const real = await rider(rh, 'Ana');
    const t = await post(rh, real, trip('trinity', 'dub'));
    expect(t.status).toBe('searching');
    await rh.rides.sweep();
    expect((await rh.call('GET', `/v1/trips/${t.id}`, { token: real.token })).json.status).toBe('searching');
  });

  test('the review account is routed to test payments even when Stripe is live', async () => {
    const live = new TestGateway();
    const gateway = new ReviewAwareGateway(Object.assign(live, { mode: 'stripe' as const, modeFor: () => 'stripe' as const }));
    const testCustomer = await gateway.createCustomer('u1', { test: true });
    expect(gateway.modeFor(testCustomer)).toBe('test');
    expect(gateway.modeFor('cus_live123')).toBe('stripe');
  });
});

describe('chat moderation through the API', () => {
  test('a blocked message is refused with a friendly explanation', async () => {
    const ana = await rider(h, 'Ana');
    const ben = await rider(h, 'Ben');
    await post(h, ana, trip('stephens-green', 'dub'));
    const b = await post(h, ben, trip('trinity', 'dub'));
    const matchId = b.match!.id;
    await h.call('POST', `/v1/matches/${matchId}/respond`, { token: ana.token, body: { accept: true } });
    await h.call('POST', `/v1/matches/${matchId}/respond`, { token: ben.token, body: { accept: true } });
    const res = await h.call('POST', `/v1/matches/${matchId}/messages`, { token: ana.token, body: { text: 'pay me at revolut.me/ana' } });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe('message_blocked');
  });
});
