// Tunable product parameters. All money is in euro cents.

export interface TariffRates {
  perKm: number;
  perMin: number;
}

export interface Tariff {
  id: 'standard' | 'premium' | 'special';
  label: string;
  initial: number;
  initialKm: number;
  initialMin: number;
  a: TariffRates;
  b: TariffRates;
}

export const CONFIG = {
  locale: 'en-IE',
  currency: 'EUR',
  timeZone: 'Europe/Dublin',

  // Irish national maximum taxi fares (NTA, in force from 1 December 2024).
  // The meter charges per km or per minute, whichever is running faster. Tariff B applies after ~14.5 km.
  fare: {
    tariffBFromKm: 14.5,
    tariffs: {
      standard: {
        id: 'standard',
        label: 'standard rate',
        initial: 440,
        initialKm: 0.5,
        initialMin: 85 / 60,
        a: { perKm: 132, perMin: 47 },
        b: { perKm: 172, perMin: 61 },
      },
      premium: {
        id: 'premium',
        label: 'night/Sunday rate',
        initial: 540,
        initialKm: 0.5,
        initialMin: 85 / 60,
        a: { perKm: 181, perMin: 64 },
        b: { perKm: 220, perMin: 78 },
      },
      special: {
        id: 'special',
        label: 'late weekend rate',
        initial: 540,
        initialKm: 0.5,
        initialMin: 85 / 60,
        a: { perKm: 220, perMin: 78 },
        b: { perKm: 220, perMin: 78 },
      },
    } satisfies Record<Tariff['id'], Tariff>,
    // Charged when the taxi is booked through an app or by phone; one booking instead of two is part of the saving.
    bookingFee: 300,
    extraPassenger: 100,
  },

  // Flat fee per rider, captured only once both riders accept a match.
  matchFee: 199,

  matching: {
    taxiSeats: 4,
    // Longest extra distance either rider may be asked to ride, as a fraction of their solo trip.
    maxDetour: 0.4,
    // Furthest apart the two pickups can be before the first rider waits too long in the taxi.
    maxPickupGapKm: 5,
    // Pickups this close are a short walk, so riders meet at one spot instead of adding a stop.
    walkToMeetKm: 0.5,
    // Both riders must save at least this much of their solo fare, and at least minNetSavings after the fee: below
    // about €4 people don't think sharing with a stranger is worth it.
    minSavingsPct: 0.15,
    minNetSavings: 400,
    // Pickup must be at least this far in the future so people can coordinate.
    minLeadMinutes: 5,
  },

  trips: {
    // Card authorisations last about 7 days, so the hold is placed and the search starts at most this many days
    // before a trip. Trips planned further ahead are saved and start then.
    maxDaysAhead: 6,
    maxPlanDaysAhead: 60,
    minFlexMinutes: 5,
    maxFlexMinutes: 120,
    minTripKm: 1,
    // Around the island of Ireland. Trips must start and end in the Republic: see area.ts.
    serviceArea: { minLat: 51.3, maxLat: 55.45, minLng: -10.7, maxLng: -5.4 },
    maxActiveTripsPerRider: 3,
  },

  // How long the pair has to answer a proposed match. Trips leaving soon get 10 minutes. Trips planned ahead get
  // until 45 minutes before pickup, for at most 12 hours, so a match found overnight for an early flight is still
  // there when people wake up.
  // A match isn't offered with less than minAnswerMinutes left to answer. When there's over an hour to answer,
  // whoever hasn't yet is reminded reminderMinutesBefore the deadline.
  accept: { minMinutes: 10, beforePickupMinutes: 45, maxHours: 12, minAnswerMinutes: 5, reminderMinutesBefore: 30, remindIfOverMinutes: 60 },

  // After the last drop-off, the booker is reminded to enter the meter total at these times (minutes). If they still
  // haven't after closeAfterHours, the ride is closed and split at the estimate both people accepted; the booker can
  // correct it until the other person has paid.
  settle: { reminderMinutes: [30, 180], closeAfterHours: 6 },
  // An account is paused automatically, while the reports are looked into, once this many different people it was
  // matched with (both having accepted) report it within a year: fewer for feeling unsafe or harassment.
  safety: { pauseAfterSeriousReports: 2, pauseAfterReports: 3, reportWindowDays: 365 },

  // Stop searching this long before a trip's latest acceptable pickup.
  stopSearchingMinutesBefore: 10,

  geo: {
    // Straight-line distance times this approximates road distance.
    circuity: 1.3,
    // Average speeds: city streets for the first few km, then main roads, then motorway.
    citySpeedKmh: 20,
    cityKm: 5,
    roadSpeedKmh: 45,
    roadKm: 20,
    motorwaySpeedKmh: 85,
  },
} as const;

export type Config = typeof CONFIG;
