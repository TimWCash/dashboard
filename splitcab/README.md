# SplitCab

Two people heading the same way at roughly the same time get matched, take one taxi, and split the fare. Built for Ireland: NTA taxi fares, euro, Irish places. Riders book the taxi themselves (Uber, FREENOW or a rank). SplitCab charges a €1.99 match fee, and only when both people accept.

```
apps/mobile     Expo (React Native) app for iOS and Android
apps/api        Fastify + Postgres API: sign-in, matching, payments, chat, safety
apps/site       Static support site: privacy policy, terms, support, account deletion
packages/core   Shared TypeScript: fare model, matching engine, places, API types
prototype       The original single-page web demo (not maintained)
docs            Launch checklist
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

The API tests run against a real Postgres database. They cover sign-in and token rotation, the full ride lifecycle, holds, captures, releases and refunds, 3-D Secure, cancellations, blocking and reporting, chat filtering, privacy of the other rider's details, concurrent matching, account deletion and export, the store review account, and signed Stripe webhooks. CI (`.github/workflows/splitcab.yml`) runs these plus the mobile typecheck, iOS/Android bundles and the API Docker build.

## Deploying

- **API:** `docker build -f apps/api/Dockerfile .` from this folder. Configure with the variables in `apps/api/.env.example`. It runs migrations on start, serves `/health` and `/ready`, and refuses to start in production with development stand-ins.
- **Mobile:** EAS Build and Submit. See [`apps/mobile/store/README.md`](apps/mobile/store/README.md).
- **Before launch:** work through [`docs/launch-checklist.md`](docs/launch-checklist.md): company, legal review, Stripe/Twilio/Google/Expo setup, store accounts, and the operations you'll need on day one.
