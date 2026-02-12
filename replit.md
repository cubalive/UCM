# United Care Mobility (UCM)

## Overview
Medical Transportation Management System for managing multi-city non-emergency medical transportation services. Features multi-city support, role-based access control, and comprehensive fleet/patient/trip management.

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
- Audit logging
- Dashboard with stats
- Supabase integration for user profiles and city management

## Data Model
All city-scoped entities: vehicles, drivers, clinics, patients, trips
Global entities: users (with city access mapping), cities, audit_log
Supabase tables: profiles (uuid, linked to auth.users), cities (uuid, with RLS)

## Project Structure
- `shared/schema.ts` - Drizzle schema, Zod schemas, TypeScript types
- `server/routes.ts` - API routes with Zod validation and RBAC
- `server/storage.ts` - Database storage layer
- `server/auth.ts` - JWT auth middleware
- `server/seed.ts` - SUPER_ADMIN creation and seed data
- `server/public-id.ts` - Atomic public ID generator using DB sequence
- `lib/supabaseClient.ts` - Shared Supabase client (browser + server, lazy init)
- `client/src/lib/auth.tsx` - Auth context provider (calls /api/auth/me + /api/me)
- `client/src/pages/` - All page components
- `scripts/supabase-migration.sql` - Idempotent Supabase DDL (tables, functions, RLS)

## API Endpoints
- `GET /api/health` - Returns `{ ok, db, supabase, version }`
- `GET /api/me` - Returns `{ id, email, role, city_id, ucm_id }` (supports both JWT and Supabase tokens)
- `GET /api/auth/me` - Returns full user profile with city access
- `POST /api/auth/login` - Login with email/password
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

## Recent Changes
- 2026-02-12: Added Supabase integration (client, health check, /api/me dual-auth)
- 2026-02-12: Frontend error panel with retry button when /api/me fails
- 2026-02-12: SQL migration script for Supabase (cities, profiles, helper functions, RLS)
