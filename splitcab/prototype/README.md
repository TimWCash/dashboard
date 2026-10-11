> **Archived prototype.** This single-page demo started SplitCab. The production app lives in `apps/` and `packages/` (see the [main README](../README.md)); this folder isn't maintained.

# SplitCab (working name)

Two people heading the same way at roughly the same time get matched, take one taxi, and split the fare. SplitCab never drives anyone. It sits outside the taxi apps: one rider books through FREENOW, Uber or Bolt (in Ireland all three dispatch licensed taxis), or takes one from a rank. SplitCab handles the matching and the split.

**No match, no charge.** Posting a trip puts a €1.99 hold on your card. The fee is captured only when you and your match both accept. If nobody matches before your window closes, or you cancel first, the hold is released.

This folder is a working prototype set up for Ireland: Irish locations, euro, and NTA maximum taxi fares. The matching engine, fare model, and the whole trip/payment lifecycle are real and tested. Payments, maps and identity are simulated.

## Try it

Requires Node 18+. There are no dependencies to install.

```bash
cd splitcab
npm run demo     # server + simulated travelers, http://localhost:3000
npm start        # server with real users only
npm test         # fare, matching and lifecycle tests
```

- **Two real people:** run the server and open it on two phones on the same Wi-Fi (`http://<your-computer-ip>:3000`). Post similar trips, for example St Stephen's Green → Dublin Airport and Trinity College → Dublin Airport around the same time.
- **On your own:** in demo mode, post a trip, then tap **Simulate a traveler nearby**. Simulated travelers accept after a few seconds and reply in chat.
- **No server at all:** serve `public/` with any static server (`npx serve public`). The app sees there's no API and runs everything in the browser, saved to localStorage. Use the switcher in the bottom bar to play both travelers.

## How it works

### The trip

A rider gives a pickup, a destination, **leave around** or **arrive around** a time, how flexible they are (±15/30/60 min), and how many people are in their group.

### Matching (`public/core/matching.js`)

For each pair of searching trips, the engine tries the four ways one taxi can serve both trips (who's picked up first, who's dropped off first) and keeps the best plan that passes every check:

| Check | Default | Why |
|---|---|---|
| Seats | ≤ 4 total | One standard taxi |
| Pickup gap | ≤ 5 km | The first rider shouldn't sit through a long detour to the second pickup |
| Detour per rider | ≤ 40% extra distance | Nobody gets dragged across town |
| Savings | ≥ 15% each, and ≥ €1 after the fee | It has to be worth it for both people |
| Timing | Both windows overlap, ≥ 5 min from now | "Leave around" applies at your pickup, "arrive around" at your drop-off |

- Pickups less than about 500 m apart become one meeting point (short walk) instead of an extra stop. Destinations that close (for example, both going to Dublin Airport) become one drop-off.
- The pickup time is set inside both riders' windows, as close as possible to what each of them asked for.
- When several candidates qualify, the engine prefers higher savings, less waiting, and less detour.
- Road distance is straight-line × 1.3. Drive times use city, main-road and motorway speeds. A routing API replaces this in production.

### Fares (`public/core/pricing.js`)

Fares follow the NTA national maximum taxi fare in force from 1 December 2024. All values are in `public/core/config.js`.

| Rate | When (Dublin time) | Initial charge | Tariff A (to ~14.5 km) | Tariff B (after) |
|---|---|---|---|---|
| Standard | Mon–Sat 08:00–20:00 | €4.40 | €1.32/km or €0.47/min | €1.72/km or €0.61/min |
| Premium | Mon–Sat 20:00–08:00, all Sunday | €5.40 | €1.81/km or €0.64/min | €2.20/km or €0.78/min |
| Special | Sat & Sun 00:00–04:00 | €5.40 | €2.20/km or €0.78/min | €2.20/km or €0.78/min |

Extras: €3 booking fee when booked by app or phone, and €1 per additional passenger. The meter charges distance or time, whichever runs faster, so the estimate takes the larger of the two. Public holidays and the Christmas/New Year special rate aren't modelled yet.

Sample daytime estimates: St Stephen's Green → Dublin Airport about €24 alone (€31 at night), Galway → Shannon Airport about €144 alone.

- **Fair split:** each rider pays the shared fare in proportion to what they'd have paid alone, so both save the same percentage. Each rider sees their exact share before accepting. Sharing saves one booking fee and one initial charge, plus most of the distance.
- **After the ride:** the person who booked enters the meter total, and the split is recalculated at the same ratio ("Cian owes you €11.40").

### Lifecycle (`public/core/service.js`)

```
post trip ──► searching ──(compatible trip appears)──► proposed ──(both accept)──► confirmed ──(booker enters fare)──► completed
  hold €1.99      │                                     │  decline / 10-min timeout       fee captured
                  │                                     └──► both back to searching (won't be re-paired)
                  └──(window closes)──► expired, hold released
```

- **Cancel while searching or proposed:** the hold is released.
- **Cancel after confirming:** your fee is kept. Your partner is refunded and goes back to searching.
- **Privacy:** before both riders accept, each sees only an approximate area for the other's stops ("Near Trinity College"). Exact stops and chat unlock after confirmation.
- **Booking:** the rider picked up first books the taxi and is the hirer. The app opens Uber with pickup and destination filled in, gives a Google Maps route with every stop to show the driver, and says which stop to add.

## Layout

```
splitcab/
  server.js              zero-dependency HTTP server + JSON API, saves state to data/state.json
  public/
    index.html, app.js   mobile-first UI (vanilla JS, no build step)
    styles.css           light + dark themes
    api.js               talks to the server, or runs the service in the browser if there's no server
    core/                shared by server and browser
      config.js          every tunable number, including NTA fares
      geo.js, pricing.js distance, time, tariff, fare, split
      matching.js        pair compatibility + route planning
      service.js         trips, matches, holds/charges, chat, settlement, expiry
      places.js          demo Irish locations (Dublin, Cork, Galway, Limerick, airports)
      demo.js            simulated travelers
  test/                  node:test suites
```

## Going from prototype to product

| Area | Prototype | Production |
|---|---|---|
| App | Mobile web | React Native / Expo (push notifications matter: matches are time-sensitive) |
| Places & routes | 34 Irish presets, straight-line math | Places autocomplete + directions API for real distances and ETAs; Eircode lookup |
| Payments | Simulated holds | Card authorization with manual capture (e.g. Stripe `capture_method=manual`). Authorize on post, capture on confirm, cancel otherwise. Card holds expire after about 7 days, so re-authorize for trips booked further ahead |
| Splitting the fare | Riders settle up themselves (Revolut, cash) | Collect the passenger's share in-app and pay out to the booker (e.g. Stripe Connect) |
| Identity & safety | First name only | Phone verification, ratings after each ride, masked calls, share-my-trip, report/block, optional ID check |
| Data | One JSON file | Postgres + PostGIS, with candidate search indexed by location and time; GDPR-compliant retention for location data |
| Auth | Rider id as bearer token | Real accounts and sessions |

### Open questions and risks

- **Liquidity is the whole game.** Matching only works if enough people post similar trips. Start where demand concentrates: Dublin Airport early mornings, events at the 3Arena, Aviva and Croke Park, students heading home from UCD/DCU, and late weekend nights when taxis are scarce. Long regional airport runs (Galway or Limerick → Shannon, Cork city → Cork Airport) have the biggest savings per match.
- **Fee model:** a flat fee is simple. A percentage of savings (for example, 15%, capped) scales with value and never costs more than it saves.
- **Who books, and trust:** the booker pays the meter. Collecting the passenger's share in-app before pickup removes the "will they pay me back?" risk.
- **Regulation, worth confirming with the NTA and a solicitor before launch:**
  - NTA guidance is that others can share a taxi with the principal hirer's consent, and the metered fare is the maximum for the journey. SplitCab keeps it that way: one hirer and one meter, with the passengers splitting it between themselves.
  - "Shared hire" with separate fares per passenger is a distinct regime under the Taxi Regulation Act 2013, tied to designated stands. Avoid anything that looks like the driver charging each rider.
  - Holding riders' money to pay each other out may need a regulated payments partner.
  - Check the terms of service of FREENOW, Uber and Bolt.
