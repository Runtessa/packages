CREATE TABLE IF NOT EXISTS auth_otp_challenges (
  id BIGSERIAL PRIMARY KEY,
  rand_id VARCHAR(64) NOT NULL UNIQUE,
  purpose VARCHAR(32) NOT NULL,
  channel VARCHAR(16) NOT NULL DEFAULT 'sms',
  destination VARCHAR(64) NOT NULL,
  code_hash VARCHAR(128) NOT NULL,
  attempts_used INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS auth_otp_challenges_lookup_idx
  ON auth_otp_challenges(purpose, destination, expires_at);

CREATE INDEX IF NOT EXISTS auth_otp_challenges_active_idx
  ON auth_otp_challenges(expires_at)
  WHERE consumed_at IS NULL;
