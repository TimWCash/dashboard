# Launch checklist

Everything the code can't do for you, in roughly the order to do it. Items marked **decision** need your call; the rest are setup steps.

## 1. Company and legal

- [ ] Register the company (CRO) and open a business bank account. App Store and Play organisation accounts need a legal entity and a D-U-N-S number (free, takes up to two weeks).
- [ ] **Decision:** final product name. Search the EUIPO and Irish trademark registers and both app stores for "SplitCab" before spending on branding.
- [ ] Solicitor review of `apps/site/public/privacy.html` and `apps/site/public/terms.html`. They're live and name Tim Cashman as running SplitCab; switch them to the company's legal name, registered address and CRO number once it exists.
- [ ] Ask the NTA (or a solicitor) to confirm the model: one hirer, one meter, passengers sharing with the hirer's consent and settling between themselves. Avoid anything resembling separate fares per passenger, which is a regulated "shared hire".
- [ ] **Decision:** VAT. The €1.99 match fee is a service sold in Ireland; ask your accountant whether it includes VAT and register when required. Put the company's legal name, address and VAT number in `RECEIPT_COMPANY_DETAILS` so they're printed on riders' receipts.
- [ ] Public liability insurance for a platform introducing strangers.
- [ ] GDPR: work through [`gdpr.md`](gdpr.md). It has the records of processing, retention schedule, processor list, how to handle data requests and breaches, and a DPIA starter. Sign data processing agreements with Stripe, Twilio, Expo, Google and your host.
- [ ] Register the company's beneficial owners (RBO) within 5 months of incorporation.
- [ ] Consumer law (Consumer Rights Act 2022): prices include VAT, and the company's legal name, registered address, CRO number, email and VAT number appear on the website and in the app (also an E-Commerce Regulations requirement). The app already asks riders to confirm they want matching to start straight away each time they post, and records when, so the 14-day right to cancel ends once both accept; have the solicitor check that wording.
- [ ] Digital Services Act: the app hosts chat between users. Publish a single point of contact for users and authorities, explain in the Terms how reports are handled, and give a reason whenever you act on a report. Small and micro companies are exempt from most of the extra online-platform duties. The Irish regulator is Coimisiún na Meán.
- [ ] Insurance: public and product liability, cyber, and professional indemnity.
- [ ] Accessibility: the European Accessibility Act covers consumer e-commerce services from June 2025, with an exemption for microenterprises. Keep the app and site accessible anyway; the review fixes are already in.
- [ ] The public demo collects real names and numbers, so it needs a named controller: set `DEMO_OPERATOR` (your name or the company's) and a `SUPPORT_EMAIL` that reaches you on the demo's Vercel project. The app shows them in "How this demo uses your data".

## 2. Website and email

- [ ] Register the domain and set up the support mailbox.
- [ ] Add a postal address where you can be reached to the website's Support and Privacy pages: the E-Commerce Regulations require a geographic address, and the pages give only a name and email for now.
- [ ] Put the website on the real domain. It's live at https://splitcab-ie.vercel.app for now, served by the demo's Vercel project (`SITE_HOSTS`): add the domain to that project and to `SITE_HOSTS`, or give the site a project of its own (root directory `splitcab/apps/site`; `apps/site/vercel.json` does the rest). Check `/`, `/privacy`, `/terms`, `/support` and `/delete-account` load: both stores link to them. Replace "Coming to the App Store and Google Play" on the landing page with the store badges once the apps are live.
- [ ] Set `TERMS_URL`, `PRIVACY_URL`, `SUPPORT_EMAIL` on the API and `SITE_URL` for `store.config.js`.

## 3. Backend

- [ ] Postgres 16 in the EU, ideally Dublin (AWS eu-west-1): Neon, Supabase or RDS. Turn on automated backups and point-in-time recovery.
- [ ] Host the API in the same region (Fly.io, Render, Railway, AWS ECS…) using `apps/api/Dockerfile`. Health check `/ready`. Two small instances are plenty to start.
- [ ] Set every variable in `apps/api/.env.example` as a secret. `NODE_ENV=production` refuses to start with development stand-ins or Stripe test keys.
- [ ] Set `TRUST_PROXY_HOPS` to the number of proxies in front of the API (usually 1 behind a PaaS load balancer). Production won't start without it. Check that `req.ip` in the logs shows real client addresses, not the load balancer's.
- [ ] Per-IP rate limits are kept in memory on each instance, so with N instances a client gets N times the limit. That's fine for two instances. Beyond that, move `@fastify/rate-limit` to a shared Redis store. Sign-in limits per phone number are already shared, because they live in Postgres.
- [ ] Uptime monitoring on `/ready`, log retention, and an alert on failed background jobs (`SELECT count(*) FROM jobs WHERE failed_at IS NOT NULL`).
- [ ] **Recommended:** add error tracking (for example Sentry) to the API and app before launch, and update `store/privacy-answers.md` if you do.

## 4. Third-party services

- [ ] **Twilio Verify:** create a Verify service, enable Fraud Guard (SMS pumping protection), and set an alphanumeric sender ID for Ireland. Register that sender ID with ComReg's SMS Sender ID Registry, or Irish networks may label the codes as likely scams. Under Geo permissions allow SMS only to the countries in `ALLOWED_PHONE_COUNTRIES` (Ireland and the UK by default), so a bug can't run up SMS charges elsewhere.
- [ ] **Stripe:** activate an Irish account and switch to live keys. Add a webhook endpoint `https://<api>/v1/webhooks/stripe` for `payment_intent.amount_capturable_updated`, `payment_intent.payment_failed`, `payment_intent.succeeded`, `payment_intent.canceled`, `charge.refunded` and `setup_intent.succeeded`. Set the statement descriptor. Test 3-D Secure with Stripe's test cards before going live.
- [ ] **Google Maps Platform (optional but recommended):** enable Places API (New), create a key restricted to your API servers, set `PLACES_PROVIDER=google`, and add a billing alert.
- [ ] **Trip map on Android (required):** enable the Maps SDK for Android, create a key restricted to the package `ie.splitcab.app` and your signing certificates' SHA-1 (Play App Signing and upload key), and set it as the EAS secret `GOOGLE_MAPS_ANDROID_API_KEY`. Without it the Android map is blank. iPhone uses Apple Maps and needs nothing.
- [ ] **Trip map on the web (only if you ship a web version):** OpenStreetMap's own tiles are for light use. Use a tile provider (MapTiler, Stadia Maps, Thunderforest) and set `EXPO_PUBLIC_MAP_TILES_URL`.
- [ ] **Expo / EAS:** `npx eas-cli@latest init` to create the project; set `EAS_PROJECT_ID`. Upload an APNs key (iOS push) and an FCM V1 service account (Android push) with `eas credentials`.
- [ ] **Uber (optional):** register an app at developer.uber.com and set `EXPO_PUBLIC_UBER_CLIENT_ID` so deep links are attributed to you.

## 5. Apple App Store

- [ ] Apple Developer Program (organisation), €99/year.
- [ ] Create the app in App Store Connect with bundle ID `ie.splitcab.app`.
- [ ] Set `REVIEW_PHONE` (a number no real person uses) and `REVIEW_CODE` on the production API, then fill the same values into `store.config.js` via environment variables.
- [ ] Answer App Privacy from `store/privacy-answers.md`.
- [ ] `eas build`, `eas submit`, then TestFlight on real iPhones: sign-in, card + 3-D Secure, push, location, Uber/FREENOW links, VoiceOver.
- [ ] `eas metadata:push`, then submit for review. Expect questions about guideline 3.1.3(e) (card payments for a real-world service) and 1.2 (chat safety); the review notes already answer both.

## 6. Google Play

- [ ] Play Console developer account (organisation accounts skip the 12-tester closed-test rule).
- [ ] Create the app, fill **App content** from `store/google-play/listing.md`, Data safety from `store/privacy-answers.md`.
- [ ] Create a service account for `eas submit` and save its key as `apps/mobile/secrets/google-play-service-account.json` (git-ignored).
- [ ] Internal testing → closed testing on real Android phones → production.

## 7. Operations before the first real users

- [ ] **Safety reports:** decide who reviews `reports` and how fast (target: within 24 hours, urgent ones immediately). There's no admin screen yet; use SQL until there is:
      `SELECT r.*, u.first_name FROM reports r JOIN users u ON u.id = r.reported_id WHERE resolved_at IS NULL ORDER BY created_at;`
- [ ] **Refunds and disputes:** handled in the Stripe dashboard; note them on the report.
- [ ] **Account deletion emails** (from the website): verify by texting the number, then delete via the database or a support script.
- [ ] **Launch area:** liquidity is everything. Pick one corridor (city centre ↔ Dublin Airport) and seed demand there first.

## Known gaps worth planning

- Admin dashboard for reports, refunds and suspensions.
- Collecting the passenger's fare share in-app (Stripe Connect) instead of person-to-person settlement.
- Real road distances and live traffic (Google Routes API) instead of straight-line estimates.
- Public-holiday and Christmas taxi tariffs.
- Booking the taxi from inside SplitCab needs a partnership: Uber's ride-request API needs Uber's approval, and FREENOW offers its booking API to partners only. Today the app opens Uber with the trip filled in and opens FREENOW for the booker to enter it.
