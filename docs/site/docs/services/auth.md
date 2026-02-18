---
title: Auth
---

Auth is a standalone service for login, SSO, tenant sync, and user/org management.

Key responsibilities:

- phone/password/verification-code login flows
- OAuth authorization + token endpoints
- profile and 2FA operations
- tenant SSO onboarding and org directory endpoints

Primary code roots:

- `src/auth/server.ts`
- `src/auth/routes`
- `src/auth/lib/services`
