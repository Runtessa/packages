# System Architecture

## Overview
IdpCore is a multi-tenant platform that serves:
- **Backend runtime** (Express + TypeORM) for tenant APIs and module execution.
- **IDE** (Next.js) for admin, tenants, editor, shared packages, logs.
- **Kernel** for bundling and previewing UI entities.
- **Shared entities** package for consistent data models across backend + IDE.

---

## Repository Layout

```
/home/adadrass/Projects/IdpCore
├─ src/                     # Express backend + runtime execution
├─ ideNew/                  # Next.js IDE (admin + editor)
├─ kernel/                  # UI entity bundler / runtime kernel
├─ packages/shared/         # Shared entities package (@idp/shared)
├─ public/                  # Built kernel bundle + preview HTML
├─ dist/                    # Compiled backend output
```

---

## Core Runtime (src/)

### Entry
- `src/server.ts` boots Express, wires middleware, serves IDE build, and hands runtime requests to the dispatcher.

### Main Layers

1. **HTTP Layer**
   - Routes under `/api` handled by controllers
   - `/admin` and `/auth` endpoints
   - Non-API requests serve IDE from `/public`

2. **Tenancy + Auth**
   - `ContextMiddleware` resolves tenant by hostname
   - `AuthGuard` attaches account info from session token

3. **Module Execution**
   - `Dispatcher` resolves tenant modules by route + method
   - Executes code in `SandboxRunner` using adapters

4. **Data Layer**
   - `AppDataSource` (TypeORM) configured in `src/core/datasource.ts`
   - Entities imported from `@idp/shared`

---

## IDE (ideNew/)

### What it is
Next.js admin panel + code editor, responsible for:
- Tenant management
- UI Entities and Backend Modules editing
- Shared packages
- Logs viewer
- ACL management

### Structure
- `ideNew/src/pages/` → UI pages + API routes
- `ideNew/src/lib/` → DB access, auth helpers, utilities
- `ideNew/src/components/` → UI and editor components

### Editor
Monaco-based editor:
- Supports split view, diff, history, search, preview
- Maintains draft vs published versions

---

## Kernel (kernel/)

### Purpose
Builds the runtime bundle used to render UI entities in preview mode.

### Output
Kernel bundle is served from `/public/bundle.js` and embedded in `preview.html`.

---

## Shared Entities (packages/shared)

### Package
`@idp/shared`

### Use
Both backend and IDE import the same TypeORM entities:

```ts
import { Tenant, ModuleEntity } from '@idp/shared';
```

Next.js is configured to transpile the package and uses type-only imports where needed.

---

## Key Data Models

- **Tenant**: top-level tenant record
- **Account**: tenant scoped user (developer/admin)
- **ModuleEntity**: backend modules (route + method + code)
- **UIPackage**: UI entity code package
- **GlobalUIPackage**: shared frontend project
- **SystemLog**: logs for admin

---

## Runtime Flow (Request Path)

1. HTTP request arrives → `server.ts`
2. Tenant resolved → `ContextMiddleware`
3. Auth resolved → `AuthGuard`
4. If `/api` → controller logic
5. If runtime endpoint → `Dispatcher` loads module
6. Module executes in sandbox with adapters
7. Response returned to client

---

## Adapter Layer

Adapters provided by `AdapterFactory`:
- Postgres, MySQL, MSSQL
- Redis, Kafka, S3
- HTTP client
- Compiler adapter for UI build

Adapters are tenant-scoped and controlled via encrypted secrets.

---

## Build & Deploy

### Backend
```
npm run build
npm start
```

### IDE
```
cd ideNew
npm run dev
```

### Shared Entities
```
npm run build:shared
```

---

## Notes

- All tenants are isolated by hostname.
- Modules and UI entities have draft + published versions.
- Shared packages allow reuse across tenants.
- System logs are visible in IDE under `/admin/logs`.
