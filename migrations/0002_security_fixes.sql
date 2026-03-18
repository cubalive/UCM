-- Security Fixes Migration
-- Generated: 2026-03-18
-- Fixes: D1 (cascade), D5 (scheduled_date), D7/D8 (unique/not null), DLQ table, trip_state_history, trip version

-- ─── 1. Dead Letter Queue Table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dead_letter_queue (
  id SERIAL PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE,
  job_type TEXT NOT NULL,
  queue_name TEXT NOT NULL DEFAULT 'default',
  payload JSONB DEFAULT '{}',
  error_message TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'failed', -- failed, retried
  retryable BOOLEAN NOT NULL DEFAULT TRUE,
  retried_at TIMESTAMPTZ,
  retried_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dlq_status ON dead_letter_queue(status);
CREATE INDEX IF NOT EXISTS idx_dlq_job_type ON dead_letter_queue(job_type);

-- ─── 2. Trip State History (Audit Trail) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS trip_state_history (
  id SERIAL PRIMARY KEY,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  actor_user_id INTEGER,
  actor_role TEXT,
  source TEXT DEFAULT 'manual',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trip_state_history_trip ON trip_state_history(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_state_history_created ON trip_state_history(created_at);

-- ─── 3. Version Column on Trips (Optimistic Locking) ────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'trips' AND column_name = 'version') THEN
    ALTER TABLE trips ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
  END IF;
END $$;

-- ─── 4. Performance Indexes ─────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trips_company_status ON trips(company_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trips_company_scheduled ON trips(company_id, scheduled_date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trips_driver_status ON trips(driver_id, status) WHERE driver_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trips_city_status ON trips(city_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trips_active ON trips(status) WHERE status NOT IN ('COMPLETED', 'CANCELLED', 'NO_SHOW');

-- ─── 5. Unique Constraints (D7) ─────────────────────────────────────────────
-- Deduplicate drivers by email (keep most recent)
DELETE FROM drivers a USING drivers b
WHERE a.id < b.id AND a.email = b.email AND a.email IS NOT NULL AND a.email != '';

-- Deduplicate clinics by email
DELETE FROM clinics a USING clinics b
WHERE a.id < b.id AND a.email = b.email AND a.email IS NOT NULL AND a.email != '';

-- Add unique constraints (if not already present)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'drivers_email_unique') THEN
    ALTER TABLE drivers ADD CONSTRAINT drivers_email_unique UNIQUE (email);
  END IF;
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'drivers_email_unique constraint skipped: duplicate emails still exist';
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clinics_email_unique') THEN
    ALTER TABLE clinics ADD CONSTRAINT clinics_email_unique UNIQUE (email);
  END IF;
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'clinics_email_unique constraint skipped: duplicate emails still exist';
END $$;

-- Note: users.email unique constraint should already exist from schema

-- ─── 6. Clinics company_id NOT NULL (D8) ────────────────────────────────────
-- First, identify orphan clinics (no company_id)
-- Set orphan clinics to the first company if they exist
DO $$ BEGIN
  UPDATE clinics SET company_id = (SELECT id FROM companies LIMIT 1)
  WHERE company_id IS NULL AND EXISTS (SELECT 1 FROM companies LIMIT 1);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not update orphan clinics: %', SQLERRM;
END $$;

-- Add NOT NULL constraint if not already set
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'clinics' AND column_name = 'company_id' AND is_nullable = 'YES') THEN
    ALTER TABLE clinics ALTER COLUMN company_id SET NOT NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not set clinics.company_id NOT NULL: %', SQLERRM;
END $$;

-- ─── 7. Refresh Tokens Table (already in schema, ensure exists) ─────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  family TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family);

-- ─── 8. MFA Tables (ensure exist) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mfa_backup_codes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mfa_audit_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  event_type TEXT NOT NULL,
  method TEXT,
  ip_address TEXT,
  user_agent TEXT,
  portal TEXT,
  metadata TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
