#!/usr/bin/env bash
# =============================================================================
# UCM Railway Setup Script
# Run this in the Replit shell (NOT in Claude Code).
# Requires: RAILWAY_TOKEN and GITHUB_TOKEN set in Replit Secrets.
# =============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[UCM]${NC} $*"; }
warn() { echo -e "${YELLOW}[UCM]${NC} $*"; }
err()  { echo -e "${RED}[UCM]${NC} $*" >&2; }

# ---------------------------------------------------------------------------
# 1. Preflight: check required env vars
# ---------------------------------------------------------------------------
REQUIRED_VARS=(
  RAILWAY_TOKEN
  SUPABASE_DB_URL
  UPSTASH_REDIS_REST_URL
  UPSTASH_REDIS_REST_TOKEN
  STRIPE_SECRET_KEY
  STRIPE_WEBHOOK_SECRET
  JWT_SECRET
  SENTRY_DSN
  GOOGLE_MAPS_API_KEY
)

missing=0
for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var:-}" ]; then
    err "Missing env var: $var"
    missing=1
  fi
done
if [ "$missing" -eq 1 ]; then
  err "Set the missing variables in Replit Secrets and restart, then re-run."
  exit 1
fi
log "All required environment variables present."

# ---------------------------------------------------------------------------
# 2. Install Railway CLI
# ---------------------------------------------------------------------------
if ! command -v railway &>/dev/null; then
  log "Installing Railway CLI..."
  npm install -g @railway/cli
else
  log "Railway CLI already installed: $(railway version)"
fi

# ---------------------------------------------------------------------------
# 3. Authenticate (uses RAILWAY_TOKEN env var automatically)
# ---------------------------------------------------------------------------
log "Authenticating with Railway..."
railway whoami || { err "Authentication failed. Check RAILWAY_TOKEN."; exit 1; }

# ---------------------------------------------------------------------------
# 4. Create or link project named "UCM"
# ---------------------------------------------------------------------------
PROJECT_NAME="UCM"

# Check if we're already linked
if railway status &>/dev/null 2>&1; then
  log "Already linked to a Railway project."
else
  log "Creating Railway project: $PROJECT_NAME ..."
  railway init --name "$PROJECT_NAME" || {
    warn "Project may already exist. Attempting to link..."
    railway link
  }
fi

log "Project status:"
railway status

# ---------------------------------------------------------------------------
# 5. Create service named "ucm-backend"
# ---------------------------------------------------------------------------
SERVICE_NAME="ucm-backend"
log "Setting up service: $SERVICE_NAME"

# Railway CLI v3+ uses 'railway service' commands
railway service --set "$SERVICE_NAME" 2>/dev/null || {
  log "Creating service $SERVICE_NAME..."
  railway add --service "$SERVICE_NAME" 2>/dev/null || {
    warn "Service may already exist or CLI version differs."
    warn "If needed, create the service manually in the Railway dashboard."
  }
}

# ---------------------------------------------------------------------------
# 6. Link GitHub repository
# ---------------------------------------------------------------------------
GITHUB_REPO="cubalive/UCM"
log "Linking GitHub repo: $GITHUB_REPO"
warn "GitHub repo linking must be done via the Railway dashboard:"
warn "  1. Go to https://railway.app/dashboard"
warn "  2. Open the UCM project"
warn "  3. Select the ucm-backend service"
warn "  4. Settings > Source > Connect Repo > Select '$GITHUB_REPO'"
warn "  (Railway requires OAuth authorization for GitHub, which cannot be done via CLI)"

# ---------------------------------------------------------------------------
# 7. Set environment variables on Railway
# ---------------------------------------------------------------------------
log "Pushing environment variables to Railway..."

# App config
railway variables set NODE_ENV=production
railway variables set PORT=5000

# Database
railway variables set SUPABASE_DB_URL="$SUPABASE_DB_URL"

# Redis
railway variables set UPSTASH_REDIS_REST_URL="$UPSTASH_REDIS_REST_URL"
railway variables set UPSTASH_REDIS_REST_TOKEN="$UPSTASH_REDIS_REST_TOKEN"

# Stripe
railway variables set STRIPE_SECRET_KEY="$STRIPE_SECRET_KEY"
railway variables set STRIPE_WEBHOOK_SECRET="$STRIPE_WEBHOOK_SECRET"

# Auth
railway variables set JWT_SECRET="$JWT_SECRET"

# Observability
railway variables set SENTRY_DSN="$SENTRY_DSN"

# Google Maps
railway variables set GOOGLE_MAPS_API_KEY="$GOOGLE_MAPS_API_KEY"

# Copy additional shared vars from Replit if present
[ -n "${SUPABASE_URL:-}" ]              && railway variables set SUPABASE_URL="$SUPABASE_URL"
[ -n "${SUPABASE_ANON_KEY:-}" ]         && railway variables set SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY"
[ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ] && railway variables set SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY"
[ -n "${TWILIO_ACCOUNT_SID:-}" ]        && railway variables set TWILIO_ACCOUNT_SID="$TWILIO_ACCOUNT_SID"
[ -n "${TWILIO_AUTH_TOKEN:-}" ]         && railway variables set TWILIO_AUTH_TOKEN="$TWILIO_AUTH_TOKEN"
[ -n "${SESSION_SECRET:-}" ]            && railway variables set SESSION_SECRET="$SESSION_SECRET"
[ -n "${PUBLIC_BASE_URL:-}" ]           && railway variables set PUBLIC_BASE_URL="$PUBLIC_BASE_URL"
[ -n "${PUBLIC_BASE_URL_APP:-}" ]       && railway variables set PUBLIC_BASE_URL_APP="$PUBLIC_BASE_URL_APP"
[ -n "${PUBLIC_BASE_URL_DRIVER:-}" ]    && railway variables set PUBLIC_BASE_URL_DRIVER="$PUBLIC_BASE_URL_DRIVER"
[ -n "${GEOFENCE_ENABLED:-}" ]          && railway variables set GEOFENCE_ENABLED="$GEOFENCE_ENABLED"
[ -n "${SMS_REMINDER_ENABLED:-}" ]      && railway variables set SMS_REMINDER_ENABLED="$SMS_REMINDER_ENABLED"

log "Environment variables pushed."

# ---------------------------------------------------------------------------
# 8. Summary
# ---------------------------------------------------------------------------
echo ""
echo "==========================================="
echo "  UCM Railway Setup Complete"
echo "==========================================="
echo ""
railway status
echo ""
railway variables
echo ""
log "Next steps:"
log "  1. Link GitHub repo in Railway dashboard (see instructions above)"
log "  2. Deploy: railway up"
log "  3. Check health: curl \$(railway domain)/health"
log "  4. View logs: railway logs"
echo ""
