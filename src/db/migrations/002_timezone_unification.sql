-- Migration: Timezone Unification
-- Converts all timestamp columns to timestamptz (timestamp with time zone)
-- Adds timezone fields to tenants and trips tables
-- All existing data is assumed to be UTC

-- Ensure database timezone is UTC
ALTER DATABASE CURRENT SET timezone TO 'UTC';

-- 1. Add timezone fields
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/New_York';
ALTER TABLE trips ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/New_York';

-- 2. Convert all timestamp columns to timestamptz
-- tenants
ALTER TABLE tenants
  ALTER COLUMN subscription_expires_at TYPE timestamptz USING subscription_expires_at AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';

-- users
ALTER TABLE users
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';

-- patients
ALTER TABLE patients
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';

-- trips
ALTER TABLE trips
  ALTER COLUMN scheduled_at TYPE timestamptz USING scheduled_at AT TIME ZONE 'UTC',
  ALTER COLUMN started_at TYPE timestamptz USING started_at AT TIME ZONE 'UTC',
  ALTER COLUMN completed_at TYPE timestamptz USING completed_at AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';

-- fee_rules
ALTER TABLE fee_rules
  ALTER COLUMN effective_from TYPE timestamptz USING effective_from AT TIME ZONE 'UTC',
  ALTER COLUMN effective_to TYPE timestamptz USING effective_to AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';

-- invoices
ALTER TABLE invoices
  ALTER COLUMN billing_period_start TYPE timestamptz USING billing_period_start AT TIME ZONE 'UTC',
  ALTER COLUMN billing_period_end TYPE timestamptz USING billing_period_end AT TIME ZONE 'UTC',
  ALTER COLUMN due_date TYPE timestamptz USING due_date AT TIME ZONE 'UTC',
  ALTER COLUMN paid_at TYPE timestamptz USING paid_at AT TIME ZONE 'UTC',
  ALTER COLUMN sent_at TYPE timestamptz USING sent_at AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';

-- invoice_line_items
ALTER TABLE invoice_line_items
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';

-- ledger_entries
ALTER TABLE ledger_entries
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';

-- webhook_events
ALTER TABLE webhook_events
  ALTER COLUMN processed_at TYPE timestamptz USING processed_at AT TIME ZONE 'UTC',
  ALTER COLUMN last_attempt_at TYPE timestamptz USING last_attempt_at AT TIME ZONE 'UTC',
  ALTER COLUMN dead_lettered_at TYPE timestamptz USING dead_lettered_at AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';

-- audit_log
ALTER TABLE audit_log
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';

-- billing_cycles
ALTER TABLE billing_cycles
  ALTER COLUMN period_start TYPE timestamptz USING period_start AT TIME ZONE 'UTC',
  ALTER COLUMN period_end TYPE timestamptz USING period_end AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN closed_at TYPE timestamptz USING closed_at AT TIME ZONE 'UTC';

-- driver_status
ALTER TABLE driver_status
  ALTER COLUMN last_location_at TYPE timestamptz USING last_location_at AT TIME ZONE 'UTC',
  ALTER COLUMN last_manual_override TYPE timestamptz USING last_manual_override AT TIME ZONE 'UTC',
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';

-- driver_earnings
ALTER TABLE driver_earnings
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';

-- driver_locations
ALTER TABLE driver_locations
  ALTER COLUMN recorded_at TYPE timestamptz USING recorded_at AT TIME ZONE 'UTC';
