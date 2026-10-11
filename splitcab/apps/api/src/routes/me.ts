import type { AppConfig as ClientConfig, MeView, PaymentSetupResponse, PaymentView, PlaceSuggestion, Place } from '@splitcab/core';
import { CONFIG } from '@splitcab/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../deps';
import { badRequest } from '../errors';
import { authenticate, parse } from '../http';
import { createModerator } from '../moderation';
import { normalizeRevtag } from '../revtag';
import { RETENTION } from '../rides/retention';
import { getUser, type UserRow } from '../rides/rows';
import type { RideService } from '../rides/service';
import { listPaymentViews, meView } from '../rides/views';

export function meRoutes(app: FastifyInstance, deps: Deps, rides: RideService) {
  const auth = { preHandler: authenticate(deps) };
  const moderate = createModerator(deps.config.BLOCKED_TERMS.split(','));

  app.get('/v1/config', async (): Promise<ClientConfig> => ({
    currency: CONFIG.currency,
    matchFee: CONFIG.matchFee,
    merchantDisplayName: deps.config.MERCHANT_DISPLAY_NAME,
    paymentsMode: deps.payments.mode,
    stripePublishableKey: deps.config.STRIPE_PUBLISHABLE_KEY ?? null,
    merchantCountryCode: 'IE',
    placesProvider: deps.places.kind,
    termsUrl: deps.config.TERMS_URL,
    privacyUrl: deps.config.PRIVACY_URL,
    supportEmail: deps.config.SUPPORT_EMAIL,
  }));

  app.get('/v1/me', auth, async (req): Promise<MeView> => meView(await getUser(deps.db, req.userId), deps.config.TERMS_VERSION));

  app.patch('/v1/me', auth, async (req): Promise<MeView> => {
    const body = parse(
      z.object({
        // Shown to the other traveller, so letters only (any alphabet), plus spaces, hyphens and apostrophes.
        firstName: z
          .string()
          .trim()
          .min(1, 'Enter your first name.')
          .max(40)
          .regex(/^\p{L}[\p{L}\p{M}' .’-]*$/u, 'Use letters only in your first name.')
          .refine((name) => moderate(name).ok, 'Choose a different name.')
          .optional(),
        acceptTerms: z.literal(true).optional(),
        // Expo push tokens look like ExponentPushToken[xxxx].
        pushToken: z.string().regex(/^Expo(nent)?PushToken\[[\w-]+\]$/).nullable().optional(),
        revtag: z.string().max(80).nullable().optional(),
      }),
      req.body,
    );
    // Shown to travel partners who owe you money, so it goes through the same filter as names.
    const revtag = body.revtag ? normalizeRevtag(body.revtag) : null;
    if (revtag && !moderate(revtag).ok) throw badRequest('invalid_revtag', 'That Revtag can\'t be used here.');
    await getUser(deps.db, req.userId);
    const now = new Date(deps.clock());
    if (body.pushToken) {
      // A device belongs to whoever signed in on it last.
      await deps.db.query('UPDATE users SET push_token = NULL WHERE push_token = $1 AND id <> $2', [body.pushToken, req.userId]);
    }
    const { rows } = await deps.db.query<UserRow>(
      `UPDATE users SET
         first_name = COALESCE($2, first_name),
         terms_accepted_at = CASE WHEN $3 THEN $4 ELSE terms_accepted_at END,
         terms_version = CASE WHEN $3 THEN $9 ELSE terms_version END,
         push_token = CASE WHEN $5 THEN $6 ELSE push_token END,
         revtag = CASE WHEN $7 THEN $8 ELSE revtag END
       WHERE id = $1 RETURNING *`,
      [req.userId, body.firstName ?? null, body.acceptTerms === true, now, body.pushToken !== undefined, body.pushToken ?? null, body.revtag !== undefined, revtag, deps.config.TERMS_VERSION],
    );
    return meView(rows[0]!, deps.config.TERMS_VERSION);
  });

  app.delete('/v1/me', auth, async (req, reply) => {
    await rides.deleteAccount(req.userId);
    return reply.status(204).send();
  });

  // Everything we hold about the signed-in person (GDPR right of access).
  app.get('/v1/me/export', auth, async (req) => {
    const user = await getUser(deps.db, req.userId);
    const q = (sql: string) => deps.db.query(sql, [req.userId]).then((r) => r.rows);
    return {
      exportedAt: new Date(deps.clock()).toISOString(),
      profile: {
        phone: user.phone,
        firstName: user.first_name,
        termsAcceptedAt: user.terms_accepted_at,
        termsVersion: user.terms_version,
        lastActiveAt: user.last_active_at,
        createdAt: user.created_at,
        card: user.payment_method_last4 ? `${user.payment_method_brand} ending ${user.payment_method_last4}` : null,
        revtag: user.revtag,
        ridesCompleted: user.rides_completed,
      },
      trips: await q(
        `SELECT id, origin_label, origin_lat, origin_lng, dest_label, dest_lat, dest_lng, time_mode, target_time, flex_min, seats, status, created_at
         FROM trips WHERE user_id = $1 ORDER BY created_at`,
      ),
      payments: await q('SELECT id, trip_id, amount, currency, status, created_at FROM payments WHERE user_id = $1 ORDER BY created_at'),
      messagesSent: await q(
        'SELECT m.match_id, m.body, m.created_at FROM messages m JOIN trips t ON t.id = m.trip_id WHERE t.user_id = $1 ORDER BY m.created_at',
      ),
      ratingsGiven: await q('SELECT match_id, stars, created_at FROM ratings WHERE rater_id = $1'),
      reportsFiled: await q('SELECT match_id, reason, details, created_at FROM reports WHERE reporter_id = $1'),
      blocks: await q('SELECT created_at FROM blocks WHERE blocker_id = $1'),
      // Reports other people made about you aren't included, to protect the people who made them (GDPR Art. 15(4)).
      howLongWeKeepThis: RETENTION,
    };
  });

  // ---- payments --------------------------------------------------------------------

  // Starts saving a card. The app shows Stripe's PaymentSheet with these values.
  app.post('/v1/payments/setup', auth, async (req): Promise<PaymentSetupResponse> => {
    const user = await getUser(deps.db, req.userId);
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      // The store review account never touches live payments.
      customerId = await deps.payments.createCustomer(user.id, { test: user.is_reviewer });
      await deps.db.query('UPDATE users SET stripe_customer_id = $2 WHERE id = $1 AND stripe_customer_id IS NULL', [user.id, customerId]);
    }
    const setup = await deps.payments.createSetup(customerId);
    return { mode: deps.payments.modeFor(customerId), customerId, ...setup };
  });

  // Called after PaymentSheet succeeds, so the app doesn't have to wait for the webhook.
  app.post('/v1/payments/method/refresh', auth, async (req): Promise<MeView> => {
    const user = await getUser(deps.db, req.userId);
    if (user.stripe_customer_id) {
      const card = await deps.payments.defaultCard(user.stripe_customer_id);
      if (card) {
        const { rows } = await deps.db.query<UserRow>(
          'UPDATE users SET payment_method_id = $2, payment_method_brand = $3, payment_method_last4 = $4 WHERE id = $1 RETURNING *',
          [user.id, card.id, card.brand, card.last4],
        );
        return meView(rows[0]!, deps.config.TERMS_VERSION);
      }
    }
    return meView(user, deps.config.TERMS_VERSION);
  });

  app.get('/v1/payments', auth, async (req): Promise<PaymentView[]> => listPaymentViews(deps.db, req.userId));

  // ---- places ------------------------------------------------------------------------

  const placesLimit = { preHandler: authenticate(deps), config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };

  app.get('/v1/places/autocomplete', placesLimit, async (req): Promise<PlaceSuggestion[]> => {
    const query = parse(
      z.object({
        q: z.string().trim().max(100).default(''),
        session: z.string().max(64).optional(),
        lat: z.coerce.number().min(-90).max(90).optional(),
        lng: z.coerce.number().min(-180).max(180).optional(),
      }),
      req.query,
    );
    if (deps.places.kind === 'google' && query.q.length < 2) return [];
    const near = query.lat !== undefined && query.lng !== undefined ? { lat: query.lat, lng: query.lng } : undefined;
    return deps.places.autocomplete(query.q, query.session, near);
  });

  app.get('/v1/places/details', placesLimit, async (req): Promise<Place> => {
    const query = parse(z.object({ id: z.string().min(1).max(300), session: z.string().max(64).optional() }), req.query);
    return deps.places.details(query.id, query.session);
  });
}
