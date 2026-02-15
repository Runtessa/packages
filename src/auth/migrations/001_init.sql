CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  rand_id VARCHAR(64) NOT NULL,
  version_no INTEGER NOT NULL CHECK (version_no > 0),
  national_id VARCHAR(96) NOT NULL,
  phone_number VARCHAR(32) NOT NULL,
  is_phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
  registered_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  first_name VARCHAR(120) NOT NULL,
  last_name VARCHAR(120) NOT NULL,
  email VARCHAR(320) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  previous_row_id BIGINT REFERENCES users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by_user_rand_id VARCHAR(64),
  changed_by_tenant_rand_id VARCHAR(64),
  change_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_rand_version_uq
  ON users(rand_id, version_no);
CREATE UNIQUE INDEX IF NOT EXISTS users_current_rand_uq
  ON users(rand_id) WHERE is_current = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS users_current_email_uq
  ON users((LOWER(email))) WHERE is_current = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS users_current_national_id_uq
  ON users(national_id) WHERE is_current = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS users_current_phone_uq
  ON users(phone_number) WHERE is_current = TRUE;
CREATE INDEX IF NOT EXISTS users_current_lookup_idx
  ON users(is_current, is_active);

CREATE TABLE IF NOT EXISTS organizations (
  id BIGSERIAL PRIMARY KEY,
  rand_id VARCHAR(64) NOT NULL,
  version_no INTEGER NOT NULL CHECK (version_no > 0),
  name VARCHAR(180) NOT NULL,
  code VARCHAR(96) NOT NULL,
  parent_org_rand_id VARCHAR(64),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  previous_row_id BIGINT REFERENCES organizations(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by_user_rand_id VARCHAR(64),
  changed_by_tenant_rand_id VARCHAR(64),
  change_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS organizations_rand_version_uq
  ON organizations(rand_id, version_no);
CREATE UNIQUE INDEX IF NOT EXISTS organizations_current_rand_uq
  ON organizations(rand_id) WHERE is_current = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS organizations_current_code_uq
  ON organizations(code) WHERE is_current = TRUE;
CREATE INDEX IF NOT EXISTS organizations_parent_lookup_idx
  ON organizations(parent_org_rand_id);

CREATE TABLE IF NOT EXISTS roles (
  id BIGSERIAL PRIMARY KEY,
  rand_id VARCHAR(64) NOT NULL,
  version_no INTEGER NOT NULL CHECK (version_no > 0),
  role_name VARCHAR(160) NOT NULL,
  role_code VARCHAR(96) NOT NULL,
  org_rand_id VARCHAR(64) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  previous_row_id BIGINT REFERENCES roles(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by_user_rand_id VARCHAR(64),
  changed_by_tenant_rand_id VARCHAR(64),
  change_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS roles_rand_version_uq
  ON roles(rand_id, version_no);
CREATE UNIQUE INDEX IF NOT EXISTS roles_current_rand_uq
  ON roles(rand_id) WHERE is_current = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS roles_org_code_current_uq
  ON roles(org_rand_id, role_code) WHERE is_current = TRUE;
CREATE INDEX IF NOT EXISTS roles_org_lookup_idx
  ON roles(org_rand_id, is_current);

CREATE TABLE IF NOT EXISTS user_roles (
  id BIGSERIAL PRIMARY KEY,
  rand_id VARCHAR(64) NOT NULL,
  version_no INTEGER NOT NULL CHECK (version_no > 0),
  user_rand_id VARCHAR(64) NOT NULL,
  role_rand_id VARCHAR(64) NOT NULL,
  org_rand_id VARCHAR(64) NOT NULL,
  is_assignment_active BOOLEAN NOT NULL DEFAULT TRUE,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  previous_row_id BIGINT REFERENCES user_roles(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by_user_rand_id VARCHAR(64),
  changed_by_tenant_rand_id VARCHAR(64),
  change_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_roles_rand_version_uq
  ON user_roles(rand_id, version_no);
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_current_rand_uq
  ON user_roles(rand_id) WHERE is_current = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_current_pair_uq
  ON user_roles(user_rand_id, role_rand_id, org_rand_id) WHERE is_current = TRUE;
CREATE INDEX IF NOT EXISTS user_roles_user_lookup_idx
  ON user_roles(user_rand_id, is_current, is_assignment_active);

CREATE TABLE IF NOT EXISTS user_orgs (
  id BIGSERIAL PRIMARY KEY,
  rand_id VARCHAR(64) NOT NULL,
  version_no INTEGER NOT NULL CHECK (version_no > 0),
  user_rand_id VARCHAR(64) NOT NULL,
  org_rand_id VARCHAR(64) NOT NULL,
  is_assignment_active BOOLEAN NOT NULL DEFAULT TRUE,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  previous_row_id BIGINT REFERENCES user_orgs(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by_user_rand_id VARCHAR(64),
  changed_by_tenant_rand_id VARCHAR(64),
  change_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_orgs_rand_version_uq
  ON user_orgs(rand_id, version_no);
CREATE UNIQUE INDEX IF NOT EXISTS user_orgs_current_rand_uq
  ON user_orgs(rand_id) WHERE is_current = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS user_orgs_current_pair_uq
  ON user_orgs(user_rand_id, org_rand_id) WHERE is_current = TRUE;
CREATE INDEX IF NOT EXISTS user_orgs_user_lookup_idx
  ON user_orgs(user_rand_id, is_current, is_assignment_active);

CREATE TABLE IF NOT EXISTS oauth_clients (
  id BIGSERIAL PRIMARY KEY,
  rand_id VARCHAR(64) NOT NULL UNIQUE,
  client_id VARCHAR(120) NOT NULL UNIQUE,
  client_secret_hash VARCHAR(255) NOT NULL,
  tenant_rand_id VARCHAR(64) NOT NULL,
  name VARCHAR(180) NOT NULL,
  allowed_redirect_uris TEXT[] NOT NULL,
  allowed_scopes TEXT[] NOT NULL,
  require_pkce BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS oauth_clients_tenant_idx
  ON oauth_clients(tenant_rand_id, is_active);

CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
  id BIGSERIAL PRIMARY KEY,
  code_hash VARCHAR(128) NOT NULL UNIQUE,
  client_id VARCHAR(120) NOT NULL,
  tenant_rand_id VARCHAR(64) NOT NULL,
  user_rand_id VARCHAR(64) NOT NULL,
  redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL,
  code_challenge TEXT,
  code_challenge_method VARCHAR(12),
  state TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS oauth_code_client_user_idx
  ON oauth_authorization_codes(client_id, user_rand_id, expires_at);

CREATE TABLE IF NOT EXISTS oauth_access_tokens (
  id BIGSERIAL PRIMARY KEY,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  client_id VARCHAR(120) NOT NULL,
  tenant_rand_id VARCHAR(64) NOT NULL,
  user_rand_id VARCHAR(64),
  scope TEXT NOT NULL,
  grant_type VARCHAR(40) NOT NULL,
  ip_address INET,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS oauth_access_tokens_lookup_idx
  ON oauth_access_tokens(client_id, user_rand_id, expires_at, revoked_at);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id BIGSERIAL PRIMARY KEY,
  rand_id VARCHAR(64) NOT NULL UNIQUE,
  session_token_hash VARCHAR(128) NOT NULL UNIQUE,
  user_rand_id VARCHAR(64) NOT NULL,
  tenant_rand_id VARCHAR(64),
  csrf_token VARCHAR(128) NOT NULL,
  ip_address INET,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  idle_expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS auth_sessions_user_idx
  ON auth_sessions(user_rand_id, expires_at, revoked_at);

CREATE TABLE IF NOT EXISTS activity (
  id BIGSERIAL PRIMARY KEY,
  rand_id VARCHAR(64) NOT NULL UNIQUE,
  event_type VARCHAR(96) NOT NULL,
  actor_user_rand_id VARCHAR(64),
  actor_tenant_rand_id VARCHAR(64),
  target_type VARCHAR(64),
  target_rand_id VARCHAR(64),
  oauth_client_id VARCHAR(120),
  ip_address INET,
  user_agent TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS activity_created_idx
  ON activity(created_at DESC);
CREATE INDEX IF NOT EXISTS activity_actor_idx
  ON activity(actor_user_rand_id, actor_tenant_rand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_event_idx
  ON activity(event_type, created_at DESC);
