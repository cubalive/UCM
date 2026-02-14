# United Care Mobility (UCM)

## Overview
United Care Mobility (UCM) is a Medical Transportation Management System designed to streamline non-emergency medical transportation services across multiple cities. It aims to enhance operational efficiency, improve patient care coordination, and optimize resource allocation. The system provides a comprehensive solution for managing fleets, patients, and trips, featuring a robust dispatch engine. The project's ambition is to become a leading platform for non-emergency medical transport providers, enabling seamless, reliable, and compliant service delivery.

## User Preferences
I prefer iterative development with a focus on clear, modular code. I appreciate detailed explanations for complex architectural decisions and new feature implementations. Please ask before making any major changes to the core structure or public-facing APIs. I prefer that the agent does not make changes to the `shared/permissions.ts` file without explicit instruction.

## System Architecture
The application follows a client-server architecture.
- **Frontend**: Built with React, Vite, Tailwind CSS, and shadcn/ui, located in the `client/` directory, emphasizing a clean, intuitive design.
- **Backend**: An Express.js API in the `server/` directory, handling business logic, data access, and integrations.
- **Database**: PostgreSQL with Drizzle ORM for primary data; Replit DB for operational data.
- **Authentication**: JWT-based with `bcryptjs` for password hashing.
- **Authorization**: Role-Based Access Control (RBAC) supporting SUPER_ADMIN, ADMIN, DISPATCH, DRIVER, VIEWER, COMPANY_ADMIN, CLINIC_USER roles.
- **Multi-city Support**: Data segregation by city for core entities.
- **Public ID System**: Standardized `01UCM000001` format for public identifiers.
- **Dispatch Engine**: Manages driver-vehicle assignment, trip assignment with ETA, automated dispatching, and real-time driver tracking, incorporating safety rules.
- **SMS Notifications**: Twilio integrated for template-based and custom SMS, with opt-out compliance.
- **Audit Logging**: Comprehensive logging of key system actions.
- **Google Maps Integration**: Geocoding, address autocomplete, ETA, route optimization, live driver maps, with server-side caching and rate limiting.
- **Project Structure**: `client/`, `server/`, `shared/` directories. `shared/schema.ts` for Drizzle/Zod schemas. `server/routes.ts` centralizes API routes with Zod validation and RBAC.
- **Trip Sharing & Tracking**: Shareable public tracking links.
- **Live Map**: Real-time driver location tracking with role-based views.
- **Clinic Address-City Enforcement**: Clinic addresses must match their service city.
- **Static Map Thumbnails**: Google Static Maps API for trip route thumbnails.
- **Magic Link Login**: User login via email magic links using Resend.
- **Email Service**: Branded email for user actions (login links, passwords).
- **Archive Management**: Soft-delete system for entities (clinics, drivers, patients, users, vehicles, trips) with granular RBAC for archiving, restoring, and permanent deletion.
- **Vehicle Makes & Models**: Controlled dropdowns for selection.
- **Trip Approval Workflow**: `approval_status` (pending/approved/cancel_requested/cancelled) separate from operational status, with role-based approval and cancellation processes.
- **Recurring Trip Series**: `trip_series` table for pattern-based scheduling (MWF, TThS, Daily, Custom) with end conditions (date or occurrence count).
- **No-Show/Late Tracking**: `trip_events` table tracks events (late_driver, late_patient, no_show_driver, no_show_patient) with UI for recording.
- **Driver Bonus System**: `driver_bonus_rules` configures per-city bonuses. Weekly metrics and bonus computation available.
- **7-Phase Automation System**:
    - **Route Engine**: Daily scheduler grouping trips into route batches by city, time window, type, and ZIP cluster.
    - **Vehicle & Trip Auto-Assignment**: Daily assignment of vehicles to drivers and distribution of scheduled trips.
    - **Anti No-Show System**: Checks for confirmation reminders and flags at-risk trips.
    - **Driver Score System**: Weekly 0-100 scoring based on performance metrics.
    - **Financial Dashboard**: Overview of daily and date-range financial metrics.
    - **Map Status Badges**: Live map shows active trip status for drivers.
    - **Ops Health Automation Tab**: Displays automation metrics and scheduler status.
    - **Auto Assignment Center**: UI for manual auto-assignment with city isolation and priority rules.
- **Production Hardening**:
    - **ARRIVED_DROPOFF Status**: New trip status with associated timestamp and UI updates.
    - **Terminal Status Lockdown**: Server-side enforcement preventing edits on COMPLETED, CANCELLED, NO_SHOW trips.
    - **SMS Config Check**: Frontend/backend check for Twilio configuration, hiding SMS features if not configured.
    - **Ops Health System**: `/api/ops/health` endpoint providing system status (GREEN/YELLOW/RED) with computed alerts.
- **Public Booking API**: Unauthenticated endpoints for quotes, booking requests, and status checks, with CORS restrictions and rate limiting. Includes a private pricing engine and optional Stripe integration.
- **Recurring Patient Schedules**: `recurring_schedules` table for patient-specific recurring schedules. Midnight scheduler generates trips for the next 7 days based on active schedules.
- **Clinic Portal**: Comprehensive portal for clinics (`/clinic-trips`) with tabs for Dashboard, Trips, Patients, and Reports. Dashboard shows today's trips, active trips with live tracking, recurring schedules, and patient counts. Live map tracking with driver marker (vehicle-colored), route, ETA, status badge. Trips tab has create/view/track. Patients tab has search/add/edit. Reports tab has CSV export. All data clinic-scoped with server-side RBAC enforcement.
- **Clinic Trip Tracking**: GET `/api/clinic/trips/:id/tracking` returns live driver location, vehicle color, route data, ETA. Auto-hides when trip reaches terminal status (COMPLETED/CANCELLED/NO_SHOW). Enforces clinicId ownership (403 on cross-clinic access).
- **Driver Presence System**: Heartbeat endpoint updates `lastSeenAt` for drivers. Dashboard displays driver stats (IN_ROUTE, ACTIVE, OFFLINE/HOLD) based on presence and dispatch status.
- **Multi-company Isolation**: `companies` table with `company_id` on all core entities (users, drivers, vehicles, clinics, patients, trips). JWT includes `companyId`. Server-side company filtering on GET list endpoints (AND with city filter). 403 enforcement on GET-by-ID and mutation endpoints via `checkCompanyOwnership`. SUPER_ADMIN bypasses company filters (companyId=null). Company management API: `GET/POST /api/companies` (SUPER_ADMIN), `POST /api/companies/:id/admin` creates COMPANY_ADMIN user. Company scoping applied in routes.ts and lib routes (dispatch, tracking). Shared helpers: `getCompanyIdFromAuth`, `applyCompanyFilter`, `checkCompanyOwnership` in `server/auth.ts`.

## External Dependencies
- **PostgreSQL**: Primary relational database.
- **Replit DB**: Operational data storage.
- **Supabase**: User authentication profiles, city management, and Row-Level Security (RLS), private requests storage.
- **Google Maps Platform**: Maps JavaScript API, Directions API, Geocoding API, Places API for location, ETA, routing, and live maps.
- **Twilio**: SMS messaging and opt-out requests.
- **Resend**: Transactional email delivery (magic links, notifications).
- **Stripe**: (Optional) Payment intent verification for public booking requests.