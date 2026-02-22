export interface LocationPoint {
  lat: number;
  lng: number;
  accuracy: number;
  timestamp: number;
  speed?: number;
  heading?: number;
  altitude?: number;
  source: "gps" | "network" | "fused";
}

export interface BackgroundLocationProvider {
  start(options: BackgroundLocationOptions): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  getLastKnownLocation(): LocationPoint | null;
  onLocation(callback: (point: LocationPoint) => void): () => void;
}

export interface BackgroundLocationOptions {
  desiredIntervalMs: number;
  minDisplacementMeters: number;
  enableHighAccuracy: boolean;
  showNotification?: boolean;
  notificationTitle?: string;
  notificationText?: string;
}

export type PlatformType = "web" | "ios" | "android";

export function detectPlatform(): PlatformType {
  if (typeof window === "undefined") return "web";
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  return "web";
}

export const PING_INTERVALS = {
  IN_TRIP: 8000,
  IDLE_ONLINE: 25000,
  OFFLINE: 0,
} as const;

export const GPS_ACCURACY_THRESHOLD_M = 50;

/*
  Background Location Notes (Capacitor / Native):

  iOS:
  - Safari PWA: Very limited background GPS. Use requestAnimationFrame + visibilitychange events.
  - Capacitor: Use @capacitor-community/background-geolocation plugin
    - Enable "Location updates" background mode in Xcode
    - Use significantLocationChange for battery-efficient tracking
    - Request "Always" location permission for background access
    - NOTE: Apple review requires justification for background location

  Android:
  - Capacitor: Use foreground service with @capacitor-community/background-geolocation
    - Requires FOREGROUND_SERVICE_LOCATION permission (Android 12+)
    - Show persistent notification while tracking
    - Use PRIORITY_HIGH_ACCURACY for in-trip, PRIORITY_BALANCED_POWER for idle

  Web PWA:
  - Use Geolocation.watchPosition() in foreground only
  - On visibilitychange (hidden->visible), send burst of accumulated locations
  - No reliable background tracking - server uses planned route + partial breadcrumbs
*/
