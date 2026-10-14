// How long SplitCab keeps personal data. The API enforces these (apps/api/src/rides/retention.ts), the app
// shows them under Privacy & your data, and the privacy policy and docs/gdpr.md state them.
export const RETENTION = {
  // Chat between travellers.
  messagesDays: 90,
  // Exact pickup and drop-off places; after this only the rough area is kept.
  exactPlacesDays: 365,
  // Free-text details of safety reports.
  reportDetailsDays: 2 * 365,
  // Accounts with no sign-in or use for this long are deleted.
  inactiveAccountDays: 2 * 365,
  // When an account paused after safety reports is deleted, a keyed hash of its number, so it can't sign straight
  // back up unpaused.
  pausedNumberDays: 2 * 365,
  // Trip, payment and receipt records, for Irish tax law (six years).
  recordsDays: 6 * 365 + 2,
} as const;
