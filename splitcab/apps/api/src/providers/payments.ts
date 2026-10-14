import Stripe from 'stripe';
import type { AppConfig } from '../config';

export type AuthorizeStatus = 'authorized' | 'requires_action' | 'failed' | 'captured' | 'released';

export interface AuthorizeResult {
  ref: string;
  status: AuthorizeStatus;
  clientSecret?: string;
  failure?: string;
}

export interface CardSummary {
  id: string;
  brand: string;
  last4: string;
}

// paymentId comes from the intent's metadata, so an authorisation can be matched up even if we crashed
// before recording the intent id.
export type GatewayEvent =
  | { id: string; type: 'payment.authorized'; ref: string; paymentId?: string }
  | { id: string; type: 'payment.failed'; ref: string; paymentId?: string; failure: string }
  | { id: string; type: 'payment.captured'; ref: string; paymentId?: string }
  | { id: string; type: 'payment.released'; ref: string; paymentId?: string }
  | { id: string; type: 'payment.refunded'; ref: string }
  | { id: string; type: 'card.saved'; customerId: string; card: CardSummary }
  | { id: string; type: 'ignored' };

export interface AuthorizeInput {
  amount: number;
  currency: string;
  customerId: string;
  paymentMethodId: string;
  // True when the rider isn't in the app (e.g. re-listing them after a partner cancels).
  offSession: boolean;
  idempotencyKey: string;
  metadata: Record<string, string>;
}

// Card holds with manual capture: authorise when a trip is posted, capture when the match is confirmed,
// cancel the authorisation otherwise.
export interface PaymentGateway {
  readonly mode: 'stripe' | 'test';
  // `test` puts the customer on the test gateway (used for the store review account).
  createCustomer(userId: string, opts?: { test?: boolean }): Promise<string>;
  // Which gateway a saved customer belongs to.
  modeFor(customerId: string): 'stripe' | 'test';
  createSetup(customerId: string): Promise<{ ephemeralKey: string; setupIntentClientSecret: string }>;
  defaultCard(customerId: string): Promise<CardSummary | null>;
  authorize(input: AuthorizeInput): Promise<AuthorizeResult>;
  retrieve(ref: string): Promise<AuthorizeResult>;
  capture(ref: string, idempotencyKey: string): Promise<void>;
  // Releases a hold. Says so if the money had in fact already been captured, so the caller can refund instead.
  cancel(ref: string, idempotencyKey: string): Promise<'released' | 'already_captured'>;
  refund(ref: string, idempotencyKey: string): Promise<void>;
  deleteCustomer(customerId: string): Promise<void>;
  parseWebhook(rawBody: Buffer, signature: string | undefined): GatewayEvent;
}

function fromIntent(pi: Stripe.PaymentIntent): AuthorizeResult {
  const base = { ref: pi.id };
  switch (pi.status) {
    case 'requires_capture':
      return { ...base, status: 'authorized' };
    case 'requires_action':
      return { ...base, status: 'requires_action', clientSecret: pi.client_secret ?? undefined };
    case 'succeeded':
      return { ...base, status: 'captured' };
    case 'canceled':
      return { ...base, status: 'released' };
    case 'processing':
      // Cards don't sit in processing for manual-capture intents; treat it as still awaiting the hold.
      return { ...base, status: 'requires_action', clientSecret: pi.client_secret ?? undefined };
    default:
      return { ...base, status: 'failed', failure: pi.last_payment_error?.message ?? 'Your card was declined.' };
  }
}

export class StripeGateway implements PaymentGateway {
  readonly mode = 'stripe' as const;
  private stripe: Stripe;

  constructor(
    secretKey: string,
    private webhookSecret: string,
  ) {
    this.stripe = new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 15_000 });
  }

  async createCustomer(userId: string) {
    const customer = await this.stripe.customers.create({ metadata: { userId } }, { idempotencyKey: `customer:${userId}` });
    return customer.id;
  }

  modeFor() {
    return 'stripe' as const;
  }

  async createSetup(customerId: string) {
    const ephemeralKey = await this.stripe.ephemeralKeys.create({ customer: customerId }, { apiVersion: Stripe.API_VERSION });
    const setupIntent = await this.stripe.setupIntents.create({
      customer: customerId,
      usage: 'off_session',
      allowed_payment_method_types: ['card'],
    });
    return { ephemeralKey: ephemeralKey.secret!, setupIntentClientSecret: setupIntent.client_secret! };
  }

  async defaultCard(customerId: string) {
    const customer = await this.stripe.customers.retrieve(customerId, { expand: ['invoice_settings.default_payment_method'] });
    if (customer.deleted) return null;
    let pm = customer.invoice_settings?.default_payment_method as Stripe.PaymentMethod | null;
    if (!pm) {
      // A card saved through PaymentSheet isn't automatically the default; use the newest one.
      const list = await this.stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 1 });
      pm = list.data[0] ?? null;
    }
    return pm?.card ? { id: pm.id, brand: pm.card.brand, last4: pm.card.last4 } : null;
  }

  async authorize(input: AuthorizeInput) {
    try {
      const pi = await this.stripe.paymentIntents.create(
        {
          amount: input.amount,
          currency: input.currency.toLowerCase(),
          customer: input.customerId,
          payment_method: input.paymentMethodId,
          capture_method: 'manual',
          confirm: true,
          off_session: input.offSession,
          // When the rider is present, let Stripe ask for 3-D Secure if the issuer wants it.
          ...(input.offSession ? {} : { use_stripe_sdk: true }),
          allowed_payment_method_types: ['card'],
          description: 'SplitCab match fee',
          statement_descriptor_suffix: 'MATCH FEE',
          metadata: input.metadata,
        },
        { idempotencyKey: input.idempotencyKey },
      );
      return fromIntent(pi);
    } catch (err) {
      if (err instanceof Stripe.errors.StripeCardError) {
        const pi = err.payment_intent;
        // Off-session authentication required: the intent exists and the rider can complete it in the app.
        if (pi && pi.status === 'requires_action') return fromIntent(pi);
        return { ref: pi?.id ?? `failed_${input.idempotencyKey}`, status: 'failed' as const, failure: err.message };
      }
      throw err;
    }
  }

  async retrieve(ref: string) {
    return fromIntent(await this.stripe.paymentIntents.retrieve(ref));
  }

  async capture(ref: string, idempotencyKey: string) {
    const pi = await this.stripe.paymentIntents.retrieve(ref);
    if (pi.status === 'succeeded') return;
    await this.stripe.paymentIntents.capture(ref, {}, { idempotencyKey });
  }

  async cancel(ref: string, idempotencyKey: string) {
    const pi = await this.stripe.paymentIntents.retrieve(ref);
    if (pi.status === 'succeeded') return 'already_captured' as const;
    if (pi.status !== 'canceled') await this.stripe.paymentIntents.cancel(ref, { cancellation_reason: 'abandoned' }, { idempotencyKey });
    return 'released' as const;
  }

  async refund(ref: string, idempotencyKey: string) {
    await this.stripe.refunds.create({ payment_intent: ref, reason: 'requested_by_customer' }, { idempotencyKey });
  }

  async deleteCustomer(customerId: string) {
    try {
      await this.stripe.customers.del(customerId);
    } catch (err) {
      if (err instanceof Stripe.errors.StripeInvalidRequestError && err.code === 'resource_missing') return;
      throw err;
    }
  }

  parseWebhook(rawBody: Buffer, signature: string | undefined): GatewayEvent {
    if (!signature) throw new Error('Missing Stripe-Signature header');
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    const pi = event.data.object as Stripe.PaymentIntent;
    const paymentId = typeof pi.metadata?.paymentId === 'string' ? pi.metadata.paymentId : undefined;
    switch (event.type) {
      case 'payment_intent.amount_capturable_updated':
        return { id: event.id, type: 'payment.authorized', ref: pi.id, paymentId };
      case 'payment_intent.payment_failed':
        return { id: event.id, type: 'payment.failed', ref: pi.id, paymentId, failure: pi.last_payment_error?.message ?? 'Your card was declined.' };
      case 'payment_intent.succeeded':
        return { id: event.id, type: 'payment.captured', ref: pi.id, paymentId };
      case 'payment_intent.canceled':
        return { id: event.id, type: 'payment.released', ref: pi.id, paymentId };
      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        const ref = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
        return ref ? { id: event.id, type: 'payment.refunded', ref } : { id: event.id, type: 'ignored' };
      }
      case 'setup_intent.succeeded': {
        const si = event.data.object as Stripe.SetupIntent;
        const customerId = typeof si.customer === 'string' ? si.customer : si.customer?.id;
        const pmId = typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id;
        if (!customerId || !pmId) return { id: event.id, type: 'ignored' };
        // Brand and last4 are fetched by the handler through defaultCard().
        return { id: event.id, type: 'card.saved', customerId, card: { id: pmId, brand: '', last4: '' } };
      }
      default:
        return { id: event.id, type: 'ignored' };
    }
  }
}

// In-memory stand-in for local development and tests. Every card is "Visa 4242".
export class TestGateway implements PaymentGateway {
  readonly mode = 'test' as const;
  intents = new Map<string, { status: AuthorizeStatus; amount: number }>();
  // Tests can make the next authorisation require 3-D Secure or fail.
  nextAuthorize: AuthorizeStatus | null = null;
  calls: { op: string; ref: string }[] = [];
  private seq = 0;

  async createCustomer(userId: string) {
    return `cus_test_${userId.replaceAll('-', '').slice(0, 16)}`;
  }
  modeFor() {
    return 'test' as const;
  }
  async createSetup() {
    return { ephemeralKey: 'ek_test', setupIntentClientSecret: 'seti_test_secret' };
  }
  async defaultCard() {
    return { id: 'pm_test_visa', brand: 'visa', last4: '4242' };
  }
  async authorize(input: AuthorizeInput) {
    const existing = [...this.intents.entries()].find(([ref]) => ref.endsWith(`_${input.idempotencyKey}`));
    if (existing) return { ref: existing[0], status: existing[1].status };
    const ref = `pi_test_${++this.seq}_${input.idempotencyKey}`;
    const status = this.nextAuthorize ?? 'authorized';
    this.nextAuthorize = null;
    this.intents.set(ref, { status, amount: input.amount });
    this.calls.push({ op: 'authorize', ref });
    if (status === 'requires_action') return { ref, status, clientSecret: `${ref}_secret` };
    if (status === 'failed') return { ref, status, failure: 'Your card was declined.' };
    return { ref, status };
  }
  async retrieve(ref: string) {
    // Test intents only live in memory; after a restart treat unknown ones as a placed hold.
    return { ref, status: this.intents.get(ref)?.status ?? ('authorized' as const) };
  }
  // Simulates the rider completing 3-D Secure in the app.
  completeAction(ref: string) {
    const intent = this.intents.get(ref);
    if (intent?.status === 'requires_action') intent.status = 'authorized';
  }
  private set(ref: string, op: string, status: AuthorizeStatus) {
    const intent = this.intents.get(ref) ?? { status, amount: 0 };
    intent.status = status;
    this.intents.set(ref, intent);
    this.calls.push({ op, ref });
  }
  async capture(ref: string) {
    this.set(ref, 'capture', 'captured');
  }
  async cancel(ref: string) {
    if (this.intents.get(ref)?.status === 'captured') return 'already_captured' as const;
    this.set(ref, 'cancel', 'released');
    return 'released' as const;
  }
  async refund(ref: string) {
    this.calls.push({ op: 'refund', ref });
  }
  async deleteCustomer() {}
  parseWebhook(): GatewayEvent {
    throw new Error('Webhooks are not used with the test payment gateway');
  }
}

// Sends the store review account to the test gateway so reviewers never touch live payments.
// Everything else goes to the live gateway. Test ids are recognisable by their prefixes.
export class ReviewAwareGateway implements PaymentGateway {
  readonly mode: 'stripe' | 'test';

  constructor(
    private live: PaymentGateway,
    private test: TestGateway = new TestGateway(),
  ) {
    this.mode = live.mode;
  }

  private by(id: string): PaymentGateway {
    return id.startsWith('cus_test_') || id.startsWith('pi_test_') ? this.test : this.live;
  }

  createCustomer(userId: string, opts?: { test?: boolean }) {
    return (opts?.test ? this.test : this.live).createCustomer(userId);
  }
  modeFor(customerId: string) {
    return this.by(customerId).mode;
  }
  createSetup(customerId: string) {
    return this.by(customerId).createSetup(customerId);
  }
  defaultCard(customerId: string) {
    return this.by(customerId).defaultCard(customerId);
  }
  authorize(input: AuthorizeInput) {
    return this.by(input.customerId).authorize(input);
  }
  retrieve(ref: string) {
    return this.by(ref).retrieve(ref);
  }
  capture(ref: string, key: string) {
    return this.by(ref).capture(ref, key);
  }
  cancel(ref: string, key: string) {
    return this.by(ref).cancel(ref, key);
  }
  refund(ref: string, key: string) {
    return this.by(ref).refund(ref, key);
  }
  deleteCustomer(customerId: string) {
    return this.by(customerId).deleteCustomer(customerId);
  }
  parseWebhook(rawBody: Buffer, signature: string | undefined) {
    return this.live.parseWebhook(rawBody, signature);
  }
}

export function createPaymentGateway(config: AppConfig): PaymentGateway {
  if (config.PAYMENTS_PROVIDER !== 'stripe') return new TestGateway();
  return new ReviewAwareGateway(new StripeGateway(config.STRIPE_SECRET_KEY!, config.STRIPE_WEBHOOK_SECRET!));
}
