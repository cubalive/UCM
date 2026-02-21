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
- **Authorization**: Centralized Permission-Based Access Control using a `ROLE_PERMISSIONS` matrix. Three clinic-scoped roles: CLINIC_ADMIN (full clinic access + user management), CLINIC_USER (trips/patients read-write), CLINIC_VIEWER (read-only). clinicId embedded in JWT for scope enforcement via `requireClinicScope` and `requireClinicAdmin` middleware. Clinic user management at `/api/clinic/users` (CRUD + password reset). Frontend admin console at `/clinic-users` with role-gated sidebar navigation.
- **Data Management**: PostgreSQL with Drizzle ORM, multi-city data segregation, and a public ID system. US States/Cities master reference tables (`us_states`, `us_cities`) with cascading State→City dropdowns, "City, ST" display format, and city deduplication via `us_city_id` linking.
- **Dispatch Engine**: Automated driver-vehicle and trip assignment, real-time tracking, ETA, and safety rule enforcement.
- **Communication**: SMS notifications and branded email services.
- **Location Services**: Google Maps integration for geocoding, autocomplete, ETA, route optimization, and live maps.
- **Audit Logging**: Comprehensive logging of key system actions.
- **Trip Management**: Includes public tracking links, clinic address enforcement, trip approval workflow, recurring trip series, no-show/late tracking, and driver offer acceptance. Driver trip accept endpoint (`POST /api/trips/:id/accept`) transitions ASSIGNED→EN_ROUTE_TO_PICKUP with SMS notification. Trip assignment (`PATCH /api/trips/:id/assign`) defaults to **direct assignment** (sets driverId, status→ASSIGNED immediately); optional `useOffer: true` body param enables the driver offer workflow with 30s TTL. Cross-company validation enforced on trip/driver/vehicle assignment.
- **Trip State Machine** (`shared/tripStateMachine.ts`): Enterprise-grade deterministic state engine. Single source of truth for trip phases (PICKUP/DROPOFF/DONE), valid transitions, UI actions, and navigation labels. Server imports `VALID_TRANSITIONS` and `STATUS_TIMESTAMP_MAP`; UI imports `uiActions()`, `derivePhase()`, `getNavLabel()`. Invalid transitions return 409. Navigation is fully decoupled from state (never triggers status changes). 55 unit tests covering all transitions, edge cases, and lifecycle paths.
- **Patient Communication System**: Automated SMS notifications for driver assignment, en-route with tracking links, T-24H reminders (background scheduler), geofence auto-arrival, picked-up, completed, and proper base URL routing. Feature flags: `GEOFENCE_ENABLED`, `SMS_REMINDER_ENABLED`.
- **Server-Side Geofence Gating**: When `GEOFENCE_ENABLED=true`, driver status transitions to `ARRIVED_PICKUP`/`ARRIVED_DROPOFF` are gated by proximity check (haversine distance vs configurable radius). Dispatch/SUPER_ADMIN can override via `/api/trips/:id/status/override`. Configurable radii: `GEOFENCE_PICKUP_RADIUS_METERS` (default 120), `GEOFENCE_DROPOFF_RADIUS_METERS` (default 160).
- **Cross-Company Tenant Isolation**: All entity write operations (trips, patients, drivers, vehicles, clinics) enforce company_id ownership checks. Cross-company driver/vehicle assignment to trips is blocked server-side. SUPER_ADMIN can operate across companies. Multi-tenant scope isolation via composite keys (company_id + city_id + clinic_id) with SQL-level filtering, composite indexes on all entity tables, NOT NULL company_id constraints, and integrity reporting endpoint.
- **Dispatcher City Permissions**: Company-scoped city access control for DISPATCH role via `dispatcher_city_permissions` table (user_id, company_id, city_id). Default-DENY: dispatchers with no permissions get 403. ScopeContext middleware enforces city restrictions on all data endpoints. Admin API at `/api/company/dispatchers/:id/permissions` (GET/PUT). Company cities API at `/api/company/cities`. Admin UI: "City Access" button on dispatcher user cards with multi-select city dialog. `company_cities` reference table links companies to their operational cities.
- **Automation & Operational Features**: A 7-Phase Automation System covering routing, auto-assignment, anti-no-show, driver scoring, financial dashboards, map status badges, and an operational health automation tab.
- **Portals & APIs**: Public Booking API, Clinic Portal, and multi-company isolation.
- **Realtime & Performance Hardening**: WebSocket server, Supabase Realtime, Upstash Redis for distributed caching, in-memory cache, rate-limited driver location ingest, and ETA throttling.
- **Enterprise Multi-Tenant + Async Engine**: Hard multi-tenant enforcement, Redis-backed background job queue, worker process, idempotency layer, company quotas, system event stream, and job status API.
- **Production Scale Hardening**: Structured JSON logging, 3-Tier Adaptive Backpressure, Google Directions Circuit Breaker, Ops Metrics Dashboard, graceful shutdown, and HTTP timeouts.
- **Platform Pricing Settings**: Configurable platform tariffs, discount precedence logic, clinic memberships, and an admin API for managing pricing.
- **Financial & Billing**: Automatic invoice email sending with Stripe integration and detailed clinic cancel/billing workflow.
- **Company-to-Driver Payroll**: Per-company payroll settings, idempotent earnings ledger, payrun management with Stripe transfers, and scheduled/manual triggers.
- **Time & Pay v1 (Hourly Timesheets)**: Manual and CSV import of time entries with a DRAFT→PAID workflow, payroll generation, and driver self-service views.
- **Driver App Experience**: Today Dashboard, status confirmations, support events, offline queue, heartbeat, navigation UX, score trend chart, and GPS security.
- **Mobile Driver App (Capacitor)**: Background GPS, secure token bridge, native UI, and Firebase Push Notifications.
- **Distributed Job Engine + Locking**: Replaces in-process schedulers with a Redis-backed enqueue scheduler using distributed locks.
- **UCM Intelligence Core**: Integrates daily/weekly metrics, TRI scores, cost leak alerts, and certifications with corresponding API endpoints and a frontend dashboard.
- **Driver Intelligence Engine**: Driver performance scoring based on various metrics, anomaly detection, and background score recomputation.
- **Platform Billing Fees**: Application fees collected on clinic invoice payments via Stripe Connect, with global and company-specific overrides.
- **Company Subscriptions**: Stripe-powered monthly subscription billing for companies. Configurable via `platform_billing_settings` (monthly_subscription_enabled, price_id, subscription_required_for_access, grace_period_days). Tables: `stripe_customers`, `company_subscriptions`. Webhook at `/api/webhooks/stripe/subscription`. Admin API at `/api/admin/subscriptions/*`. Admin UI at `/admin/subscriptions`.
- **Production Ops & Observability**: Boot config logging, pooler enforcement, Redis startup diagnostic, SUPER_ADMIN-only ops endpoints (`/api/ops/*`), graceful shutdown, HTTP timeouts, access-denied logging, WebSocket hardening, and DB-backed route cache.
- **Entity Detail Pages & Click-Through Navigation**: Dedicated detail pages for patients (`/patients/:id`), drivers (`/drivers/:id`), vehicles (`/vehicles/:id`), clinics (`/clinics/:id`), invoices (`/invoices/:id`), and payroll runs (`/payroll/runs/:id`). All EntityRef components (PatientRef, DriverRef, VehicleRef, ClinicRef, InvoiceRef, TripRef) navigate to corresponding detail pages with back button navigation.
- **URL-Based Filter Persistence**: FilterBar's `usePersistedFilters` hook syncs active filters to URL query params (bidirectional). Filters are preserved in URLs for shareability and browser history, with localStorage fallback.
- **Server-Side Search**: All major list endpoints (patients, drivers, clinics, trips) support `?q=` query parameter for ILIKE text search across name, phone, publicId, and address fields. Search respects RBAC scope for all roles including clinic users.
- **Driver Portal Upgrade (Shift Mode + Trip Center)**: Formal shift session tracking via `driver_shifts` table (ACTIVE→COMPLETED→AUTO_ENDED). APIs: `POST /api/driver/shift/start`, `POST /api/driver/shift/end`, `GET /api/driver/shift/active`, `GET /api/driver/shift/history`. UI: "Start Shift"/"End Shift" replaces "Go Online"/"Go Offline" with shift timer banner. In-app foreground geofence distance display (pickup/dropoff meters) via `GET /api/driver/geofence-check`. No-show evidence capture via `POST /api/driver/no-show-evidence` with `no_show_evidence` table. Digital signature "refused to sign" option via `POST /api/driver/signature-refused` with `signature_refused`/`refused_reason` columns on `trip_signatures`. Earnings drawer tab with today/week/month range, shift hours, trip earnings via `GET /api/driver/shift-earnings`. Search + status filter chips on driver trips list. Controller: `server/controllers/driver-shift.controller.ts`.

## Running the Project
- **Development**: `npm run dev` (uses tsx for hot reload)
- **Production build**: `npm run build` (outputs to `dist/`)
- **Production run**: `node ./dist/index.cjs` (correct production command)
- Always run `npm run build` before using the production command to ensure latest changes are compiled.

## Capacitor (Native Mobile)
- **Config**: `capacitor.config.ts` — appId: `com.unitedcaremobility.driver`, webDir: `dist/public`
- **Platforms**: `android/` and `ios/` scaffolded via `@capacitor/android` and `@capacitor/ios`
- **Build & Sync**: `npm run build && npx cap sync`
- **Open Android Studio**: `npx cap open android`
- **Open Xcode**: `npx cap open ios`
- **Feature Flags**: `VITE_NATIVE_ENABLED` (default false), `VITE_BG_TRACKING_ENABLED` (default false)
- **Runtime Detection**: `isNative()` from `client/src/lib/hostDetection.ts` — true only when running inside Capacitor AND `VITE_NATIVE_ENABLED=true`
- **Native Mode Badge**: Shown in Driver Settings tab only when native + flag enabled
- **Permission Placeholders**: Android has location + foregroundService; iOS has NSLocation* + NSMotion descriptions. Background modes NOT enabled yet.
- **PWA unchanged**: All flags default false, no behavior change in web/PWA mode.

## External Dependencies
- **PostgreSQL**: Primary relational database, specifically Supabase pooler.
- **Supabase**: User authentication profiles, city management, Row-Level Security (RLS), and private requests storage.
- **Google Maps Platform**: Maps JavaScript API, Directions API, Geocoding API, Places API.
- **Twilio**: SMS messaging.
- **Resend**: Transactional email delivery.
- **Stripe**: Payment intent verification.
- **Upstash Redis**: Distributed cache and message broker.
- **Firebase Cloud Messaging**: Push notifications.