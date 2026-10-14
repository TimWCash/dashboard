-- Failed code checks are counted per number so sign-in codes can't be brute-forced.
ALTER TABLE otp_requests ADD COLUMN kind text NOT NULL DEFAULT 'start' CHECK (kind IN ('start', 'fail'));
CREATE INDEX otp_requests_kind_idx ON otp_requests (phone, kind, created_at DESC);

-- The store review account is recorded on the user, so changing REVIEW_PHONE later can't let an old
-- review account mix with real travellers or keep using test payments unnoticed.
ALTER TABLE users ADD COLUMN is_reviewer boolean NOT NULL DEFAULT false;
