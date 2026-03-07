# Sounds & Haptics

## Overview
The notification system provides audio and haptic feedback for driver events. It uses Web Audio API (AudioContext) for sounds and Navigator.vibrate for haptics, with graceful fallbacks.

## Events
| Event | Sound | Haptics | Trigger |
|-------|-------|---------|---------|
| NEW_TRIP_ASSIGNED | 880Hz sine, 3-tone ascending | Heavy | New trip appears in driver's trip list |
| TRIP_STATUS_CHANGED | 660Hz sine, 2-tone | Light | Trip status changes (from dispatch/server) |
| MESSAGE_RECEIVED | 1200Hz sine, 2-tone | Light | New message received |
| SMART_PROMPT_CRITICAL | 1000Hz square, 3-tone urgent | Heavy | Critical smart prompt fires |
| SMART_PROMPT_NORMAL | 600Hz sine, 2-tone | Light | Normal smart prompt fires |
| SHIFT_STARTED | 523Hz sine, 2-tone | Light | Driver starts shift |
| SHIFT_ENDED | 440Hz sine, 1-tone | Light | Driver ends shift |

## Haptic Patterns
- **Heavy**: `[100, 50, 100, 50, 200]` ms (vibrate-pause-vibrate-pause-long vibrate)
- **Light**: `[50, 30, 50]` ms (short vibrate-pause-short vibrate)

## Audio
- Uses AudioContext with OscillatorNodes
- Gain set to 0.3 (comfortable volume)
- Requires user gesture to unlock (auto-registers on first click/touch)
- Falls back to haptics-only if AudioContext is blocked

## Settings
- `driver_settings.soundsOn` — Enable/disable sounds (default: true)
- `driver_settings.hapticsOn` — Enable/disable haptics (default: true)
- Togglable via Driver Preferences card in Settings tab

## Trigger Sources
The `useDriverV3Notifications` hook in the driver portal detects events by:
1. **Polling diff**: Comparing previous trip snapshot to current (every 10s via trip query refetch)
2. **New assignment**: Trip ID appears in list that wasn't there before
3. **Status change**: Trip ID status differs from previous snapshot
4. **Smart prompts**: Direct trigger from SmartPromptsBanner when prompt fires

## Platform Notes
- **Web/PWA**: AudioContext works after user gesture. navigator.vibrate supported on Android Chrome.
- **iOS Safari**: AudioContext works after gesture. navigator.vibrate NOT supported (no haptics on iOS web).
- **Capacitor (native)**: Full support when native plugins are added.

## Files
- `client/src/lib/notificationManager.ts` — NotificationManager (sound + haptics)
- `client/src/hooks/use-sound-notifications.ts` — Legacy sound hook (pre-v3)
- `client/src/pages/driver-portal.tsx` — useDriverV3Notifications hook
