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
- **Authorization**: Centralized Permission-Based Access Control using a `ROLE_PERMISSIONS` matrix, enforcing clinic-scoped roles and user management.
- **Data Management**: PostgreSQL with Drizzle ORM, multi-city data segregation, and a public ID system. US States/Cities master reference tables with cascading dropdowns and deduplication.
- **Dispatch Engine**: Automated driver-vehicle and trip assignment, real-time tracking, ETA, and safety rule enforcement.
- **Communication**: SMS notifications and branded email services.
- **Location Services**: Google Maps integration for geocoding, autocomplete, ETA, route optimization, and live maps.
- **Audit Logging**: Comprehensive logging of key system actions.
- **Trip Management**: Public tracking links, clinic address enforcement, approval workflow, recurring trips, no-show/late tracking, and driver offer acceptance. Utilizes a deterministic state machine for robust trip status transitions.
- **Patient Communication System**: Automated SMS notifications for various trip events with configurable geofencing and reminders.
- **Server-Side Geofence Gating**: Proximity checks for driver status transitions (e.g., `ARRIVED_PICKUP`) with configurable radii and manual override capabilities.
- **Waiting Timer**: Automatic patient waiting countdown, configurable per company, with driver extension options and audit logging.
- **Cross-Company Tenant Isolation**: Strict enforcement of company_id ownership for all entities, preventing cross-company data access, with SUPER_ADMIN override capabilities.
- **Dispatcher City Permissions**: Granular access control for dispatchers based on city, enforced via middleware and configurable through an admin interface.
- **Automation & Operational Features**: A 7-Phase Automation System for routing, auto-assignment, anti-no-show, driver scoring, and operational health monitoring.
- **Portals & APIs**: Public Booking API, Clinic Portal, and multi-company isolation.
- **Realtime Trip State Management**: Centralized `transitionTripStatus()` helper for consistent status transitions, driver dispatch sync, audit logging, and multi-channel broadcasts. WebSocket company/clinic channels with tenant-isolated subscriptions, auto-reconnecting frontend hook (`useRealtimeTrips`), shared trip status color/label mapping (`tripStatusMapping.ts`), map legend component, and instant dispatch board updates replacing 15s polling. DB indexes on `trips(driver_id, status)`, `trips(company_id, status)`, `trips(clinic_id, status)`, `trips(city_id, status)` for fast active trip lookups.
- **Realtime & Performance Hardening**: WebSocket server, Supabase Realtime, Upstash Redis for caching, rate-limited data ingestion, and ETA throttling.
- **Enterprise Multi-Tenant + Async Engine**: Hard multi-tenant enforcement, Redis-backed background job queue, idempotency, company quotas, and system event streams.
- **Production Scale Hardening**: Structured JSON logging, adaptive backpressure, circuit breakers, graceful shutdown, and HTTP timeouts.
- **Platform Pricing Settings**: Configurable tariffs, discount logic, clinic memberships, and an admin API.
- **Financial & Billing**: Automatic invoice email sending, Stripe integration, and detailed clinic cancellation/billing workflows.
- **Enterprise Billing vNext**: Billing adjustments (credit/debit/refund/fee_override), double-entry ledger (journal-based with balance enforcement), payout reconciliation (Stripe balance transaction sync), billing audit events, dunning/retry logic with Stripe idempotency keys, Stripe customer/PM management (setup_future_usage), dispute tracking via webhooks, and SUPER_ADMIN Finance Console UI.
- **Company-to-Driver Payroll**: Per-company payroll settings, idempotent earnings ledger, payrun management with Stripe transfers. Earnings Modifiers Engine with optional ON/OFF toggles per company: Daily Minimum Guarantee (top-up to configurable daily min), On-Time Bonus (per-trip or weekly mode with threshold), No-Show Penalty (per-incident deduction). Idempotent `driver_earnings_adjustments` table with deterministic keys, computed on trip completion via `transitionTripStatus()`, admin Pay Rules settings page, and driver weekly earnings breakdown UI.
- **Time & Pay v1 (Hourly Timesheets)**: Manual and CSV import of time entries with a DRAFT→PAID workflow and driver self-service views.
- **Driver App Experience**: Today Dashboard, status confirmations, support events, offline queue, heartbeat, navigation UX, and score trend chart.
- **Mobile Driver App (Capacitor)**: Background GPS, secure token bridge, native UI, and Firebase Push Notifications, with feature flags for native functionalities.
- **Distributed Job Engine + Locking**: Redis-backed enqueue scheduler with distributed locks replacing in-process schedulers.
- **UCM Intelligence Core**: Integrates daily/weekly metrics, TRI scores, cost leak alerts, and certifications with corresponding API endpoints and a frontend dashboard.
- **Driver Intelligence Engine**: Driver performance scoring based on KPIs, anomaly detection, and background recomputation.
- **Platform Billing Fees**: Application fees collected via Stripe Connect, with global and company-specific overrides.
- **Company Subscriptions**: Stripe-powered monthly subscription billing for companies, configurable via platform settings and managed through admin interfaces.
- **Production Ops & Observability**: Boot config logging, pooler enforcement, Redis diagnostics, SUPER_ADMIN ops endpoints, graceful shutdown, HTTP timeouts, access-denied logging, WebSocket hardening, and DB-backed route cache.
- **Entity Detail Pages & Click-Through Navigation**: Dedicated detail pages for key entities (patients, drivers, vehicles, clinics, invoices, payroll runs) with consistent navigation.
- **URL-Based Filter Persistence**: Filter states persisted in URL query parameters for shareability and browser history.
- **Server-Side Search**: ILIKE text search across major list endpoints, respecting RBAC scope.
- **Driver Portal Upgrade (Shift Mode + Trip Center)**: Formal shift session tracking, in-app foreground geofence distance display, no-show evidence capture, digital signature options, and earnings summaries.
- **Driver App v3 (Feature-Flagged)**: Triple-gated features (env + company + driver settings) including performance scoring, smart prompts, offline outbox, and sounds/haptics.

## External Dependencies
- **PostgreSQL**: Primary relational database, specifically Supabase pooler.
- **Supabase**: User authentication profiles, city management, Row-Level Security (RLS), and private requests storage.
- **Google Maps Platform**: Maps JavaScript API, Directions API, Geocoding API, Places API.
- **Twilio**: SMS messaging.
- **Resend**: Transactional email delivery.
- **Stripe**: Payment intent verification.
- **Upstash Redis**: Distributed cache and message broker.
- **Firebase Cloud Messaging**: Push notifications.