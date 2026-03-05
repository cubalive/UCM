# Railway Deployment Guide

## Service Topology

UCM runs as two Railway services from the same Docker image, differentiated by `RUN_MODE`:

```
┌─────────────────────────────────────────────────┐
│                   Railway                        │
│                                                  │
│  ┌──────────────┐       ┌──────────────────┐    │
│  │   ucm-api    │       │   ucm-worker     │    │
│  │ RUN_MODE=api │       │ RUN_MODE=worker  │    │
│  │              │       │                  │    │
│  │ Express HTTP │       │ Schedulers       │    │
│  │ WebSocket    │       │ Job processor    │    │
│  │ Static files │       │ Orchestrator     │    │
│  │              │       │ Route optimizer  │    │
│  │ Port: $PORT  │       │ Port: $PORT      │    │
│  │ Public       │       │ Private          │    │
│  └──────┬───────┘       └────────┬─────────┘    │
│         │                        │               │
│         └────────┬───────────────┘               │
│                  │                               │
│         ┌────────▼────────┐                      │
│         │  Upstash Redis  │  (external)          │
│         │  Leader Election│                      │
│         │  Rate Limiting  │                      │
│         │  Caching        │                      │
│         └────────┬────────┘                      │
│                  │                               │
│         ┌────────▼────────┐                      │
│         │ Supabase Postgres│ (external)          │
│         │  All data        │                      │
│         └─────────────────┘                      │
└─────────────────────────────────────────────────┘
```

## RUN_MODE Values

| Value | Resolves To | HTTP Server | Schedulers | WebSocket | Use Case |
|-------|------------|-------------|------------|-----------|----------|
| `api` | `server` | Full Express + routes | No | Yes | Public-facing API |
| `worker` | `worker` | Healthcheck-only | Yes (with leader election) | No | Background jobs |
| `all` | `all` | Full Express + routes | Yes | Yes | Dev / single-instance |

## Railway Service Configuration

### ucm-api (Public)

| Setting | Value |
|---------|-------|
| Docker image | Same Dockerfile |
| Start command | `node dist/index.cjs` (from Dockerfile CMD) |
| Healthcheck path | `/health` |
| Healthcheck timeout | 30s |
| Public networking | Enabled |
| Custom domain | `app.unitedcaremobility.com` |

**Environment variables:**
```
NODE_ENV=production
RUN_MODE=api
PORT=5000
SUPABASE_DB_URL=<connection string>
JWT_SECRET=<secret>
SESSION_SECRET=<secret>
SUPABASE_URL=<url>
SUPABASE_ANON_KEY=<key>
SUPABASE_SERVICE_ROLE_KEY=<key>
UPSTASH_REDIS_REST_URL=<url>
UPSTASH_REDIS_REST_TOKEN=<token>
GOOGLE_MAPS_API_KEY=<key>
STRIPE_SECRET_KEY=<key>
TWILIO_ACCOUNT_SID=<sid>
TWILIO_AUTH_TOKEN=<token>
PUBLIC_BASE_URL=https://app.unitedcaremobility.com
```

### ucm-worker (Private)

| Setting | Value |
|---------|-------|
| Docker image | Same Dockerfile |
| Start command | `node dist/index.cjs` (from Dockerfile CMD) |
| Healthcheck path | `/health` |
| Healthcheck timeout | 30s |
| Public networking | Disabled |

**Environment variables:**
Same as ucm-api, except:
```
RUN_MODE=worker
```

## Health Endpoints

| Path | Auth | DB Required | Purpose |
|------|------|-------------|---------|
| `/health` | None | No | Liveness probe (Railway healthcheck) |
| `/api/healthz` | None | Yes | Full health with DB/Redis/scheduler status |
| `/api/readyz` | None | Yes | Readiness probe (DB connected?) |
| `/api/health` | None | Yes | Legacy health check |
| `/api/health/detailed` | SUPER_ADMIN/ADMIN | Yes | Deep health with all subsystems |

## Leader Election

When multiple worker instances run, Upstash Redis leader election ensures only one instance runs schedulers at a time. The leader:
- Runs all 15+ scheduler loops
- Runs orchestrator and route optimizer
- Heartbeats via Redis every 10s

If the leader dies, another instance acquires leadership within ~30s.

Set `LEADER_ELECTION=false` to disable (not recommended for multi-instance).

## Scaling Guidelines

- **ucm-api**: Scale horizontally. All instances are stateless. WebSocket connections are per-instance (no sticky sessions needed for REST, but WS clients reconnect automatically).
- **ucm-worker**: Scale to 2+ for HA. Leader election ensures only one runs schedulers. Job processing can run on all instances (uses DB-level locking).

## Troubleshooting

### Container won't start
- Check `dist/index.cjs` exists in the build output
- Verify `NODE_ENV=production` is set
- Check Railway build logs for esbuild errors

### Health check fails
- `/health` should always return 200 (no DB dependency)
- If `/api/healthz` returns 503, check `SUPABASE_DB_URL`
- Check Railway logs for `process_start` and `boot_complete` events

### Schedulers not running
- Verify `RUN_MODE=worker` on the worker service
- Check logs for `schedulers_initialized` event
- If using leader election, check `schedulers_waiting_for_leadership` event
- Verify `UPSTASH_REDIS_REST_URL` is set for leader election

### Rate limiting not distributed
- Verify `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set
- Falls back to in-memory per-instance limiting if Redis unavailable
