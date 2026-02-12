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
- Audit logging
- Dashboard with stats
- Supabase integration for user profiles and city management

## Data Model
All city-scoped entities: vehicles, drivers, clinics, patients, trips
Global entities: users (with city access mapping), cities, audit_log
Supabase tables: profiles (uuid, linked to auth.users), cities (uuid, with RLS)

### Key Schema Fields
- **vehicles**: colorHex (hex color for map markers)
- **drivers**: vehicleId (FK to vehicles), lastLat/lastLng/lastSeenAt (GPS tracking), dispatchStatus (available/enroute/hold/off)
- **trips**: driverId, vehicleId, pickupLat/pickupLng, dropoffLat/dropoffLng, lastEtaMinutes, distanceMiles, durationMinutes, routePolyline

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
- `server/lib/rateLimiter.ts` - Per-IP rate limiter (in-memory, 60 req/min)
- `lib/supabaseClient.ts` - Shared Supabase client (browser + server, lazy init)
- `lib/mapsConfig.ts` - Google Maps API key config (reads GOOGLE_MAPS_API_KEY env)
- `client/src/lib/auth.tsx` - Auth context provider (calls /api/auth/me + /api/me)
- `client/src/components/MapLoader.tsx` - Maps availability context (backend-only, no key exposure)
- `client/src/pages/dispatch-map.tsx` - Dispatch center page (driver/trip management, status controls, assignment)
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
- CRUD endpoints for all entities under `/api/*`

## Running
- `npm run dev` - Development with hot reload
- Health check: GET /api/health

## Secrets Required
- DATABASE_URL - PostgreSQL connection (Replit DB)
- JWT_SECRET - JWT signing key
- ADMIN_EMAIL - Super admin email
- ADMIN_PASSWORD - Super admin password
- SUPABASE_URL - Supabase project URL
- SUPABASE_ANON_KEY - Supabase anon/public key
- SUPABASE_SERVICE_ROLE_KEY - Supabase service role key
- GOOGLE_MAPS_API_KEY - Google Maps API key (Maps JS, Directions, Geocoding, Places)

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
