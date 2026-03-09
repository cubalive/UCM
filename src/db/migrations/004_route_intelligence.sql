-- Migration 004: Route intelligence and dispatch readiness
-- Adds route caching, ETA tracking, and dispatch intelligence fields

-- Add route cache fields to trips
ALTER TABLE trips ADD COLUMN IF NOT EXISTS route_polyline TEXT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS route_distance_miles DECIMAL(10, 2);
ALTER TABLE trips ADD COLUMN IF NOT EXISTS route_duration_minutes INTEGER;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS route_fetched_at TIMESTAMPTZ;

-- Add ETA tracking
ALTER TABLE trips ADD COLUMN IF NOT EXISTS eta_minutes INTEGER;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS eta_updated_at TIMESTAMPTZ;

-- Add vehicle type preference to trips
ALTER TABLE trips ADD COLUMN IF NOT EXISTS vehicle_type TEXT;

-- Add performance tracking to driver_status
ALTER TABLE driver_status ADD COLUMN IF NOT EXISTS avg_completion_minutes DECIMAL(10, 1);
ALTER TABLE driver_status ADD COLUMN IF NOT EXISTS completed_trips_30d INTEGER DEFAULT 0;
ALTER TABLE driver_status ADD COLUMN IF NOT EXISTS on_time_rate DECIMAL(5, 2);
ALTER TABLE driver_status ADD COLUMN IF NOT EXISTS decline_rate_7d DECIMAL(5, 2);

-- Index for route cache freshness
CREATE INDEX IF NOT EXISTS trips_route_fetched_idx ON trips(route_fetched_at) WHERE route_fetched_at IS NOT NULL;

-- Index for ETA queries
CREATE INDEX IF NOT EXISTS trips_eta_idx ON trips(eta_updated_at) WHERE eta_minutes IS NOT NULL;
