# Driver Trip Workflow

## Trip Status Enum

| Status | Description |
|---|---|
| SCHEDULED | Trip created, no driver assigned yet |
| ASSIGNED | Driver assigned, waiting to start |
| EN_ROUTE_TO_PICKUP | Driver heading to pickup location |
| ARRIVED_PICKUP | Driver at pickup location |
| PICKED_UP | Patient in vehicle |
| EN_ROUTE_TO_DROPOFF | Driving to destination |
| IN_PROGRESS | Alternative to EN_ROUTE_TO_DROPOFF |
| ARRIVED_DROPOFF | At destination |
| COMPLETED | Trip finished |
| CANCELLED | Trip cancelled |
| NO_SHOW | Patient no-show |

## Valid Transitions

| From | Allowed Next States |
|---|---|
| SCHEDULED | ASSIGNED, CANCELLED |
| ASSIGNED | EN_ROUTE_TO_PICKUP, CANCELLED |
| EN_ROUTE_TO_PICKUP | ARRIVED_PICKUP, CANCELLED |
| ARRIVED_PICKUP | PICKED_UP, NO_SHOW, CANCELLED |
| PICKED_UP | EN_ROUTE_TO_DROPOFF, IN_PROGRESS, CANCELLED |
| EN_ROUTE_TO_DROPOFF | ARRIVED_DROPOFF, CANCELLED |
| ARRIVED_DROPOFF | COMPLETED, CANCELLED |
| IN_PROGRESS | COMPLETED, CANCELLED |
| COMPLETED | (terminal) |
| CANCELLED | (terminal) |
| NO_SHOW | (terminal) |

## Trip Phase Derivation

The `getTripPhase(trip)` function derives the current phase:

- **PICKUP phase**: status is ASSIGNED, EN_ROUTE_TO_PICKUP, or ARRIVED_PICKUP
- **DROPOFF phase**: status is PICKED_UP, EN_ROUTE_TO_DROPOFF, ARRIVED_DROPOFF, or IN_PROGRESS
- **DONE phase**: status is COMPLETED, CANCELLED, or NO_SHOW

## UI Button Mapping

| Status | Primary Action | Navigation Label | Navigate Target |
|---|---|---|---|
| ASSIGNED | Go to Pickup (-> EN_ROUTE_TO_PICKUP) | Go to Pickup | Pickup address |
| EN_ROUTE_TO_PICKUP | Mark Arrived at Pickup (-> ARRIVED_PICKUP) | Go to Pickup | Pickup address |
| ARRIVED_PICKUP | Picked Up Patient (-> PICKED_UP) | Go to Pickup | Pickup address |
| PICKED_UP | Start Trip to Dropoff (-> EN_ROUTE_TO_DROPOFF) | Go to Dropoff | Dropoff address |
| EN_ROUTE_TO_DROPOFF | Mark Arrived at Dropoff (-> ARRIVED_DROPOFF) | Go to Dropoff | Dropoff address |
| ARRIVED_DROPOFF | Complete Trip (-> COMPLETED) | Go to Dropoff | Dropoff address |
| IN_PROGRESS | Complete Trip (-> COMPLETED) | Go to Dropoff | Dropoff address |
| COMPLETED | No actions | - | - |
| CANCELLED | No actions | - | - |

## Navigation Provider

### Supported Providers
- **Google Maps**: `https://www.google.com/maps/dir/?api=1&destination=LAT,LNG`
- **Apple Maps**: `https://maps.apple.com/?daddr=LAT,LNG`
- **Waze**: `https://waze.com/ul?ll=LAT,LNG&navigate=yes`

### Storage
- Key: `ucm_driver_nav_app` in localStorage
- Values: `"google"`, `"apple"`, or `"waze"`
- Behavior: If saved, opens directly; if not saved, shows NavChooser modal with "Remember my choice" toggle
- Clear: "Change" link below navigate button resets saved preference
- Settings page: Navigation Provider card lets driver select/change default at any time

### Coordinate Priority
1. Use lat/lng from trip record if available
2. Fall back to address string (URL-encoded)

## Status Update API

**Endpoint**: `PATCH /api/trips/:id/status`

**Body**: `{ "status": "<NEXT_STATUS>", "idempotencyKey": "<optional>" }`

**Validations**:
- Driver must own the trip
- Transition must be in VALID_TRANSITIONS
- Cannot complete without pickup timestamp
- Geofence check for ARRIVED_PICKUP/ARRIVED_DROPOFF (if GEOFENCE_ENABLED=true)

**Timestamp Columns Set Automatically**:
| Status | Column |
|---|---|
| EN_ROUTE_TO_PICKUP | startedAt |
| ARRIVED_PICKUP | arrivedPickupAt |
| PICKED_UP | pickedUpAt |
| EN_ROUTE_TO_DROPOFF | enRouteDropoffAt |
| ARRIVED_DROPOFF | arrivedDropoffAt |
| COMPLETED | completedAt |
| CANCELLED | cancelledAt |
| NO_SHOW | cancelledAt |

## Geofence Gating

When `GEOFENCE_ENABLED=true`:
- ARRIVED_PICKUP requires driver within `GEOFENCE_PICKUP_RADIUS_METERS` (default 120m)
- ARRIVED_DROPOFF requires driver within `GEOFENCE_DROPOFF_RADIUS_METERS` (default 160m)
- Dispatch/SUPER_ADMIN can override via `POST /api/trips/:id/status/override`

## Common Failure Modes

| Issue | Prevention |
|---|---|
| Buttons not showing | `getTripPhase()` always returns a phase; STATUS_FLOW covers all active statuses |
| Double-tap status | Idempotency key prevents duplicate transitions; same-status returns success |
| Invalid transition | Server validates against VALID_TRANSITIONS; client shows only valid next action |
| Offline status change | Queued locally, synced on reconnect via offline action queue |
| Navigation fails | Falls back to address-encoded URL if lat/lng missing |
| Complete without pickup | Server rejects: "Cannot complete trip: no pickup timestamp recorded" |

## Smoke Test Checklist

1. Assigned trip shows "Go to Pickup" as primary action
2. After Go to Pickup -> shows "Mark Arrived at Pickup"
3. After Arrived Pickup -> shows "Picked Up Patient"
4. After Picked Up -> shows "Start Trip to Dropoff"
5. After Start Trip -> shows "Mark Arrived at Dropoff"
6. After Arrived Dropoff -> shows "Complete Trip"
7. Navigation button shows "Go to Pickup" during pickup phases
8. Navigation button shows "Go to Dropoff" during dropoff phases
9. NavChooser modal shows Google Maps, Apple Maps, Waze
10. "Remember my choice" persists and auto-opens preferred app
11. "Change" link clears saved preference
12. Completed/Cancelled trips show no action buttons

## Architecture: Single Source of Truth

All trip state logic lives in `shared/tripStateMachine.ts`:
- `TripState` / `TripEvent` constants
- `transition(state, event)` - returns next state or throws
- `allowedEvents(state)` - returns valid events for a state
- `uiActions(state)` - returns status action + nav action for driver UI
- `derivePhase(state)` - returns PICKUP / DROPOFF / DONE
- `deriveStateFromTrip(trip)` - maps existing trip record to canonical state
- `VALID_TRANSITIONS` - computed from transition table, used by server
- `STATUS_TIMESTAMP_MAP` - maps status to timestamp column name

Server imports `VALID_TRANSITIONS` and `STATUS_TIMESTAMP_MAP` from this module.
UI imports `uiActions`, `derivePhase`, `getNavLabel`, `getNavTarget` from this module.
Navigation destination (pickup vs dropoff) is derived exclusively via `getNavTarget(status)`.
No other code decides state transitions or navigation targets.

## Navigation is Decoupled from State

Navigation actions (Go to Pickup, Go to Dropoff) open external map apps.
They NEVER change trip state. Only EVENT buttons (status actions) change state.
The NavChooser component is purely a UI utility for launching Google Maps, Apple Maps, or Waze.

## Shift + Connected Coexistence

Driver home shows four independent states:
- DISCONNECTED: not connected to dispatch
- CONNECTED_OFF_SHIFT: connected but not clocked in
- ON_SHIFT: connected and clocked in, tracking active
- ON_BREAK: on shift but temporarily on break

Both connection state and shift state are always visible simultaneously.
A "Connected" badge is shown on ON_SHIFT and ON_BREAK states so it never disappears.

## Trip Delete/Cancel RBAC

| Role | Can Archive (Soft Delete) | Can Hard Delete | Can Cancel |
|---|---|---|---|
| SUPER_ADMIN | Yes | Yes (SCHEDULED/ASSIGNED/CANCELLED only) | Yes |
| COMPANY_ADMIN | Yes (own company) | No | Yes |
| DISPATCH | Yes (own company) | No | Yes |
| DRIVER | No | No | No |

Hard delete removes the trip record permanently. Archive sets `archivedAt` timestamp.
Active/in-progress trips cannot be archived (409 response).
