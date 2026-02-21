# Driver Performance Scoring

## Overview
Driver Performance provides a real-time Turn Score (0–100) with a letter grade (A–F) based on weighted KPIs. Scores are computed server-side per active shift.

## KPIs
| KPI | Description | Weight |
|-----|-------------|--------|
| Punctuality | On-time arrival rate (arrived_pickup ≤ scheduled + grace) | 45% |
| Acceptance | Trip acceptance rate (offers accepted / offers received) | 20% |
| Idle Time | Non-productive time while on shift (capped at 120 min) | 15% |
| Cancellations | Driver-initiated cancellations (capped at 5) | 10% |
| Compliance | Location freshness while on shift | 10% |

## Score Formula
```
score = Σ(kpi_score × weight) / Σ(weights)
```
Each KPI is normalized to 0–100. The final score is clamped to [0, 100].

- **Idle score**: `max(0, 100 - (idleMinutes / 120) × 100)`
- **Cancel score**: `max(0, 100 - (cancelCount / 5) × 100)`

## Grade Mapping
| Score Range | Grade | Color |
|-------------|-------|-------|
| 90–100 | A | Emerald |
| 80–89 | B | Blue |
| 70–79 | C | Amber |
| 60–69 | D | Orange |
| 0–59 | F | Red |

## Configuration
Weights are configurable per company via `company_settings.driverV3.scoring.weights`.

Default weights: `{ punctuality: 45, acceptance: 20, idle: 15, cancellations: 10, compliance: 10 }`

Grace minutes (default 5) configurable via `company_settings.driverV3.scoring.graceMinutes`.

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/driver/performance/current-shift` | Current shift performance (score, grade, KPIs) |

## Feature Flags (Triple-Gate)
1. **Environment**: `DRIVER_V3_PERFORMANCE_ENABLED=true`
2. **Company**: `company_settings.driverV3.performance = true`
3. **Driver**: `driver_settings.performanceVisible = true`

All must be enabled for the feature to be active.

## Files
- `shared/driverPerformance.ts` — Score computation, grade mapping
- `shared/driverPerformance.test.ts` — 17 unit tests
- `client/src/pages/driver-performance.tsx` — Performance screen UI
- `server/controllers/driver-portal.controller.ts` — API handler

## UI
- Performance page at `/driver/performance` with score circle, grade badge, KPI breakdown
- Navigation link in Settings tab ("Performance" button)
- "Show Performance" toggle in Driver Preferences card
