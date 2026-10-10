// Tunable product parameters. Money is in euro.
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
        label: 'standard rate',
        initial: 4.4,
        initialKm: 0.5,
        initialMin: 85 / 60,
        a: { perKm: 1.32, perMin: 0.47 },
        b: { perKm: 1.72, perMin: 0.61 },
      },
      premium: {
        label: 'night/Sunday rate',
        initial: 5.4,
        initialKm: 0.5,
        initialMin: 85 / 60,
        a: { perKm: 1.81, perMin: 0.64 },
        b: { perKm: 2.2, perMin: 0.78 },
      },
      special: {
        label: 'late weekend rate',
        initial: 5.4,
        initialKm: 0.5,
        initialMin: 85 / 60,
        a: { perKm: 2.2, perMin: 0.78 },
        b: { perKm: 2.2, perMin: 0.78 },
      },
    },
    // Charged when the taxi is booked through an app or by phone; one booking instead of two is part of the saving.
    bookingFee: 3.0,
    extraPassenger: 1.0,
  },

  // Flat fee per rider, captured only once both riders accept a match.
  matchFee: 1.99,

  matching: {
    taxiSeats: 4,
    // Longest extra distance either rider may be asked to ride, as a fraction of their solo trip.
    maxDetour: 0.4,
    // Furthest apart the two pickups can be before the first rider waits too long in the taxi.
    maxPickupGapKm: 5,
    // Pickups this close are a short walk, so riders meet at one spot instead of adding a stop.
    walkToMeetKm: 0.5,
    // Both riders must save at least this much of their solo fare, and come out ahead after the fee.
    minSavingsPct: 0.15,
    minNetSavings: 1.0,
    // Pickup must be at least this far in the future so people can coordinate.
    minLeadMinutes: 5,
  },

  // How long the pair has to accept a proposed match.
  acceptWindowMinutes: 10,
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
};
