-- Performance indexes for UCM Phase 5.4
-- Safe to run multiple times (IF NOT EXISTS)
-- These are add-only, non-destructive

-- Trips: clinic + date (clinic billing queries, clinic portal)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trips_clinic_scheduled
  ON trips (clinic_id, scheduled_date)
  WHERE deleted_at IS NULL;

-- Trips: driver + status (driver schedule, active trips)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trips_driver_status
  ON trips (driver_id, status)
  WHERE deleted_at IS NULL;

-- Trips: city + date (dispatch view, daily schedule)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trips_city_scheduled
  ON trips (city_id, scheduled_date)
  WHERE deleted_at IS NULL;

-- Trips: status + date (status-filtered lists)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trips_status_scheduled
  ON trips (status, scheduled_date)
  WHERE deleted_at IS NULL;

-- Trips: company + status (multi-company isolation)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trips_company_status
  ON trips (company_id, status)
  WHERE deleted_at IS NULL;

-- Audit log: entity lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_log_entity_created
  ON audit_log (entity, entity_id, created_at);

-- Drivers: city + status (dispatch assignment)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_drivers_city_status
  ON drivers (city_id, status)
  WHERE deleted_at IS NULL;
