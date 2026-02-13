# United Care Mobility (UCM)

## Overview
Medical Transportation Management System for managing multi-city non-emergency medical transportation services. Features multi-city support, role-based access control, comprehensive fleet/patient/trip management, and a full dispatch engine with driver-vehicle linking, trip assignment, auto-dispatch, and driver status tracking.

## Architecture
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui, served from `client/`
- **Backend**: Express.js API, served from `server/`
- **Database**: PostgreSQL via Drizzle ORM (Replit DB for operational data)
- **Supabase**: Connected for auth profiles, cities, and RLS-protected data
- **Auth**: JWT-based with bcryptjs password hashing; /api/me also supports Supabase access tokens

## Key Features
- Multi-city system with city-scoped data
- RBAC: SUPER_ADMIN, ADMIN, DISPATCH, DRIVER, VIEWER
- Public ID system (01UCM000001 format)
- CRUD for Cities, Users, Vehicles, Drivers, Clinics, Patients, Trips
- Dispatch engine: driver-vehicle assignment, trip assignment, auto-dispatch, driver status
- Driver dispatch status: available, enroute, hold, off
- Safety rules: no cross-city assignments, wheelchair accessibility checks, vehicle requirement enforcement
- Google Maps ETA calculation on trip assignment (graceful fallback when API unavailable)
- Twilio SMS notifications for patients and dispatch (template-based + custom messages)
- SMS opt-out compliance (STOP/START keyword handling via inbound webhook)
- Audit logging
- Dashboard with stats
- Supabase integration for user profiles and city management

## Data Model
All city-scoped entities: vehicles, drivers, clinics, patients, trips
Global entities: users (with city access mapping), cities, audit_log, sms_opt_out
Supabase tables: profiles (uuid, linked to auth.users), cities (uuid, with RLS)

### Key Schema Fields
- **vehicles**: colorHex (hex color for map markers)
- **drivers**: vehicleId (FK to vehicles), lastLat/lastLng/lastSeenAt (GPS tracking), dispatchStatus (available/enroute/hold/off)
- **trips**: driverId, vehicleId, pickupLat/pickupLng, dropoffLat/dropoffLng, lastEtaMinutes, distanceMiles, durationMinutes, routePolyline
- **sms_opt_out**: phone (PK), optedOut, updatedAt

## Project Structure
- `shared/schema.ts` - Drizzle schema, Zod schemas, TypeScript types
- `server/routes.ts` - API routes with Zod validation and RBAC
- `server/storage.ts` - Database storage layer (IStorage interface)
- `server/auth.ts` - JWT auth middleware
- `server/seed.ts` - SUPER_ADMIN creation and seed data
- `server/public-id.ts` - Atomic public ID generator using DB sequence
- `server/lib/googleMaps.ts` - Google Maps service (geocode, autocomplete, ETA, route) with TTL caching
- `server/lib/mapsRoutes.ts` - Maps API endpoints with Zod validation and rate limiting
- `server/lib/dispatchRoutes.ts` - Dispatch engine endpoints (assign vehicle, assign trip, auto-assign, driver status)
- `server/lib/twilioSms.ts` - Twilio SMS helper (sendSms, message templates, opt-out check)
- `server/lib/smsRoutes.ts` - SMS API endpoints (send, trip notify, inbound webhook, health)
- `server/lib/rateLimiter.ts` - Per-IP rate limiter (in-memory, 60 req/min)
- `lib/supabaseClient.ts` - Shared Supabase client (browser + server, lazy init)
- `lib/mapsConfig.ts` - Google Maps API key config (reads GOOGLE_MAPS_API_KEY env)
- `client/src/lib/auth.tsx` - Auth context provider (calls /api/auth/me + /api/me)
- `client/src/components/MapLoader.tsx` - Maps availability context (backend-only, no key exposure)
- `client/src/pages/dispatch-map.tsx` - Dispatch center page (driver/trip management, status controls, assignment, SMS notifications)
- `client/src/pages/` - All page components
- `scripts/supabase-migration.sql` - Idempotent Supabase DDL (tables, functions, RLS)

## API Endpoints
- `GET /api/health` - Returns `{ ok, db, supabase, version }`
- `GET /api/me` - Returns `{ id, email, role, city_id, ucm_id }` (supports both JWT and Supabase tokens)
- `GET /api/auth/me` - Returns full user profile with city access
- `POST /api/auth/login` - Login with email/password
- `GET /api/maps/health` - Returns `{ ok, mapsKeyLoaded }` (no key exposed)
- `POST /api/maps/geocode` - Geocode address to lat/lng (server-side only)
- `POST /api/maps/places/autocomplete` - Address autocomplete suggestions (server-side only)
- `POST /api/maps/eta` - Traffic-aware ETA between two locations (server-side only)
- `POST /api/maps/route` - Route with waypoint optimization (server-side only)
- `POST /api/dispatch/assign-driver-vehicle` - Link driver to vehicle (same city, no conflicts)
- `POST /api/dispatch/assign-trip` - Assign trip to driver (validates vehicle, city, wheelchair, calculates ETA)
- `POST /api/dispatch/auto-assign` - Smart auto-assign: closest available drivers to unassigned trips
- `POST /api/dispatch/unassign-driver-vehicle` - Remove vehicle from driver
- `POST /api/drivers/status` - Change driver dispatch status (available/enroute/hold/off)
- `POST /api/drivers/location` - Update driver GPS coordinates
- `GET /api/dispatch/map-data` - Full dispatch dashboard data (drivers+vehicles, active trips, clinics)
- `GET /api/sms/health` - Returns `{ ok, twilioConfigured }` (Twilio config status)
- `POST /api/sms/send` - Send direct SMS (SUPER_ADMIN/DISPATCH, E.164 validation, opt-out check)
- `POST /api/trips/:id/notify` - Send patient notification by trip status template (SUPER_ADMIN/DISPATCH)
- `POST /api/twilio/inbound` - Twilio inbound webhook (STOP/START opt-out handling, TwiML response)
- `PATCH /api/patients/:id` - Update patient fields (SUPER_ADMIN/ADMIN/DISPATCH, phone auto-normalized)
- CRUD endpoints for all entities under `/api/*`

## Running
- `npm run dev` - Development with hot reload
- Health check: GET /api/health
- SMS health: GET /api/sms/health

## Secrets Required
- DATABASE_URL - PostgreSQL connection (Replit DB)
- JWT_SECRET - JWT signing key
- ADMIN_EMAIL - Super admin email
- ADMIN_PASSWORD - Super admin password
- SUPABASE_URL - Supabase project URL
- SUPABASE_ANON_KEY - Supabase anon/public key
- SUPABASE_SERVICE_ROLE_KEY - Supabase service role key
- GOOGLE_MAPS_API_KEY - Google Maps API key (Maps JS, Directions, Geocoding, Places)
- TWILIO_ACCOUNT_SID - Twilio account SID
- TWILIO_AUTH_TOKEN - Twilio auth token
- TWILIO_FROM_NUMBER - Twilio sender phone (E.164 format)
- DISPATCH_PHONE_NUMBER - Dispatch office phone (optional, defaults to TWILIO_FROM_NUMBER)

## Recent Changes
- 2026-02-12: Added Supabase integration (client, health check, /api/me dual-auth)
- 2026-02-12: Frontend error panel with retry button when /api/me fails
- 2026-02-12: SQL migration script for Supabase (cities, profiles, helper functions, RLS)
- 2026-02-12: Google Maps integration (lib/mapsConfig.ts, MapLoader.tsx, /api/maps/test endpoint)
- 2026-02-12: Backend-only Google Maps service (geocode, autocomplete, ETA, route) with caching + rate limiting
- 2026-02-12: Added lat/lng columns to clinics, patients tables; pickup/dropoff lat/lng + ETA fields to trips table
- 2026-02-12: Dispatch engine: driver-vehicle linking, trip assignment with ETA, auto-dispatch, driver status system
- 2026-02-12: Dispatch Center page (/dispatch) with driver/trip panels, status controls, assignment dialogs
- 2026-02-12: Schema: dispatchStatus enum (available/enroute/hold/off), colorHex on vehicles, distanceMiles/durationMinutes/routePolyline on trips
- 2026-02-13: Twilio SMS integration: helper service, message templates, opt-out compliance table
- 2026-02-13: SMS API endpoints: /api/sms/send, /api/trips/:id/notify, /api/twilio/inbound, /api/sms/health
- 2026-02-13: SMS notification UI in Dispatch Center: template-based and custom SMS from active trips
- 2026-02-13: Phone normalization: auto-convert (xxx) xxx-xxxx to E.164 on save (patients, drivers, clinics) and on send
- 2026-02-13: SMS service hardening: retry-once on Twilio failure, structured error logging
- 2026-02-13: Automatic SMS triggers: driver_assigned on trip assign, en_route on driver status enroute (with ETA), arrived on trip IN_PROGRESS
- 2026-02-13: Live ETA engine: recalculates ETA every 60s for en_route trips using Google Maps Directions API
- 2026-02-13: Auto "arriving soon" 5-min SMS alert: triggers once when ETA <= 5 min (fiveMinAlertSent flag prevents duplicates)
- 2026-02-13: Enhanced dispatch panel: live ETA display, distance badges, driver status indicators, stale ETA warnings, alert-sent badges
- `server/lib/dispatchAutoSms.ts` - Shared auto-notification helper (fire-and-forget, opt-out aware)
- `server/lib/etaEngine.ts` - Live ETA recalculation engine (60s interval, 5-min alert trigger)
- 2026-02-13: Patient editing: PATCH /api/patients/:id (SUPER_ADMIN/ADMIN/DISPATCH), notes column added, edit dialog in patients page
- 2026-02-13: Required trip times: pickupTime (required), estimatedArrivalTime (optional) added to trips schema + form + display
- 2026-02-13: Facility type classification: facilityType enum (clinic/hospital/mental/private) added to clinics schema + form + display badge
