// App Store listing, age rating and review details, pushed with `npx eas-cli@latest metadata:push`.
// Review account details come from the environment so they aren't committed:
//   REVIEW_PHONE / REVIEW_CODE         same values as the API's REVIEW_PHONE / REVIEW_CODE
//   REVIEW_CONTACT_FIRST_NAME, REVIEW_CONTACT_LAST_NAME, REVIEW_CONTACT_EMAIL, REVIEW_CONTACT_PHONE
const SITE = process.env.SITE_URL ?? 'https://splitcab.ie';

const description = `SplitCab matches you with someone heading the same way at roughly the same time, so you can share one taxi and split the fare.

Off to the airport at 5am? Heading home after a gig? Post your trip and we'll look for a travel partner nearby.

HOW IT WORKS
• Tell us where you're going and roughly when you want to leave or arrive.
• We find someone nearby going your way and show exactly what you'll each pay before you agree.
• You both accept, agree where to meet in the chat, and one of you books the taxi in your usual taxi app or takes one from a rank.
• After the ride, the person who booked enters the fare and SplitCab shows who owes what.

NO MATCH, NO CHARGE
When you post a trip we place a €1.99 hold on your card. It's only charged if you're matched and you both accept. If no one is found, the hold is released automatically.

A FAIR SPLIT
You each pay in proportion to what you'd have paid alone, so you both save the same share. Estimates follow the National Transport Authority's maximum taxi fares, including night and Sunday rates.

BUILT FOR SAFETY
• Every traveller verifies their phone number.
• Your exact pickup point is only shared once you've both accepted.
• Ratings after every ride.
• Report or block anyone in two taps. Blocking cancels the ride and refunds both match fees.

SplitCab is for adults aged 18 and over and works anywhere on the island of Ireland. SplitCab doesn't provide taxis: you ride in a licensed taxi that you book yourselves.`;

module.exports = () => ({
  configVersion: 0,
  apple: {
    copyright: `${new Date().getFullYear()} ${process.env.COMPANY_LEGAL_NAME ?? 'SplitCab'}`,
    categories: ['TRAVEL', 'NAVIGATION'],
    info: {
      'en-GB': {
        title: 'SplitCab: Share a Taxi',
        subtitle: 'Share a taxi, split the fare',
        promoText: 'Heading to the airport or home after a gig? Get matched with someone going your way, share one taxi and split the fare. No match, no charge.',
        description,
        keywords: ['taxi', 'share', 'split', 'fare', 'airport', 'Dublin', 'Cork', 'Galway', 'Shannon', 'cab', 'carpool', 'travel', 'commute'],
        releaseNotes: 'First release.',
        marketingUrl: SITE,
        supportUrl: `${SITE}/support`,
        privacyPolicyUrl: `${SITE}/privacy`,
        privacyChoicesUrl: `${SITE}/delete-account`,
        screenshots: {
          APP_IPHONE_67: ['store/screenshots/ios/01.png', 'store/screenshots/ios/02.png', 'store/screenshots/ios/03.png', 'store/screenshots/ios/04.png', 'store/screenshots/ios/05.png'],
        },
      },
    },
    advisory: {
      alcoholTobaccoOrDrugUseOrReferences: 'NONE',
      contests: 'NONE',
      gamblingSimulated: 'NONE',
      horrorOrFearThemes: 'NONE',
      matureOrSuggestiveThemes: 'NONE',
      medicalOrTreatmentInformation: 'NONE',
      profanityOrCrudeHumor: 'NONE',
      sexualContentGraphicAndNudity: 'NONE',
      sexualContentOrNudity: 'NONE',
      violenceCartoonOrFantasy: 'NONE',
      violenceRealistic: 'NONE',
      violenceRealisticProlongedGraphicOrSadistic: 'NONE',
      gunsOrOtherWeapons: 'NONE',
      gambling: false,
      unrestrictedWebAccess: false,
      lootBox: false,
      advertising: false,
      healthOrWellnessTopics: false,
      parentalControls: false,
      ageAssurance: false,
      // Private one-to-one chat with a matched traveller.
      messagingAndChat: true,
      userGeneratedContent: true,
      kidsAgeBand: null,
      // Strangers sharing a taxi: adults only.
      ageRatingOverride: 'SEVENTEEN_PLUS',
      ageRatingOverrideV2: 'EIGHTEEN_PLUS',
      koreaAgeRatingOverride: 'NINETEEN_PLUS',
    },
    release: {
      automaticRelease: false,
      phasedRelease: true,
    },
    review: {
      firstName: process.env.REVIEW_CONTACT_FIRST_NAME ?? 'REPLACE_ME',
      lastName: process.env.REVIEW_CONTACT_LAST_NAME ?? 'REPLACE_ME',
      email: process.env.REVIEW_CONTACT_EMAIL ?? 'REPLACE_ME@example.com',
      phone: process.env.REVIEW_CONTACT_PHONE ?? '+353 1 000 0000',
      demoRequired: true,
      demoUsername: process.env.REVIEW_PHONE ?? 'REPLACE_ME',
      demoPassword: process.env.REVIEW_CODE ?? 'REPLACE_ME',
      notes: `Sign in with the phone number above. No text message is sent to this review number: enter the code given as the password.

To see the whole flow:
1. Plan a trip, for example St Stephen's Green → Dublin Airport, leaving in an hour.
2. "Add card" is skipped for this review account; no real payment is taken.
3. Tap "Find someone to share with". A demo travel partner ("Alex") is matched straight away and has already accepted. In real use a second person on another phone would be matched.
4. Accept to confirm. You can message Alex, open the booking links, and after the "ride" enter a fare to see the split.
5. The flag icon on a trip opens Report or block. Account → Delete account removes the account.

The €1.99 match fee is for a real-world service (matching people to share a physical taxi ride), so it is charged by card through Stripe rather than in-app purchase (guideline 3.1.3(e)). Rides are booked by the users in licensed taxi apps or at a rank; SplitCab never dispatches vehicles.`,
    },
  },
});
