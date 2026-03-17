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
  - `client/src/pharmacy-portal/` — pharmacy portal UI
  - `client/src/broker-portal/` — broker portal UI
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

- **Auth:** JWT-based with magic link login. Roles: SUPER_ADMIN, ADMIN, COMPANY_ADMIN, DISPATCH, DRIVER, VIEWER, CLINIC_ADMIN, CLINIC_USER, CLINIC_VIEWER, BROKER_ADMIN, BROKER_USER, PHARMACY_ADMIN, PHARMACY_USER
- **Multi-tenancy:** Hard tenant enforcement via `tenantGuard` middleware and `requireCompanyScope`/`requireTenantScope` middleware. City-scoped data segregation.
- **Trip lifecycle:** Deterministic state machine in `shared/tripStateMachine.ts`. All status transitions go through `transitionTripStatus()`.
- **Process modes:** `RUN_MODE` env var controls `api` / `worker` / `all` split. Workers run background schedulers without HTTP.
- **Realtime:** WebSocket server (`server/lib/realtime.ts`) + Supabase Realtime for live tracking
- **Caching:** Upstash Redis for distributed cache, job queue, rate limiting, leader election
- **Database:** PostgreSQL via Supabase. Drizzle ORM for queries. Boot-time migrations in `server/index.ts`.

### External Services

PostgreSQL (Supabase), Google Maps Platform, Twilio (SMS), Resend (email), Stripe (payments), Upstash Redis, Firebase Cloud Messaging (push notifications)

### Deployment

Railway (primary), with Fly.io and Render as alternatives. API + Worker process separation via `RUN_MODE` env var. Railway configs: `railway.toml` (API, 2 replicas HA), `railway.worker.toml` (Worker). Health checks at `/api/health/live` (liveness) and `/api/health/ready` (readiness). Production builds to `dist/`.

## Important Conventions

- **Do not modify `shared/permissions.ts` without explicit instruction** — this is a critical RBAC file
- Tests live in `server/tests/` and `shared/` (vitest, node environment)
- Route files follow the pattern `server/routes/*.routes.ts` with `register*Routes()` functions
- The schema in `shared/schema.ts` uses Drizzle ORM with `drizzle-zod` for validation
- DB connection requires `SUPABASE_DB_URL` or `DATABASE_URL` pointing to a Supabase instance

## Current State (as of 2026-03-17)

### Recently Completed
- Railway deployment with API/Worker separation (2 replicas HA) — deployed to `admin.unitedcaremobility.com`
- Health check fixes: `/api/health/live` before middleware, worker mode minimal HTTP server
- Healthcheck timeout increased to 120s (API) / 300s (Worker) to handle boot with DB migrations
- Dispatch subdomain routing (`dispatch.*` restricts to dispatch/admin roles)
- **MFA engine** — TOTP (Google Authenticator), SMS/Email OTP, backup codes, account lockout (`server/lib/mfaEngine.ts`)
- **Pharmacy portal** — full CRUD: orders, tracking, notifications, metrics (`client/src/pharmacy-portal/`, `server/controllers/pharmacy-portal.controller.ts`)
- **Broker portal** — dashboard, contracts, settlements, trip requests, marketplace (`client/src/broker-portal/`, `server/controllers/broker-portal.controller.ts`)
- **Broker API v1** — external API with HMAC auth for broker integrations (`server/routes/broker-api-v1.routes.ts`, `server/lib/brokerApiAuth.ts`)
- **EDI billing** — 837 claim generation + 835 remittance parsing (`server/lib/edi837Engine.ts`, `server/lib/edi835Parser.ts`)
- **Medicaid billing engine** — full Medicaid claim lifecycle (`server/lib/medicaidBillingEngine.ts`)
- **Fraud detection engine** — anomaly scoring for trips/billing (`server/lib/fraudDetectionEngine.ts`)
- **Billing automation** — auto-invoicing, dunning emails, reconciliation, subscription tiers (`server/services/`)
- **Driver app v4 redesign** — real route maps, navigation, proof of delivery (photo + signature)
- **HIPAA compliance** — PHI encryption (`server/lib/phiEncryption.ts`), audit middleware (`server/middleware/phiAudit.ts`)
- **Security hardening** — httpOnly JWT cookies, CSRF double-submit, input sanitizer, rate limiter, SUPER_ADMIN impersonation audit
- **i18n** — Spanish translations across all pages, clinic/pharmacy/broker/driver portals
- **New engines** — SLA metrics, demand prediction, multi-stop optimizer, inter-city transfers, smart cancellation, cascade delays, trip grouping, dead mile tracking, patient ratings, SMS confirmation
- **Mobile** — App Store readiness (account deletion, offline fallback, ATT, Capacitor configs)
- **9 new UI pages** — AI dashboard, EDI billing, Medicaid billing, marketplace, ratings, reconciliation, city comparison, inter-city, dead mile, cascade alerts, smart cancel, trip groups

### Required Environment Variables (Production)
- `JWT_SECRET` — signing key for access tokens (required, app exits without it)
- `JWT_REFRESH_SECRET` — signing key for refresh tokens (falls back to `JWT_SECRET + "-refresh"` if missing)
- `SUPABASE_DB_URL` or `DATABASE_URL` — PostgreSQL connection (must contain "supabase" in hostname)
- `PHI_ENCRYPTION_KEY` — AES key for HIPAA PHI encryption
- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` — Redis for rate limiter, job queue, leader election
- `SENTRY_DSN` — (optional) error tracking
- `GOOGLE_MAPS_API_KEY` — maps and geocoding
- `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_PHONE_NUMBER` — SMS notifications
- `RESEND_API_KEY` — email sending
- `STRIPE_SECRET_KEY` — payments
- `FCM_SERVICE_ACCOUNT` — Firebase push notifications

### Known Issues / Technical Debt
- TypeScript errors may exist — run `npm run check` to verify
- Some new engines (fraud detection, demand prediction, AI routes) have placeholder/mock logic that needs real ML integration
- Broker API v1 webhook engine (`server/lib/brokerWebhookEngine.ts`) needs production webhook URLs configured
- `shared/permissions.ts` was modified to add broker/pharmacy roles — verify RBAC matrix is correct
- esbuild `define` replaces `process.env.NODE_ENV` at build time — be aware that `IS_PROD` checks are compile-time constants in the bundle

### Suggested Next Steps
- Run full test suite (`npx vitest run`) and fix any failures
- Run `npm run check` and resolve TypeScript errors
- Real ML model integration for fraud detection and demand prediction
- E2E tests for pharmacy portal, broker portal, and driver app v4
- Stripe integration for broker settlements and pharmacy billing
- Push notification testing (FCM) for pharmacy order updates
