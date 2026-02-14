# ADA Idp Dashboard & API

Next.js control panel and API for managing users, session tokens, and audit logs.

## Stack
- Next.js (pages router), React, TypeScript, Tailwind
- Postgres for users and login sessions
- Redis for session caching

## Getting Started
1) Install deps: `npm install`  
2) Copy env: `cp .env.example .env` (update database URL and admin credentials)  
3) Run dev server: `npm run dev` (Next on http://localhost:3000)

## Scripts
- `npm run dev` — start Next.js in dev mode
- `npm run build` — production build
- `npm start` — serve built app
- `npm run type-check` — TypeScript checks

## Project Structure
- `src/pages` — API routes and UI pages (login, dashboard, docs, admin/users)
- `src/layouts` — app shell, header layout
- `src/components` — dashboard, layout, and UI primitives
- `src/lib` — database, auth, client helpers
- `src/styles` — global Tailwind styles

Path aliases: `@/*` points to `src/*` (configured in `tsconfig.json`).

## Notes
- Admin credentials and API tokens are driven by environment variables; update `.env` before first run.
- Session tokens are cached in Redis for quicker auth checks.
