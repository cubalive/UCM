# United Care Mobility (UCM)

## Overview
Medical Transportation Management System for managing multi-city non-emergency medical transportation services. Features multi-city support, role-based access control, and comprehensive fleet/patient/trip management.

## Architecture
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui, served from `client/`
- **Backend**: Express.js API, served from `server/`
- **Database**: PostgreSQL via Drizzle ORM
- **Auth**: JWT-based with bcryptjs password hashing

## Key Features
- Multi-city system with city-scoped data
- RBAC: SUPER_ADMIN, ADMIN, DISPATCH, DRIVER, VIEWER
- Public ID system (01UCM000001 format)
- CRUD for Cities, Users, Vehicles, Drivers, Clinics, Patients, Trips
- Audit logging
- Dashboard with stats

## Data Model
All city-scoped entities: vehicles, drivers, clinics, patients, trips
Global entities: users (with city access mapping), cities, audit_log

## Project Structure
- `shared/schema.ts` - Drizzle schema, Zod schemas, TypeScript types
- `server/routes.ts` - API routes with Zod validation and RBAC
- `server/storage.ts` - Database storage layer
- `server/auth.ts` - JWT auth middleware
- `server/seed.ts` - SUPER_ADMIN creation and seed data
- `server/public-id.ts` - Atomic public ID generator using DB sequence
- `client/src/lib/auth.tsx` - Auth context provider
- `client/src/pages/` - All page components

## Running
- `npm run dev` - Development with hot reload
- Health check: GET /api/health

## Secrets Required
- DATABASE_URL - PostgreSQL connection
- JWT_SECRET - JWT signing key
- ADMIN_EMAIL - Super admin email
- ADMIN_PASSWORD - Super admin password
