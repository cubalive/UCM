# Smart Prompts

## Overview
Smart Prompts provide context-aware, non-spammy alerts to drivers based on trip timing, location proximity, and ETA analysis. Each prompt fires at most once per trip per phase.

## Prompt Types

### LEAVE_NOW
- **Trigger**: Pickup in ≤ 25 minutes AND driver status is pre-en-route (ASSIGNED, SCHEDULED, PENDING)
- **Priority**: Critical if ≤ 10 min, Normal otherwise
- **Actions**: "Navigate to Pickup", "Snooze"
- **Fires**: Once per trip (stored in localStorage)

### ARRIVE_NOW
- **Trigger**: Driver within 150m geofence of pickup AND status is EN_ROUTE_TO_PICKUP or EN_ROUTE
- **Priority**: Normal
- **Actions**: "Mark Arrived", "Dismiss"
- **Fires**: Once per trip

### LATE_RISK
- **Trigger**: ETA exceeds scheduled pickup + grace period
- **Priority**: Critical
- **Actions**: "Navigate to Pickup", "Dismiss"
- **Cooldown**: 10 minutes between re-fires for same trip

## Anti-Spam Mechanism
- **localStorage tracking**: Each fired prompt is recorded per trip ID and prompt type
- **Cooldown enforcement**: LATE_RISK respects configurable cooldown (default 10 min)
- **Phase-aware**: Prompts only fire in appropriate trip statuses
- **Cleanup**: Old records for inactive trips are automatically removed

## Configuration
```typescript
{
  tMinusLeaveNow: 25,    // minutes before pickup to fire LEAVE_NOW
  geofenceMeters: 150,   // proximity threshold for ARRIVE_NOW
  cooldownMin: 10,       // cooldown for LATE_RISK re-fires
  graceMin: 5,           // grace period before ETA is considered late
}
```

## Feature Flags
1. **Driver preference**: `driver_settings.promptsEnabled` (default true)
2. Smart Prompts only evaluate when driver is on shift and has active trips

## Sound/Haptic Integration
When a prompt fires:
- Critical prompts → `SMART_PROMPT_CRITICAL` notification event (heavy haptics, square wave)
- Normal prompts → `SMART_PROMPT_NORMAL` notification event (light haptics, sine wave)
- Respects driver's `soundsOn` and `hapticsOn` preferences

## UI
- Banner rendered on Home tab between GPS status and connect card
- Color-coded: Red for critical, Amber for normal
- Action buttons for each prompt action
- Dismissible via action buttons

## Files
- `client/src/lib/smartPrompts.ts` — Rule engine + anti-spam
- `shared/smartPrompts.test.ts` — 21 unit tests
- Banner component in `client/src/pages/driver-portal.tsx` (SmartPromptsBanner)
