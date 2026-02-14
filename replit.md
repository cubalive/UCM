# United Care Mobility (UCM)

## Overview
United Care Mobility (UCM) is a Medical Transportation Management System designed to streamline non-emergency medical transportation services across multiple cities. The system aims to enhance operational efficiency, improve patient care coordination, and optimize resource allocation. It provides a comprehensive solution for managing fleets, patients, and trips, featuring a robust dispatch engine. The project's ambition is to become a leading platform for non-emergency medical transport providers, enabling seamless, reliable, and compliant service delivery.

## User Preferences
I prefer iterative development with a focus on clear, modular code. I appreciate detailed explanations for complex architectural decisions and new feature implementations. Please ask before making any major changes to the core structure or public-facing APIs. I prefer that the agent does not make changes to the `shared/permissions.ts` file without explicit instruction.

## System Architecture
The application follows a client-server architecture.
- **Frontend**: Built with React, Vite, Tailwind CSS, and shadcn/ui, located in the `client/` directory. UI/UX emphasizes a clean, intuitive design with a consistent color scheme.
- **Backend**: An Express.js API residing in the `server/` directory, handling business logic, data access, and external integrations.
- **Database**: PostgreSQL is used as the primary data store, managed via Drizzle ORM. Replit DB is utilized for operational data.
- **Authentication**: JWT-based authentication with `bcryptjs` for password hashing.
- **Authorization**: Role-Based Access Control (RBAC) with roles including SUPER_ADMIN, ADMIN, DISPATCH, DRIVER, and VIEWER.
- **Multi-city Support**: Core entities are scoped to specific cities for data segregation.
- **Public ID System**: Consistent `01UCM000001` format for public-facing identifiers, generated atomically.
- **Dispatch Engine**: Features driver-vehicle assignment, trip assignment with ETA calculation, automated dispatching, and real-time driver status tracking. Includes safety rules for assignments.
- **SMS Notifications**: Integrated Twilio for template-based and custom SMS notifications with opt-out compliance.
- **Audit Logging**: Comprehensive logging of key system actions.
- **Google Maps Integration**: Services for geocoding, address autocomplete, ETA calculation, route optimization, and live driver maps, with server-side caching and rate limiting.
- **Project Structure**: Organized into `client/`, `server/`, and `shared/` directories. `shared/schema.ts` defines common Drizzle and Zod schemas. `server/routes.ts` centralizes API routes with Zod validation and RBAC.
- **Trip Sharing & Tracking**: Shareable tracking links for trips with public tracking pages.
- **Live Map**: Real-time driver location tracking on Google Maps, with role-based views.
- **Clinic Address-City Enforcement**: Clinic addresses must match their assigned service city.
- **Static Map Thumbnails**: Trip route thumbnails using Google Static Maps API for caching and display in various views.
- **Magic Link Login**: System for user login via email magic links using Resend.
- **Email Service**: Branded email functions for various user actions (login links, temporary passwords, recovery links).
- **Archive Management**: Soft-delete system for entities (clinics, drivers, patients, users, vehicles, trips) with granular RBAC for archiving, restoring, and permanent deletion.
- **Vehicle Makes & Models**: Controlled dropdowns for vehicle make and model selection, replacing free-text inputs.
- **Trip Approval Workflow**: Trips have an `approval_status` (pending/approved/cancel_requested/cancelled) separate from operational status, with role-based approval and cancellation processes. Cancel has `cancel_type` (soft/hard) and `cancelled_at` timestamp. Dispatch/Admin can cancel with type selection; clinic can cancel pending trips (auto soft) or request cancellation for approved trips.
- **Trip Archive Policy**: Trip archive/restore/permanent-delete restricted to SUPER_ADMIN only. DISPATCH cannot archive or delete trips (only cancel). Archive page trips tab visible only to SUPER_ADMIN.
- **Recurring Trip Series**: Controlled recurring trip scheduling via `trip_series` table with pattern-based generation (MWF, TThS, Daily, Custom). Series store full address/coordinate data and generate child trips with `trip_series_id` FK. End condition is either an end date or occurrence count (max 365). Date generation uses city timezone for correct day-of-week matching. Series management endpoints in `server/lib/tripSeriesRoutes.ts`. RBAC: SUPER_ADMIN, ADMIN, DISPATCH can create/manage series.

## External Dependencies
- **PostgreSQL**: Relational database for persistent storage, accessed via Drizzle ORM.
- **Replit DB**: Used for specific operational data storage.
- **Supabase**: Leveraged for user authentication profiles, city management, and Row-Level Security (RLS).
- **Google Maps Platform**: Utilized for Maps JavaScript API, Directions API, Geocoding API, Places API for location services, ETA calculations, route optimization, and live driver map.
- **Twilio**: Integrated for sending and receiving SMS messages and handling opt-out requests.
- **Resend**: Used for transactional email delivery, specifically for magic link logins and other email notifications.

## No-Show/Late Tracking & Driver Bonus System
- **Trip Events**: `trip_events` table tracks events per trip (late_driver, late_patient, no_show_driver, no_show_patient, complaint, incident) with optional minutesLate and notes. UI buttons in TripDetailDialog for dispatch/admin to record events.
- **Driver Bonus Rules**: `driver_bonus_rules` table stores per-city bonus configuration (isEnabled, weeklyAmountCents, criteriaJson with maxNoShowDriver, maxLateDriver, minCompletionRate). Managed via Reports page Bonus Rules tab.
- **Weekly Driver Metrics**: GET /api/reports/drivers/weekly returns per-driver metrics (assigned, completed, cancellations, no-shows, late counts, avg late minutes, completion rate) for a given week.
- **Bonus Computation**: POST /api/bonuses/compute-week evaluates drivers against city bonus criteria and returns eligible/ineligible lists with reasons. SUPER_ADMIN only. Does NOT auto-pay.
- **Reports Page**: `/reports` route accessible to ADMIN+ roles. Four tabs: Weekly Metrics, Driver Scores, Bonus Rules (ADMIN+), Compute Bonus (SUPER_ADMIN). Routes defined in `server/lib/reportRoutes.ts`.

## 7-Phase Automation System
- **Route Engine**: `server/lib/routeEngine.ts` - 5:30 AM daily scheduler (Mon-Sat) groups SCHEDULED trips into route batches by city, time window (early/morning/midday/afternoon/late), trip type, and ZIP cluster (first 3 digits). Stored in `route_batches` table.
- **Vehicle & Trip Auto-Assignment**: `server/lib/vehicleAutoAssign.ts` - 6:00 AM daily (Mon-Sat) assigns vehicles to drivers and distributes SCHEDULED trips across assigned drivers using balanced round-robin.
- **Anti No-Show System**: `server/lib/noShowEngine.ts` - Every 5 min checks for T-24h/T-2h confirmation reminders (stubs), flags unconfirmed trips as "at_risk" within 30 min of pickup. Tracks patient no-show counts for 3-strike alerts.
- **Driver Score System**: `server/lib/driverScoreEngine.ts` - Weekly 0-100 scoring: base 50 + completion (25pts) + on-time (15pts) - no_shows (5pt each) - late (2pt each) - cancellations (3pt each) + volume bonus (up to 10pts). Stored in `driver_scores` table.
- **Financial Dashboard**: `/financial` page with today's summary cards (trips, completed, cancelled, no-show, revenue, miles, drivers, miles/driver) and date range report with daily breakdown. API: `/api/financial/daily` and `/api/financial/range`.
- **Map Status Badges**: Live map info windows show active trip status (SCHEDULED, EN_ROUTE_PICKUP, AT_PICKUP, IN_TRANSIT, AT_DROPOFF, COMPLETED) with colored badges when clicking driver markers.
- **Ops Health Automation Tab**: Ops Health page has Automation tab showing route batch count, trip assignment metrics, active driver count, scheduler reference, and today's route batches table.
- **Automation API Routes**: `server/lib/automationRoutes.ts` - 14 endpoints for route batches, trip reassignment, confirmations, patient no-show count, driver scores, financial stats.
- **Auto Assignment Center**: `/auto-assignment` page for NO-API auto assignment in Las Vegas/Pahrump. Engine in `server/lib/assignmentEngine.ts` with city isolation, ZIP clustering, trip type priority (dialysis > recurring > one_time), wheelchair vehicle matching, patient-driver history pairing, hold driver exclusion, round-robin balanced assignment. API routes in `server/lib/assignmentRoutes.ts` with city access enforcement. Batch lifecycle: proposed → applied/cancelled. Per-trip manual override. `assignment_batches` table stores batches; trips table has `assignment_batch_id`, `assignment_source`, `assignment_reason` columns.

## Production Hardening (Feb 2026)
- **ARRIVED_DROPOFF Status**: New trip status between EN_ROUTE_TO_DROPOFF and COMPLETED. Enum value added via ALTER TYPE, `arrivedDropoffAt` timestamp column added to trips. VALID_TRANSITIONS: EN_ROUTE_TO_DROPOFF → [ARRIVED_DROPOFF, CANCELLED], ARRIVED_DROPOFF → [COMPLETED, CANCELLED]. Violet color theme in UI. All pages updated: driver-dashboard, dispatch-board, clinic-trips, trips.
- **Terminal Status Lockdown**: COMPLETED, CANCELLED, NO_SHOW are terminal statuses. Server-side enforcement blocks: trip edits (PATCH /api/trips/:id), driver assignment (PATCH /api/trips/:id/assign), status changes (PATCH /api/trips/:id/status), messaging (POST /api/trips/:id/messages), cancellation, and approval changes.
- **SMS Config Check**: Frontend queries /api/sms/health to check Twilio configuration. SMS buttons hidden when Twilio not configured, with warning indicator shown. Server-side also rejects /api/sms/send and /api/trips/:id/notify with 503 when Twilio not configured.
- **Ops Health System**: /api/ops/health returns GREEN/YELLOW/RED status with computed alerts (pending approvals, unassigned trips, late drivers, missing ETAs, cancellations). Full UI at /ops-health page with alert history, scheduler status, and SMS alert system.

## Public Booking API (Feb 2026)
- **Public API Routes**: `server/lib/publicApiRoutes.ts` - Unauthenticated endpoints at `/api/public/*` for Lovable frontend integration. CORS restricted to `ALLOWED_ORIGIN_1` env var. Per-IP rate limiting.
- **Endpoints**: GET `/api/public/health` (service status), POST `/api/public/quote` (price calculation), POST `/api/public/request` (submit booking), POST `/api/public/status` (check request status by UUID).
- **Private Pricing Engine**: `server/lib/privatePricing.ts` - $2.50/mi base, 15% buffer, peak-hour surcharge (6-9AM, 4-7PM at 15%), WAV surcharge ($15), round-trip multiplier (1.85x), $0.50 rounding, min $35 / max $750.
- **Supabase Storage**: `private_requests` table in Supabase (auto-created via RPC if missing). Stores passenger info, addresses, quote, payment status.
- **Stripe Integration**: Optional payment intent verification on booking requests. Returns 402 if payment not succeeded, 503 if Stripe not configured.
- **Dispatch Notifications**: Email sent to ADMIN_EMAIL via Resend on new booking requests with full details.

## Recurring Patient Schedules (Feb 2026)
- **recurring_schedules Table**: `recurring_schedules` table stores patient-specific recurring schedules with `patientId`, `cityId`, `days` (text array e.g. ["Mon","Wed","Fri"]), `pickupTime` (24h format), `startDate`, `active` flag.
- **Schema & Types**: Defined in `shared/schema.ts` with `insertRecurringScheduleSchema`, `RecurringSchedule`, `InsertRecurringSchedule` types.
- **Storage CRUD**: Full CRUD in `server/storage.ts` - `getRecurringSchedulesByPatient`, `getRecurringSchedulesByCity`, `getActiveRecurringSchedules`, `createRecurringSchedule`, `updateRecurringSchedule`, `deleteRecurringSchedule`.
- **API Endpoints**: GET/POST/PATCH/DELETE `/api/recurring-schedules` with RBAC (SUPER_ADMIN, ADMIN, DISPATCH). POST `/api/recurring-schedules/generate` (SUPER_ADMIN) for manual trigger.
- **Patient Form UI**: Day selector toggle buttons (Mon-Sun) + time picker replaces old text input. Schedule data saved both to notes `[SCHEDULE: ...]` and to `recurring_schedules` table.
- **Midnight Scheduler**: `server/lib/recurringScheduleEngine.ts` - Checks every 60s for midnight window, generates trips for next 7 days based on active schedules. Skips dates before startDate, avoids duplicate trips (checks patientId + date + pickupTime). Trips created as SCHEDULED with tripType "recurring".
- **Manual Generate**: POST `/api/recurring-schedules/generate` allows SUPER_ADMIN to trigger trip generation on-demand.