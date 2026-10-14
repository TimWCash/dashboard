import { withTx, type Tx } from '../db';
import type { Deps } from '../deps';
import type { GatewayEvent } from '../providers/payments';
import type { RideService } from '../rides/service';
import { getPayment, setPaymentStatus, type PaymentRow } from '../rides/rows';
import { enqueue, type JobHandlers } from './queue';

const REPORT_REASON: Record<string, string> = {
  no_show: "didn't show up",
  unsafe: 'felt unsafe',
  harassment: 'harassment or abusive messages',
  payment: "didn't pay their share",
  other: 'something else',
};

// Moves a payment to a new status if it's still in one of the expected states. Returns whether it moved.
async function transition(deps: Deps, paymentId: string, from: PaymentRow['status'][], to: PaymentRow['status']) {
  return withTx(deps.db, async (tx) => {
    const payment = await getPayment(tx, paymentId, { lock: true });
    if (!payment || !from.includes(payment.status)) return false;
    await setPaymentStatus(tx, paymentId, to, deps.clock());
    return true;
  });
}

// Runs payment work with the payment row locked, across the call to Stripe, so a capture and a release or
// refund of the same payment can never interleave (even with several workers).
async function withPayment(deps: Deps, paymentId: string, fn: (payment: PaymentRow, tx: Tx) => Promise<void>) {
  await withTx(deps.db, async (tx) => {
    const payment = await getPayment(tx, paymentId, { lock: true });
    if (payment) await fn(payment, tx);
  });
}

export function createJobHandlers(deps: Deps, rides: RideService): JobHandlers {
  const { payments } = deps;
  const now = () => deps.clock();

  // Gives the money back whatever state the intent is in: release the hold, or refund if it was captured.
  async function giveBack(payment: PaymentRow, tx: Tx) {
    const result = await payments.cancel(payment.provider_ref!, `cancel:${payment.id}`);
    if (result === 'already_captured') {
      await payments.refund(payment.provider_ref!, `refund:${payment.id}`);
      await setPaymentStatus(tx, payment.id, 'refunded', now());
    } else {
      await setPaymentStatus(tx, payment.id, 'released', now());
    }
  }

  return {
    'payment.authorize': async ({ paymentId }) => {
      await rides.authorizeOffSession(paymentId);
    },

    'payment.capture': async ({ paymentId }) =>
      withPayment(deps, paymentId, async (payment, tx) => {
        if (payment.status !== 'authorized' || !payment.provider_ref) return;
        await payments.capture(payment.provider_ref, `capture:${paymentId}`);
        await setPaymentStatus(tx, paymentId, 'captured', now());
      }),

    'payment.cancel': async ({ paymentId }) =>
      withPayment(deps, paymentId, async (payment, tx) => {
        if (!['pending', 'requires_action', 'authorized'].includes(payment.status)) return;
        if (!payment.provider_ref) {
          // The hold is still being placed. Retry shortly; by then we'll know its id.
          if (payment.status === 'pending' && now() - payment.created_at.getTime() < 60 * 60_000) {
            throw new Error('Authorisation still in progress');
          }
          await setPaymentStatus(tx, paymentId, 'released', now());
          return;
        }
        await giveBack(payment, tx);
      }),

    'payment.refund': async ({ paymentId }) =>
      withPayment(deps, paymentId, async (payment, tx) => {
        if (!payment.provider_ref) return;
        if (payment.status === 'authorized') {
          // Not captured yet, so release the hold instead of refunding.
          await giveBack(payment, tx);
        } else if (payment.status === 'captured') {
          await payments.refund(payment.provider_ref, `refund:${paymentId}`);
          await setPaymentStatus(tx, paymentId, 'refunded', now());
        }
      }),

    'customer.delete': async ({ customerId }) => {
      await payments.deleteCustomer(customerId);
    },

    // No names, numbers or report text leave the database: support looks the report up with `ops reports`.
    'report.alert': async ({ reportId }) => {
      const { rows } = await deps.db.query<{ reason: string; paused: boolean; open: number }>(
        `SELECT r.reason, u.suspended_at IS NOT NULL AS paused,
                (SELECT count(DISTINCT o.reporter_id)::int FROM reports o WHERE o.reported_id = r.reported_id AND o.resolved_at IS NULL) AS open
         FROM reports r JOIN users u ON u.id = r.reported_id WHERE r.id = $1`,
        [reportId],
      );
      const r = rows[0];
      if (!r) return;
      const others = r.open > 1 ? ` ${r.open} people have open reports about this account.` : '';
      const paused = r.paused ? ' The account is paused.' : '';
      await deps.alerts.send(
        `New safety report (${reportId.slice(0, 8)}): ${REPORT_REASON[r.reason] ?? r.reason}.${others}${paused} See it with: npm run ops -w @splitcab/api -- reports`,
      );
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
      if (!(await transition(deps, paymentId, ['authorized'], 'captured'))) {
        // Captured at Stripe although we'd already given the money back: record it and refund.
        if (await transition(deps, paymentId, ['released'], 'captured')) await enqueue(deps.db, deps.clock(), 'payment.refund', { paymentId });
      }
      break;
    case 'payment.released':
      await transition(deps, paymentId, ['pending', 'requires_action', 'authorized'], 'released');
      break;
    case 'payment.refunded':
      await transition(deps, paymentId, ['captured'], 'refunded');
      break;
  }
}
