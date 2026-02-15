CREATE TABLE IF NOT EXISTS tenant_sso_whitelist (
  id BIGSERIAL PRIMARY KEY,
  tenant_name VARCHAR(255) NOT NULL,
  tenant_rand_id VARCHAR(64),
  sso_token_hash VARCHAR(128) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_sso_whitelist_name_uq
  ON tenant_sso_whitelist(tenant_name);

CREATE INDEX IF NOT EXISTS tenant_sso_whitelist_active_idx
  ON tenant_sso_whitelist(is_active);

ALTER TABLE oauth_authorization_codes
  ADD COLUMN IF NOT EXISTS tenant_name VARCHAR(255);

ALTER TABLE oauth_authorization_codes
  ALTER COLUMN tenant_name SET DEFAULT '';

UPDATE oauth_authorization_codes
   SET tenant_name = ''
 WHERE tenant_name IS NULL;

ALTER TABLE oauth_authorization_codes
  ALTER COLUMN tenant_name SET NOT NULL;

CREATE INDEX IF NOT EXISTS oauth_code_tenant_name_idx
  ON oauth_authorization_codes(tenant_name, expires_at);

ALTER TABLE oauth_access_tokens
  ADD COLUMN IF NOT EXISTS tenant_name VARCHAR(255);

ALTER TABLE oauth_access_tokens
  ALTER COLUMN tenant_name SET DEFAULT '';

UPDATE oauth_access_tokens
   SET tenant_name = ''
 WHERE tenant_name IS NULL;

ALTER TABLE oauth_access_tokens
  ALTER COLUMN tenant_name SET NOT NULL;

CREATE INDEX IF NOT EXISTS oauth_access_tokens_tenant_name_idx
  ON oauth_access_tokens(tenant_name, expires_at, revoked_at);
