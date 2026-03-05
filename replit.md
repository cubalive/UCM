# United Care Mobility (UCM)

## Overview
United Care Mobility (UCM) is a Medical Transportation Management System designed to streamline non-emergency medical transportation services across multiple cities. It aims to enhance operational efficiency, improve patient care coordination, and optimize resource allocation. The system provides a comprehensive solution for managing fleets, patients, and trips, featuring a robust dispatch engine. The project's ambition is to become a leading platform for non-emergency medical transport providers, enabling seamless, reliable, and compliant service delivery.

## User Preferences
I prefer iterative development with a focus on clear, modular code. I appreciate detailed explanations for complex architectural decisions and new feature implementations. Please ask before making any major changes to the core structure or public-facing APIs. I prefer that the agent does not make changes to the `shared/permissions.ts` file without explicit instruction.

## System Architecture
The application follows a client-server architecture.

**UI/UX Decisions:**
- **Frontend**: Built with React, Vite, Tailwind CSS, and shadcn/ui.
- **Live Maps**: Uber-like map views for drivers and live tracking for clinics.
- **Admin Dashboards**: Comprehensive dashboards for operational oversight, financial metrics, and automation health.

**Technical Implementations & Feature Specifications:**
- **Authentication & Authorization**: JWT-based with Magic Link Login, dual-auth, and centralized Permission-Based Access Control using a `ROLE_PERMISSIONS` matrix for clinic-scoped roles.
- **Data Management**: PostgreSQL with Drizzle ORM, supporting multi-city data segregation, public IDs, and US States/Cities master reference tables.
- **Dispatch Engine**: Automated driver-vehicle and trip assignment, real-time tracking, ETA, and safety rule enforcement, utilizing a deterministic state machine for trip status transitions. This includes an "Approved = Assigned" Auto-Dispatch feature with preferred driver priority and clinic affinity scoring.
- **Communication**: SMS notifications and branded email services with automated patient communication and configurable geofencing.
- **Location Services**: Google Maps integration for geocoding, autocomplete, ETA, route optimization, and live maps. Server-side geofence gating for driver status transitions.
- **Realtime & Performance**: WebSocket server, Supabase Realtime, Upstash Redis for caching, rate-limited data ingestion, and ETA throttling. Includes a centralized `transitionTripStatus()` helper for consistent state changes and instant dispatch board updates.
- **Enterprise Multi-Tenant & Async Engine**: Hard multi-tenant enforcement, Redis-backed background job queue, idempotency, company quotas, and system event streams. Distributed job engine with Redis-backed scheduler and locks.
- **Financial & Billing**: Configurable platform pricing, automatic invoice emailing, Stripe integration, and a financial engine for double-entry ledger creation, detailed financial breakdowns, and payout reconciliation.
- **Payroll**: Per-company payroll settings, idempotent earnings ledger, payrun management with Stripe transfers, and an Earnings Modifiers Engine.
- **Driver & Clinic Portals**: Dedicated portals for clinics and drivers, including a Driver App with background GPS, push notifications, and feature flags. Clinic Portal features an Arrival Radar and Smart Staff Alerts.
- **UCM Intelligence Core**: Integrates daily/weekly metrics, TRI scores, cost leak alerts, certifications, and a Driver Intelligence Engine for performance scoring and anomaly detection.
- **Enterprise Multi-Instance Hardening**: `ROLE_MODE` runtime split, Redis-based leader election, priority job queue with DLQ, circuit breakers, and priority-based load shedding.
- **Agentic Features (UCM Agentic C)**: Redis Streams event bus with orchestrator and route worker for computing and finalizing Google Maps routes, including route proof API.
- **Dispatch Window Engine**: Intelligent dispatch timing system for optimal dispatch and notification times based on ETA and mobility buffers, including trip feasibility checking.
- **Round-Trip Enforcement**: Supports `is_round_trip`, `return_required`, `return_note`, `paired_trip_id` for managing round trips with either a return pickup time or a return note.
- **Enhanced Driver Dispatch UX**: Real-time driver WebSocket channel for dispatch_notify, dispatch_now, tracking_stale, tracking_restored events. Driver portal features upcoming reservations, dispatch notification banners, and tracking health monitoring.
- **Multi-Subdomain Architecture**: Centralized API at `app.unitedcaremobility.com` with specific subdomains for `app`, `clinic`, `driver`, `dispatch`, `admin`. CORS allows all UCM subdomains.
- **Production Stability & Deployment**: `RUN_MODE` environment variable (`api`/`worker`/`all`) controls process split. Optimistic concurrency control on trip status updates. Golden contract test suite for validation. Deployment configured via `Dockerfile`, `fly.toml`, `render.yaml`.
- **Mobile Apps (iOS/Android - Capacitor)**: Three Capacitor-wrapped apps: Driver, Clinic, and Admin, each with its own configurations for background GPS, push notifications, native platform settings, and universal links.

## External Dependencies
- **PostgreSQL**: Primary relational database.
- **Supabase**: User authentication, city management, Row-Level Security (RLS).
- **Google Maps Platform**: Maps JavaScript API, Directions API, Geocoding API, Places API.
- **Twilio**: SMS messaging.
- **Resend**: Transactional email delivery.
- **Stripe**: Payment processing, subscriptions, and financial integrations.
- **Upstash Redis**: Distributed cache and message broker.
- **Firebase Cloud Messaging**: Push notifications.