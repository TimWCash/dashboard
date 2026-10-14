# GDPR at SplitCab

How SplitCab handles personal data, what the product does for you automatically, and what the company still has to do. It's a working draft for your solicitor or data protection adviser to review, not legal advice. Fill in the placeholders in `[brackets]`.

SplitCab ([Company legal name]) is the **controller** for everything below. The lead supervisory authority is the Data Protection Commission (DPC), Ireland.

## Built into the product

| GDPR principle or right | What SplitCab does | Where |
|---|---|---|
| Data minimisation (Art. 5(1)(c)) | Only a first name and rating are shown to a travel partner, and the phone number never is. Location is read only when someone taps "Use where I am now". There's no analytics, advertising or tracking SDK. Stripe holds card details; SplitCab keeps only brand and last four digits. | `rides/views.ts`, `store/privacy-answers.md` |
| Privacy by default (Art. 25) | Before both people accept, each sees only the rough area of the other's stops ("Trinity College area"), rounded times and no coordinates. A Revtag is shown only to a partner who owes that person money, after the ride. | `rides/views.ts` |
| Storage limitation (Art. 5(1)(e)) | Retention runs automatically every 6 hours (see the schedule below). | `rides/retention.ts`, `RideService.purgeOldData`, `packages/core/src/retention.ts` |
| Transparency (Art. 12–14) | Privacy policy, plus **Account → Privacy & your data** in the app, which lists what's kept and for how long. The version of the Terms and Privacy Policy each person agreed to is recorded, and a new version is put to them before their next trip. | `apps/site/public/privacy.html`, `app/(app)/privacy.tsx`, `TERMS_VERSION` |
| Access and portability (Art. 15, 20) | **Download my data** gives a JSON file of everything held about the person, including how long each part is kept. Reports other people made about them are withheld to protect the reporters (Art. 15(4)). | `GET /v1/me/export`, `ops-cli export` |
| Rectification (Art. 16) | People edit their first name and Revtag in the app. A phone number change is handled by support (delete and sign up again, or an update in the database). | `app/(app)/name.tsx`, `app/(app)/revtag.tsx` |
| Erasure (Art. 17) | **Delete my account** in the app, or by email using `ops-cli delete`. Name, number, Revtag, card reference, push token and sessions are erased at once. Trip and payment records are kept for tax law (Art. 17(3)(b)) with place names removed and locations blurred. | `RideService.deleteAccount` |
| Security (Art. 32) | TLS only. Short-lived access tokens; refresh tokens stored hashed and rotated, with reuse detection. Sign-in codes are rate-limited with a lockout after wrong codes. Logs redact auth headers and drop query strings (place searches, coordinates). Card data never touches SplitCab's servers. | `auth/`, `app.ts`, `http.ts` |
| Children (Art. 8) | SplitCab is 18+. People confirm their age when they agree to the Terms. | `app/(auth)/profile.tsx` |
| Consent | Push notifications only with the phone's permission, which can be withdrawn in its settings. Nothing else relies on consent. | `lib/push.ts` |
| Automated decisions (Art. 22) | Matching is automated, but it only proposes a shared ride that both people choose to accept. It has no legal or similarly significant effect. Record this conclusion in the DPIA. | `packages/core/src/matching.ts` |

## Retention schedule

These numbers live in `packages/core/src/retention.ts`. The API enforces them, the app shows them, and the privacy policy states them. Change all three together.

| Data | Kept for | Then |
|---|---|---|
| Chat messages | 90 days | Deleted |
| Sign-in code requests | 1 day | Deleted |
| Expired or revoked sign-in sessions | 7 days | Deleted |
| Exact pickup and drop-off places (trips and ride plans) | 1 year after the trip | Replaced by the nearest known area; coordinates rounded to about 1 km |
| Free text in safety reports | 2 years | Cleared (the reason and date stay until 6 years) |
| Keyed hash of the number of a paused account that was deleted | 2 years | Deleted. The hash is an HMAC keyed with `JWT_SECRET`, so it can't be reversed by hashing every number; it stops the person signing straight back up unpaused. Rotating `JWT_SECRET` makes old entries useless. |
| Accounts | Until deleted, or 2 years without use | Deleted as if the person had deleted it |
| Trips, matches, payments, payment history, ratings, receipts | 6 years | Deleted |
| Deleted accounts' remaining rows (no personal details) | 6 years after deletion | Deleted |
| Completed background jobs | 30 days | Deleted |
| Stripe webhook IDs | 90 days | Deleted |
| Database backups | [your provider's setting, e.g. 7 days] | Expire. A deletion reaches backups when they expire; say so if asked. |

## Records of processing (Art. 30)

| Activity | Personal data | Purpose | Legal basis | Recipients | Retention |
|---|---|---|---|---|---|
| Accounts and sign-in | Phone number, first name, Terms version, last active date, sessions | Run the account; sign-in by text code | Contract | Twilio (SMS) | See schedule |
| Matching and trips | Pickup, destination, times, seats; location on request | Match people going the same way; estimate fares | Contract | The matched traveller (area only until both accept) | Exact places 1 year; records 6 years |
| Match fee | Card brand and last four, payment history | Charge, release or refund the €1.99 fee | Contract; legal obligation (tax) | Stripe | 6 years |
| Paying back between riders | Revtag (optional), amounts owed, "I've paid" | Help the person who owes pay the booker | Contract | The partner who owes money; Revolut only if the payer follows the link | Until removed or the account is deleted |
| Chat | Messages | Coordinate the pickup | Contract | The matched traveller | 90 days |
| Safety | Reports, blocks, ratings; whether an account is paused, when and why | Keep travellers safe; act on misconduct. Accounts are paused automatically after reports from two people (unsafe or harassment) or three (anything), until support looks into it | Legitimate interests | Support staff; the report alert service (only the kind of report and a reference, no names, numbers or report text); authorities when the law requires | Report text 2 years; records 6 years |
| Notifications | Push token; message text with first names and amounts | Tell people about matches, messages and payments | Consent (OS permission) | Expo, Apple, Google | Until the token changes or the account is deleted |
| Support and data requests | Emails, request log | Answer questions and GDPR requests | Legal obligation | Support staff | [e.g. 2 years after closing] |

## Processors and transfers

Sign a data processing agreement (DPA) with each processor and list them in the privacy policy.

| Processor | What it processes | Location | Transfer safeguard | DPA |
|---|---|---|---|---|
| [Hosting provider] and managed Postgres | Everything in the database | EU (Dublin region) | None needed | [ ] |
| Stripe | Card details, payment amounts, customer IDs | EU and US | EU–US Data Privacy Framework / SCCs | In Stripe's terms [ ] |
| Twilio Verify | Phone numbers, sign-in codes | US | DPF / SCCs | [ ] |
| Expo push service | Push tokens, notification text | US | DPF / SCCs | [ ] |
| Google Maps Platform (if enabled) | Search text, approximate location | US | DPF / SCCs | [ ] |
| Trip map: Google Maps SDK (Android) | The map area being viewed, device IP and identifiers | US | DPF / SCCs | Google Maps Platform terms [ ] |
| Trip map: Apple MapKit (iPhone) | The map area being viewed | Apple's own terms with the user | Apple acts for the user, not SplitCab | n/a |
| Demo only: Vercel and Supabase (EU) | The shared demo's accounts and trips. An account unused for a day is deleted as if its owner had deleted it, since people may try the demo with their real number. The one-person demo keeps everything in the visitor's browser. Map tiles come from OpenStreetMap. | EU (Dublin) | None needed | Vercel and Supabase terms [ ] |

The report alert service (`REPORT_ALERT_WEBHOOK_URL`, for example Slack or Discord) receives no personal data: only the kind of report, a reference and how many people have open reports about the account. Check that this stays true if you change the alert text in `jobs/handlers.ts`.

Revolut is not a processor. Riders pay each other under Revolut's own terms; SplitCab only links to the booker's public Revolut page.

## Handling a data request (DSAR)

1. **Log it** in the request register: date received, who, which right, the deadline (one month, extendable by two more for complex requests).
2. **Check identity.** Requests must be linked to the account's phone number. Ask the person to use the app if they can. If they can't, text the number on file and ask them to reply with the code you sent.
3. **Act:**
   - Access or portability: `npm run ops -w @splitcab/api -- export +353871234567 > data.json` (or `node dist/ops-cli.js export …` in the API container), then send the file securely.
   - Erasure: `npm run ops -w @splitcab/api -- delete +353871234567 --yes`.
   - Rectification: a name is easiest changed in the app; otherwise update `users.first_name` directly.
   - Restriction or objection: decide with your adviser. A restriction can be met by deleting the person's sessions (`DELETE FROM refresh_tokens WHERE user_id = …`) and cancelling open trips, while keeping the data.
4. **Reply** within the deadline, and record what you did and when.

## Personal data breaches (Art. 33, 34)

1. **Contain it at once:**
   - Rotate `JWT_SECRET`, which signs everyone out within 15 minutes.
   - Revoke sessions: `UPDATE refresh_tokens SET revoked_at = now() WHERE revoked_at IS NULL`.
   - Rotate the Stripe, Twilio, Expo and Google keys.
2. **Assess** what data, how many people and the likely harm. Phone numbers together with travel times and places can put someone's safety at risk.
3. **Notify the DPC within 72 hours** of becoming aware, through dataprotection.ie, unless the breach is unlikely to put anyone at risk. Record the decision either way.
4. **Tell the people affected** without undue delay if the risk to them is high. Use the app (push) and a text message.
5. **Log** every breach, including ones you didn't report, in the breach register.

## Data protection impact assessment (starter)

A DPIA is advisable because SplitCab processes location data and introduces strangers to each other. Complete it before launch and review it after any big change.

| Risk to people | Mitigations already built | Residual risk |
|---|---|---|
| Someone learns where another person lives | Only the rough area until both accept; exact places blurred after a year; phone never shown; block and report | [Low/Medium] |
| Harassment through chat | Chat only after both accept; link and abuse filter; block ends contact and refunds both fees before pickup; 90-day message retention | [ ] |
| Payment scams between riders | Payment links blocked in chat; Revtag shown only to the partner who owes money, after the ride | [ ] |
| Account takeover | Text-code sign-in with lockout; Irish and UK numbers only; refresh token reuse detection | [ ] |
| Data breach | Minimal data; card data at Stripe; EU hosting; retention limits; hashed tokens | [ ] |
| Function creep | No analytics or advertising; data used only for the purposes above | [ ] |

Sign-off: [name, role, date]. Whether a Data Protection Officer is required (Art. 37) depends on whether matching counts as large-scale regular and systematic monitoring of location. Get advice; appointing one is good practice either way.

## Changing the Terms or Privacy Policy

1. Update `apps/site/public/terms.html` or `privacy.html` and their "Last updated" dates.
2. Set `TERMS_VERSION` on the API to the new date and deploy.
3. Everyone is shown "We've updated our Terms and Privacy Policy" before their next trip. Their agreement is stored with the version (`users.terms_version`, `users.terms_accepted_at`) and included in their data export.

## Before launch

- [ ] Solicitor review of this document, the privacy policy and the terms.
- [ ] DPAs signed with every processor above; privacy policy lists them.
- [ ] DPIA completed and signed off; DPO decision recorded.
- [ ] A monitored privacy mailbox (the support address works), with the DSAR and breach registers set up.
- [ ] Database and backups in the EU, with backup retention noted in the schedule above.
- [ ] Only the people who need it have production database access, and access is logged.
