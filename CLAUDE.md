# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

United Care Mobility (UCM) — a multi-tenant Medical Transportation Management System for non-emergency medical transport (NEMT). Manages fleets, drivers, patients, trips, clinics, billing, and dispatch across multiple cities.

## Commands

- **Dev server:** `npm run dev` (starts Express + Vite on port 5000)
- **Build:** `npm run build` (runs `tsx script/build.ts`)
- **Type check:** `npm run check` (runs `tsc`)
- **DB push:** `npm run db:push` (runs `drizzle-kit push`)
- **Run all tests:** `npx vitest run`
- **Run single test:** `npx vitest run server/tests/reassign.test.ts`
- **Production start:** `npm start`

## Architecture

### Monorepo Structure (single package.json)

- **`client/`** — React SPA (Vite, wouter router, TanStack Query, shadcn/ui + Radix, Tailwind CSS, Zustand)
  - `client/src/pages/` — page components
  - `client/src/components/ui/` — shadcn/ui primitives
  - `client/src/lib/` — utilities, API client, auth
  - `client/src/driver-v4/` — dedicated driver app UI
  - `client/src/clinic-portal/` — clinic portal UI
  - `client/src/i18n/` — i18next internationalization
- **`server/`** — Express 5 API server (Node 20, TypeScript)
  - `server/index.ts` — app entry point, middleware, boot sequence with inline schema migrations
  - `server/routes/` — route registration files (`*.routes.ts`)
  - `server/controllers/` — request handlers
  - `server/lib/` — business logic engines, background jobs, integrations
  - `server/services/` — billing, invoicing, platform fee services
  - `server/middleware/` — tenant scoping, city context, subscription checks
  - `server/auth.ts` — JWT + session auth middleware
  - `server/db.ts` — pg Pool + Drizzle ORM connection (Supabase-only)
  - `server/seed.ts` — seed data on boot
- **`shared/`** — Code shared between client and server
  - `shared/schema.ts` — Drizzle ORM schema (PostgreSQL), single source of truth for DB tables
  - `shared/permissions.ts` — RBAC permission matrix (`ROLE_PERMISSIONS`)
  - `shared/tripStateMachine.ts` — deterministic trip status state machine
- **`migrations/`** — Drizzle Kit migration output
- **`mobile-driver/`, `mobile-clinic/`, `mobile-admin/`** — Capacitor wrappers for iOS/Android apps

### Path Aliases

- `@/*` → `client/src/*`
- `@shared/*` → `shared/*`
- `@assets` → `attached_assets/`

### Key Patterns

- **Auth:** JWT-based with magic link login. Roles: SUPER_ADMIN, ADMIN, COMPANY_ADMIN, DISPATCH, DRIVER, VIEWER, CLINIC_ADMIN, CLINIC_USER, CLINIC_VIEWER
- **Multi-tenancy:** Hard tenant enforcement via `tenantGuard` middleware and `requireCompanyScope`/`requireTenantScope` middleware. City-scoped data segregation.
- **Trip lifecycle:** Deterministic state machine in `shared/tripStateMachine.ts`. All status transitions go through `transitionTripStatus()`.
- **Process modes:** `RUN_MODE` env var controls `api` / `worker` / `all` split. Workers run background schedulers without HTTP.
- **Realtime:** WebSocket server (`server/lib/realtime.ts`) + Supabase Realtime for live tracking
- **Caching:** Upstash Redis for distributed cache, job queue, rate limiting, leader election
- **Database:** PostgreSQL via Supabase. Drizzle ORM for queries. Boot-time migrations in `server/index.ts`.

### External Services

PostgreSQL (Supabase), Google Maps Platform, Twilio (SMS), Resend (email), Stripe (payments), Upstash Redis, Firebase Cloud Messaging (push notifications)

### Deployment

Dockerfile (Node 20 Alpine), fly.toml (Fly.io, region `iad`), render.yaml. Production builds to `dist/`.

## Important Conventions

- **Do not modify `shared/permissions.ts` without explicit instruction** — this is a critical RBAC file
- Tests live in `server/tests/` and `shared/` (vitest, node environment)
- Route files follow the pattern `server/routes/*.routes.ts` with `register*Routes()` functions
- The schema in `shared/schema.ts` uses Drizzle ORM with `drizzle-zod` for validation
- DB connection requires `SUPABASE_DB_URL` or `DATABASE_URL` pointing to a Supabase instance
