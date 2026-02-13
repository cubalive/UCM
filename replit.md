# United Care Mobility (UCM)

## Overview
United Care Mobility (UCM) is a Medical Transportation Management System designed to streamline non-emergency medical transportation services across multiple cities. The system aims to enhance operational efficiency, improve patient care coordination, and optimize resource allocation within a complex, multi-city environment. It provides a comprehensive solution for managing fleets, patients, and trips, featuring a robust dispatch engine. The project's ambition is to become the leading platform for non-emergency medical transport providers, enabling seamless, reliable, and compliant service delivery.

## User Preferences
I prefer iterative development with a focus on clear, modular code. I appreciate detailed explanations for complex architectural decisions and new feature implementations. Please ask before making any major changes to the core structure or public-facing APIs. I prefer that the agent does not make changes to the `shared/permissions.ts` file without explicit instruction.

## System Architecture
The application follows a client-server architecture.
- **Frontend**: Built with React, Vite, Tailwind CSS, and shadcn/ui, located in the `client/` directory. UI/UX emphasizes a clean, intuitive design with a consistent color scheme derived from Tailwind CSS and shadcn/ui components.
- **Backend**: An Express.js API residing in the `server/` directory, handling business logic, data access, and external integrations.
- **Database**: PostgreSQL is used as the primary data store, managed via Drizzle ORM. Replit DB is utilized for operational data.
- **Authentication**: JWT-based authentication with `bcryptjs` for password hashing. The `/api/me` endpoint supports both internal JWTs and Supabase access tokens.
- **Authorization**: Role-Based Access Control (RBAC) is implemented with roles including SUPER_ADMIN, ADMIN, DISPATCH, DRIVER, and VIEWER, enforcing permissions across the system.
- **Multi-city Support**: Core entities like vehicles, drivers, clinics, patients, and trips are scoped to specific cities, ensuring data segregation and operational independence.
- **Public ID System**: A consistent `01UCM000001` format is used for public-facing identifiers, generated atomically using database sequences.
- **Dispatch Engine**: Features include driver-vehicle assignment, trip assignment with ETA calculation, automated dispatching, and real-time driver status tracking (available, enroute, hold, off). Safety rules prevent cross-city assignments and enforce vehicle requirements (e.g., wheelchair accessibility).
- **SMS Notifications**: Integrated Twilio for template-based and custom SMS notifications to patients and dispatch, with opt-out compliance via inbound webhooks.
- **Audit Logging**: Comprehensive logging of key system actions for accountability and troubleshooting.
- **Google Maps Integration**: Services for geocoding, address autocomplete, ETA calculation, and route optimization, with server-side caching and rate limiting.
- **Project Structure**: Organized into `client/`, `server/`, and `shared/` directories. `shared/schema.ts` defines common Drizzle and Zod schemas. `server/routes.ts` centralizes API routes with Zod validation and RBAC.

## External Dependencies
- **PostgreSQL**: Relational database for persistent storage, accessed via Drizzle ORM.
- **Replit DB**: Used for specific operational data storage.
- **Supabase**: Leveraged for user authentication profiles, city management, and Row-Level Security (RLS).
- **Google Maps Platform**: Utilized for Maps JavaScript API, Directions API, Geocoding API, and Places API for location services, ETA calculations, route optimization, and live driver map. The frontend loads the Maps JS API via a protected `/api/maps/client-key` endpoint.
- **Twilio**: Integrated for sending and receiving SMS messages, including patient notifications and handling SMS opt-out requests.

## Recent Changes
- **Trip Sharing & Tracking** (Feb 2026): Added shareable tracking links for trips. Backend: `trip_share_tokens` + `trip_sms_log` tables, endpoints for creating/revoking share tokens (`POST /api/trips/:id/share-token`, `POST /api/trips/:id/share-token/revoke`), public tracking endpoint (`GET /api/public/trips/track/:token`). Frontend: Public tracking page at `/t/:token` (outside auth, with Google Maps), ETA display + "5 min away" badge in Trip Detail dialog, tracking link create/copy/revoke UI for dispatch. SMS templates (driver_assigned, en_route, arriving_soon) auto-include tracking URLs.
- **ETA to Pickup** (Feb 2026): `GET /api/trips/:id/eta-to-pickup` uses Google Directions API with cached fallback. Polls every 120s in Trip Detail dialog for active trips.
- **Live Map page** (Feb 2026): Added `/live-map` page under Ops (dispatch resource) showing real-time driver locations on Google Maps. Backend endpoint `GET /api/ops/driver-locations?city_id=...` returns active driver locations. Frontend polls every 10s, highlights stale drivers (>2min), gracefully handles missing Maps API key. Protected endpoint `GET /api/maps/client-key` serves the Google Maps API key to authenticated dispatch/admin users.
- **Role-Based Map Views** (Feb 2026): Extended Live Map with role-specific views. Users table has `clinicId`, `patientId`, `driverId` fields for linking to entities. Backend: `/api/ops/driver-locations` supports SUPER_ADMIN/ADMIN/DISPATCH (all city drivers), VIEWER+clinicId (only drivers on clinic's active trips), VIEWER+patientId (only their trip's driver), DRIVER (self only). `/api/ops/my-active-trips` returns active trip context per role. Frontend: ClinicMapView shows trip cards + filtered driver map, PatientMapView shows single trip + single driver, DispatchMapView unchanged. VIEWER and DRIVER roles can access `/live-map` via custom route check (no changes to `shared/permissions.ts`).