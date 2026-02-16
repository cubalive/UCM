import { registerPlugin } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const TOKEN_KEY = 'ucm_driver_jwt';
const API_BASE = 'https://app.unitedcaremobility.com';

interface BackgroundGeolocationPlugin {
  addWatcher(options: {
    backgroundMessage: string;
    backgroundTitle: string;
    requestPermissions: boolean;
    stale: boolean;
    distanceFilter: number;
  }, callback: (location: { latitude: number; longitude: number; accuracy: number; time: number } | undefined, error: any) => void): Promise<string>;
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
const MIN_POST_INTERVAL_MS = 2000;

async function postLocation(lat: number, lng: number, accuracy: number, timestamp: number): Promise<boolean> {
  const now = Date.now();
  if (now - lastPostTime < MIN_POST_INTERVAL_MS) {
    return false;
  }

  const token = await getStoredToken();
  if (!token) {
    console.warn('[BG-GPS] No stored JWT token, skipping location post');
    return false;
  }

  try {
    const res = await fetch(`${API_BASE}/api/driver/me/location`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        lat,
        lng,
        accuracy,
        timestamp,
      }),
    });

    if (res.ok) {
      lastPostTime = now;
      return true;
    }

    if (res.status === 401) {
      console.warn('[BG-GPS] Token expired or invalid (401)');
    }

    return false;
  } catch (err) {
    console.error('[BG-GPS] Failed to post location:', err);
    return false;
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
        distanceFilter: 20,
      },
      (location, error) => {
        if (error) {
          if (error.code === 'NOT_AUTHORIZED') {
            console.warn('[BG-GPS] Permission denied. Prompt user to open settings.');
          }
          return;
        }

        if (location) {
          postLocation(
            location.latitude,
            location.longitude,
            location.accuracy,
            location.time || Date.now()
          );
        }
      }
    );

    activeWatcherId = id;
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

export async function openLocationSettings(): Promise<void> {
  try {
    await BackgroundGeolocation.openSettings();
  } catch (err) {
    console.error('[BG-GPS] Failed to open settings:', err);
  }
}
