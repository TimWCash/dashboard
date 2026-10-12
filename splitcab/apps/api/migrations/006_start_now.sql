-- When the rider asked us to start looking straight away, acknowledging that the match fee can't be cancelled
-- under the 14-day right to cancel once they and their match have both accepted (Consumer Rights Act 2022).
ALTER TABLE trips ADD COLUMN start_now_at timestamptz;
