# UCM Deployment Guide

## Environments

| Environment   | Branch    | UCM_ENV      | NODE_ENV    | Domain                              |
|--------------|-----------|-------------|-------------|-------------------------------------|
| Production   | `main`    | `production` | `production` | `app.unitedcaremobility.com`       |
| Staging      | `develop` | `staging`    | `production` | `staging.unitedcaremobility.com`   |
| Development  | local     | `development`| `development`| `localhost:5000`                   |

> **NODE_ENV** stays `production` in both staging and production for optimized builds and secure defaults.
> **UCM_ENV** differentiates staging from production for logging, Sentry tags, and resource isolation.

## Railway Service Topology

Each environment (production + staging) runs two Railway services from the same Docker image:

```
Environment (production or staging)
 +-- ucm-api     (RUN_MODE=api)      Public HTTP + WebSocket
 +-- ucm-worker  (RUN_MODE=worker)   Background schedulers + jobs
 +-- Upstash Redis                   (external, separate per environment)
 +-- Supabase PostgreSQL             (external, separate per environment)
```

## RUN_MODE Values

| Value    | HTTP Server         | Schedulers | WebSocket | Use Case              |
|----------|--------------------|-----------|-----------|-----------------------|
| `api`    | Full Express       | No        | Yes       | Public-facing API     |
| `worker` | Healthcheck-only   | Yes       | No        | Background jobs       |
| `all`    | Full Express       | Yes       | Yes       | Dev / single-instance |

## Railway Service Configuration

### ucm-api

| Setting             | Value                             |
|--------------------|-----------------------------------|
| Docker image        | Same Dockerfile                   |
| Start command       | `node dist/index.cjs` (Dockerfile CMD) |
| Healthcheck path    | `/health`                         |
| Healthcheck timeout | 30s                               |
| Public networking   | Enabled                           |

### ucm-worker

| Setting             | Value                             |
|--------------------|-----------------------------------|
| Docker image        | Same Dockerfile                   |
| Start command       | `node dist/index.cjs` (Dockerfile CMD) |
| Healthcheck path    | `/health`                         |
| Healthcheck timeout | 30s                               |
| Public networking   | Disabled                          |

## Environment Variables

### Required (both services, both environments)

```
NODE_ENV=production
RUN_MODE=api|worker
PORT=5000

# Database (SEPARATE per environment)
SUPABASE_DB_URL=<connection string>
SUPABASE_URL=<url>
SUPABASE_ANON_KEY=<key>
SUPABASE_SERVICE_ROLE_KEY=<key>

# Auth
JWT_SECRET=<secret>
SESSION_SECRET=<secret>

# Redis (SEPARATE per environment)
UPSTASH_REDIS_REST_URL=<url>
UPSTASH_REDIS_REST_TOKEN=<token>
```

### Environment-specific

```
# Set on both Railway services in each environment
UCM_ENV=production          # or "staging"
PUBLIC_BASE_URL=https://app.unitedcaremobility.com   # or staging URL

# Stripe (SEPARATE keys per environment — use test keys for staging)
STRIPE_SECRET_KEY=sk_live_...    # production
STRIPE_SECRET_KEY=sk_test_...    # staging

# Sentry (same DSN, environment tag is set automatically from UCM_ENV)
SENTRY_DSN=<dsn>

# Google Maps (can share key, or use separate for quota isolation)
GOOGLE_MAPS_API_KEY=<key>

# Twilio (use test credentials for staging, or separate subaccount)
TWILIO_ACCOUNT_SID=<sid>
TWILIO_AUTH_TOKEN=<token>
```

## Staging vs Production — Resource Isolation

| Resource        | Isolation Strategy                                |
|----------------|--------------------------------------------------|
| PostgreSQL      | Separate Supabase project                        |
| Redis           | Separate Upstash database                        |
| Stripe          | Test keys (`sk_test_*`) in staging               |
| Sentry          | Same project, filtered by `environment` tag      |
| Twilio          | Test credentials or separate subaccount          |
| Google Maps     | Same or separate key (quota isolation optional)  |
| Domain          | `staging.unitedcaremobility.com`                 |

## CI/CD Pipeline

GitHub Actions runs on both `main` and `develop` branches:

| Branch    | CI Jobs                                      | Deploys To  |
|-----------|----------------------------------------------|-------------|
| `main`    | typecheck, test, build, docker smoke test    | Production  |
| `develop` | typecheck, test, build, docker smoke test    | Staging     |

Railway auto-deploys from the linked branch per environment.

### Railway Setup for Two Environments

1. **Production project**: Link to `main` branch, set `UCM_ENV=production`
2. **Staging project**: Link to `develop` branch, set `UCM_ENV=staging`
3. Each project has its own ucm-api + ucm-worker services
4. Each project points to its own Supabase + Upstash instances

## Health Endpoints

| Path                  | Auth       | DB Required | Purpose                              |
|-----------------------|-----------|-------------|--------------------------------------|
| `/health`             | None      | No          | Liveness probe (Railway healthcheck) |
| `/api/healthz`        | None      | Yes         | Full health with DB/Redis status     |
| `/api/readyz`         | None      | Yes         | Readiness probe                      |
| `/api/health/detailed`| Admin     | Yes         | Deep health with all subsystems      |

The `/health` response includes `environment`, `version`, and `runMode` fields.

## Logging

All structured logs (via pino) include these base fields:

```json
{
  "environment": "staging",
  "service": "api",
  "version": "2026.03.05.080000"
}
```

Sentry errors are tagged with `environment` and `service` for filtering.

## Subscription Enforcement

UCM enforces SaaS subscription status and usage quotas per company.

### How It Works

1. **Subscription status** is synced from Stripe via webhooks into `company_subscriptions`
2. **Per-company settings** in `company_subscription_settings` control:
   - `subscription_enabled` — whether enforcement is active for this company
   - `subscription_required_for_access` — whether an active subscription is required
   - `max_drivers`, `max_active_trips`, `max_clinics` — quota limits
   - `grace_period_days` — days of access after payment failure (default: 7)
3. **Two middleware layers**:
   - `requireSubscription` — gates API access when subscription is inactive
   - `enforceQuota` — blocks resource creation (POST /api/drivers, /api/trips, /api/clinics) when quotas are exceeded

### Subscription Statuses

| Status     | Reads | New Resources | Trip Completion |
|-----------|-------|--------------|-----------------|
| `active`   | Yes   | Yes (quota)  | Yes             |
| `trialing` | Yes   | Yes (quota)  | Yes             |
| `past_due` (within grace) | Yes | Yes (quota) | Yes |
| `past_due` (grace expired) | Yes | **No** | Yes |
| `canceled` | Yes   | **No**       | Yes             |
| `paused`   | Yes   | **No**       | Yes             |

**Critical rule**: Drivers can always complete assigned trips, even with inactive subscriptions.

### Error Codes

| Code | HTTP | Meaning |
|------|------|---------|
| `SUBSCRIPTION_INACTIVE` | 403 | Subscription is not active (canceled, paused, or past_due beyond grace) |
| `QUOTA_EXCEEDED` | 403 | Resource creation blocked — limit reached |

Response includes metadata: `companyId`, `status`, `limitName`, `currentUsage`, `limitValue`, `graceDaysRemaining`.

### Bypasses

- **SUPER_ADMIN** always bypasses all enforcement
- **Exempt paths**: `/health`, `/api/auth/*`, `/api/public/*`, `/api/stripe/*`, `/api/webhooks/*`
- **Companies without enforcement enabled** — `subscription_enabled = false` (default)

### Quota Defaults

| Quota | Default | Override Column |
|-------|---------|----------------|
| Max drivers | 50 | `max_drivers` |
| Max active trips | 200 | `max_active_trips` |
| Max clinics | 20 | `max_clinics` |
| Grace period | 7 days | `grace_period_days` |

### Redis Caching

Usage counts are cached in Redis with 30s TTL per company:
- Key: `company:{companyId}:usage_counts`
- Falls back to direct DB query when Redis is unavailable

### Staging Environment

For staging, simulate subscription states by:
1. Set `subscription_enabled = true` on test companies via admin API
2. Use Stripe test keys (`sk_test_*`) — subscriptions work with test cards
3. Manually set subscription status via admin endpoints for edge case testing
4. Grace period testing: set `current_period_end` to past dates

### Audit Trail

All enforcement blocks are logged to the `system_events` table with:
- `event_type: "subscription_enforcement"`
- Payload includes: code, reason, quota snapshot, environment, service, version

## Workflow

```
feature branch --> PR to develop --> merge --> staging auto-deploy
                                                    |
                                              test on staging
                                                    |
                                    PR from develop to main --> merge --> production auto-deploy
```
