import { CONFIG, formatMoney } from '@splitcab/core';
import type { Queryable } from './db';
import { enqueue } from './jobs/queue';

const timeFmt = new Intl.DateTimeFormat(CONFIG.locale, { timeZone: CONFIG.timeZone, hour: 'numeric', minute: '2-digit' });
const at = (ms: number) => timeFmt.format(new Date(ms));

type Notice =
  | { kind: 'match_found'; partner: string }
  | { kind: 'partner_accepted'; partner: string }
  | { kind: 'match_confirmed'; partner: string; youBook: boolean; pickupAt: number }
  | { kind: 'match_fell_through' }
  | { kind: 'partner_cancelled'; partner: string; refunded: boolean }
  | { kind: 'trip_expired' }
  | { kind: 'payment_failed' }
  | { kind: 'payment_action_required' }
  | { kind: 'new_message'; partner: string; text: string }
  | { kind: 'settled'; partner: string; youOwe: number };

function render(n: Notice): { title: string; body: string } {
  const fee = formatMoney(CONFIG.matchFee);
  switch (n.kind) {
    case 'match_found':
      return { title: 'We found someone to share with', body: `${n.partner} is heading your way. You have ${CONFIG.acceptWindowMinutes} minutes to accept.` };
    case 'partner_accepted':
      return { title: `${n.partner} accepted`, body: 'Accept now to lock in your shared taxi.' };
    case 'match_confirmed':
      return {
        title: `You're sharing a taxi with ${n.partner}`,
        body: n.youBook ? `You're booking the taxi. Pickup at ${at(n.pickupAt)}.` : `${n.partner} is booking the taxi. Be ready at ${at(n.pickupAt)}.`,
      };
    case 'match_fell_through':
      return { title: 'Your match fell through', body: "We're looking for someone else heading your way." };
    case 'partner_cancelled':
      return {
        title: `${n.partner} cancelled`,
        body: n.refunded ? "Your match fee is being refunded. We're looking for someone else." : "We're looking for someone else.",
      };
    case 'trip_expired':
      return { title: 'No match this time', body: `Your ${fee} hold has been released. You weren't charged.` };
    case 'payment_failed':
      return { title: "We couldn't place the hold", body: 'Your card was declined, so your trip was cancelled. Update your card and try again.' };
    case 'payment_action_required':
      return { title: 'Confirm your card', body: `Your bank needs you to approve the ${fee} hold so we can keep looking for a match.` };
    case 'new_message':
      return { title: n.partner, body: n.text.length > 120 ? `${n.text.slice(0, 117)}...` : n.text };
    case 'settled':
      return { title: 'Fare split', body: n.youOwe > 0 ? `You owe ${n.partner} ${formatMoney(n.youOwe)} for your share.` : `${n.partner} owes you their share.` };
  }
}

// Queues a push notification. Written in the caller's transaction so it's only sent if the change commits.
export async function notify(q: Queryable, now: number, userId: string, notice: Notice, data: Record<string, string> = {}) {
  const { title, body } = render(notice);
  await enqueue(q, now, 'push', { userId, title, body, data: { kind: notice.kind, ...data } });
}
