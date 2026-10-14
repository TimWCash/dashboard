-- Trips planned further ahead than a card hold lasts are saved as 'scheduled', with no hold, and start searching
-- (placing the hold) at search_from.
ALTER TABLE trips DROP CONSTRAINT trips_status_check;
ALTER TABLE trips ADD CONSTRAINT trips_status_check
  CHECK (status IN ('scheduled', 'pending_payment', 'searching', 'proposed', 'confirmed', 'completed', 'expired', 'cancelled'));
ALTER TABLE trips ADD COLUMN search_from timestamptz;
CREATE INDEX trips_scheduled_idx ON trips (search_from) WHERE status = 'scheduled';

-- Reminders: to answer a proposal before it lapses, and to the booker to enter the meter total.
ALTER TABLE matches ADD COLUMN answer_reminded_at timestamptz;
ALTER TABLE matches ADD COLUMN fare_reminders smallint NOT NULL DEFAULT 0;
