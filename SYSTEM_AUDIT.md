# System Audit (Current State)

## Stable / Working
- **Core runtime routing**: tenant-aware request dispatch, module lookup, shared backend lookup.
- **Auth endpoints**: `/auth/login`, `/auth/register` (respect `tenant.allowRegistration`).
- **Tenant-scoped ACL JSON**: permissions / roles / endpoints stored on tenant; enforced in Dispatcher.
- **Published module caching**: published modules cached by tenant + method.
- **UI entity registry**: tenant UI packages + shared UI packages served via registry.
- **Kernel preview**: bundle serving via `/public/bundle.js` and `preview.html`.
- **Model save triggers migration**: editor saves models and triggers `/api/models/migrate` automatically.

## Partially Working / Needs Verification
- **ORM models + migrations**: loader hardened, but still requires validation in dev to confirm entity discovery and external require stability in Next API runtime.
- **Monaco language services**: worker paths + extra libs configured; requires verification in-browser that JS/JSX + adapters + typeorm typings resolve.
- **Shared backends ACL**: shared endpoints use tenant ACL; missing endpoints are auto-registered on first request (deny by default).
- **Login UI override**: `@app/login` used when published; fallback login shell otherwise. (Need to verify per-tenant UI override end-to-end.)

## Missing / Known Gaps
- **Model migration UX**: limited visibility into migration status/errors beyond toast; no detailed report.
- **Global system status dashboard**: no single UI for health/feature readiness.
- **IDE modal-heavy flows**: some create/edit actions still modal-only (modules/ui/shared).
- **Model builder CLI**: intentionally removed; only auto-migrate on save.

## Test Checklist (Quick Pass)
1. **Login flow**
   - `/login` on tenant host loads published `@app/login` when available.
   - Allow registration toggle works (403 when disabled).
2. **ACL enforcement**
   - Deny access when endpoint permission missing.
   - Allow anonymous when `allowAnonymous: true`.
   - Shared backend route respects tenant ACL.
3. **Monaco typings**
   - `IdpModuleHandler` provides `req`/`adapters` intellisense in JS modules.
   - `typeorm` decorators resolve in model files.
4. **ORM migration**
   - Create a JS model with decorators.
   - Save model triggers migration and creates table.
   - Migration error surfaces with clear message.
5. **Shared packages**
   - Shared UI package builds and loads in tenant UI.
   - Shared backend endpoint executes and returns data.

