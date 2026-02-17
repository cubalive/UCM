# UCM System Performance Baseline

Generated: 2026-02-17
Version: Phase 5 Performance Audit

## 1. API Route Inventory

### Top Routes by Request Volume (from requestMetrics)

| Route | Method | Typical RPM | p50 (ms) | p95 (ms) |
|-------|--------|-------------|----------|----------|
| /api/trips | GET | High | ~20 | ~80 |
| /api/driver/location | POST | High (GPS) | ~15 | ~50 |
| /api/driver/heartbeat | POST | Medium | ~10 | ~30 |
| /api/auth/me | GET | Medium | ~15 | ~40 |
| /api/patients | GET | Medium | ~25 | ~100 |
| /api/clinics | GET | Medium | ~20 | ~60 |
| /api/drivers | GET | Medium | ~20 | ~80 |
| /api/vehicles | GET | Low-Med | ~15 | ~50 |
| /api/trips/:id | GET | Medium | ~30 | ~120 |
| /api/ops/health | GET | Low | ~50 | ~200 |
| /api/tracking/:token | GET | Low-Med | ~25 | ~80 |
| /api/maps/autocomplete | GET | Low | ~100 | ~500 |
| /api/maps/geocode | POST | Low | ~80 | ~400 |
| /api/driver/trips/active | GET | Low-Med | ~20 | ~60 |
| /api/driver/summary | GET | Low | ~30 | ~100 |
| /api/invoices | GET | Low | ~25 | ~80 |
| /api/ops/metrics | GET | Low | ~20 | ~50 |
| /api/reports/* | GET | Low | ~100 | ~500 |
| /api/trips/:id/pdf | GET | Low | ~200 | ~800 |
| /api/invoices/:id/pdf | GET | Low | ~300 | ~1200 |

### Latency Hotspots (p95 > 200ms)

1. **PDF Generation** (trip + invoice): CPU-bound, synchronous PDF rendering
2. **Google Maps API calls**: Geocoding, Directions, Places (network-bound)
3. **Reports endpoints**: Complex aggregation queries
4. **Ops Health checks**: Multiple DB queries per city
5. **Trip list with filters**: Full-table scans without proper indexes

## 2. Database Analysis

### Current Indexes on `trips` Table
- `trips_pkey` (id)
- `trips_public_id_unique` (public_id)
- `idx_trips_company_id` (company_id)
- `idx_trips_invoice_id` (invoice_id)

### Missing Indexes (Identified Bottlenecks)
- `trips(clinic_id, scheduled_date DESC)` — clinic trip lists
- `trips(driver_id, status, scheduled_date DESC)` — driver schedule queries
- `trips(city_id, scheduled_date DESC)` — city-scoped date filtering
- `trips(city_id, status)` — active trip lookups by city
- `invoices(clinic_id)` — invoice list filtering
- `billing_cycle_invoices` already has `bci_clinic_period_idx`

### DB-Heavy Endpoints
1. `GET /api/trips` — filters by city, date, status, clinic; no composite index
2. `GET /api/ops/health` — loads all trips for city+date, then all drivers
3. `GET /api/reports/*` — aggregation across trips/invoices
4. ETA Engine cycle — queries all active en-route trips every 2min
5. Assignment Engine — queries available drivers + unassigned trips

## 3. Realtime System

### WebSocket
- Connection auth: JWT from query param
- Subscription model: trip-scoped (`subscribe_trip`, `unsubscribe_trip`)
- Broadcast types: `driver_location`, `status_change`, `eta_update`
- Coalescing: 5s window per trip for location updates
- Backpressure: 3-tier publish interval (5s/10s/15s)

### Current Metrics Tracked
- Active WS connections count
- Active subscription count
- Supabase broadcast counts

### Known Issues
- No topic-based subscriptions (clinic/driver/city level)
- All subscribers get all data for subscribed trips
- No delta broadcasting (full payload each time)

## 4. Google Maps Usage

### API Call Types
| API | Cache TTL | Circuit Breaker | Fallback |
|-----|-----------|-----------------|----------|
| Directions/ETA | 60s (memory) | 30 calls/min, 2min cooldown | Haversine |
| Build Route | 90s (memory) | Same as above | Error thrown |
| Geocoding | 30 days (memory) | None | Error thrown |
| Places Autocomplete | 10min (memory) | None | Error thrown |
| Place Details | 30 days (memory) | None | Error thrown |
| Distance Matrix | 60s (memory) | Falls back to Directions | Haversine |
| Static Maps | None | None | null |

### Cost Concerns
- ETA recalculation runs every 2min for ALL active trips
- Memory-only caches lost on restart
- No Redis-backed caching for Directions/ETA
- No per-company rate limiting

## 5. Redis/Cache Architecture

### Current
- Upstash Redis (REST mode) with in-memory fallback
- Write-through: memory cache + Redis
- Key patterns: `driver:{id}:last_location`, `trip:{id}:driver_location`, `trip:{id}:eta`
- TTLs: 120s driver location, 120s trip location, 60s ETA
- Rate limiting: `rl:driver:{id}` (2s), `rl:ip:{ip}` (60/min)
- Distributed locks: `lock:eta:{tripId}` (10s SETNX)

### Metrics Tracked
- Hit/miss rates by key category
- Rate limit events
- Lock contention events

## 6. Top 5 Bottlenecks

1. **Missing DB indexes on trips table** — clinic_id, driver_id+status, city_id+scheduled_date queries do full table scans
2. **Google Maps ETA cache is memory-only** — lost on restart, causing burst of API calls; no Redis backing for Directions results
3. **No query budget enforcement** — some endpoints trigger unbounded N+1 queries without detection
4. **No pagination on some list endpoints** — trips list can return thousands of rows
5. **No per-company Google Maps rate limiting** — one heavy clinic can exhaust the quota for all

## 7. SLO Targets

| Metric | Current Estimate | Target |
|--------|-----------------|--------|
| API p95 latency | ~200ms | <150ms |
| API error rate | <2% | <1% |
| Google Maps cache hit rate | ~30% | >50% |
| WS message delivery | ~5s coalesce | <3s for status changes |
| DB query time share | Unknown | <40% of request time |

## 8. Profiling Mode

Set `UCM_PROFILE=true` to enable:
- Per-request timing breakdown (dbMs, cacheHit, externalApiMs)
- Query count per request logging
- N+1 detection warnings
- Extended metrics in /api/ops/perf/summary
