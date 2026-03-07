# UCM Platform — Secrets Rotation Plan

## Secrets Inventory

| Secret | Location | Rotation Frequency | Impact of Rotation |
|--------|----------|-------------------|-------------------|
| `DATABASE_URL` | Railway / Supabase | On compromise only | Full restart required |
| `REDIS_URL` | Railway | On compromise only | Brief cache miss |
| `STRIPE_SECRET_KEY` | Stripe Dashboard | Every 90 days recommended | Old key invalid immediately |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard | When endpoint changes | Webhooks fail until updated |
| `JWT_SECRET` | Railway env vars | Every 90 days | All active sessions invalidated |
| `CSRF_SECRET` | Railway env vars | Every 90 days | Active forms invalidated |
| `SMTP_PASS` | SMTP provider | Per provider policy | Emails fail until updated |
| `SENTRY_DSN` | Sentry dashboard | Rarely | Error tracking paused |

## Rotation Procedures

### Stripe Keys
1. Go to Stripe Dashboard → Developers → API Keys
2. Click "Roll key" on the secret key
3. Copy the new key
4. Update `STRIPE_SECRET_KEY` in Railway environment variables
5. Deploy — Railway will restart with new key
6. Verify: hit `/api/health` and confirm `stripe: "up"`
7. Old key is invalidated immediately by Stripe

### Stripe Webhook Secret
1. Go to Stripe Dashboard → Developers → Webhooks
2. Select the UCM endpoint
3. Click "Reveal" on signing secret → note old secret
4. If rolling: delete endpoint, recreate with same URL
5. Update `STRIPE_WEBHOOK_SECRET` in Railway
6. Deploy and verify with a test event from Stripe

### JWT Secret
1. Generate a new 64-character random string: `openssl rand -hex 32`
2. Update `JWT_SECRET` in Railway environment variables
3. Deploy — all existing JWTs are invalidated
4. Users must re-authenticate
5. Consider: deploy during low-traffic period

### Database URL
1. Supabase: Settings → Database → Reset database password
2. Update `DATABASE_URL` in Railway
3. Deploy and verify `/api/health/ready`

### SMTP Credentials
1. Rotate via your email provider's dashboard
2. Update `SMTP_USER` and/or `SMTP_PASS` in Railway
3. Deploy and verify by triggering a test email

## Emergency Rotation (Suspected Compromise)
1. Rotate ALL secrets simultaneously
2. Deploy immediately
3. Audit: check `GET /api/admin/audit-log` for suspicious activity
4. Check Stripe Dashboard for unauthorized charges
5. Review webhook events for unusual patterns
6. Notify affected users if data breach is confirmed

## Automation Opportunities
- Railway supports environment variable groups — use a shared group for non-sensitive defaults
- Consider HashiCorp Vault or AWS Secrets Manager for automated rotation
- Set calendar reminders for 90-day rotation cycles
- Monitor failed auth attempts as an early warning signal
