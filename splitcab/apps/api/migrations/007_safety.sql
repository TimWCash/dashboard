-- Accounts paused while reports about them are looked into, automatically after reports from several people or
-- by support. A paused account can still sign in, see its trips, settle a ride that happened, download its data
-- and delete itself, but it can't post trips, be matched or send messages.
ALTER TABLE users ADD COLUMN suspended_at timestamptz;
ALTER TABLE users ADD COLUMN suspended_reason text CHECK (char_length(suspended_reason) <= 300);
CREATE INDEX reports_reported_open_idx ON reports (reported_id, created_at) WHERE resolved_at IS NULL;

-- When an account paused after reports is deleted, a keyed hash of its number (never the number itself), so the
-- same number can't sign straight back up unpaused. Deleted after RETENTION.pausedNumberDays.
CREATE TABLE paused_numbers (
  phone_hash  text PRIMARY KEY,
  paused_at   timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
