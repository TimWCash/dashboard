-- Which version of the Terms of Service and Privacy Policy someone agreed to, so changes can be put to them.
ALTER TABLE users ADD COLUMN terms_version text;
UPDATE users SET terms_version = '2026-10-11' WHERE terms_accepted_at IS NOT NULL;

-- Storage limitation: accounts nobody has used for two years are deleted (see src/rides/retention.ts).
ALTER TABLE users ADD COLUMN last_active_at timestamptz;
UPDATE users SET last_active_at = created_at;
ALTER TABLE users ALTER COLUMN last_active_at SET DEFAULT now(), ALTER COLUMN last_active_at SET NOT NULL;
CREATE INDEX users_last_active_idx ON users (last_active_at) WHERE deleted_at IS NULL;

-- When a trip's exact places were replaced by a rough area (after a year, or when the account is deleted).
ALTER TABLE trips ADD COLUMN blurred_at timestamptz;
CREATE INDEX trips_unblurred_idx ON trips (target_time) WHERE blurred_at IS NULL;
