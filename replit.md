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
- **Authentication**: JWT-based with `bcryptjs` and Magic Link Login, supporting dual-auth (Bearer token + httpOnly session cookie).
- **Authorization**: Centralized Permission-Based Access Control using `shared/permissions.ts` ROLE_PERMISSIONS matrix as single source of truth. `requirePermission(resource, permission)` middleware in `server/auth.ts` replaces hardcoded role lists. SUPER_ADMIN-only operations and routes involving DRIVER/CLINIC_USER (not in permissions matrix) still use `requireRole()`. `isDispatchLevel()` includes COMPANY_ADMIN.
- **Data Management**: PostgreSQL with Drizzle ORM, multi-city data segregation, and a public ID system.
- **Dispatch Engine**: Automated driver-vehicle and trip assignment, real-time tracking, ETA, and safety rule enforcement.
- **Communication**: SMS notifications and branded email services.
- **Location Services**: Google Maps integration for geocoding, autocomplete, ETA, route optimization, and live maps with server-side caching.
- **Audit Logging**: Comprehensive logging of key system actions.
- **Trip Management**: Includes public tracking links, clinic address enforcement, trip approval workflow, recurring trip series, no-show/late tracking, and driver offer acceptance.
- **Automation & Operational Features**:
    - **7-Phase Automation System**: Covers routing, auto-assignment, anti-no-show, driver scoring, financial dashboards, map status badges, and an operational health automation tab.
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
- **Enterprise Multi-Tenant + Async Engine**:
    - **Hard Multi-Tenant Enforcement**: `tenantGuard` middleware and cross-company access checks.
    - **Background Job Queue**: Redis-backed queue for PDF generation, invoicing, billing, and email sending with retry mechanisms.
    - **Worker Process**: Separate process for continuous job polling.
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
- **Company-to-Driver Payroll**:
    - **Payroll Settings**: Per-company configuration for PER_TRIP or HOURLY pay modes, cadence (WEEKLY/BIWEEKLY/MONTHLY), holdback days, minimum payout thresholds.
    - **Earnings Ledger**: Idempotent earnings generation from completed trips with status lifecycle (EARNED→ELIGIBLE→IN_PAYRUN→PAID).
    - **Payrun Management**: Draft→Approved→Processing→Paid lifecycle with idempotency keys and period-based deduplication.
    - **Stripe Transfers**: Driver Stripe Connect onboarding and automated transfers via connected accounts.
    - **Scheduler**: Hourly background check for due payruns + internal API endpoint for manual triggers.
    - **Role Gating**: SUPER_ADMIN (all companies), COMPANY_ADMIN (own company), DRIVER (own earnings/payruns only).
    - **Tables**: `company_payroll_settings`, `driver_stripe_accounts`, `driver_earnings_ledger`, `payroll_payruns`, `payroll_payrun_items`.
    - **Routes**: `server/lib/payrollRoutes.ts`.
- **Time & Pay v1 (Hourly Timesheets)**:
    - **Time Entries**: Manual creation and CSV import with DRAFT→SUBMITTED→APPROVED→REJECTED→PAID workflow.
    - **CSV Import**: Bulk import with duplicate detection via unique index on (company_id, driver_id, work_date, source_type, source_ref).
    - **Payroll Generation**: Creates payroll runs from APPROVED time entries with hourly rate computation.
    - **Tenant Isolation**: All endpoints enforce company scope via requireTenantScope middleware and requireCompanyOrFail helper.
    - **Driver Self-Service**: Drivers can view their own time entries via /api/driver/time endpoint.
    - **Tables**: `time_entries`, `time_import_batches`, `tp_payroll_runs`, `tp_payroll_items`.
    - **Routes**: `server/routes/timepay.routes.ts`, controller: `server/controllers/timepay.controller.ts`.
    - **Frontend**: `/timecards` (time entry management) and `/tp-payroll` (payroll runs).
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
    - **Background GPS**: Uses `@capacitor-community/background-geolocation` for location updates with adaptive intervals.
    - **Token Bridge**: Securely passes JWTs between web and native.
    - **Native UI**: Background Tracking card with status badge and permissions shortcut.
    - **Push Notifications**: Firebase Cloud Messaging for alerts.
- **Distributed Job Engine + Locking**: Replaces in-process schedulers with a Redis-backed enqueue scheduler using distributed locks for ETA cycles and auto-assignment.
- **UCM Intelligence Core**: Integrates `daily_metrics_rollup`, `weekly_score_snapshots`, `tri_scores`, `cost_leak_alerts`, and `ucm_certifications` tables. Provides API endpoints for rollups, snapshots, rankings, performance, TRI scores, cost leak alerts management, and certifications. Frontend includes a dashboard with KPI cards, trends, and alerts.
- **Driver Intelligence Engine**: Implements driver performance scoring based on punctuality, completion, cancellations, GPS quality, and acceptance. Includes anomaly detection for stale GPS, late spikes, clinic cancel spikes, ETA degradation, and quota limits. Uses background jobs for score recomputation and anomaly sweeps.

## External Dependencies
- **PostgreSQL**: Primary relational database.
- **Replit DB**: Operational data storage.
- **Supabase**: User authentication profiles, city management, Row-Level Security (RLS), and private requests storage.
- **Google Maps Platform**: Maps JavaScript API, Directions API, Geocoding API, Places API.
- **Twilio**: SMS messaging.
- **Resend**: Transactional email delivery.
- **Stripe**: Payment intent verification.
- **Upstash Redis**: Distributed cache and message broker.
- **Firebase Cloud Messaging**: Push notifications.