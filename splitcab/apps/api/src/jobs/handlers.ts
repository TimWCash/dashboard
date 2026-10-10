import { withTx } from '../db';
import type { Deps } from '../deps';
import type { GatewayEvent } from '../providers/payments';
import type { RideService } from '../rides/service';
import { getPayment, setPaymentStatus, type PaymentRow } from '../rides/rows';
import type { JobHandlers } from './queue';

// Moves a payment to a new status if it's still in one of the expected states. Returns whether it moved.
async function transition(deps: Deps, paymentId: string, from: PaymentRow['status'][], to: PaymentRow['status']) {
  return withTx(deps.db, async (tx) => {
    const payment = await getPayment(tx, paymentId, { lock: true });
    if (!payment || !from.includes(payment.status)) return false;
    await setPaymentStatus(tx, paymentId, to, deps.clock());
    return true;
  });
}

export function createJobHandlers(deps: Deps, rides: RideService): JobHandlers {
  const { payments } = deps;
  return {
    'payment.authorize': async ({ paymentId }) => {
      await rides.authorizeOffSession(paymentId);
    },

    'payment.capture': async ({ paymentId }) => {
      const payment = await getPayment(deps.db, paymentId);
      if (!payment || payment.status !== 'authorized' || !payment.provider_ref) return;
      await payments.capture(payment.provider_ref, `capture:${paymentId}`);
      await transition(deps, paymentId, ['authorized'], 'captured');
    },

    'payment.cancel': async ({ paymentId }) => {
      const payment = await getPayment(deps.db, paymentId);
      if (!payment || !['pending', 'requires_action', 'authorized'].includes(payment.status)) return;
      if (!payment.provider_ref) {
        // The hold is still being placed. Retry shortly; by then we'll know its id.
        if (payment.status === 'pending' && deps.clock() - payment.created_at.getTime() < 60 * 60_000) {
          throw new Error('Authorisation still in progress');
        }
        await transition(deps, paymentId, ['pending', 'requires_action', 'authorized'], 'released');
        return;
      }
      await payments.cancel(payment.provider_ref, `cancel:${paymentId}`);
      await transition(deps, paymentId, ['pending', 'requires_action', 'authorized'], 'released');
    },

    'payment.refund': async ({ paymentId }) => {
      const payment = await getPayment(deps.db, paymentId);
      if (!payment?.provider_ref) return;
      if (payment.status === 'authorized') {
        // Not captured yet, so release the hold instead of refunding.
        await payments.cancel(payment.provider_ref, `cancel:${paymentId}`);
        await transition(deps, paymentId, ['authorized'], 'released');
      } else if (payment.status === 'captured') {
        await payments.refund(payment.provider_ref, `refund:${paymentId}`);
        await transition(deps, paymentId, ['captured'], 'refunded');
      }
    },

    'customer.delete': async ({ customerId }) => {
      await payments.deleteCustomer(customerId);
    },

    push: async ({ userId, title, body, data }) => {
      const { rows } = await deps.db.query<{ push_token: string | null }>('SELECT push_token FROM users WHERE id = $1 AND deleted_at IS NULL', [userId]);
      const to = rows[0]?.push_token;
      if (!to) return;
      const result = await deps.push.send({ to, title, body, data });
      if (result === 'invalid_token') await deps.db.query('UPDATE users SET push_token = NULL WHERE id = $1 AND push_token = $2', [userId, to]);
    },
  };
}

// Applies a verified Stripe webhook. Every branch is safe to run twice.
export async function handleGatewayEvent(deps: Deps, rides: RideService, event: GatewayEvent) {
  if (event.type === 'ignored') return;

  if (event.type === 'card.saved') {
    const card = await deps.payments.defaultCard(event.customerId);
    if (card) {
      await deps.db.query(
        'UPDATE users SET payment_method_id = $2, payment_method_brand = $3, payment_method_last4 = $4 WHERE stripe_customer_id = $1',
        [event.customerId, card.id, card.brand, card.last4],
      );
    }
    return;
  }

  const { rows } = await deps.db.query<{ id: string }>('SELECT id FROM payments WHERE provider_ref = $1 OR id::text = $2 LIMIT 1', [
    event.ref,
    'paymentId' in event && event.paymentId ? event.paymentId : '00000000-0000-0000-0000-000000000000',
  ]);
  const paymentId = rows[0]?.id;
  if (!paymentId) return;

  switch (event.type) {
    case 'payment.authorized':
      await rides.applyAuthorization(paymentId, { ref: event.ref, status: 'authorized' });
      break;
    case 'payment.failed':
      await rides.applyAuthorization(paymentId, { ref: event.ref, status: 'failed', failure: event.failure });
      break;
    case 'payment.captured':
      await transition(deps, paymentId, ['authorized'], 'captured');
      break;
    case 'payment.released':
      await transition(deps, paymentId, ['pending', 'requires_action', 'authorized'], 'released');
      break;
    case 'payment.refunded':
      await transition(deps, paymentId, ['captured'], 'refunded');
      break;
  }
}
