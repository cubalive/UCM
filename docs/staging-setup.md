# UCM Platform — Staging Environment Setup

## Overview
Staging mirrors production but uses Stripe Test Mode and a separate database.

## Required Infrastructure

### Railway Staging Service
1. Create a new Railway project or environment: `ucm-staging`
2. Deploy from the same git branch (or a `staging` branch)
3. Configure environment variables (see below)

### Supabase Staging Database
1. Create a separate Supabase project: `ucm-staging`
2. Use the staging `DATABASE_URL` in Railway staging env
3. Run migrations: `npx drizzle-kit migrate`

### Stripe Test Mode
- Stripe automatically provides test mode keys alongside live keys
- Use `sk_test_*` and `pk_test_*` keys for staging
- Create a separate webhook endpoint in Stripe pointing to staging URL
- Use test mode webhook signing secret (`whsec_*` from test endpoint)

## Environment Variables for Staging

```env
DATABASE_URL=postgresql://...@staging-db.supabase.co:5432/postgres
REDIS_URL=redis://...@staging-redis:6379
STRIPE_SECRET_KEY=sk_test_your_test_key
STRIPE_WEBHOOK_SECRET=whsec_your_test_webhook_secret
STRIPE_PUBLISHABLE_KEY=pk_test_your_test_key
JWT_SECRET=staging-jwt-secret-at-least-32-characters
CSRF_SECRET=staging-csrf-secret-at-least-32-characters
SMTP_HOST=smtp.mailtrap.io  # Use Mailtrap for staging emails
SMTP_PORT=587
SMTP_USER=your_mailtrap_user
SMTP_PASS=your_mailtrap_pass
FROM_EMAIL=staging@ucm.example.com
APP_URL=https://ucm-staging.up.railway.app
PORT=3000
NODE_ENV=production
LOG_LEVEL=debug
SENTRY_DSN=  # Separate Sentry project for staging
```

## Stripe Test Mode Features
- Use test card numbers: `4242424242424242` (success), `4000000000000002` (decline)
- Stripe CLI for local webhook testing: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
- Test clocks for subscription testing
- All test mode data is isolated from live data

## Verification Checklist
- [ ] Staging database created and migrations applied
- [ ] Stripe test mode keys configured
- [ ] Webhook endpoint created in Stripe test mode
- [ ] Health check passes: `GET /api/health`
- [ ] Test invoice generation flow works
- [ ] Test payment flow works with test cards
- [ ] Email notifications arrive in Mailtrap
- [ ] Webhook events are received and processed
- [ ] Reconciliation report runs without errors

## Deployment Flow
```
main branch → CI (lint, typecheck, test, build) → merge → staging auto-deploy
staging verified → promote to production
```
