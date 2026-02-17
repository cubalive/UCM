# United Care Mobility (UCM)

## Overview
United Care Mobility (UCM) is a Medical Transportation Management System designed to streamline non-emergency medical transportation services across multiple cities. It aims to enhance operational efficiency, improve patient care coordination, and optimize resource allocation. The system provides a comprehensive solution for managing fleets, patients, and trips, featuring a robust dispatch engine. The project's ambition is to become a leading platform for non-emergency medical transport providers, enabling seamless, reliable, and compliant service delivery.

## User Preferences
I prefer iterative development with a focus on clear, modular code. I appreciate detailed explanations for complex architectural decisions and new feature implementations. Please ask before making any major changes to the core structure or public-facing APIs. I prefer that the agent does not make changes to the `shared/permissions.ts` file without explicit instruction.

## System Architecture
The application follows a client-server architecture.

**UI/UX Decisions:**
- **Frontend**: Built with React, Vite, Tailwind CSS, and shadcn/ui.
- **Color Scheme**: Emphasizes clarity and ease of use.
- **Live Maps**: Uber-like map views for drivers and live tracking for clinics.
- **Admin Dashboards**: Comprehensive dashboards for operational oversight, financial metrics, and automation health.

**Technical Implementations & Feature Specifications:**
- **Authentication**: JWT-based with `bcryptjs` and Magic Link Login. Dual-auth (Bearer token + httpOnly session cookie).
- **Authorization**: Role-Based Access Control (RBAC) with various roles.
- **Data Management**: PostgreSQL with Drizzle ORM, multi-city data segregation, public ID system.
- **Dispatch Engine**: Automated driver-vehicle and trip assignment, real-time tracking, ETA, and safety rule enforcement.
- **Communication**: SMS notifications and branded email services.
- **Location Services**: Google Maps integration for geocoding, autocomplete, ETA, route optimization, and live maps with server-side caching.
- **Audit Logging**: Comprehensive logging of key system actions.
- **Trip Management**: Includes public tracking links, clinic address enforcement, static map thumbnails, archive management, controlled dropdowns, trip approval workflow, recurring trip series, no-show/late tracking, go-time alerts, and driver offer acceptance.
- **Automation & Operational Features**:
    - **7-Phase Automation System**: Route Engine, Vehicle & Trip Auto-Assignment, Anti No-Show System, Driver Score System, Financial Dashboard, Map Status Badges, Ops Health Automation Tab, Auto Assignment Center.
    - **Ops Health System**: Provides system status (GREEN/YELLOW/RED) with alerts.
    - **Driver Presence System**: Heartbeat endpoint for driver status tracking.
- **Portals & APIs**:
    - **Public Booking API**: Unauthenticated endpoints for quotes, booking requests, and status checks.
    - **Clinic Portal**: Comprehensive portal for clinics with dashboards, trip management, patient management, and reports.
    - **Multi-company Isolation**: Server-side company filtering and ownership checks.
- **Realtime & Performance Hardening**:
    - **WebSocket Server**: JWT-authenticated, trip-scoped channels for real-time updates.
    - **Supabase Realtime**: Dual-broadcast for trip details with token-based authentication.
    - **Upstash Redis**: Distributed cache for driver locations, trip ETAs, rate limiting, and distributed locks.
    - **In-Memory Cache**: Write-through layer for fast synchronous reads.
    - **Driver Location Ingest**: Rate-limited and validated endpoint for location updates.
    - **ETA Throttle**: Recomputes ETA based on movement or time with caching and locking.
    - **Polling Reduction**: Optimized polling intervals and real-time connections.
- **Performance Optimization**: Request tracing, load test harness, database indexing, pagination enforcement, Redis geocode caching, degrade status API, and performance profiling UI.
- **Enterprise Multi-Tenant + Async Engine**:
    - **Hard Multi-Tenant Enforcement**: `tenantGuard` middleware and cross-company access checks.
    - **Background Job Queue**: Redis-backed queue for PDF generation, invoicing, billing, and email sending with retry mechanisms.
    - **Worker Process**: Separate process for continuous job polling.
    - **Async PDF Generation**: Generates PDFs in the background.
    - **Idempotency Layer**: Prevents duplicate resource creation using `Idempotency-Key` header.
    - **Company Quotas**: Enforces limits on drivers, active trips, and API request rates.
    - **System Event Stream**: Logs system events for auditing.
    - **Job Status API**: Monitors job and queue status.
- **Production Scale Hardening**:
    - **Structured JSON Logging**: Centralized logging with request IDs.
    - **3-Tier Adaptive Backpressure**: Dynamic throttling based on system load.
    - **Google Directions Circuit Breaker**: Prevents overload of Google Directions API.
    - **Ops Metrics Dashboard**: Visualizes operational metrics.
- **Financial & Billing**: Automatic invoice email sending with Stripe integration and detailed clinic cancel/billing workflow.
- **Driver App Experience**:
    - **Today Dashboard**: Card-based home view.
    - **Status Confirmations**: Requires confirmation for trip status changes.
    - **Support Events**: Allows drivers to log issues.
    - **Offline Queue**: Dual queue for GPS and actions, flushed on reconnect.
    - **Heartbeat**: 30-second interval ping.
    - **Navigation UX**: Copy-address fallback, auto-destination, nav app preference persistence.
    - **Score Trend Chart**: Displays driver performance trends.
    - **GPS Security**: Server-side anti-spoofing and location validation.
- **Mobile Driver App (Capacitor)**:
    - **Background GPS**: Uses `@capacitor-community/background-geolocation` for location updates.
    - **Adaptive Intervals**: Adjusts GPS update frequency based on movement.
    - **Token Bridge**: Securely passes JWTs between web and native.
    - **Native UI**: Background Tracking card with status badge and permissions shortcut.
    - **Auto Start/Stop**: Background tracking starts/stops automatically.
    - **Push Notifications**: Firebase Cloud Messaging for alerts.

## Phase 4 — Enterprise Hardening
- **Deep Health Endpoint**: `GET /api/admin/health/deep` (ADMIN-only) — returns `GREEN/YELLOW/RED` status with sub-checks:
    - `db`: SELECT 1 + recent jobs count with latency
    - `redis`: ping + set/get verification with TTL key
    - `worker`: heartbeat check (Redis key updated every 10s by worker); stale >60s → RED
    - `queue`: queued/working/failed counts in last 15min; failed spike or high lag → flags
- **Metrics Summary**: `GET /api/admin/metrics/summary` (ADMIN-only) — requestCount, avgDbTimeMs, cacheHitRate, p50/p95, slowestRoutes (top 10), queue throughput/failures per minute; graceful `profilingDisabled:true` when UCM_PROFILE not set
- **Worker Heartbeat**: Worker emits heartbeat to Redis every 10s via `setWorkerHeartbeat()`; 120s TTL; deep health checks staleness
- **PDF Watermark**: `?watermark=1` query param on `GET /api/trips/:id/pdf/download` — admin-only; inserts `CompanyName • TripID • GeneratedAt` as PDF comment
- **Batch PDF ZIP**: `POST /api/trips/pdf/batch` with `{tripIds:[]}` → 202 + jobId; `GET /api/trips/pdf/batch/:jobId/download` → application/zip; max 50 trips; company-scoped access control; ZIP stored in job result
- **Headers**: All PDF/ZIP downloads include `Content-Disposition: attachment`, `Cache-Control: no-store`, correct `Content-Type`
- **Files**: `server/lib/deepHealth.ts`, `server/lib/pdfWatermark.ts`, `server/lib/batchPdfProcessor.ts`

## UCM Command Center AI Engine
- **60-Second Scheduler**: `server/lib/aiEngine.ts` runs compute cycle every 60s with 5s startup delay
- **Sentinel**: Separate 15s interval for critical risk checks only (no DB queries)
- **Incremental Queries**: `getRecentTripsUpdatedSince` (30 min window), `getRecentDriversUpdatedSince` (10 min window) — no full table scans
- **Redis Caching**: Snapshot cached with 55s TTL; in-memory fallback if Redis unavailable
- **Runtime Guardrails**: SLOW warning at 5s, auto-throttle to 120s at 10s, skip next cycle on slow runs
- **Snapshot Persistence**: `ai_engine_snapshots` table stores aggregated metrics, top 5 risks, forecast summary
- **API Endpoints**: `GET /api/admin/ai-engine/snapshot` (cached snapshot), `GET /api/admin/ai-engine/status` (engine health)
- **DB Schema Note**: `drivers` table has `updated_at` column added (Feb 2026); used alongside `last_seen_at` and `last_active_at` for incremental queries
- **Files**: `server/lib/aiEngine.ts`, `shared/schema.ts` (drivers.updatedAt, aiEngineSnapshots)

## Phase 7A — Driver Intelligence Engine
- **DB Tables**: `driver_perf_scores` (id, companyId, driverId, window, score 0-100, components JSONB, computedAt) and `ops_anomalies` (id, companyId, entityType, entityId, severity, code, title, details JSONB, firstSeenAt, lastSeenAt, isActive)
- **Scoring Algorithm** (`server/lib/opsIntelligence.ts`): Punctuality 40pts, Completion 25pts, Cancellations 15pts, GPS Quality 10pts, Acceptance 10pts; rolling 7d/30d windows; company-scoped
- **Anomaly Detection**: DRIVER_STALE_GPS, DRIVER_LATE_SPIKE, CLINIC_CANCEL_SPIKE, ETA_DEGRADE, QUOTA_NEAR_LIMIT; auto-resolve after 2 missed detections
- **Background Jobs**: `score_recompute` and `anomaly_sweep` job types in worker; idempotency keys prevent duplicates
- **Ops Scheduler** (`server/lib/opsScheduler.ts`): Redis leader lock (setNx, 30s TTL); anomaly sweep every 60s; score recompute every 15min; configurable via env vars
- **API Endpoints**:
  - `GET /api/admin/ops-intel/scores?window=7d|30d&company_id=N` — driver performance scores
  - `GET /api/admin/ops-intel/anomalies?active=true|false&company_id=N` — operational anomalies
  - `POST /api/admin/ops-intel/scores/recompute` — trigger immediate recompute
  - `GET /api/admin/ops-intel/scores/csv?window=7d|30d&company_id=N` — CSV export
- **Frontend**: Driver Intelligence card in metrics.tsx with score bars, window selector, recompute button, CSV export, anomaly list
- **Env Vars**: UCM_PUNCTUALITY_GRACE_MIN (10), UCM_LATE_SPIKE_PCT (0.20), UCM_CANCEL_SPIKE_THRESHOLD (3), UCM_GPS_STALE_MIN (5), UCM_QUOTA_WARN_PCT (0.85), UCM_ANOMALY_RESOLVE_MISSES (2), UCM_OPS_ANOMALY_INTERVAL_MS (60000), UCM_SCORE_RECOMPUTE_INTERVAL_MS (900000), UCM_OPS_SCHEDULER (true|false)
- **Files**: `server/lib/opsIntelligence.ts`, `server/lib/opsScheduler.ts`, `shared/schema.ts` (driverPerfScores, opsAnomalies), `client/src/pages/metrics.tsx`

## Phase 4 — Distributed Job Engine + Locking
- **Job Engine** (`server/lib/jobEngine.ts`): Replaces in-process `startEtaEngine()` and `startVehicleAutoAssignScheduler()` with a Redis-backed enqueue scheduler
- **Distributed Locks**: `acquireLock(key, ttl)` using Redis setNx with TTL; key patterns:
  - `eta:city:{cityId}` — per-city ETA cycle lock (180s TTL)
  - `autoassign:city:{cityId}:date:{date}` — per-city/date auto-assign lock (600s TTL)
  - `job:{jobId}` — per-job lock for generic use
- **New Job Types**: `eta_cycle` and `autoassign_cycle` added to `JobType` in `jobQueue.ts`
- **Worker Handlers** (`server/worker.ts`): ETA cycle and auto-assign cycle handlers acquire distributed locks before executing; skip gracefully if lock held by another instance
- **Idempotency**: ETA cycles use `eta:{cycleKey}:city:{cityId}` keys; auto-assign uses `autoassign:city:{cityId}:date:{date}` keys to prevent duplicate enqueues
- **Refactored Modules**:
  - `etaEngine.ts`: Added `executeEtaCycleForCity(cityId)` for worker use; kept `startEtaEngine()` as fallback
  - `vehicleAutoAssign.ts`: `runVehicleAutoAssignForCity()` remains the core work function called by worker
- **Scheduler**: `startJobEngine()` runs in `server/index.ts` replacing direct scheduler starts
  - ETA enqueue interval: 120s (configurable via `UCM_ETA_ENQUEUE_INTERVAL_MS`)
  - Auto-assign enqueue interval: 60s (configurable via `UCM_AUTOASSIGN_ENQUEUE_INTERVAL_MS`)
- **Observability**:
  - `system_events` logged for job_started, job_succeeded, job_failed
  - `GET /api/ops/jobs` — paginated job list with status/type filters (DISPATCH/ADMIN/SUPER_ADMIN)
  - Job Dashboard card in metrics.tsx with stats, filters, and job table
- **Files**: `server/lib/jobEngine.ts`, `server/worker.ts`, `server/lib/jobQueue.ts`, `server/lib/etaEngine.ts`, `server/index.ts`, `client/src/pages/metrics.tsx`

## External Dependencies
- **PostgreSQL**: Primary relational database.
- **Replit DB**: Operational data storage.
- **Supabase**: User authentication profiles, city management, Row-Level Security (RLS), and private requests storage.
- **Google Maps Platform**: Maps JavaScript API, Directions API, Geocoding API, Places API.
- **Twilio**: SMS messaging.
- **Resend**: Transactional email delivery.
- **Stripe**: Payment intent verification.