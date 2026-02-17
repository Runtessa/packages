CREATE TABLE IF NOT EXISTS user_tenant_memberships (
  id BIGSERIAL PRIMARY KEY,
  rand_id VARCHAR(64) NOT NULL,
  version_no INTEGER NOT NULL CHECK (version_no > 0),
  user_rand_id VARCHAR(64) NOT NULL,
  tenant_name VARCHAR(255) NOT NULL,
  tenant_rand_id VARCHAR(64),
  org_rand_id VARCHAR(64),
  source VARCHAR(32) NOT NULL DEFAULT 'signup',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  previous_row_id BIGINT REFERENCES user_tenant_memberships(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by_user_rand_id VARCHAR(64),
  changed_by_tenant_rand_id VARCHAR(64),
  change_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_tenant_memberships_rand_version_uq
  ON user_tenant_memberships(rand_id, version_no);

CREATE UNIQUE INDEX IF NOT EXISTS user_tenant_memberships_current_rand_uq
  ON user_tenant_memberships(rand_id) WHERE is_current = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS user_tenant_memberships_current_pair_uq
  ON user_tenant_memberships(user_rand_id, tenant_name, COALESCE(org_rand_id, ''))
  WHERE is_current = TRUE;

CREATE INDEX IF NOT EXISTS user_tenant_memberships_tenant_lookup_idx
  ON user_tenant_memberships(tenant_name, org_rand_id, is_current, is_active);

CREATE INDEX IF NOT EXISTS user_tenant_memberships_user_lookup_idx
  ON user_tenant_memberships(user_rand_id, is_current, is_active);

