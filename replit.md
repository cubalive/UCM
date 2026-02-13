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
- **Trip Approval Workflow**: Trips have an `approval_status` (pending/approved/cancel_requested/cancelled) separate from operational status, with role-based approval and cancellation processes.

## External Dependencies
- **PostgreSQL**: Relational database for persistent storage, accessed via Drizzle ORM.
- **Replit DB**: Used for specific operational data storage.
- **Supabase**: Leveraged for user authentication profiles, city management, and Row-Level Security (RLS).
- **Google Maps Platform**: Utilized for Maps JavaScript API, Directions API, Geocoding API, Places API for location services, ETA calculations, route optimization, and live driver map.
- **Twilio**: Integrated for sending and receiving SMS messages and handling opt-out requests.
- **Resend**: Used for transactional email delivery, specifically for magic link logins and other email notifications.