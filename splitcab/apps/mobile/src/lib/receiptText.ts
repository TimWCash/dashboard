import type { PaymentStatus, ReceiptView } from '@splitcab/core';
import { clock, money } from './format';

const dateFmt = new Intl.DateTimeFormat('en-IE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
export const receiptDate = (iso: string) => dateFmt.format(new Date(iso));

const FEE_STATUS: Partial<Record<PaymentStatus, string>> = {
  captured: 'Charged',
  refunded: 'Refunded',
  released: 'Not charged',
  authorized: 'Being charged',
};
export const feeStatus = (status: PaymentStatus) => FEE_STATUS[status] ?? 'Pending';

// The receipt's lines, shared by the screen and the PDF so they always say the same thing.
export function receiptLines(r: ReceiptView) {
  const partner = r.ride.partner;
  const lines: { label: string; value: string; strong?: boolean }[] = [];
  if (r.fare.meterTotal !== null) lines.push({ label: 'Taxi fare (meter total)', value: money(r.fare.meterTotal) });
  lines.push({ label: 'Your share', value: money(r.fare.yourShare), strong: true });
  lines.push({ label: `${partner}'s share`, value: money(r.fare.partnerShare) });
  if (r.matchFee) lines.push({ label: `SplitCab match fee (${feeStatus(r.matchFee.status).toLowerCase()})`, value: money(r.matchFee.amount) });
  if (r.fare.savings > 0) lines.push({ label: 'You saved, compared with a taxi alone', value: money(r.fare.savings) });
  return lines;
}

export function settleUpLine(r: ReceiptView) {
  const partner = r.ride.partner;
  const on = r.settleUp.paidAt ? ` on ${receiptDate(r.settleUp.paidAt)}` : '';
  if (r.settleUp.youOwe > 0) {
    const amount = money(r.settleUp.youOwe);
    return `${on ? `You paid ${partner} ${amount}${on}` : `You owe ${partner} ${amount}`}. ${partner} paid the taxi.`;
  }
  if (r.settleUp.owedToYou > 0) {
    const amount = money(r.settleUp.owedToYou);
    return `${on ? `${partner} paid you ${amount}${on}` : `${partner} owes you ${amount}`}. You paid the taxi.`;
  }
  return r.ride.youBooked ? 'You paid the taxi.' : `${partner} paid the taxi.`;
}

export const rideLine = (r: ReceiptView) => `${receiptDate(r.ride.pickupAt)}, ${clock(r.ride.pickupAt)} to ${clock(r.ride.dropoffAt)}`;

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// A one-page receipt for saving as a PDF or printing.
export function receiptHtml(r: ReceiptView) {
  const rows = receiptLines(r)
    .map((l) => `<tr${l.strong ? ' class="strong"' : ''}><td>${escape(l.label)}</td><td class="amount">${escape(l.value)}</td></tr>`)
    .join('');
  const estimate = r.fare.meterTotal === null ? `<p class="note">The fare wasn't entered after the ride, so these are the estimates you both accepted.</p>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>SplitCab receipt ${escape(r.number)}</title>
<style>
  body { font-family: -apple-system, system-ui, 'Segoe UI', Roboto, sans-serif; color: #17181C; margin: 40px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .muted { color: #5F6368; font-size: 13px; margin: 2px 0; }
  .ride { margin: 24px 0 16px; font-size: 15px; }
  table { width: 100%; border-collapse: collapse; font-size: 15px; }
  td { padding: 10px 0; border-bottom: 1px solid #E5E3DC; }
  .amount { text-align: right; white-space: nowrap; }
  .strong td { font-weight: 700; }
  .note, .settle { font-size: 14px; margin-top: 16px; }
  footer { margin-top: 32px; font-size: 12px; color: #5F6368; }
</style></head><body>
<h1>${escape(r.merchant.name)} receipt</h1>
<p class="muted">Receipt ${escape(r.number)} · issued ${escape(receiptDate(r.issuedAt))}</p>
<div class="ride"><strong>${escape(r.ride.from)} → ${escape(r.ride.to)}</strong><br>
<span class="muted">${escape(rideLine(r))} · shared with ${escape(r.ride.partner)}</span></div>
<table>${rows}</table>
${estimate}
<p class="settle">${escape(settleUpLine(r))}</p>
<footer>The taxi fare was paid to the driver by whoever booked; ${escape(r.merchant.name)} only charges the match fee.${
    r.merchant.details ? `<br>${escape(r.merchant.details)}` : ''
  }</footer>
</body></html>`;
}
