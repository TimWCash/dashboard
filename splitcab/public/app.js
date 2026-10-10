import { connect } from './api.js';
import { PLACES, placeById, REGION } from './core/places.js';
import { soloEstimate } from './core/pricing.js';
import { CONFIG } from './core/config.js';
import { haversineKm } from './core/geo.js';

const MINUTE = 60_000;
const root = document.getElementById('app');

let api;
let view = null;
let lastViewJson = '';
const ui = {
  tab: 'ride',
  formOpen: false,
  busy: false,
  toast: null,
  draft: defaultDraft(),
  chat: {},
  fare: {},
};

// ---- helpers -----------------------------------------------------------------

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const currency = new Intl.NumberFormat(CONFIG.locale, { style: 'currency', currency: CONFIG.currency });
const money = (n) => currency.format(n);
const pct = (n) => `${Math.round(n * 100)}%`;
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const distance = (km) => (km < 1 ? `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m` : `${km.toFixed(1)} km`);
const initial = (name) => esc(String(name).trim().charAt(0).toUpperCase() || '?');

function when(ms) {
  const d = new Date(ms);
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 60 * MINUTE);
  if (d.toDateString() === today.toDateString()) return clock(ms);
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow ${clock(ms)}`;
  return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}, ${clock(ms)}`;
}

function toLocalInput(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultDraft() {
  const quarter = 15 * MINUTE;
  const t = Math.ceil((Date.now() + 60 * MINUTE) / quarter) * quarter;
  return { from: 'stephens-green', to: 'dub', timeMode: 'depart', time: toLocalInput(t), flexMin: 30, seats: 1 };
}

const icon = {
  cab: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 17h14M6 17v2M18 17v2M4 13l2-5a2 2 0 0 1 1.9-1.4h8.2A2 2 0 0 1 18 8l2 5v4H4z"/><path d="M10 6.6V4h4v2.6"/><circle cx="7.5" cy="14" r=".6" fill="currentColor"/><circle cx="16.5" cy="14" r=".6" fill="currentColor"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg>',
  swap: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3"/></svg>',
};

function toast(message, kind = 'info') {
  ui.toast = { message, kind, id: Date.now() };
  render();
  const id = ui.toast.id;
  setTimeout(() => {
    if (ui.toast?.id === id) {
      ui.toast = null;
      render();
    }
  }, 4000);
}

async function act(fn, success) {
  if (ui.busy) return;
  ui.busy = true;
  render();
  try {
    setView(await fn());
    if (success) toast(success);
  } catch (err) {
    if (err.status === 401) {
      api.signOut();
      view = null;
    }
    toast(err.message || 'Something went wrong.', 'error');
  } finally {
    ui.busy = false;
    render();
  }
}

function setView(next) {
  view = next;
  const { now, ...rest } = next ?? {};
  lastViewJson = JSON.stringify(rest);
}

// ---- screens ---------------------------------------------------------------------

function header() {
  return `
    <header class="top">
      <div class="brand"><span class="brand-mark">${icon.cab}</span>SplitCab</div>
      ${view ? `<div class="me"><span>${esc(view.rider.name)}</span><span class="avatar">${initial(view.rider.name)}</span></div>` : ''}
    </header>`;
}

function onboarding() {
  return `
    <section class="hero">
      <h1>Share the cab.<br><mark>Split the fare.</mark></h1>
      <p>Tell us where you're headed and roughly when. We'll find someone going the same way so you can take one taxi and pay less.</p>
    </section>
    <div class="card">
      <ol class="steps">
        <li><div><strong>Post your trip</strong><span>Pickup, destination, and a rough time to leave or arrive.</span></div></li>
        <li><div><strong>Get matched</strong><span>We pair you with a traveler nearby heading your way, and show exactly what you'll each pay.</span></div></li>
        <li><div><strong>Ride together</strong><span>One of you books the taxi in any app or hails one. The fare is split fairly.</span></div></li>
      </ol>
      <hr class="divider">
      <div class="note good">${icon.shield}<div><strong>No match, no charge.</strong> We only charge a ${money(CONFIG.matchFee)} match fee when you and your travel partner both say yes.</div></div>
    </div>
    <form class="card stack" data-form="register">
      <label class="field"><span>Your first name</span>
        <input class="input" name="name" autocomplete="given-name" maxlength="40" required placeholder="e.g. Sam" id="reg-name">
      </label>
      <button class="btn primary block" ${ui.busy ? 'disabled' : ''}>Get started</button>
    </form>`;
}

function placeOptions(selected) {
  const groups = [...new Set(PLACES.map((p) => p.group))];
  return groups
    .map(
      (g) =>
        `<optgroup label="${esc(g)}">${PLACES.filter((p) => p.group === g)
          .map((p) => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${esc(p.label)}</option>`)
          .join('')}</optgroup>`,
    )
    .join('');
}

function tripForm() {
  const d = ui.draft;
  const from = placeById(d.from);
  const to = placeById(d.to);
  const at = new Date(d.time).getTime();
  const est = from && to && from.id !== to.id && Number.isFinite(at) ? soloEstimate(from, to, { at, passengers: Number(d.seats) }) : null;
  const seg = (name, value, label) =>
    `<button type="button" data-set="${name}" data-value="${value}" aria-pressed="${String(d[name]) === String(value)}">${label}</button>`;
  return `
    <form class="card stack" data-form="trip">
      <div>
        <h2>Where are you heading?</h2>
        <p class="sub">${esc(REGION.name)} · demo locations</p>
      </div>
      <div class="route-inputs">
        <label class="field"><span>From</span><select class="input" name="from" id="f-from">${placeOptions(d.from)}</select></label>
        <label class="field"><span>To</span><select class="input" name="to" id="f-to">${placeOptions(d.to)}</select></label>
        <button type="button" class="swap" data-action="swap" aria-label="Swap pickup and destination">${icon.swap}</button>
      </div>
      <div class="seg" role="group" aria-label="Time type">
        ${seg('timeMode', 'depart', 'Leave around')}${seg('timeMode', 'arrive', 'Arrive around')}
      </div>
      <label class="field"><span>${d.timeMode === 'arrive' ? 'Arrival time' : 'Departure time'}</span>
        <input class="input" type="datetime-local" name="time" id="f-time" value="${esc(d.time)}" required>
      </label>
      <div class="field"><span>How flexible are you?</span>
        <div class="seg" role="group" aria-label="Flexibility">${seg('flexMin', 15, '± 15 min')}${seg('flexMin', 30, '± 30 min')}${seg('flexMin', 60, '± 1 hr')}</div>
      </div>
      <div class="field"><span>Travelers in your group</span>
        <div class="seg" role="group" aria-label="Group size">${seg('seats', 1, '1')}${seg('seats', 2, '2')}${seg('seats', 3, '3')}</div>
      </div>
      ${
        est
          ? `<div class="note">${icon.info}<div>A taxi on your own is about <strong>${money(est.fare)}</strong> (~${Math.round(est.minutes)} min, ${esc(est.tariff)}). You'll see your exact share before you agree to anything.</div></div>`
          : `<div class="note warn">${icon.info}<div>Pick a destination different from your pickup.</div></div>`
      }
      <div class="note good">${icon.shield}<div>We place a <strong>${money(view.fee)} hold</strong> on your card. It's only charged if you're matched and both of you accept. Otherwise it's released automatically.</div></div>
      <div class="row between small muted"><span>Pay with</span><span>Visa •••• 4242 <span class="pill">demo card</span></span></div>
      <button class="btn primary block" ${ui.busy || !est ? 'disabled' : ''}>Find someone to share with</button>
      ${activeTrips().length ? '<button type="button" class="btn link block" data-action="close-form">Not now</button>' : ''}
    </form>`;
}

const activeTrips = () => (view?.trips ?? []).filter((t) => ['searching', 'proposed', 'confirmed'].includes(t.status));

function timeLine(t) {
  const verb = t.timeMode === 'arrive' ? 'Arrive' : 'Leave';
  const people = t.seats === 1 ? '1 traveler' : `${t.seats} travelers`;
  return `${verb} ~${when(t.time)} ± ${t.flexMin} min · ${people}`;
}

const STATUS_PILL = {
  searching: '<span class="pill warn">Searching</span>',
  proposed: '<span class="pill accent">Match found</span>',
  confirmed: '<span class="pill ink">Confirmed</span>',
  completed: '<span class="pill good">Done</span>',
  expired: '<span class="pill">No match</span>',
  cancelled: '<span class="pill">Cancelled</span>',
};

function tripCard(t) {
  let body = '';
  if (t.status === 'searching') body = searchingBody(t);
  else if (t.status === 'proposed') body = proposedBody(t);
  else if (t.status === 'confirmed') body = confirmedBody(t);
  else if (t.status === 'completed') body = completedBody(t);
  else if (t.status === 'expired') {
    body = `<div class="note good">${icon.shield}<div>We couldn't find anyone in time. Your ${money(t.payment.amount)} hold was released — you weren't charged.</div></div>`;
  } else if (t.status === 'cancelled') {
    body =
      t.payment.status === 'captured'
        ? `<div class="note">${icon.info}<div>You cancelled after confirming, so the ${money(t.payment.amount)} match fee wasn't refunded.</div></div>`
        : `<div class="note good">${icon.shield}<div>Cancelled. Your hold was released — you weren't charged.</div></div>`;
  }
  return `
    <article class="card" id="trip-${t.id}">
      <div class="trip-head">
        <div>
          <div class="trip-route">${esc(t.origin.label)}<span class="arrow">→</span>${esc(t.destination.label)}</div>
          <p class="sub">${esc(timeLine(t))}</p>
        </div>
        ${STATUS_PILL[t.status] ?? ''}
      </div>
      ${body}
    </article>`;
}

function fellThrough(t) {
  const m = t.match;
  if (!m || !['declined', 'expired', 'cancelled'].includes(m.status)) return '';
  const name = esc(m.partner.name);
  const why = {
    declined: `${name} and you didn't both accept`,
    expired: `The match with ${name} timed out`,
    cancelled: m.cancelledByPartner ? `${name} cancelled` : 'Your last match was cancelled',
  }[m.status];
  const refund = m.status === 'cancelled' && m.cancelledByPartner && m.confirmedAt ? ' Your match fee was refunded.' : '';
  return `<div class="note warn">${icon.info}<div>${why}, so we're looking again.${refund}</div></div>`;
}

function searchingBody(t) {
  return `
    <div class="stack">
      ${fellThrough(t)}
      <div class="searching">
        <div class="radar"><span></span></div>
        <div>
          <strong>Looking for someone heading your way</strong>
          <p class="sub">We'll keep looking until ${esc(when(t.searchUntil))} and notify you when there's a match.</p>
        </div>
      </div>
      <div class="note good">${icon.shield}<div>${money(t.payment.amount)} on hold — not charged unless you're matched.</div></div>
      <div class="btn-row">
        <button class="btn ghost" data-action="cancel" data-trip="${t.id}" ${ui.busy ? 'disabled' : ''}>Cancel trip</button>
        ${api.demo ? `<button class="btn dark" data-action="demo-traveler" data-trip="${t.id}" ${ui.busy ? 'disabled' : ''}>Simulate a traveler nearby</button>` : ''}
      </div>
    </div>`;
}

function partnerRow(m) {
  const p = m.partner;
  const meta = p.rating ? `★ ${p.rating.toFixed(1)} · ${p.tripsTaken} shared rides` : 'New to SplitCab';
  const group = p.seats > 1 ? ` · group of ${p.seats}` : '';
  return `
    <div class="partner">
      <span class="avatar lg accent">${initial(p.name)}</span>
      <div><div class="name">${esc(p.name)}</div><div class="meta">${esc(meta + group)}</div></div>
    </div>`;
}

function routeTimeline(m) {
  const name = esc(m.partner.name);
  const action = (s) => {
    const out = s.kind === 'dropoff';
    if (s.you && s.partner) return out ? 'You both get out' : `You and ${name} get in`;
    if (s.you) return out ? 'You get out' : 'You get in';
    return out ? `${name} gets out` : `${name} gets in`;
  };
  return `
    <ol class="timeline">
      ${m.plan.route
        .map(
          (s) => `
        <li class="${s.kind === 'dropoff' ? 'drop' : ''}">
          <span class="t">${clock(s.at)}</span><span class="dot"></span>
          <span class="what"><strong>${action(s)}</strong><span>${esc(s.label)}</span></span>
        </li>`,
        )
        .join('')}
    </ol>`;
}

function priceBox(m) {
  const y = m.plan.you;
  return `
    <div class="prices">
      <div class="line strike"><span>Taxi on your own</span><span>${money(y.soloFare)}</span></div>
      <div class="line"><span>Your share of the fare</span><span>${money(y.share)}</span></div>
      <div class="line"><span>Match fee</span><span>${money(y.fee)}</span></div>
      <div class="line save"><span>You save</span><span>${money(y.savings)} (${pct(y.savings / y.soloFare)})</span></div>
    </div>`;
}

function facts(m) {
  const y = m.plan.you;
  const items = [];
  if (y.walkToPickupMin > 0) items.push(`${y.walkToPickupMin} min walk to the pickup`);
  if (y.walkFromDropMin > 0) items.push(`${y.walkFromDropMin} min walk after drop-off`);
  items.push(y.detourPct > 0.02 ? `Ride is ${pct(y.detourPct)} longer than going alone` : 'No detour for you');
  items.push(`Est. total fare ${money(m.plan.fare)}`);
  return `<div class="facts">${items.map((i) => `<span class="pill">${esc(i)}</span>`).join('')}</div>`;
}

function countdown(ms) {
  return `<span class="countdown" data-countdown="${ms}">${fmtCountdown(ms)}</span>`;
}
function fmtCountdown(ms) {
  const s = Math.max(0, Math.round((ms - Date.now()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function proposedBody(t) {
  const m = t.match;
  const name = esc(m.partner.name);
  const actions = m.youAccepted
    ? `<div class="note warn">${icon.info}<div>You're in. Waiting for ${name} to accept · ${countdown(m.expiresAt)}</div></div>
       <button class="btn link block" data-action="cancel" data-trip="${t.id}">Cancel trip</button>`
    : `<div class="btn-row">
         <button class="btn ghost" data-action="decline" data-match="${m.id}" ${ui.busy ? 'disabled' : ''}>Decline</button>
         <button class="btn primary" data-action="accept" data-match="${m.id}" ${ui.busy ? 'disabled' : ''}>Accept · ${money(m.plan.you.fee)}</button>
       </div>
       <p class="sub center">Respond within ${countdown(m.expiresAt)}. ${m.partnerAccepted ? `${name} has already accepted.` : ''}</p>`;
  return `
    ${partnerRow(m)}
    ${routeTimeline(m)}
    ${priceBox(m)}
    ${facts(m)}
    ${actions}`;
}

function bookingLinks(m) {
  const pickup = m.plan.route[0];
  const drop = m.plan.route[m.plan.route.length - 1];
  const enc = encodeURIComponent;
  const uber =
    `https://m.uber.com/ul/?action=setPickup&pickup[latitude]=${pickup.lat}&pickup[longitude]=${pickup.lng}&pickup[nickname]=${enc(pickup.label)}` +
    `&dropoff[latitude]=${drop.lat}&dropoff[longitude]=${drop.lng}&dropoff[nickname]=${enc(drop.label)}`;
  // Directions with every stop, handy to show the driver.
  const stops = m.plan.route.slice(1, -1).map((s) => `${s.lat},${s.lng}`).join('|');
  const maps =
    `https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${pickup.lat},${pickup.lng}` +
    `&destination=${drop.lat},${drop.lng}${stops ? `&waypoints=${enc(stops)}` : ''}`;
  return `
    <div class="book-links">
      <a class="btn dark" href="${esc(uber)}" target="_blank" rel="noopener">Open Uber</a>
      <a class="btn ghost" href="${esc(maps)}" target="_blank" rel="noopener">Route for driver</a>
    </div>`;
}

function chat(m) {
  const msgs = m.messages.length
    ? m.messages.map((x) => `<div class="bubble ${x.mine ? 'mine' : ''}">${esc(x.text)}</div>`).join('')
    : `<div class="empty">Say hi and agree where to meet.</div>`;
  return `
    <div class="chat">
      <div class="chat-log" id="chat-${m.id}">${msgs}</div>
      <form data-form="chat" data-match="${m.id}">
        <input name="text" id="chat-input-${m.id}" placeholder="Message ${esc(m.partner.name)}…" maxlength="500" autocomplete="off" value="${esc(ui.chat[m.id] ?? '')}">
        <button aria-label="Send">Send</button>
      </form>
    </div>`;
}

function confirmedBody(t) {
  const m = t.match;
  const name = esc(m.partner.name);
  const myPickup = m.plan.route.find((s) => s.you && s.kind === 'pickup');
  const start = m.plan.route[0];
  const middle = m.plan.route.slice(1, -1).map((s) => {
    const whose = s.you ? 'your' : `${name}'s`;
    const what = s.kind === 'pickup' ? `${whose} pickup` : `${whose} drop-off`;
    const away = s.kind === 'pickup' ? ` (${distance(haversineKm(start, s))} from you)` : '';
    return `${what} at <strong>${esc(s.label)}</strong>${away}`;
  });
  const stopHint = middle.length
    ? `In the app, add ${middle.join(' and ')} as ${middle.length > 1 ? 'stops' : 'a stop'}.`
    : `${name} will meet you at the pickup.`;
  const booking = m.youBook
    ? `<div class="stack">
         <div><h3>You book the taxi</h3>
         <p class="sub">Book a taxi from <strong>${esc(m.plan.route[0].label)}</strong> for ${clock(m.plan.startAt)} in FREENOW, Uber or Bolt, or take one from a rank. ${stopHint}</p></div>
         ${bookingLinks(m)}
       </div>`
    : `<div><h3>${name} books the taxi</h3>
       <p class="sub">Be at <strong>${esc(myPickup.label)}</strong> by ${clock(m.plan.you.pickupAt)}${
         m.plan.you.walkToPickupMin ? ` (about a ${m.plan.you.walkToPickupMin} min walk)` : ''
       }. You'll pay ${name} your share after the ride.</p></div>`;
  const settle = m.youBook
    ? `<form class="stack" data-form="settle" data-match="${m.id}">
         <label class="field"><span>After the ride: total on your receipt</span>
           <input class="input" name="fare" id="fare-${m.id}" inputmode="decimal" placeholder="${m.plan.fare.toFixed(2)}" value="${esc(ui.fare[m.id] ?? '')}" required>
         </label>
         <button class="btn primary block" ${ui.busy ? 'disabled' : ''}>Split the fare</button>
       </form>`
    : `<p class="sub">${name} will enter the final fare after the ride and we'll show what you owe.</p>`;
  return `
    <div class="stack">
      <div class="note good">${icon.shield}<div>You're riding with ${name}. Your ${money(t.payment.amount)} match fee has been charged.</div></div>
      ${partnerRow(m)}
      ${routeTimeline(m)}
      ${booking}
      <div class="prices">
        <div class="line"><span>Estimated fare</span><span>${money(m.plan.fare)}</span></div>
        <div class="line"><span>Your share</span><span>${money(m.plan.you.share)}</span></div>
        <div class="line"><span>${name}'s share</span><span>${money(m.plan.partner.share)}</span></div>
        <div class="line small muted"><span>Final split follows the real receipt, same ratio.</span><span></span></div>
      </div>
      ${chat(m)}
      ${settle}
      <button class="btn link block" data-action="cancel" data-trip="${t.id}">Cancel ride (fee not refunded)</button>
    </div>`;
}

function completedBody(t) {
  const m = t.match;
  const s = m.settlement;
  const name = esc(m.partner.name);
  const myShare = m.youBook ? s.bookerShare : s.amount;
  const saved = m.plan.you.soloFare - myShare - m.plan.you.fee;
  const owe = m.youBook
    ? `${name} owes you <strong>${money(s.amount)}</strong> for their share of the ${money(s.actualFare)} fare.`
    : `You owe ${name} <strong>${money(s.amount)}</strong> for your share of the ${money(s.actualFare)} fare.`;
  return `
    <div class="stack">
      <div class="note">${icon.info}<div>${owe} Settle up with cash or any payment app.</div></div>
      ${saved > 0 ? `<div class="note good">${icon.shield}<div>You saved about <strong>${money(saved)}</strong> compared with riding alone.</div></div>` : ''}
    </div>`;
}

function rideTab() {
  const trips = view.trips;
  const active = activeTrips();
  const past = trips.filter((t) => !active.includes(t));
  const showForm = ui.formOpen || active.length === 0;
  return `
    ${active.map(tripCard).join('')}
    ${showForm ? tripForm() : `<button class="btn ghost block" data-action="open-form" style="margin-bottom:14px">+ Plan another trip</button>`}
    ${past.length ? `<h3 class="muted small" style="margin:20px 4px 8px">Past trips</h3>${past.map(tripCard).join('')}` : ''}`;
}

const PAY_STATUS = {
  authorized: '<span class="pill warn">On hold</span>',
  captured: '<span class="pill ink">Charged</span>',
  released: '<span class="pill good">Not charged</span>',
  refunded: '<span class="pill good">Refunded</span>',
};
const PAY_WORD = { authorized: 'Hold placed', captured: 'Charged', released: 'Hold released', refunded: 'Refunded' };

function walletTab() {
  const pays = view.payments;
  const sum = (status) => pays.filter((p) => p.status === status).reduce((a, p) => a + p.amount, 0);
  return `
    <div class="totals">
      <div class="total"><div class="k">Charged</div><div class="v">${money(sum('captured'))}</div></div>
      <div class="total"><div class="k">On hold</div><div class="v">${money(sum('authorized'))}</div></div>
    </div>
    <div class="card">
      <div class="note good" style="margin-bottom:8px">${icon.shield}<div>You're only charged the ${money(view.fee)} match fee when you and your travel partner both accept. Holds on trips without a match drop off automatically.</div></div>
      ${
        pays.length
          ? `<ul class="ledger">${pays
              .map(
                (p) => `
            <li>
              <div class="row between">
                <div><strong>${esc(p.trip.from)} → ${esc(p.trip.to)}</strong><div class="sub">${esc(when(p.trip.time))}</div></div>
                <div class="center"><div class="amt ${p.status === 'released' || p.status === 'refunded' ? 'void' : ''}">${money(p.amount)}</div>${PAY_STATUS[p.status]}</div>
              </div>
              <div class="hist">${p.history.map((h) => `${PAY_WORD[h.status]} ${esc(clock(h.at))}`).join(' · ')}</div>
            </li>`,
              )
              .join('')}</ul>`
          : '<p class="sub center" style="padding:12px 0">No payments yet.</p>'
      }
    </div>`;
}

function demoBar() {
  if (!api?.demo) return '';
  if (api.mode === 'server') {
    return `<div class="demo-bar"><div class="inner"><span>Demo mode: simulated travelers are on.</span></div></div>`;
  }
  const travelers = api.travelers();
  const options = travelers
    .map((r) => `<option value="${r.id}" ${r.id === api.riderId ? 'selected' : ''}>${esc(r.name)}</option>`)
    .join('');
  return `
    <div class="demo-bar"><div class="inner">
      <span>Demo · simulated travelers, saved in this browser</span>
      ${
        travelers.length
          ? `<label class="sr-only" for="switch">Switch traveler</label>
             <select id="switch" data-action="switch">${api.riderId ? '' : '<option selected disabled>Pick…</option>'}${options}<option value="__new">+ New traveler</option></select>`
          : ''
      }
      <button data-action="reset">Reset</button>
    </div></div>`;
}

// ---- render ----------------------------------------------------------------------

function render() {
  // Keep focus and caret across re-renders so polling never interrupts typing.
  const active = document.activeElement;
  const focusId = active && root.contains(active) ? active.id : null;
  const caret = focusId && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
  const scrolls = [...root.querySelectorAll('.chat-log')].map((el) => [el.id, el.scrollTop, el.scrollHeight - el.scrollTop - el.clientHeight < 8]);

  let main;
  if (!view) main = onboarding();
  else {
    main = `
      <nav class="tabs" role="tablist">
        <button role="tab" data-tab="ride" aria-selected="${ui.tab === 'ride'}">Rides</button>
        <button role="tab" data-tab="wallet" aria-selected="${ui.tab === 'wallet'}">Wallet</button>
      </nav>
      ${ui.tab === 'ride' ? rideTab() : walletTab()}`;
  }
  root.innerHTML = `
    ${header()}
    ${main}
    ${demoBar()}
    <div role="status" aria-live="polite">${ui.toast ? `<div class="toast ${ui.toast.kind === 'error' ? 'error' : ''}">${esc(ui.toast.message)}</div>` : ''}</div>`;

  for (const [id, top, atBottom] of scrolls) {
    const el = document.getElementById(id);
    if (el) el.scrollTop = atBottom ? el.scrollHeight : top;
  }
  root.querySelectorAll('.chat-log').forEach((el) => {
    if (!scrolls.some(([id]) => id === el.id)) el.scrollTop = el.scrollHeight;
  });
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) {
      el.focus();
      if (caret && 'setSelectionRange' in el) {
        try {
          el.setSelectionRange(...caret);
        } catch {
          // Not every input type supports a caret.
        }
      }
    }
  }
}

// ---- events ----------------------------------------------------------------------

root.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    ui.tab = tab.dataset.tab;
    return render();
  }
  const set = e.target.closest('[data-set]');
  if (set) {
    const { set: key, value } = set.dataset;
    ui.draft[key] = key === 'timeMode' ? value : Number(value);
    return render();
  }
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'SELECT') return;
  const { action, trip, match } = el.dataset;
  if (action === 'swap') {
    [ui.draft.from, ui.draft.to] = [ui.draft.to, ui.draft.from];
    render();
  } else if (action === 'open-form') {
    ui.formOpen = true;
    render();
  } else if (action === 'close-form') {
    ui.formOpen = false;
    render();
  } else if (action === 'cancel') {
    if (confirm('Cancel this trip?')) act(() => api.cancelTrip(trip), 'Trip cancelled.');
  } else if (action === 'demo-traveler') {
    act(() => api.addNearbyTraveler(trip));
  } else if (action === 'accept') {
    act(() => api.respond(match, true));
  } else if (action === 'decline') {
    act(() => api.respond(match, false), "Declined. We'll keep looking.");
  } else if (action === 'reset') {
    if (confirm('Reset the demo? This clears all travelers and trips in this browser.')) api.reset();
  }
});

root.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.action === 'switch') {
    if (t.value === '__new') {
      api.signOut();
      view = null;
      ui.draft = defaultDraft();
      render();
    } else {
      api.switchTo(t.value);
      ui.formOpen = false;
      act(() => api.me());
    }
    return;
  }
  if (t.form?.dataset.form === 'trip' && t.name in ui.draft) {
    ui.draft[t.name] = t.value;
    render();
  }
});

root.addEventListener('input', (e) => {
  const t = e.target;
  const form = t.form?.dataset.form;
  if (form === 'chat') ui.chat[t.form.dataset.match] = t.value;
  if (form === 'settle') ui.fare[t.form.dataset.match] = t.value;
  if (form === 'trip' && t.name === 'time') ui.draft.time = t.value;
});

root.addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  const kind = form.dataset.form;
  if (kind === 'register') {
    const name = new FormData(form).get('name');
    act(() => api.register(name));
  } else if (kind === 'trip') {
    const d = ui.draft;
    const origin = placeById(d.from);
    const destination = placeById(d.to);
    const time = new Date(d.time).getTime();
    act(async () => {
      const next = await api.postTrip({
        origin: { label: origin.label, lat: origin.lat, lng: origin.lng },
        destination: { label: destination.label, lat: destination.lat, lng: destination.lng },
        timeMode: d.timeMode,
        time,
        flexMin: Number(d.flexMin),
        seats: Number(d.seats),
      });
      ui.formOpen = false;
      return next;
    });
  } else if (kind === 'chat') {
    const id = form.dataset.match;
    const text = (ui.chat[id] ?? '').trim();
    if (!text) return;
    act(async () => {
      const next = await api.sendMessage(id, text);
      ui.chat[id] = '';
      return next;
    });
  } else if (kind === 'settle') {
    const id = form.dataset.match;
    const fare = Number(String(ui.fare[id] ?? '').replace(/[^0-9.]/g, ''));
    act(() => api.complete(id, fare), 'Fare split. Thanks for sharing!');
  }
});

// ---- boot ------------------------------------------------------------------------

async function refresh() {
  if (!api?.riderId || ui.busy) return;
  try {
    const next = await api.me();
    const { now, ...rest } = next;
    if (JSON.stringify(rest) !== lastViewJson) {
      setView(next);
      render();
    }
  } catch (err) {
    if (err.status === 401) {
      api.signOut();
      view = null;
      render();
    }
  }
}

setInterval(() => {
  for (const el of root.querySelectorAll('[data-countdown]')) el.textContent = fmtCountdown(Number(el.dataset.countdown));
}, 1000);

(async () => {
  root.innerHTML = header();
  api = await connect();
  if (api.riderId) {
    try {
      setView(await api.me());
    } catch {
      api.signOut();
    }
  }
  render();
  setInterval(refresh, 2000);
})();
