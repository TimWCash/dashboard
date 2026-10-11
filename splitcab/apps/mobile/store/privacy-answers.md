# Privacy answers for the stores

Answers for **App Store Connect → App Privacy** and **Play Console → Data safety**, based on what the app and API actually collect. Update this file whenever you add analytics, crash reporting or another SDK.

## What SplitCab collects

| Data | Where it comes from | Why | Linked to the person | Shared with other users |
|---|---|---|---|---|
| Phone number | Sign-in | Account and sign-in (SMS code via Twilio Verify) | Yes | Never |
| First name | Profile | Shown to your matched travel partner | Yes | Yes, once matched |
| Trip pickup and destination (precise) | Typed or "Use where I am now" | Matching and fare estimates | Yes | Approximate area when matched; exact stop once both accept |
| Device location (precise) | Only when you tap "Use where I am now" | Fill in the pickup point; not stored except as the trip pickup | Yes | As above |
| Revolut username (Revtag), optional | Account → Get paid back by Revolut | So a travel partner who owes you can pay you through your Revolut page | Yes | Only with a partner who owes you money, after the ride |
| Payment card | Entered in Stripe's payment sheet | Match fee holds and charges. SplitCab stores only brand and last four digits | Yes | Never |
| Purchase history | Match fee holds, charges, refunds | Wallet and accounting | Yes | Never |
| Messages | Chat with a matched traveller | Coordinating the pickup; safety reviews | Yes | The matched traveller only |
| Reports, ratings, blocks | Safety features | Trust and safety | Yes | Ratings appear as an average |
| Push token | Device | Match and message notifications | Yes | Never |

Not collected: contacts, photos, browsing history, health data, advertising identifiers, analytics or crash data (none in this build). No tracking across other companies' apps or websites, so no App Tracking Transparency prompt is needed.

Service providers that process data on SplitCab's behalf: Stripe (payments), Twilio (SMS codes), Expo (push delivery), Google Maps Platform (place search, if enabled), and the hosting provider. Under both stores' definitions this is processing by service providers, not "sharing".

## App Store Connect → App Privacy

Data used to track you: **None.**

Data linked to you (all with purpose **App Functionality** unless noted):

| Apple category | Data type | Purposes |
|---|---|---|
| Contact Info | Name | App Functionality |
| Contact Info | Phone Number | App Functionality |
| Contact Info | Other User Contact Info (Revolut username, optional) | App Functionality |
| Location | Precise Location | App Functionality |
| Financial Info | Payment Info | App Functionality |
| Purchases | Purchase History | App Functionality |
| User Content | Other User Content (chat, reports, ratings) | App Functionality, Customer Support |
| Identifiers | User ID | App Functionality |
| Identifiers | Device ID (push token) | App Functionality |

Data not linked to you: **None.**

## Play Console → Data safety

- Does your app collect or share any of the required user data types? **Yes**
- Is all user data encrypted in transit? **Yes** (HTTPS only)
- Do you provide a way for users to request that their data is deleted? **Yes** (in-app and https://splitcab.ie/delete-account)

| Play category | Data type | Collected | Shared | Optional? | Purposes |
|---|---|---|---|---|---|
| Personal info | Name | Yes | No | Required | App functionality, Account management |
| Personal info | Phone number | Yes | No | Required | Account management, Fraud prevention, security and compliance |
| Personal info | User IDs | Yes | No | Required | App functionality, Account management |
| Personal info | Other info (Revolut username) | Yes | No | Optional | App functionality |
| Location | Precise location | Yes | No | Required (trip stops) | App functionality |
| Financial info | Payment info | Yes | No | Required | App functionality |
| Financial info | Purchase history | Yes | No | Required | App functionality |
| Messages | Other in-app messages | Yes | No | Optional | App functionality, Fraud prevention, security and compliance |
| App activity | Other user-generated content (reports, ratings) | Yes | No | Optional | Fraud prevention, security and compliance |
| Device or other IDs | Device or other IDs (push token) | Yes | No | Optional | App functionality |

"Shared: No" because data goes to the matched traveller at the user's own direction and to service providers acting for SplitCab, both of which Google excludes from "sharing". Have your solicitor confirm this reading.

## Retention (also in the privacy policy)

- Chat messages: deleted after 90 days (`purgeOldData` in the API).
- Sign-in records: code requests after 1 day, expired sessions after 7 days.
- Deleted accounts: name, phone, Revolut username, card details and push token erased immediately; trips and payment records kept in anonymised form for accounting and dispute handling.
