# Google Play listing

Paste these into Play Console → **Grow → Store presence → Main store listing** (English (United Kingdom) – en-GB).

| Field | Limit | Text |
|---|---|---|
| App name | 30 | SplitCab: Share a Taxi |
| Short description | 80 | Get matched with someone going your way. Share one taxi and split the fare. |
| Full description | 4000 | Same text as the App Store description in `store.config.js` (`description`). |
| App icon | 512×512 PNG | `store/google-play/icon-512.png` |
| Feature graphic | 1024×500 | `store/google-play/feature-graphic.png` |
| Phone screenshots | 2–8, 9:16 | `store/screenshots/android/*.png` |
| Category | | Travel & Local |
| Tags | up to 5 | Taxi, Ride sharing, Travel, Airport transfers, Commute |
| Contact email | | Your support address (same as `SUPPORT_EMAIL` on the API) |
| Website | | https://splitcab.ie |
| Privacy policy | | https://splitcab.ie/privacy |

## App content (Policy → App content)

| Form | Answer |
|---|---|
| Privacy policy | https://splitcab.ie/privacy |
| App access | Restricted. Add the review account: phone number = `REVIEW_PHONE`, code = `REVIEW_CODE`. Instructions: the same steps as the App Store review notes in `store.config.js`. |
| Ads | No ads |
| Content rating (IARC) | Category: Utility, productivity, communication or other. Users can interact or exchange information: **Yes** (private chat with a matched traveller). Shares user's physical location with other users: **Yes** (pickup point, only after both accept). Digital purchases: **No** (the match fee is for a real-world service). Everything else: No. |
| Target audience | **18 and over** only. Not designed for children. |
| News app | No |
| Data safety | See `store/privacy-answers.md` |
| Government app | No |
| Financial features | None of the listed features (the app doesn't provide financial services; card payments go through Stripe) |
| Health | No |
| Account deletion | In-app: Account → Delete account. Web: https://splitcab.ie/delete-account |

## Releases

Start on **Internal testing**, then **Closed testing**. New personal developer accounts must run a closed test with at least 12 testers for 14 days before production access is granted (check the current rule in Play Console when you apply). Organisation accounts are exempt.
