---
title: Core Runtime
---

Core provides tenant execution and adapter orchestration.

Key responsibilities:

- dispatching module handlers
- enforcing ACL and policy checks
- adapter factory and connection resolution
- SSO session bridge with auth service

Primary code roots:

- `src/core/server.ts`
- `src/core/app`
- `src/core/engine`
