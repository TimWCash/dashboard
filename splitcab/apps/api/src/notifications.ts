import { CONFIG, formatMoney } from '@splitcab/core';
import type { Queryable } from './db';
import { enqueue } from './jobs/queue';

const timeFmt = new Intl.DateTimeFormat(CONFIG.locale, { timeZone: CONFIG.timeZone, hour: 'numeric', minute: '2-digit' });
const at = (ms: number) => timeFmt.format(new Date(ms));
const dayFmt = new Intl.DateTimeFormat(CONFIG.locale, { timeZone: CONFIG.timeZone, weekday: 'short', day: 'numeric', month: 'short' });
const day = (ms: number) => dayFmt.format(new Date(ms));

type Notice =
  | { kind: 'match_found'; partner: string; acceptBy: number; now: number }
  | { kind: 'partner_accepted'; partner: string }
  | { kind: 'match_confirmed'; partner: string; youBook: boolean; pickupAt: number }
  | { kind: 'match_fell_through' }
  | { kind: 'partner_cancelled'; partner: string; refunded: boolean }
  | { kind: 'trip_expired' }
  | { kind: 'payment_failed' }
  | { kind: 'payment_action_required' }
  | { kind: 'new_message'; partner: string; text: string }
  | { kind: 'settled'; partner: string; youOwe: number }
  | { kind: 'paid'; partner: string; amount: number }
  | { kind: 'receipt'; partner: string; owedToYou: number }
  | { kind: 'search_started'; to: string; tripAt: number }
  | { kind: 'answer_reminder'; partner: string; partnerAccepted: boolean; acceptBy: number }
  | { kind: 'fare_reminder'; partner: string }
  | { kind: 'settled_at_estimate'; partner: string; youOwe: number }
  | { kind: 'estimate_used'; partner: string; owedToYou: number };

function render(n: Notice): { title: string; body: string } {
  const fee = formatMoney(CONFIG.matchFee);
  switch (n.kind) {
    case 'match_found': {
      const minutes = Math.round((n.acceptBy - n.now) / 60_000);
      const deadline = minutes <= 60 ? `You have ${minutes} minutes to accept.` : `Accept by ${at(n.acceptBy)}.`;
      return { title: 'We found someone to share with', body: `${n.partner} is heading your way. ${deadline}` };
    }
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
      return {
        title: 'Fare split',
        body: `${n.youOwe > 0 ? `You owe ${n.partner} ${formatMoney(n.youOwe)} for your share.` : `${n.partner} owes you their share.`} Your receipt is in the app.`,
      };
    case 'receipt':
      return {
        title: 'Your receipt',
        body: `Your ride with ${n.partner} is split.${n.owedToYou > 0 ? ` ${n.partner} owes you ${formatMoney(n.owedToYou)}.` : ''} Tap to see your receipt.`,
      };
    case 'paid':
      return { title: 'Paid', body: `${n.partner} says they've paid you ${formatMoney(n.amount)}.` };
    case 'search_started':
      return {
        title: 'Looking for someone to share with',
        body: `We've started looking for someone heading to ${n.to} on ${day(n.tripAt)}. The ${fee} hold is going on your card now.`,
      };
    case 'answer_reminder':
      return {
        title: n.partnerAccepted ? `${n.partner} said yes` : 'Still want to share?',
        body: `Answer by ${at(n.acceptBy)}, or the match with ${n.partner} lapses.`,
      };
    case 'fare_reminder':
      return { title: 'How much was the taxi?', body: `Enter the meter total so ${n.partner} can pay you their share.` };
    case 'settled_at_estimate':
      return {
        title: 'Your share of the taxi',
        body: `${n.partner} didn't enter the meter total, so we've used the estimate: you owe ${n.partner} ${formatMoney(n.youOwe)}.`,
      };
    case 'estimate_used':
      return {
        title: 'We split the fare for you',
        body: `We used the estimate: ${n.partner} owes you ${formatMoney(n.owedToYou)}. If the meter said something different, you can still change it.`,
      };
  }
}

// Queues a push notification. Written in the caller's transaction so it's only sent if the change commits.
export async function notify(q: Queryable, now: number, userId: string, notice: Notice, data: Record<string, string> = {}) {
  const { title, body } = render(notice);
  await enqueue(q, now, 'push', { userId, title, body, data: { kind: notice.kind, ...data } });
}
