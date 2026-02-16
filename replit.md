# United Care Mobility (UCM)

## Overview
United Care Mobility (UCM) is a Medical Transportation Management System designed to streamline non-emergency medical transportation services across multiple cities. It aims to enhance operational efficiency, improve patient care coordination, and optimize resource allocation. The system provides a comprehensive solution for managing fleets, patients, and trips, featuring a robust dispatch engine. The project's ambition is to become a leading platform for non-emergency medical transport providers, enabling seamless, reliable, and compliant service delivery.

## User Preferences
I prefer iterative development with a focus on clear, modular code. I appreciate detailed explanations for complex architectural decisions and new feature implementations. Please ask before making any major changes to the core structure or public-facing APIs. I prefer that the agent does not make changes to the `shared/permissions.ts` file without explicit instruction.

## System Architecture
The application follows a client-server architecture.

**UI/UX Decisions:**
- **Frontend**: Built with React, Vite, Tailwind CSS, and shadcn/ui for a clean, intuitive design.
- **Color Scheme**: Emphasizes clarity and ease of use.
- **Live Maps**: Uber-like map views for drivers and live tracking for clinics with real-time updates and navigation options.
- **Admin Dashboards**: Comprehensive dashboards for operational oversight, financial metrics, and automation health.

**Technical Implementations & Feature Specifications:**
- **Authentication**: JWT-based with `bcryptjs` for password hashing and Magic Link Login via email.
- **Authorization**: Role-Based Access Control (RBAC) with roles like SUPER_ADMIN, ADMIN, DISPATCH, DRIVER, VIEWER, COMPANY_ADMIN, CLINIC_USER.
- **Data Management**: PostgreSQL with Drizzle ORM; multi-city data segregation; public ID system (e.g., `01UCM000001`).
- **Dispatch Engine**: Automated driver-vehicle and trip assignment, real-time tracking, ETA calculation, and safety rule enforcement.
- **Communication**: SMS notifications (Twilio) and branded email services (Resend).
- **Location Services**: Google Maps integration for geocoding, autocomplete, ETA, route optimization, and live maps with server-side caching.
- **Audit Logging**: Comprehensive logging of key system actions.
- **Trip Management**:
    - Shareable public tracking links.
    - Clinic address-city enforcement.
    - Static map thumbnails for trip routes.
    - Archive management with soft-delete and RBAC for entities.
    - Controlled dropdowns for vehicle makes & models.
    - Trip Approval Workflow with `approval_status`, fault party, billable status, and cancel fee calculation.
    - Recurring Trip Series with pattern-based scheduling and end conditions.
    - No-Show/Late Tracking via `trip_events`.
    - Go-Time Alert System for drivers with configurable city settings.
    - Driver Offer Acceptance system with TTL.
- **Automation & Operational Features**:
    - **7-Phase Automation System**: Route Engine, Vehicle & Trip Auto-Assignment, Anti No-Show System, Driver Score System, Financial Dashboard, Map Status Badges, Ops Health Automation Tab, Auto Assignment Center.
    - **Ops Health System**: Provides system status (GREEN/YELLOW/RED) with alerts.
    - **Driver Presence System**: Heartbeat endpoint for driver status tracking.
- **Portals & APIs**:
    - **Public Booking API**: Unauthenticated endpoints for quotes, booking requests, and status checks with CORS and rate limiting.
    - **Clinic Portal**: Comprehensive portal for clinics with dashboards, trip management, patient management, and reports, all clinic-scoped with RBAC.
    - **Multi-company Isolation**: `companies` table with `company_id` on core entities, server-side company filtering, and `checkCompanyOwnership` for security.
- **Realtime & Performance Hardening**:
    - **WebSocket Server**: JWT-authenticated, trip-scoped channels for real-time driver location, status, and ETA updates.
    - **Supabase Realtime**: Dual-broadcast for trip details, with token-based authentication and client-side hooks for robust real-time experiences.
    - **Upstash Redis (REST)**: Production-grade distributed cache (`server/lib/redis.ts`) with safe fallback to in-memory cache if env vars missing. Used for:
      - Shared TTL cache: `driver:{id}:last_location` (120s), `trip:{id}:driver_location` (120s), `trip:{id}:eta` (60s).
      - Distributed rate limiting: `rl:driver:{id}` (1 update/2s), `rl:ip:{ip}` (60 req/min) for GPS ingest.
      - Distributed locks: `lock:eta:{tripId}` (SETNX, 10s TTL) to prevent Directions API stampedes.
    - **In-Memory Cache**: Write-through layer for fast synchronous reads; Redis is source of truth.
    - **Driver Location Ingest**: Rate-limited (Redis + in-memory) and validated endpoint for single/batch location updates with cache-first storage and dual-broadcasting.
    - **ETA Throttle**: Recomputes ETA based on movement or time, with Redis-backed caching and distributed lock.
    - **Polling Reduction**: Optimized polling intervals and preference for real-time connections.
- **Financial & Billing**:
    - Invoice Email & Stripe Payment Links: Automatic invoice email sending with Stripe checkout integration for private/internal patients.
    - Clinic Cancel/Billing Workflow: Detailed process for managing cancellations, fault parties, billable status, and generating invoices with cancel fees.

## Driver App Experience
- **Today Dashboard**: Card-based home view with Next Pickup, Active Trip, Today's Schedule, Weekly Bonus Progress
- **Status Confirmations**: Trip status transitions require confirmation dialog with timestamp display and optional quick notes
- **Support Events**: "Need Help" panel with 5 event types (patient_not_ready, patient_no_show, address_incorrect, vehicle_issue, traffic_delay), stored in `driver_support_events` table
- **Offline Queue**: Dual queue system — GPS location queue + action queue for status transitions and support events, with automatic flush on reconnect
- **Heartbeat**: 30-second interval heartbeat ping to `/api/driver/heartbeat` when online
- **Navigation UX**: Copy-address fallback, auto-destination by trip phase, nav app preference persistence (localStorage)
- **Score Trend Chart**: Recharts-based AreaChart in metrics drawer showing score/completion/on-time trends from `/api/driver/score-history`
- **GPS Security**: Server-side anti-spoofing with coordinate validation, mock location rejection, accuracy warnings, and velocity-based teleport detection

## Mobile Driver App (Capacitor)
- **Location**: `mobile-driver/` — separate build target, does not affect web app
- **App ID**: `com.unitedcaremobility.driver`
- **Wraps**: `https://driver.unitedcaremobility.com` via Capacitor server.url
- **Background GPS**: `@capacitor-community/background-geolocation` plugin posts to `/api/driver/me/location` with JWT auth
- **Token Bridge**: JWT stored via Capacitor Preferences plugin, consumed by background location poster
- **Native UI**: Background Tracking card in driver dashboard drawer (only visible on native platform via `window.Capacitor.isNativePlatform()`)
- **Build**: Run `cd mobile-driver && bash setup.sh`, then `npm run cap:ios` or `npm run cap:android`
- **Host Detection**: Uses `isProdDomain = host.endsWith("unitedcaremobility.com")` pattern (not isReplit negative guard)

## External Dependencies
- **PostgreSQL**: Primary relational database.
- **Replit DB**: Operational data storage.
- **Supabase**: User authentication profiles, city management, Row-Level Security (RLS), and private requests storage.
- **Google Maps Platform**: Maps JavaScript API, Directions API, Geocoding API, Places API.
- **Twilio**: SMS messaging and opt-out requests.
- **Resend**: Transactional email delivery.
- **Stripe**: (Optional) Payment intent verification for public booking requests.