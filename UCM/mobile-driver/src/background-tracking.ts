import { registerPlugin } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const TOKEN_KEY = 'ucm_driver_jwt';
const API_BASE = 'https://driver.unitedcaremobility.com';

interface BackgroundGeolocationPlugin {
  addWatcher(options: {
    backgroundMessage: string;
    backgroundTitle: string;
    requestPermissions: boolean;
    stale: boolean;
    distanceFilter: number;
  }, callback: (location: { latitude: number; longitude: number; accuracy: number; speed: number; time: number } | undefined, error: any) => void): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
  openSettings(): Promise<void>;
}

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');

export async function storeToken(token: string): Promise<void> {
  await Preferences.set({ key: TOKEN_KEY, value: token });
}

export async function getStoredToken(): Promise<string | null> {
  const { value } = await Preferences.get({ key: TOKEN_KEY });
  return value;
}

export async function clearStoredToken(): Promise<void> {
  await Preferences.remove({ key: TOKEN_KEY });
}

let activeWatcherId: string | null = null;
let lastPostTime = 0;
let lastPostedLat = 0;
let lastPostedLng = 0;
let consecutiveFailures = 0;
let locationQueue: Array<{ lat: number; lng: number; accuracy: number; timestamp: number; speed: number }> = [];

const MAX_QUEUE_SIZE = 100;
const MIN_POST_INTERVAL_MOVING_MS = 2000;
const MIN_POST_INTERVAL_STATIONARY_MS = 15000;
const MIN_POST_INTERVAL_LOW_BATTERY_MS = 30000;
const SPEED_THRESHOLD_STATIONARY_MPS = 1.5;
const MIN_DISTANCE_FILTER_M = 25;

function getAdaptiveInterval(speedMps: number): number {
  if (speedMps < SPEED_THRESHOLD_STATIONARY_MPS) {
    return MIN_POST_INTERVAL_STATIONARY_MS;
  }
  return MIN_POST_INTERVAL_MOVING_MS;
}

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function postLocation(
  lat: number,
  lng: number,
  accuracy: number,
  timestamp: number,
  speed: number
): Promise<boolean> {
  const token = await getStoredToken();
  if (!token) {
    console.warn('[BG-GPS] No stored JWT token, queuing location');
    queueLocation(lat, lng, accuracy, timestamp, speed);
    return false;
  }

  try {
    const res = await fetch(`${API_BASE}/api/driver/me/location`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ lat, lng, accuracy, timestamp }),
    });

    if (res.ok) {
      lastPostTime = Date.now();
      lastPostedLat = lat;
      lastPostedLng = lng;
      consecutiveFailures = 0;
      flushQueue(token);
      return true;
    }

    if (res.status === 401) {
      console.warn('[BG-GPS] Token expired or invalid (401)');
    } else if (res.status === 429) {
      console.warn('[BG-GPS] Rate limited (429)');
    }

    consecutiveFailures++;
    queueLocation(lat, lng, accuracy, timestamp, speed);
    return false;
  } catch (err) {
    console.error('[BG-GPS] Failed to post location:', err);
    consecutiveFailures++;
    queueLocation(lat, lng, accuracy, timestamp, speed);
    return false;
  }
}

function queueLocation(lat: number, lng: number, accuracy: number, timestamp: number, speed: number): void {
  locationQueue.push({ lat, lng, accuracy, timestamp, speed });
  if (locationQueue.length > MAX_QUEUE_SIZE) {
    locationQueue = locationQueue.slice(-MAX_QUEUE_SIZE);
  }
}

async function flushQueue(token: string): Promise<void> {
  if (locationQueue.length === 0) return;

  const batch = locationQueue.splice(0, 10);
  for (const loc of batch) {
    try {
      await fetch(`${API_BASE}/api/driver/me/location`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          lat: loc.lat,
          lng: loc.lng,
          accuracy: loc.accuracy,
          timestamp: loc.timestamp,
        }),
      });
    } catch {
      locationQueue.unshift(loc);
      break;
    }
  }
}

export async function startBackgroundTracking(): Promise<boolean> {
  if (activeWatcherId) {
    console.log('[BG-GPS] Already tracking, watcher id:', activeWatcherId);
    return true;
  }

  try {
    const id = await BackgroundGeolocation.addWatcher(
      {
        backgroundMessage: 'UCM Driver is tracking your location for active trips.',
        backgroundTitle: 'UCM Driver - Location Active',
        requestPermissions: true,
        stale: false,
        distanceFilter: MIN_DISTANCE_FILTER_M,
      },
      (location, error) => {
        if (error) {
          if (error.code === 'NOT_AUTHORIZED') {
            console.warn('[BG-GPS] Location permission denied. Open settings to enable.');
          }
          return;
        }

        if (location) {
          const speedMps = location.speed || 0;
          const now = Date.now();
          const interval = getAdaptiveInterval(speedMps);
          const elapsed = now - lastPostTime;

          if (elapsed < interval) return;

          const dist = distanceMeters(lastPostedLat, lastPostedLng, location.latitude, location.longitude);
          if (dist < MIN_DISTANCE_FILTER_M && elapsed < MIN_POST_INTERVAL_STATIONARY_MS) return;

          postLocation(
            location.latitude,
            location.longitude,
            location.accuracy,
            location.time || now,
            speedMps
          );
        }
      }
    );

    activeWatcherId = id;
    consecutiveFailures = 0;
    console.log('[BG-GPS] Background tracking started, watcher id:', id);
    return true;
  } catch (err) {
    console.error('[BG-GPS] Failed to start background tracking:', err);
    return false;
  }
}

export async function stopBackgroundTracking(): Promise<void> {
  if (!activeWatcherId) {
    console.log('[BG-GPS] No active watcher to stop');
    return;
  }

  try {
    await BackgroundGeolocation.removeWatcher({ id: activeWatcherId });
    console.log('[BG-GPS] Background tracking stopped');
    activeWatcherId = null;
  } catch (err) {
    console.error('[BG-GPS] Failed to stop background tracking:', err);
  }
}

export function isTrackingActive(): boolean {
  return activeWatcherId !== null;
}

export function getQueueSize(): number {
  return locationQueue.length;
}

export function getConsecutiveFailures(): number {
  return consecutiveFailures;
}

export async function openLocationSettings(): Promise<void> {
  try {
    await BackgroundGeolocation.openSettings();
  } catch (err) {
    console.error('[BG-GPS] Failed to open settings:', err);
  }
}
