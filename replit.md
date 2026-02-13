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
- **Google Maps Platform**: Utilized for Maps JavaScript API, Directions API, Geocoding API, and Places API for location services, ETA calculations, and route optimization.
- **Twilio**: Integrated for sending and receiving SMS messages, including patient notifications and handling SMS opt-out requests.