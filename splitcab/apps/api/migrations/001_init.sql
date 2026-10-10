-- SplitCab initial schema. Money is in euro cents. All times are timestamptz.

CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- E.164. Cleared when the account is deleted.
  phone                 text UNIQUE,
  first_name            text CHECK (char_length(first_name) BETWEEN 1 AND 40),
  terms_accepted_at     timestamptz,
  stripe_customer_id    text UNIQUE,
  payment_method_id     text,
  payment_method_brand  text,
  payment_method_last4  text,
  push_token            text,
  rating_sum            integer NOT NULL DEFAULT 0,
  rating_count          integer NOT NULL DEFAULT 0,
  rides_completed       integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);

CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- SHA-256 of the token; the token itself is never stored.
  token_hash  text NOT NULL UNIQUE,
  -- Every rotation stays in the same family, so reuse of an old token revokes the whole chain.
  family_id   uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  revoked_at  timestamptz
);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

-- Throttles code requests per phone number.
CREATE TABLE otp_requests (
  id          bigserial PRIMARY KEY,
  phone       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_requests_phone_idx ON otp_requests (phone, created_at DESC);

CREATE TABLE trips (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id),
  origin_label  text NOT NULL,
  origin_lat    double precision NOT NULL,
  origin_lng    double precision NOT NULL,
  dest_label    text NOT NULL,
  dest_lat      double precision NOT NULL,
  dest_lng      double precision NOT NULL,
  time_mode     text NOT NULL CHECK (time_mode IN ('depart', 'arrive')),
  target_time   timestamptz NOT NULL,
  flex_min      integer NOT NULL CHECK (flex_min BETWEEN 5 AND 120),
  seats         integer NOT NULL CHECK (seats BETWEEN 1 AND 3),
  status        text NOT NULL CHECK (status IN ('pending_payment', 'searching', 'proposed', 'confirmed', 'completed', 'expired', 'cancelled')),
  search_until  timestamptz NOT NULL,
  solo_fare     integer NOT NULL,
  match_id      uuid,
  payment_id    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trips_searching_idx ON trips (search_until) WHERE status = 'searching';
CREATE INDEX trips_pending_idx ON trips (created_at) WHERE status = 'pending_payment';
CREATE INDEX trips_user_idx ON trips (user_id, created_at DESC);

-- Pairs that must not be proposed to each other again (declined, timed out, cancelled).
CREATE TABLE trip_exclusions (
  trip_id        uuid NOT NULL REFERENCES trips(id),
  other_trip_id  uuid NOT NULL REFERENCES trips(id),
  PRIMARY KEY (trip_id, other_trip_id)
);

CREATE TABLE matches (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_a                uuid NOT NULL REFERENCES trips(id),
  trip_b                uuid NOT NULL REFERENCES trips(id),
  status                text NOT NULL CHECK (status IN ('proposed', 'confirmed', 'completed', 'declined', 'expired', 'cancelled')),
  plan                  jsonb NOT NULL,
  booker_trip_id        uuid NOT NULL REFERENCES trips(id),
  a_accepted_at         timestamptz,
  b_accepted_at         timestamptz,
  proposed_at           timestamptz NOT NULL,
  expires_at            timestamptz NOT NULL,
  confirmed_at          timestamptz,
  ended_at              timestamptz,
  cancelled_by_trip_id  uuid REFERENCES trips(id),
  settlement            jsonb,
  CHECK (trip_a <> trip_b)
);
CREATE INDEX matches_trip_a_idx ON matches (trip_a, proposed_at DESC);
CREATE INDEX matches_trip_b_idx ON matches (trip_b, proposed_at DESC);
CREATE INDEX matches_proposed_idx ON matches (expires_at) WHERE status = 'proposed';

ALTER TABLE trips ADD CONSTRAINT trips_match_fk FOREIGN KEY (match_id) REFERENCES matches(id);

CREATE TABLE payments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id),
  trip_id        uuid NOT NULL REFERENCES trips(id),
  amount         integer NOT NULL CHECK (amount > 0),
  currency       text NOT NULL,
  status         text NOT NULL CHECK (status IN ('pending', 'requires_action', 'authorized', 'captured', 'released', 'refunded', 'failed')),
  -- Stripe PaymentIntent id.
  provider_ref   text UNIQUE,
  -- Only kept while the rider still has to authenticate the hold.
  client_secret  text,
  failure        text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_user_idx ON payments (user_id, created_at DESC);

CREATE TABLE payment_events (
  id          bigserial PRIMARY KEY,
  payment_id  uuid NOT NULL REFERENCES payments(id),
  status      text NOT NULL,
  at          timestamptz NOT NULL
);
CREATE INDEX payment_events_payment_idx ON payment_events (payment_id, id);

ALTER TABLE trips ADD CONSTRAINT trips_payment_fk FOREIGN KEY (payment_id) REFERENCES payments(id);

CREATE TABLE messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id    uuid NOT NULL REFERENCES matches(id),
  trip_id     uuid NOT NULL REFERENCES trips(id),
  body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  created_at  timestamptz NOT NULL
);
CREATE INDEX messages_match_idx ON messages (match_id, created_at);

CREATE TABLE ratings (
  match_id    uuid NOT NULL REFERENCES matches(id),
  rater_id    uuid NOT NULL REFERENCES users(id),
  ratee_id    uuid NOT NULL REFERENCES users(id),
  stars       smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, rater_id)
);

CREATE TABLE blocks (
  blocker_id  uuid NOT NULL REFERENCES users(id),
  blocked_id  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE INDEX blocks_blocked_idx ON blocks (blocked_id);

CREATE TABLE reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id  uuid NOT NULL REFERENCES users(id),
  reported_id  uuid NOT NULL REFERENCES users(id),
  match_id     uuid REFERENCES matches(id),
  reason       text NOT NULL CHECK (reason IN ('no_show', 'unsafe', 'harassment', 'payment', 'other')),
  details      text CHECK (char_length(details) <= 1000),
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz
);
CREATE INDEX reports_open_idx ON reports (created_at) WHERE resolved_at IS NULL;

-- Durable background work: payment captures/releases/refunds and push notifications.
CREATE TABLE jobs (
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL,
  payload     jsonb NOT NULL,
  run_at      timestamptz NOT NULL DEFAULT now(),
  attempts    integer NOT NULL DEFAULT 0,
  last_error  text,
  done_at     timestamptz,
  failed_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_due_idx ON jobs (run_at) WHERE done_at IS NULL AND failed_at IS NULL;

-- Stripe webhook event ids already processed, so retries are ignored.
CREATE TABLE webhook_events (
  id           text PRIMARY KEY,
  received_at  timestamptz NOT NULL DEFAULT now()
);
