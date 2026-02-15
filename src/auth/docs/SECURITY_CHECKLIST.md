# Auth Service Security Checklist

This checklist applies to `src/auth` and should be validated before production rollout.

## 1) Transport and Network
- [ ] Enforce HTTPS at ingress and app edge.
- [ ] Set `AUTH_COOKIE_SECURE=true` in all non-local environments.
- [ ] Set `AUTH_COOKIE_SAME_SITE=none` only when cross-site SSO is required.
- [ ] Restrict inbound traffic to auth endpoints from approved networks only.
- [ ] Keep `AUTH_ALLOWED_ORIGINS` limited to trusted origins.

## 2) Session Security
- [ ] Use strong `AUTH_SESSION_SECRET` (>=32 chars random).
- [ ] Ensure cookie is `HttpOnly`, `Secure`, and signed.
- [ ] Keep session TTL short (`AUTH_SESSION_TTL_SEC`, `AUTH_SESSION_IDLE_TTL_SEC`).
- [ ] Revoke sessions on logout and suspicious activity.
- [ ] Validate CSRF token on cookie-authenticated state-changing actions.

## 3) OAuth Security
- [ ] Require PKCE for public clients.
- [ ] Enforce tenant callback pattern (`https://<tenant-host>/auth`).
- [ ] Allow only tenant hosts present in `tenant_sso_whitelist`.
- [ ] Validate tenant SSO secret token (`tenant_name` + `tenant_sso_token`) on token exchange.
- [ ] Hash client secrets with bcrypt.
- [ ] Hash authorization codes and access tokens in storage.
- [ ] Use least-privilege scopes (`tenant.sync` only where needed).

## 4) Data Protection
- [ ] Keep users/roles/orgs in append-only version history (`is_current` + `version_no`).
- [ ] Capture actor user, actor tenant, and timestamp for each change.
- [ ] Encrypt database backups at rest.
- [ ] Restrict direct DB access to service role only.
- [ ] Rotate bootstrap credentials after first deployment.

## 5) API Hardening
- [ ] Enable rate limits for login, register, oauth routes.
- [ ] Validate input shape and field lengths.
- [ ] Block open redirects (only allow same-site `returnTo`).
- [ ] Return generic auth errors to avoid account enumeration.
- [ ] Log security events (login success/failure, token issues, sync writes).
- [ ] Restrict CORS + trusted origins to auth host and active tenant whitelist hosts.

## 6) Operational Controls
- [ ] Run `npm run migrate` before startup.
- [ ] Run dependency audits (`npm audit`, container scan).
- [ ] Monitor activity logs and alert on unusual patterns.
- [ ] Add regular secret rotation and key management policy.
- [ ] Keep disaster recovery runbook for auth outage and DB restore.
