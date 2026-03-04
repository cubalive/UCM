# United Care Mobility (UCM)

## Overview
United Care Mobility (UCM) is a Medical Transportation Management System designed to streamline non-emergency medical transportation services across multiple cities. It aims to enhance operational efficiency, improve patient care coordination, and optimize resource allocation. The system provides a comprehensive solution for managing fleets, patients, and trips, featuring a robust dispatch engine. The project's ambition is to become a leading platform for non-emergency medical transport providers, enabling seamless, reliable, and compliant service delivery.

## User Preferences
I prefer iterative development with a focus on clear, modular code. I appreciate detailed explanations for complex architectural decisions and new feature implementations. Please ask before making any major changes to the core structure or public-facing APIs. I prefer that the agent does not make changes to the `shared/permissions.ts` file without explicit instruction.

## System Architecture
The application follows a client-server architecture.

**UI/UX Decisions:**
- **Frontend**: Built with React, Vite, Tailwind CSS, and shadcn/ui, emphasizing clarity and ease of use.
- **Live Maps**: Uber-like map views for drivers and live tracking for clinics.
- **Admin Dashboards**: Comprehensive dashboards for operational oversight, financial metrics, and automation health.

**Technical Implementations & Feature Specifications:**
- **Authentication & Authorization**: JWT-based with Magic Link Login, dual-auth, and centralized Permission-Based Access Control using a `ROLE_PERMISSIONS` matrix for clinic-scoped roles.
- **Data Management**: PostgreSQL with Drizzle ORM, supporting multi-city data segregation, public IDs, and US States/Cities master reference tables.
- **Dispatch Engine**: Automated driver-vehicle and trip assignment, real-time tracking, ETA, and safety rule enforcement, utilizing a deterministic state machine for trip status transitions.
- **Communication**: SMS notifications and branded email services with automated patient communication and configurable geofencing.
- **Location Services**: Google Maps integration for geocoding, autocomplete, ETA, route optimization, and live maps. Server-side geofence gating for driver status transitions.
- **Realtime & Performance**: WebSocket server, Supabase Realtime, Upstash Redis for caching, rate-limited data ingestion, and ETA throttling. Includes a centralized `transitionTripStatus()` helper for consistent state changes and instant dispatch board updates.
- **Enterprise Multi-Tenant & Async Engine**: Hard multi-tenant enforcement, Redis-backed background job queue, idempotency, company quotas, and system event streams. Distributed job engine with Redis-backed scheduler and locks.
- **Financial & Billing**: Configurable platform pricing, automatic invoice emailing, Stripe integration, and a financial engine for double-entry ledger creation, detailed financial breakdowns, and payout reconciliation.
- **Payroll**: Per-company payroll settings, idempotent earnings ledger, payrun management with Stripe transfers, and an Earnings Modifiers Engine (Daily Minimum Guarantee, On-Time Bonus, No-Show Penalty).
- **Driver & Clinic Portals**: Dedicated portals for clinics and drivers, including a Driver App with background GPS, push notifications, and feature flags. Clinic Portal features an Arrival Radar and Smart Staff Alerts.
- **UCM Intelligence Core**: Integrates daily/weekly metrics, TRI scores, cost leak alerts, certifications, and a Driver Intelligence Engine for performance scoring and anomaly detection.
- **Enterprise Multi-Instance Hardening**: ROLE_MODE runtime split, Redis-based leader election, priority job queue with DLQ, circuit breakers, and priority-based load shedding.
- **Agentic Features (UCM Agentic C)**: Redis Streams event bus with orchestrator and route worker for computing and finalizing Google Maps routes, including route proof API.
- **Dispatch Window Engine**: Intelligent dispatch timing system for optimal dispatch and notification times based on ETA and mobility buffers, including trip feasibility checking to prevent overlapping assignments.
- **"Approved = Assigned" Auto-Dispatch**: Automatic driver assignment on trip approval via `assignTripAutomatically()` with preferred driver priority (patient-preferred 1000pt > trip-preferred 500pt > clinic affinity 200pt > scored best), clinic affinity scoring (3+ completed trips in 60-day window), feasibility-gated assignment, and periodic retry scheduler (5min cycles for FAILED/PENDING trips). Reason tracking: preferred_driver, trip_preferred_driver, high_clinic_affinity, scored_best.
- **Round-Trip Enforcement**: `is_round_trip`, `return_required`, `return_note`, `paired_trip_id` columns on trips. Approval of round-trip requests enforces either a return pickup time (creates paired return trip with swapped addresses) or a return note explaining deferral.
- **ETA & Dispatch Window on Assignment**: `computeEtaAndDispatchWindow()` runs after successful auto-assign, computing `eta_driver_to_pickup_min`, `service_buffer_min`, `dispatch_at`, `notify_at`, `eta_pickup_to_dropoff_min`, and `planned_dropoff_arrival_at`.
- **Enhanced Driver Dispatch UX**: Real-time driver WebSocket channel (`subscribe_driver`/`broadcastToDriver()`) for dispatch_notify, dispatch_now, tracking_stale, tracking_restored events. Driver portal features: Upcoming Reservations list (ASSIGNED trips before dispatch_at), dispatch notification banner with countdown, auto-switch to active trip on dispatch_now, and tracking stale alert banner. Tracking health scheduler (30s cycles) detects GPS >60s stale, sets tracking_status='STALE', auto-recovers on fresh ping. Location ingest clears STALE status on fresh GPS receipt.

- **Multi-Subdomain Architecture**: Centralized API at `app.unitedcaremobility.com` with `VITE_API_BASE_URL` env var and `API_BASE_URL`/`resolveUrl()`/`getWsUrl()` in `client/src/lib/api.ts`. All client-side `fetch()` and WebSocket calls route through these helpers for cross-subdomain support. Subdomains: `app` (API+admin), `clinic`, `driver`, `dispatch`, `admin`. CORS allows all UCM subdomains via `BUILTIN_APP_ORIGINS` in `server/index.ts`. System diagnostic endpoints: `/api/system/origins`, `/api/system/auth-health`, `/api/boot`.
- **Production Stability & Deployment**: `RUN_MODE` env var (`api`/`worker`/`all`) controls process split — `api` runs HTTP server only (no schedulers/orchestrator/route-worker), `worker` runs background jobs only (no HTTP server, no WebSocket, no Express routes), `all` runs everything (default for development). Optimistic concurrency control on trip status updates prevents race conditions. Golden contract test suite (`shared/goldenContract.test.ts`) validates driver buttons, trip lifecycle, clinic categorization, and state machine integrity (<1s runtime). Deployment configs: `Dockerfile` (multi-stage), `fly.toml`, `render.yaml` with health check at `/api/boot`.

## Deployment Configuration (Two-Deployment Split)

### API Deployment (public HTTP)
- **Purpose**: Serves all HTTP routes, WebSocket, static frontend, all API endpoints
- **RUN_MODE**: `api`
- **Behavior**: Express server + WebSocket + Vite/static. NO schedulers, NO orchestrator, NO route worker
- **Health check**: `GET /api/boot` returns `{ roleMode: "server", ... }`
- **Boot log**: `{"event":"boot_complete","roleMode":"server","httpServer":"active","websocket":"active","schedulers":[]}`
- **Domains**: app.unitedcaremobility.com, clinic.unitedcaremobility.com, driver.unitedcaremobility.com, dispatch.unitedcaremobility.com, admin.unitedcaremobility.com

### Worker Deployment (background only)
- **Purpose**: Runs all schedulers, orchestrator, route worker, job engine, leader election
- **RUN_MODE**: `worker`
- **Behavior**: DB init + schema migrations + scheduler loops. NO HTTP listener, NO WebSocket, NO Express routes
- **Health indicator**: JSON heartbeat every 60s: `{"event":"worker_heartbeat","roleMode":"worker","uptimeSeconds":...}`
- **Boot log**: `{"event":"boot_complete","roleMode":"worker","httpServer":"disabled","websocket":"disabled","schedulers":[...]}`
- **No public domains needed**

### Required Env Vars for Both Deployments
- `DATABASE_URL` or `SUPABASE_DB_URL` — database connection
- `JWT_SECRET` — auth token signing
- `SESSION_SECRET` — session encryption
- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` — Redis for leader election, caching, event bus
- `RUN_MODE` — `api` for API deployment, `worker` for worker deployment
- `NODE_ENV` — `production`

### Additional API-only Env Vars
- `GOOGLE_MAPS_API_KEY` — maps/geocoding
- `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_FROM_NUMBER` — SMS
- `STRIPE_SECRET_KEY` — payments
- `SUPABASE_URL` + `SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY` — Supabase auth

### Worker-specific Env Vars
- `UCM_AGENTIC_ROUTES=1` — enables orchestrator + route worker (optional, requires Redis)
- `LEADER_ELECTION=true` — enables Redis-based leader election for multi-instance safety (default: auto based on Redis availability)

## Mobile App (iOS/Android - Capacitor)
- **Bundle ID**: `com.unitedcaremobility.driver`
- **App Name**: UCM Driver
- **Root Capacitor Config**: `capacitor.config.ts` (production-oriented, locked to `driver.unitedcaremobility.com`)
- **Mobile-Driver Wrapper**: `mobile-driver/` — standalone Capacitor project with background GPS (`@capacitor-community/background-geolocation`), push notifications, and native platform configs
- **iOS Config**: `ios/App/App/Info.plist` — CFBundleShortVersionString=1.0.0, CFBundleVersion=1, background modes (location, fetch, processing, remote-notification), location permission rationale strings, `ITSAppUsesNonExemptEncryption=false`
- **Android Config**: `android/app/src/main/AndroidManifest.xml` — FINE_LOCATION, FOREGROUND_SERVICE, FOREGROUND_SERVICE_LOCATION permissions
- **Universal Links**: Dynamic AASA served per subdomain via `server/config/apps.ts` (Team ID: HVF2V75J4T). `/.well-known/apple-app-site-association` returns hostname-specific appID (driver/clinic/admin). Android App Links via `client/public/.well-known/assetlinks.json`.
- **Central App Config**: `server/config/apps.ts` — single source of truth for TEAM_ID, APP_DOMAINS, APP_BUNDLES, `getRedirectBaseUrlForRole()`, `getAASA()`. All auth link generation uses this.
- **Release Readiness**: `GET /api/system/release-readiness` (SUPER_ADMIN) — env presence, AASA URLs, auth redirect mapping, build info. `POST /api/system/release-readiness/smoke-test` (SUPER_ADMIN) — validates AASA, Supabase, Redis, Maps key.
- **Service Worker Guard**: Service worker registration skipped on Capacitor native platform (`isCapacitorNative` check in `main.tsx`) to avoid WKWebView caching conflicts
- **Offline Detection**: `client/src/components/network-status.tsx` — full-screen offline overlay with retry, auto-dismiss on reconnect
- **Version Checker**: `client/src/components/version-checker.tsx` — polls `/version.json` every 5 min, auto-reloads on version change (skipped for "dev" builds)
- **Legal Pages**: `/privacy` (privacy-policy.tsx) and `/terms` (terms-of-service.tsx) — public routes accessible without auth, linked from login page and driver profile
- **Error Boundary**: `AppErrorBoundary` in App.tsx with Reload + Report Issue buttons (mailto:support@unitedcaremobility.com)

## External Dependencies
- **PostgreSQL**: Primary relational database (Supabase pooler).
- **Supabase**: User authentication, city management, Row-Level Security (RLS).
- **Google Maps Platform**: Maps JavaScript API, Directions API, Geocoding API, Places API.
- **Twilio**: SMS messaging.
- **Resend**: Transactional email delivery.
- **Stripe**: Payment processing, subscriptions, and financial integrations.
- **Upstash Redis**: Distributed cache and message broker.
- **Firebase Cloud Messaging**: Push notifications.