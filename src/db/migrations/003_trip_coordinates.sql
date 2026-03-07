-- Migration: Add trip coordinate columns for geocoding and route calculation
-- These enable map rendering, distance calculation, and auto-assign proximity scoring

ALTER TABLE trips ADD COLUMN IF NOT EXISTS pickup_lat DECIMAL(10,7);
ALTER TABLE trips ADD COLUMN IF NOT EXISTS pickup_lng DECIMAL(10,7);
ALTER TABLE trips ADD COLUMN IF NOT EXISTS dropoff_lat DECIMAL(10,7);
ALTER TABLE trips ADD COLUMN IF NOT EXISTS dropoff_lng DECIMAL(10,7);
ALTER TABLE trips ADD COLUMN IF NOT EXISTS estimated_miles DECIMAL(10,2);
ALTER TABLE trips ADD COLUMN IF NOT EXISTS estimated_minutes INTEGER;

-- Index for proximity-based queries (auto-assign, map feeds)
CREATE INDEX IF NOT EXISTS trips_pickup_coords_idx ON trips (pickup_lat, pickup_lng) WHERE pickup_lat IS NOT NULL;
