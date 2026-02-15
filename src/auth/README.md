# IDP Auth Service (`src/auth`)

Standalone authentication + SSO service built with:
- Next.js UI (`/login`, `/register`, `/profile`)
- Custom secure Express server (`server.ts`)
- TypeORM + PostgreSQL
- OAuth 2.0 authorization code flow for tenant SSO
- Versioned append-only records for identity/access data

## Features
- Cookie session auth (no JWT in browser storage)
- Shared cookie domain support across auth host + tenant host (computed parent domain or `AUTH_COOKIE_DOMAIN`)
- OAuth endpoints: `/oauth/authorize`, `/oauth/token`, `/oauth/userinfo`
- Standard tenant callback pattern: `https://<tenant-host>/auth`
- Per-tenant SSO token validation on `/oauth/token` (`tenant_name` + `tenant_sso_token`)
- Tenant sync endpoint with history: `/api/tenant-sync/upsert`
- Session heartbeat renewal endpoint for tenant/kernel pages: `POST /api/session/renew`
- Auth admin tenant whitelist panel: `/admin/tenants`
- Versioned entities:
  - `users`
  - `roles`
  - `organizations`
  - `user_roles`
  - `user_orgs`
- Tenant whitelist entity:
  - `tenant_sso_whitelist`
- Activity logs for auth, oauth, and change operations
- Tenant data is **not** a source-of-truth table in auth DB; tenant policy is resolved via:
  - remote tenant policy endpoint (`AUTH_TENANT_POLICY_URL`), or
  - `oauth_clients.meta` fallback cache.

## Setup
1. Copy `.env.example` to `.env` and configure secrets + database URL.
2. Install deps:
   ```bash
   npm --prefix src/auth install
   ```
3. Run migrations:
   ```bash
   npm --prefix src/auth run migrate
   ```
4. Seed default tenant/client/admin:
   ```bash
   npm --prefix src/auth run seed
   ```
   Seeding now also creates the tenant whitelist entry, prints the tenant SSO token, and marks bootstrap admin with `meta.authAdmin=true`.
   You can also auto-bootstrap on service startup with `AUTH_BOOTSTRAP_ON_START=true` (enabled by default in development).
5. Run dev server:
   ```bash
   npm --prefix src/auth run dev
   ```

## Tenant/Kernal SSO Renewal Contract
For tenant pages (including kernel runtime), renew auth sessions while page is active:
1. Call `GET /api/session` with `credentials: 'include'`.
2. If authenticated, take `csrfToken`.
3. Call `POST /api/session/renew` with:
   - `credentials: 'include'`
   - header `X-CSRF-Token: <csrfToken>`
4. Repeat on focus + interval (for example every 5 minutes).

## Security
Security baseline checklist: `src/auth/docs/SECURITY_CHECKLIST.md`
