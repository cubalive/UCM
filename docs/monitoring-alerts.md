# UCM Platform — Monitoring & Alerts Plan

## Critical Alerts (Page immediately)

| Alert | Condition | Source | Action |
|-------|-----------|--------|--------|
| Health check failing | `/api/health` returns 503 for >2 min | Railway / UptimeRobot | Check DB/Redis connectivity |
| DB connection pool exhausted | Pool errors in logs | Application logs | Scale pool or investigate connections |
| Unhandled errors spike | >10 unhandled errors in 5 min | Sentry | Investigate stack traces |
| Payment processing failure rate | >20% of payments failing in 1h | Application logs | Check Stripe status, review errors |

## Warning Alerts (Respond within 1 hour)

| Alert | Condition | Source | Action |
|-------|-----------|--------|--------|
| Dead letter queue growing | >10 dead letter events | Reconciliation job | Review and replay or resolve |
| Stuck invoices detected | Reconciliation finds stuck invoices | Reconciliation job | Manual review, Stripe verification |
| Ledger mismatches | Reconciliation finds mismatches | Reconciliation job | Investigate, manual correction |
| Redis unavailable | Redis health check fails | Health endpoint | Check Redis service, app degrades gracefully |
| High response latency | P95 >2s for API endpoints | Railway metrics | Scale or optimize queries |
| Webhook processing delay | Events >5 min old in "received" status | Application logs | Check processing pipeline |

## Informational (Review daily)

| Metric | Source | Purpose |
|--------|--------|---------|
| Total invoices by status | Billing report endpoint | Business health |
| Webhook processing rate | Webhook dashboard | Integration health |
| Daily revenue | Billing report | Business metric |
| Active tenants | DB query | Growth metric |
| API request volume | Railway metrics | Capacity planning |

## Implementation

### Sentry Integration
```typescript
// Already configured via SENTRY_DSN env var
// All unhandled errors are captured
// Transaction performance monitoring available
```

### UptimeRobot / Better Uptime
- Monitor: `GET /api/health/live` — basic uptime
- Monitor: `GET /api/health/ready` — readiness
- Monitor: `GET /api/health` — full system health
- Alert via: Slack, Email, PagerDuty

### Railway Built-in Monitoring
- CPU/Memory usage per deployment
- Request volume and latency
- Deploy success/failure notifications

### Log-Based Alerts
Use Railway log drains or a log aggregator (Datadog, Papertrail) to alert on:
- `logger.error` patterns
- `"Reconciliation"` + `"mismatch"` in logs
- `"dead_letter"` in logs
- `"STRIPE_WEBHOOK_SECRET"` errors (misconfiguration)

### Reconciliation Job as Monitor
The built-in reconciliation job (runs every 6 hours) acts as a synthetic monitor:
- Checks stuck invoices
- Checks ledger consistency
- Checks webhook processing health
- Logs warnings and errors that can trigger alerts
