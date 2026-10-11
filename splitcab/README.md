# SplitCab

Two people heading the same way at roughly the same time get matched, take one taxi, and split the fare. Built for Ireland: NTA taxi fares, euro, Irish places. Riders book the taxi themselves (Uber, FREENOW or a rank). SplitCab charges a €1.99 match fee, and only when both people accept.

```
apps/mobile     Expo (React Native) app for iOS and Android
apps/api        Fastify + Postgres API: sign-in, matching, payments, chat, safety
apps/site       Static support site: privacy policy, terms, support, account deletion
apps/demo       Browser-only demo: the app's web build with the real API running in the page
packages/core   Shared TypeScript: fare model, matching engine, places, API types
prototype       The original single-page web demo (not maintained)
docs            Launch checklist and GDPR operations
```

## How it works

1. A rider posts a trip: pickup, destination, "leave around" or "arrive by" a time, flexibility and group size. The API places a €1.99 card hold (Stripe, manual capture, 3-D Secure when the bank asks).
2. The matching engine (`packages/core/src/matching.ts`) looks for another searching trip it can serve in one taxi. It tries every pickup and drop-off order and checks seats, detour (≤40%), pickup distance, time windows, and that both riders save at least 15% and come out ahead after the fee. Matching is serialised with a Postgres advisory lock, so a trip can never be offered to two people at once.
3. Both riders see the route, their share, who books, and a 10-minute countdown. When both accept, both holds are captured. Otherwise they're released.
4. Riders chat to meet up; the person picked up first books the taxi. After the ride they enter the meter total, and each share is scaled to it.
5. Background jobs (`jobs` table, retried with backoff) capture, release and refund holds and send push notifications. A sweeper expires stale proposals and trips every 15 seconds.

## Local development

You need Node 22 and Postgres 16.

```bash
npm install
createdb splitcab
cp apps/api/.env.example apps/api/.env      # development stand-ins: no Twilio, Stripe or Google needed
npm run api:migrate
npm run api:dev                              # http://localhost:3000; sign-in codes are returned in the response

cd apps/mobile
cp .env.example .env
npx expo run:ios      # or run:android. Stripe and push need a development build, not Expo Go
npx expo start --web  # quick UI checks in a browser against the test payment mode
```

## Tests

```bash
npm run typecheck
npm test -w @splitcab/core
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/splitcab_test npm test -w @splitcab/api   # wipes that database
```

The API tests run against a real Postgres database. They cover sign-in, wrong-code lockouts and token rotation, the full ride lifecycle, holds, captures, releases and refunds (including captures that race a release), 3-D Secure, cancellations before and after pickup, blocking and reporting, chat and name filtering, privacy of the other rider's stops before both accept, posting limits and pair cooldowns, concurrent matching, account deletion and export, the store review account, production config guards, and signed Stripe webhooks. CI (`.github/workflows/splitcab.yml`) runs these plus the mobile typecheck, iOS/Android bundles and the API Docker build.

## Privacy and GDPR

Retention limits run automatically (`apps/api/src/rides/retention.ts`, periods in `packages/core/src/retention.ts`). People can download, correct and delete their data under Account → Privacy & your data. Support handles requests that arrive by email with `npm run ops -w @splitcab/api -- export|delete <phone>`. See [`docs/gdpr.md`](docs/gdpr.md) for the records of processing, data requests, breaches and the DPIA starter.

## Demo

The app's web build, with sign-in codes shown on screen and simulated cards. Two versions:

- **Shared** (`npm run demo:build:server`): the real API runs as a Vercel Function on a Postgres database, so two people on different phones match each other. If nobody else is looking, a pretend traveller joins after `DEMO_PARTNER_AFTER_S` seconds (45 by default). Either rider can skip to after the ride.
- **One person** (`npm run demo:build`, a static site in `apps/demo/dist`): the API runs in the page on PGlite (Postgres compiled to WebAssembly), saved in the browser. Every trip is matched with the pretend traveller. No server needed.

`vercel.json` deploys to Vercel with the project root set to `splitcab`. It builds the shared version when the project has a `DATABASE_URL`, and the one-person version otherwise. The shared version needs these Vercel environment variables:

| Variable | Value |
|---|---|
| `DATABASE_URL` | A Postgres database used only for the demo. With Supabase, use the transaction pooler (port 6543) and a dedicated role. |
| `DATABASE_TRANSACTION_POOLER` | `true` with a transaction pooler. Then set the timeouts on the role: `ALTER ROLE … SET statement_timeout = '10s'; ALTER ROLE … SET idle_in_transaction_session_timeout = '30s';` |
| `DATABASE_SSL_CA` | The database's CA certificate (PEM), when it isn't publicly signed (Supabase's pooler). |
| `JWT_SECRET` | 32+ random characters. |
| `NODE_ENV`, `DEMO_MODE`, `OTP_PROVIDER` | `production`, `true`, `demo` |
| `PAYMENTS_PROVIDER`, `PUSH_PROVIDER`, `PLACES_PROVIDER` | `test`, `log`, `builtin` |
| `TRUST_PROXY_HOPS`, `DATABASE_POOL_MAX` | `1`, `2` |

`DEMO_MODE` refuses live Stripe keys and Twilio, and its sign-in codes are derived from `JWT_SECRET`, so no SMS is ever sent. Migrations run when the function starts. Retention rules run every 6 hours, as in production, except that demo accounts are deleted after a day without use.

## Deploying

- **API:** `docker build -f apps/api/Dockerfile .` from this folder. Configure with the variables in `apps/api/.env.example`. It runs migrations on start, serves `/health` and `/ready`, and refuses to start in production with development stand-ins.
- **Mobile:** EAS Build and Submit. See [`apps/mobile/store/README.md`](apps/mobile/store/README.md).
- **Before launch:** work through [`docs/launch-checklist.md`](docs/launch-checklist.md): company, legal review, Stripe/Twilio/Google/Expo setup, store accounts, and the operations you'll need on day one.
