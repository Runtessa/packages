ALTER TABLE oauth_authorization_codes
  ADD COLUMN IF NOT EXISTS tenant_org_rand_id VARCHAR(64);

CREATE INDEX IF NOT EXISTS oauth_code_tenant_org_idx
  ON oauth_authorization_codes(tenant_name, tenant_org_rand_id, expires_at);

ALTER TABLE oauth_access_tokens
  ADD COLUMN IF NOT EXISTS tenant_org_rand_id VARCHAR(64);

CREATE INDEX IF NOT EXISTS oauth_access_tokens_tenant_org_idx
  ON oauth_access_tokens(tenant_name, tenant_org_rand_id, expires_at, revoked_at);

