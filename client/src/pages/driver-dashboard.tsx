import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useTripRealtime } from "@/hooks/use-trip-realtime";
import { RealtimeDebugPanel } from "@/components/realtime-debug-panel";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api";
import {
  Car,
  MapPin,
  Clock,
  CheckCircle,
  PlayCircle,
  Navigation,
  User,
  CalendarDays,
  History,
  AlertTriangle,
  Power,
  PowerOff,
  MapPinOff,
  Send,
  MessageSquare,
  Lock,
  LocateFixed,
  Timer,
  ExternalLink,
  MapPinned,
  Bell,
  Coffee,
  Menu,
  X,
  ChevronRight,
  BarChart3,
  Trophy,
  CalendarClock,
  FileText,
  LogOut,
  TrendingUp,
  Target,
  Wifi,
  WifiOff,
  Satellite,
  Radio,
  ClipboardCopy,
  HelpCircle,
  RefreshCw,
  Eye,
  UserX,
  MapPinCheck,
  Wrench,
  CloudRain,
  Settings,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { TripDateTimeHeader, TripMetricsCard, TripProgressTimeline } from "@/components/trip-progress-timeline";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Area, AreaChart } from "recharts";

function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

const STATUS_FLOW: Record<string, { next: string; label: string; icon: any }> = {
  ASSIGNED: { next: "EN_ROUTE_TO_PICKUP", label: "Start Trip", icon: PlayCircle },
  EN_ROUTE_TO_PICKUP: { next: "ARRIVED_PICKUP", label: "Arrived at Pickup", icon: MapPin },
  ARRIVED_PICKUP: { next: "PICKED_UP", label: "Picked Up Patient", icon: User },
  PICKED_UP: { next: "EN_ROUTE_TO_DROPOFF", label: "En Route to Dropoff", icon: Navigation },
  EN_ROUTE_TO_DROPOFF: { next: "ARRIVED_DROPOFF", label: "Arrived at Dropoff", icon: MapPin },
  ARRIVED_DROPOFF: { next: "COMPLETED", label: "Complete Trip", icon: CheckCircle },
  IN_PROGRESS: { next: "COMPLETED", label: "Complete Trip", icon: CheckCircle },
};

const STATUS_COLORS: Record<string, string> = {
  SCHEDULED: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  ASSIGNED: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  EN_ROUTE_TO_PICKUP: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
  ARRIVED_PICKUP: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
  PICKED_UP: "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
  EN_ROUTE_TO_DROPOFF: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  ARRIVED_DROPOFF: "bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200",
  IN_PROGRESS: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  COMPLETED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  CANCELLED: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  NO_SHOW: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
};

const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: "Scheduled",
  ASSIGNED: "Assigned",
  EN_ROUTE_TO_PICKUP: "En Route to Pickup",
  ARRIVED_PICKUP: "Arrived at Pickup",
  PICKED_UP: "Picked Up",
  EN_ROUTE_TO_DROPOFF: "En Route to Dropoff",
  ARRIVED_DROPOFF: "Arrived at Dropoff",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  NO_SHOW: "No Show",
};

const ACTIVE_STATUSES = ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"];

const PHASE_LABELS: Record<string, string> = {
  ASSIGNED: "To Pickup",
  EN_ROUTE_TO_PICKUP: "To Pickup",
  ARRIVED_PICKUP: "At Pickup",
  PICKED_UP: "In Transit",
  EN_ROUTE_TO_DROPOFF: "In Transit",
  ARRIVED_DROPOFF: "At Dropoff",
  IN_PROGRESS: "In Progress",
};

const SUPPORT_EVENT_TYPES = [
  { type: "patient_not_ready", label: "Patient Not Ready", icon: Clock },
  { type: "patient_no_show", label: "Patient No-Show", icon: UserX },
  { type: "address_incorrect", label: "Address Incorrect", icon: MapPinCheck },
  { type: "vehicle_issue", label: "Vehicle Issue", icon: Wrench },
  { type: "traffic_delay", label: "Traffic Delay", icon: CloudRain },
] as const;

function getDestinationAddress(trip: ActiveTripData): string {
  const isPickupPhase = PICKUP_STAGES.includes(trip.status);
  return isPickupPhase ? trip.pickupAddress : trip.dropoffAddress;
}

function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
  }
  return Promise.resolve(false);
}

const isStandalone =
  typeof window !== "undefined" &&
  (window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true);

const isNativePlatform = typeof (window as any).Capacitor !== "undefined" && (window as any).Capacitor.isNativePlatform?.() === true;

function useNativeBackgroundTracking(token: string | null) {
  const [tracking, setTracking] = useState(false);
  const [bgLastSent, setBgLastSent] = useState<number | null>(null);
  const [bgAccuracy, setBgAccuracy] = useState<number | null>(null);
  const [bgPermissionDenied, setBgPermissionDenied] = useState(false);
  const watcherIdRef = useRef<string | null>(null);
  const bgThrottleRef = useRef<number>(0);
  const bgLastLatRef = useRef<number>(0);
  const bgLastLngRef = useRef<number>(0);
  const tokenRef = useRef<string | null>(token);

  useEffect(() => {
    tokenRef.current = token;
    if (isNativePlatform && token) {
      const cap = (window as any).Capacitor;
      const Prefs = cap?.Plugins?.Preferences;
      if (Prefs) {
        Prefs.set({ key: 'ucm_driver_jwt', value: token }).catch(() => {});
      }
    }
  }, [token]);

  const startTracking = useCallback(async () => {
    if (!isNativePlatform || !tokenRef.current) return;
    if (watcherIdRef.current) return;
    try {
      const cap = (window as any).Capacitor;
      const BackgroundGeolocation = cap.Plugins?.BackgroundGeolocation;
      if (!BackgroundGeolocation) {
        console.warn('[BG-GPS] BackgroundGeolocation plugin not available');
        return;
      }

      const id = await BackgroundGeolocation.addWatcher(
        {
          backgroundMessage: 'UCM Driver is tracking your location for active trips.',
          backgroundTitle: 'UCM Driver - Location Active',
          requestPermissions: true,
          stale: false,
          distanceFilter: 25,
        },
        (location: any, error: any) => {
          if (error) {
            if (error.code === 'NOT_AUTHORIZED') {
              setBgPermissionDenied(true);
            }
            console.warn('[BG-GPS] Error:', error.code);
            return;
          }
          if (location) {
            setBgPermissionDenied(false);
            const now = Date.now();
            const speedMps = location.speed || 0;
            const interval = speedMps < 1.5 ? 15000 : speedMps < 10 ? 5000 : 2000;
            if (now - bgThrottleRef.current < interval) return;

            const R = 6371000;
            const dLat = (location.latitude - bgLastLatRef.current) * Math.PI / 180;
            const dLng = (location.longitude - bgLastLngRef.current) * Math.PI / 180;
            const a = Math.sin(dLat / 2) ** 2 + Math.cos(bgLastLatRef.current * Math.PI / 180) * Math.cos(location.latitude * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
            const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            if (dist < 25 && (now - bgThrottleRef.current) < 15000) return;

            bgThrottleRef.current = now;
            const currentToken = tokenRef.current;
            if (!currentToken) return;

            const host = window.location.origin || 'https://driver.unitedcaremobility.com';
            fetch(`${host}/api/driver/me/location`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`,
              },
              body: JSON.stringify({
                lat: location.latitude,
                lng: location.longitude,
                accuracy: location.accuracy,
                timestamp: location.time || now,
              }),
            }).then((res) => {
              if (res.ok) {
                setBgLastSent(Date.now());
                setBgAccuracy(Math.round(location.accuracy));
                bgLastLatRef.current = location.latitude;
                bgLastLngRef.current = location.longitude;
              }
            }).catch(() => {});
          }
        }
      );
      watcherIdRef.current = id;
      setTracking(true);
      setBgPermissionDenied(false);
      console.log('[BG-GPS] Background tracking started, watcher id:', id);
    } catch (err) {
      console.error('[BG-GPS] Failed to start:', err);
    }
  }, []);

  const stopTracking = useCallback(async () => {
    if (!isNativePlatform || !watcherIdRef.current) return;
    try {
      const cap = (window as any).Capacitor;
      const BackgroundGeolocation = cap.Plugins?.BackgroundGeolocation;
      if (BackgroundGeolocation) {
        await BackgroundGeolocation.removeWatcher({ id: watcherIdRef.current });
      }
      watcherIdRef.current = null;
      setTracking(false);
    } catch (err) {
      console.error('[BG-GPS] Failed to stop:', err);
    }
  }, []);

  const openSettings = useCallback(async () => {
    if (!isNativePlatform) return;
    try {
      const cap = (window as any).Capacitor;
      const BackgroundGeolocation = cap.Plugins?.BackgroundGeolocation;
      if (BackgroundGeolocation) {
        await BackgroundGeolocation.openSettings();
      }
    } catch {}
  }, []);

  const isStale = bgLastSent !== null && (Date.now() - bgLastSent > 120000);

  return { tracking, bgLastSent, bgAccuracy, bgPermissionDenied, isStale, startTracking, stopTracking, openSettings };
}

const LOCATION_QUEUE_KEY = "ucm_driver_location_queue";

function getQueuedLocations(): Array<{ lat: number; lng: number; accuracy: number | null; timestamp: number }> {
  try {
    const raw = localStorage.getItem(LOCATION_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function queueLocation(lat: number, lng: number, accuracy: number | null, timestamp: number) {
  const queue = getQueuedLocations();
  queue.push({ lat, lng, accuracy, timestamp });
  if (queue.length > 50) queue.splice(0, queue.length - 50);
  try { localStorage.setItem(LOCATION_QUEUE_KEY, JSON.stringify(queue)); } catch {}
}

function clearLocationQueue() {
  try { localStorage.removeItem(LOCATION_QUEUE_KEY); } catch {}
}

const ACTION_QUEUE_KEY = "ucm_driver_action_queue";

type QueuedAction = {
  id: string;
  type: "status_transition" | "support_event";
  payload: any;
  timestamp: number;
};

function getQueuedActions(): QueuedAction[] {
  try {
    const raw = localStorage.getItem(ACTION_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function queueAction(action: Omit<QueuedAction, "id" | "timestamp">) {
  const queue = getQueuedActions();
  queue.push({ ...action, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, timestamp: Date.now() });
  if (queue.length > 50) queue.splice(0, queue.length - 50);
  try { localStorage.setItem(ACTION_QUEUE_KEY, JSON.stringify(queue)); } catch {}
}

function clearActionQueue() {
  try { localStorage.removeItem(ACTION_QUEUE_KEY); } catch {}
}

function removeActionFromQueue(id: string) {
  const queue = getQueuedActions().filter(a => a.id !== id);
  try { localStorage.setItem(ACTION_QUEUE_KEY, JSON.stringify(queue)); } catch {}
}

function useNetworkStatus() {
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}

function useGeolocation(isActive: boolean) {
  const [permission, setPermission] = useState<"granted" | "denied" | "prompt">("prompt");
  const [location, setLocation] = useState<{ lat: number; lng: number; accuracy: number; timestamp: number } | null>(null);
  const [watchError, setWatchError] = useState(false);
  const watchRef = useRef<number | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);

  useEffect(() => {
    console.log("[GPS] mode:", isStandalone ? "standalone (PWA)" : "browser");
    if (!navigator.geolocation) {
      console.warn("[GPS] Geolocation API not available");
      setPermission("denied");
    }
  }, []);

  const requestPermission = useCallback(() => {
    if (!navigator.geolocation) return;
    console.log("[GPS] requestPermission called, attempting getCurrentPosition (highAccuracy)");

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        console.log("[GPS] Position acquired:", pos.coords.latitude.toFixed(5), pos.coords.longitude.toFixed(5));
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, timestamp: pos.timestamp });
        setPermission("granted");
        setWatchError(false);
        retryCountRef.current = 0;
      },
      (err) => {
        console.warn("[GPS] getCurrentPosition error:", err.code, err.message);
        if (err.code === 1) {
          setPermission("denied");
        } else if (err.code === 3) {
          console.log("[GPS] Timeout — retrying with enableHighAccuracy:false");
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              console.log("[GPS] Fallback position acquired:", pos.coords.latitude.toFixed(5), pos.coords.longitude.toFixed(5));
              setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, timestamp: pos.timestamp });
              setPermission("granted");
              setWatchError(false);
              retryCountRef.current = 0;
            },
            (err2) => {
              console.warn("[GPS] Fallback also failed:", err2.code, err2.message);
              if (err2.code === 1) {
                setPermission("denied");
              }
            },
            { enableHighAccuracy: false, timeout: 15000, maximumAge: 0 }
          );
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, []);

  useEffect(() => {
    if (!isActive || !navigator.geolocation || permission !== "granted") return;

    const startWatch = () => {
      if (watchRef.current !== null) {
        navigator.geolocation.clearWatch(watchRef.current);
      }
      setWatchError(false);
      console.log("[GPS] Starting watchPosition");
      watchRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, timestamp: pos.timestamp });
          setWatchError(false);
          retryCountRef.current = 0;
        },
        (err) => {
          console.warn("[GPS] watchPosition error:", err.code, err.message);
          setWatchError(true);
          const delay = Math.min(5000 * Math.pow(2, retryCountRef.current), 60000);
          retryCountRef.current++;
          retryRef.current = setTimeout(startWatch, delay);
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
      );
    };

    startWatch();

    return () => {
      if (watchRef.current !== null) {
        navigator.geolocation.clearWatch(watchRef.current);
        watchRef.current = null;
      }
      if (retryRef.current !== null) {
        clearTimeout(retryRef.current);
        retryRef.current = null;
      }
    };
  }, [isActive, permission]);

  return { permission, location, watchError, requestPermission, isStandalone };
}

type GpsStatus = "permission_needed" | "gps_active" | "gps_stale" | "offline" | "watch_error";
const GPS_STALE_THRESHOLD_MS = 120000;

function GpsStatusBanner({ status, lastSentTime, onRequestPermission }: {
  status: GpsStatus;
  lastSentTime: number | null;
  onRequestPermission: () => void;
}) {
  if (status === "gps_active") return null;

  const config: Record<Exclude<GpsStatus, "gps_active">, { bg: string; icon: any; label: string; sublabel?: string; action?: boolean }> = {
    permission_needed: {
      bg: "bg-blue-600",
      icon: LocateFixed,
      label: "Location permission needed",
      action: true,
    },
    gps_stale: {
      bg: "bg-amber-600",
      icon: Satellite,
      label: "GPS signal stale",
      sublabel: lastSentTime ? `Last update ${formatTimeSince(lastSentTime)}` : "No recent update",
    },
    offline: {
      bg: "bg-red-700",
      icon: WifiOff,
      label: "Device offline",
      sublabel: "Locations queued for retry",
    },
    watch_error: {
      bg: "bg-amber-600",
      icon: AlertTriangle,
      label: "GPS signal lost",
      sublabel: "Attempting to reconnect...",
    },
  };

  const c = config[status];
  const Icon = c.icon;

  return (
    <div
      className={`${c.bg} text-white rounded-md shadow-lg px-4 py-2.5 flex items-center gap-3`}
      data-testid={`banner-gps-${status.replace("_", "-")}`}
    >
      <Icon className="w-5 h-5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="font-medium text-sm">{c.label}</span>
        {c.sublabel && <span className="text-xs opacity-90 ml-2">{c.sublabel}</span>}
      </div>
      {c.action && (
        <Button
          onClick={onRequestPermission}
          variant="outline"
          className="text-white border-white/40 min-h-[36px] text-sm px-3"
          data-testid="button-gps-banner-enable"
        >
          Enable
        </Button>
      )}
    </div>
  );
}

function formatTimeSince(timestamp: number): string {
  const diff = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function useLoadGoogleMaps(token: string | null) {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/maps/client-key", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled || !json.key) return;

        if (window.google?.maps) {
          setLoaded(true);
          return;
        }
        const existing = document.querySelector('script[src*="maps.googleapis.com"]');
        if (existing) {
          existing.addEventListener("load", () => setLoaded(true));
          if (window.google?.maps) setLoaded(true);
          return;
        }
        const script = document.createElement("script");
        script.src = `https://maps.googleapis.com/maps/api/js?key=${json.key}&libraries=geometry`;
        script.async = true;
        script.defer = true;
        script.onload = () => setLoaded(true);
        document.head.appendChild(script);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [token]);

  return loaded;
}

interface ActiveTripData {
  id: number;
  publicId: string;
  status: string;
  pickupAddress: string;
  pickupLat: number | null;
  pickupLng: number | null;
  dropoffAddress: string;
  dropoffLat: number | null;
  dropoffLng: number | null;
  routePolyline: string | null;
  lastEtaMinutes: number | null;
  lastEtaUpdatedAt: string | null;
  distanceMiles: number | null;
  scheduledDate: string;
  pickupTime: string;
  patientName: string | null;
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function useAutoReroute(
  activeTrip: ActiveTripData | null,
  driverLocation: { lat: number; lng: number } | null,
  token: string | null,
) {
  const lastRecomputeRef = useRef<{ lat: number; lng: number; time: number; status: string } | null>(null);
  const pendingRef = useRef(false);
  const SOFT_THROTTLE_MS = 45000;
  const HARD_THROTTLE_MS = 20000;
  const MIN_DISTANCE_M = 300;

  function distMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  useEffect(() => {
    if (!activeTrip || !driverLocation || !token) return;
    if (pendingRef.current) return;

    const now = Date.now();
    const last = lastRecomputeRef.current;

    if (last && (now - last.time) < HARD_THROTTLE_MS) return;

    let shouldRecompute = false;
    if (!last) {
      shouldRecompute = true;
    } else if (last.status !== activeTrip.status) {
      shouldRecompute = true;
    } else {
      const dist = distMeters(last.lat, last.lng, driverLocation.lat, driverLocation.lng);
      const elapsed = now - last.time;
      if (dist >= MIN_DISTANCE_M) {
        shouldRecompute = true;
      } else if (elapsed >= SOFT_THROTTLE_MS) {
        shouldRecompute = true;
      }
    }

    if (!shouldRecompute) return;

    pendingRef.current = true;
    fetch(`/api/trips/${activeTrip.id}/route/recompute`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ originLat: driverLocation.lat, originLng: driverLocation.lng }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.ok) {
          lastRecomputeRef.current = { lat: driverLocation.lat, lng: driverLocation.lng, time: Date.now(), status: activeTrip.status };
          queryClient.invalidateQueries({ queryKey: ["/api/driver/active-trip"] });
        }
      })
      .catch(() => {})
      .finally(() => { pendingRef.current = false; });
  }, [activeTrip?.id, activeTrip?.status, driverLocation?.lat, driverLocation?.lng, token]);
}

const PICKUP_STAGES = ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP"];

function getNavigateUrl(trip: ActiveTripData) {
  const isPickupPhase = PICKUP_STAGES.includes(trip.status);
  const destLat = isPickupPhase ? trip.pickupLat : trip.dropoffLat;
  const destLng = isPickupPhase ? trip.pickupLng : trip.dropoffLng;
  const destAddr = isPickupPhase ? trip.pickupAddress : trip.dropoffAddress;

  if (destLat && destLng) {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOS) {
      return `https://maps.apple.com/?daddr=${destLat},${destLng}`;
    }
    return `https://www.google.com/maps/dir/?api=1&destination=${destLat},${destLng}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destAddr)}`;
}

type NavApp = "google" | "waze" | "apple";

function getNavUrlForApp(trip: ActiveTripData, app: NavApp): string {
  const isPickupPhase = PICKUP_STAGES.includes(trip.status);
  const destLat = isPickupPhase ? trip.pickupLat : trip.dropoffLat;
  const destLng = isPickupPhase ? trip.pickupLng : trip.dropoffLng;
  const destAddr = isPickupPhase ? trip.pickupAddress : trip.dropoffAddress;

  switch (app) {
    case "google":
      if (destLat && destLng) return `https://www.google.com/maps/dir/?api=1&destination=${destLat},${destLng}`;
      return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destAddr)}`;
    case "waze":
      if (destLat && destLng) return `https://waze.com/ul?ll=${destLat},${destLng}&navigate=yes`;
      return `https://waze.com/ul?q=${encodeURIComponent(destAddr)}&navigate=yes`;
    case "apple":
      if (destLat && destLng) return `https://maps.apple.com/?daddr=${destLat},${destLng}`;
      return `https://maps.apple.com/?daddr=${encodeURIComponent(destAddr)}`;
  }
}

function getSavedNavApp(): NavApp | null {
  try {
    const val = localStorage.getItem("ucm_driver_nav_app");
    if (val === "google" || val === "waze" || val === "apple") return val;
  } catch {}
  return null;
}

function setSavedNavApp(app: NavApp | null) {
  try {
    if (app) localStorage.setItem("ucm_driver_nav_app", app);
    else localStorage.removeItem("ucm_driver_nav_app");
  } catch {}
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface DriverMapStore {
  map: google.maps.Map;
  container: HTMLDivElement;
  driverMarker: google.maps.Marker | null;
  pickupMarker: google.maps.Marker | null;
  dropoffMarker: google.maps.Marker | null;
  polyline: google.maps.Polyline | null;
  boundsFit: boolean;
}

function getOrCreateDriverMap(key: string, center: { lat: number; lng: number }): DriverMapStore | null {
  if (!window.google?.maps) return null;
  if (!window.__UCM_MAP__) (window as any).__UCM_MAP__ = {};
  const store = (window as any).__UCM_MAP__ as Record<string, any>;
  if (store[key]) return store[key] as DriverMapStore;

  const container = document.createElement("div");
  container.className = "w-full h-full ucm-map-container";
  container.setAttribute("data-testid", "div-driver-live-map");

  console.log("MAP INIT driver-fullscreen");
  const map = new google.maps.Map(container, {
    center,
    zoom: 14,
    disableDefaultUI: true,
    zoomControl: true,
    gestureHandling: "greedy",
    styles: [
      { featureType: "poi", stylers: [{ visibility: "off" }] },
      { featureType: "transit", stylers: [{ visibility: "off" }] },
    ],
  });

  const entry: DriverMapStore = { map, container, driverMarker: null, pickupMarker: null, dropoffMarker: null, polyline: null, boundsFit: false };
  store[key] = entry;
  return entry;
}

function FullScreenMap({
  driverLocation,
  activeTrip,
  mapsLoaded,
  gpsWatchError,
}: {
  driverLocation: { lat: number; lng: number } | null;
  activeTrip: ActiveTripData | null;
  mapsLoaded: boolean;
  gpsWatchError: boolean;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mapKeyRef = useRef("driver-fullscreen");
  const lastGpsTimeRef = useRef<number>(Date.now());
  const prevLocationRef = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (
      driverLocation &&
      (!prevLocationRef.current ||
        prevLocationRef.current.lat !== driverLocation.lat ||
        prevLocationRef.current.lng !== driverLocation.lng)
    ) {
      lastGpsTimeRef.current = Date.now();
      prevLocationRef.current = driverLocation;
    }
  }, [driverLocation]);

  const [staleNow, setStaleNow] = useState(false);
  useEffect(() => {
    const iv = setInterval(() => {
      setStaleNow(Date.now() - lastGpsTimeRef.current > 120000);
    }, 10000);
    return () => clearInterval(iv);
  }, []);

  const isGpsStale = staleNow || gpsWatchError;

  useEffect(() => {
    if (!mapsLoaded || !wrapperRef.current || !window.google?.maps) return;
    const center = driverLocation || { lat: 33.749, lng: -84.388 };
    const entry = getOrCreateDriverMap(mapKeyRef.current, center);
    if (!entry) return;
    if (entry.container.parentNode !== wrapperRef.current) {
      wrapperRef.current.appendChild(entry.container);
      google.maps.event.trigger(entry.map, "resize");
    }
  }, [mapsLoaded]);

  useEffect(() => {
    if (!mapsLoaded || !window.google?.maps) return;
    const store = (window as any).__UCM_MAP__ as Record<string, any> | undefined;
    const entry = store?.[mapKeyRef.current] as DriverMapStore | undefined;
    if (!entry) return;
    const map = entry.map;

    if (driverLocation) {
      const pos = new google.maps.LatLng(driverLocation.lat, driverLocation.lng);
      if (!entry.driverMarker) {
        entry.driverMarker = new google.maps.Marker({
          map,
          position: pos,
          title: "Your Location",
          zIndex: 999,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 10,
            fillColor: "#3b82f6",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 3,
          },
        });
      } else {
        entry.driverMarker.setPosition(pos);
      }
    }

    if (activeTrip?.pickupLat && activeTrip?.pickupLng) {
      const pickupPos = { lat: activeTrip.pickupLat, lng: activeTrip.pickupLng };
      if (!entry.pickupMarker) {
        entry.pickupMarker = new google.maps.Marker({
          map,
          position: pickupPos,
          title: "Pickup (A)",
          label: { text: "A", color: "#ffffff", fontWeight: "bold" },
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 14,
            fillColor: "#22c55e",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
          },
        });
      } else {
        entry.pickupMarker.setPosition(pickupPos);
      }
    } else if (entry.pickupMarker) {
      entry.pickupMarker.setMap(null);
      entry.pickupMarker = null;
    }

    if (activeTrip?.dropoffLat && activeTrip?.dropoffLng) {
      const dropoffPos = { lat: activeTrip.dropoffLat, lng: activeTrip.dropoffLng };
      if (!entry.dropoffMarker) {
        entry.dropoffMarker = new google.maps.Marker({
          map,
          position: dropoffPos,
          title: "Dropoff (B)",
          label: { text: "B", color: "#ffffff", fontWeight: "bold" },
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 14,
            fillColor: "#ef4444",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
          },
        });
      } else {
        entry.dropoffMarker.setPosition(dropoffPos);
      }
    } else if (entry.dropoffMarker) {
      entry.dropoffMarker.setMap(null);
      entry.dropoffMarker = null;
    }

    if (!activeTrip) {
      if (entry.pickupMarker) { entry.pickupMarker.setMap(null); entry.pickupMarker = null; }
      if (entry.dropoffMarker) { entry.dropoffMarker.setMap(null); entry.dropoffMarker = null; }
      if (entry.polyline) { entry.polyline.setMap(null); entry.polyline = null; }
    }

    if (activeTrip?.routePolyline) {
      const path = google.maps.geometry.encoding.decodePath(activeTrip.routePolyline);
      if (!entry.polyline) {
        entry.polyline = new google.maps.Polyline({
          map,
          path,
          strokeColor: "#3b82f6",
          strokeWeight: 5,
          strokeOpacity: 0.8,
        });
      } else {
        entry.polyline.setPath(path);
      }
    } else if (entry.polyline) {
      entry.polyline.setMap(null);
      entry.polyline = null;
    }

    if (!entry.boundsFit) {
      const bounds = new google.maps.LatLngBounds();
      let hasPoints = false;
      if (driverLocation) { bounds.extend(driverLocation); hasPoints = true; }
      if (activeTrip?.pickupLat && activeTrip?.pickupLng) { bounds.extend({ lat: activeTrip.pickupLat, lng: activeTrip.pickupLng }); hasPoints = true; }
      if (activeTrip?.dropoffLat && activeTrip?.dropoffLng) { bounds.extend({ lat: activeTrip.dropoffLat, lng: activeTrip.dropoffLng }); hasPoints = true; }
      if (hasPoints) {
        entry.boundsFit = true;
        map.fitBounds(bounds, { top: 40, right: 40, bottom: 120, left: 40 });
        const maxZoom = 16;
        google.maps.event.addListenerOnce(map, "idle", () => {
          if ((map.getZoom() || 0) > maxZoom) map.setZoom(maxZoom);
        });
      }
    }
  }, [driverLocation, activeTrip, mapsLoaded]);

  return (
    <div className="relative w-full h-full">
      <div ref={wrapperRef} className="w-full h-full" />
      {!mapsLoaded && (
        <div className="absolute inset-0 bg-muted animate-pulse z-10" data-testid="skeleton-map" />
      )}
      {/* GPS stale badge removed - replaced by GpsStatusBanner in parent */}
    </div>
  );
}

export default function DriverDashboard() {
  const { token, user, logout } = useAuth();
  const { toast } = useToast();
  const [selectedDate, setSelectedDate] = useState(getToday());
  const [chatTripId, setChatTripId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerSection, setDrawerSection] = useState<string | null>(null);
  const [tripsTab, setTripsTab] = useState<"scheduled" | "history">("scheduled");

  const mapsLoaded = useLoadGoogleMaps(token);

  const handleRtStatusChange = useCallback((statusData: { status: string; tripId: number }) => {
    queryClient.invalidateQueries({ queryKey: ["/api/driver/active-trip"] });
    queryClient.invalidateQueries({ queryKey: ["/api/driver/my-trips"] });
  }, []);

  const handleRtEtaUpdate = useCallback((etaData: { minutes: number; distanceMiles: number }) => {
    queryClient.setQueryData(["/api/driver/active-trip"], (old: any) => {
      if (!old?.trip) return old;
      return { ...old, trip: { ...old.trip, lastEtaMinutes: etaData.minutes, distanceMiles: etaData.distanceMiles, lastEtaUpdatedAt: new Date().toISOString() } };
    });
  }, []);

  const [rtActiveTripId, setRtActiveTripId] = useState<number | null>(null);

  const { connected: rtConnected, debugInfo: rtDebugInfo } = useTripRealtime({
    tripId: rtActiveTripId,
    authToken: token,
    onStatusChange: handleRtStatusChange,
    onEtaUpdate: handleRtEtaUpdate,
  });

  const activeTripQuery = useQuery<{ trip: ActiveTripData | null }>({
    queryKey: ["/api/driver/active-trip"],
    queryFn: () => apiFetch("/api/driver/active-trip", token),
    enabled: !!token,
    refetchInterval: rtConnected ? false : 10000,
  });

  useEffect(() => {
    const tripId = activeTripQuery.data?.trip?.id ?? null;
    setRtActiveTripId(tripId);
  }, [activeTripQuery.data?.trip?.id]);

  const profileQuery = useQuery<any>({
    queryKey: ["/api/driver/profile"],
    queryFn: () => apiFetch("/api/driver/profile", token),
    enabled: !!token,
  });

  const tripsQuery = useQuery<any>({
    queryKey: ["/api/driver/my-trips", selectedDate],
    queryFn: () => apiFetch(`/api/driver/my-trips?date=${selectedDate}`, token),
    enabled: !!token,
    refetchInterval: 60000,
  });

  const metricsQuery = useQuery<any>({
    queryKey: ["/api/driver/metrics"],
    queryFn: () => apiFetch("/api/driver/metrics", token),
    enabled: !!token,
  });

  const bonusQuery = useQuery<any>({
    queryKey: ["/api/driver/bonus-progress"],
    queryFn: () => apiFetch("/api/driver/bonus-progress", token),
    enabled: !!token,
  });

  const scheduleChangeQuery = useQuery<any[]>({
    queryKey: ["/api/driver/schedule-change-requests"],
    queryFn: () => apiFetch("/api/driver/schedule-change-requests", token),
    enabled: !!token,
  });

  const driver = profileQuery.data?.driver;
  const vehicle = profileQuery.data?.vehicle;
  const todayTrips = tripsQuery.data?.todayTrips || [];
  const allTrips = tripsQuery.data?.allTrips || [];

  const isDriverActive = driver?.dispatchStatus === "available";
  const isOnBreak = driver?.dispatchStatus === "hold";
  const isDriverOnline = isDriverActive || isOnBreak;
  const hasActiveTrip = todayTrips.some((t: any) => ACTIVE_STATUSES.includes(t.status));

  const { permission: geoPermission, location: geoLocation, watchError: geoWatchError, requestPermission } = useGeolocation(isDriverOnline || hasActiveTrip);
  const isNetworkOnline = useNetworkStatus();
  const { tracking: bgTracking, bgLastSent, bgAccuracy, bgPermissionDenied, isStale: bgStale, startTracking: bgStart, stopTracking: bgStop, openSettings: bgOpenSettings } = useNativeBackgroundTracking(token);

  const lastSentRef = useRef<{ lat: number; lng: number; time: number } | null>(null);
  const [lastSentTime, setLastSentTime] = useState<number | null>(null);
  const [, forceRender] = useState(0);
  const gpsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const staleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    staleTimerRef.current = setInterval(() => forceRender((c) => c + 1), 10000);
    return () => { if (staleTimerRef.current) clearInterval(staleTimerRef.current); };
  }, []);

  const sendLocation = useCallback(async (lat: number, lng: number, accuracy?: number, timestamp?: number) => {
    if (!token) return;
    const ts = timestamp ?? Date.now();
    if (!navigator.onLine) {
      queueLocation(lat, lng, accuracy ?? null, ts);
      console.log("[GPS] Offline — queued location");
      return;
    }
    try {
      await apiFetch("/api/driver/me/location", token, {
        method: "POST",
        body: JSON.stringify({ lat, lng, accuracy: accuracy ?? null, timestamp: ts }),
      });
      lastSentRef.current = { lat, lng, time: Date.now() };
      setLastSentTime(Date.now());
    } catch {
      queueLocation(lat, lng, accuracy ?? null, ts);
      console.log("[GPS] Send failed — queued location");
    }
  }, [token]);

  const flushQueue = useCallback(async () => {
    if (!token || !navigator.onLine) return;
    const queue = getQueuedLocations();
    if (queue.length === 0) return;
    console.log("[GPS] Flushing", queue.length, "queued locations");
    clearLocationQueue();
    for (const loc of queue) {
      try {
        await apiFetch("/api/driver/me/location", token, {
          method: "POST",
          body: JSON.stringify(loc),
        });
        lastSentRef.current = { lat: loc.lat, lng: loc.lng, time: Date.now() };
        setLastSentTime(Date.now());
      } catch {
        queueLocation(loc.lat, loc.lng, loc.accuracy, loc.timestamp);
        break;
      }
    }
  }, [token]);

  useEffect(() => {
    if (isNetworkOnline) {
      flushQueue();
    }
  }, [isNetworkOnline, flushQueue]);

  useEffect(() => {
    const shouldTrack = isDriverOnline || hasActiveTrip;
    if (!shouldTrack || !geoLocation) {
      if (gpsTimerRef.current) { clearInterval(gpsTimerRef.current); gpsTimerRef.current = null; }
      return;
    }

    const GPS_MIN_DISTANCE_M = 25;
    const GPS_MIN_INTERVAL_MS = 15000;
    const GPS_IDLE_INTERVAL_MS = 30000;
    const GPS_IDLE_SPEED_MPS = 1;

    function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
      const R = 6371000;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLng = (lng2 - lng1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function checkAndSend() {
      if (!geoLocation) return;
      const now = Date.now();
      const last = lastSentRef.current;

      if (!last) {
        sendLocation(geoLocation.lat, geoLocation.lng, geoLocation.accuracy, geoLocation.timestamp);
        return;
      }

      const elapsed = now - last.time;
      const dist = distanceMeters(last.lat, last.lng, geoLocation.lat, geoLocation.lng);
      const speed = elapsed > 0 ? dist / (elapsed / 1000) : 0;

      if (speed < GPS_IDLE_SPEED_MPS) {
        if (elapsed >= GPS_IDLE_INTERVAL_MS) {
          sendLocation(geoLocation.lat, geoLocation.lng, geoLocation.accuracy, geoLocation.timestamp);
        }
        return;
      }

      if (dist >= GPS_MIN_DISTANCE_M || elapsed >= GPS_MIN_INTERVAL_MS) {
        sendLocation(geoLocation.lat, geoLocation.lng, geoLocation.accuracy, geoLocation.timestamp);
      }
    }

    checkAndSend();

    if (gpsTimerRef.current) clearInterval(gpsTimerRef.current);
    gpsTimerRef.current = setInterval(checkAndSend, 5000);

    return () => {
      if (gpsTimerRef.current) { clearInterval(gpsTimerRef.current); gpsTimerRef.current = null; }
    };
  }, [isDriverOnline, hasActiveTrip, geoLocation?.lat, geoLocation?.lng, sendLocation]);

  useEffect(() => {
    if (!isDriverOnline || !token || !isNetworkOnline) return;
    const sendHeartbeat = () => {
      apiFetch("/api/driver/heartbeat", token, { method: "POST" }).catch(() => {});
    };
    sendHeartbeat();
    const hbInterval = setInterval(sendHeartbeat, 30000);
    return () => clearInterval(hbInterval);
  }, [isDriverOnline, token, isNetworkOnline]);

  useEffect(() => {
    if (!isNativePlatform) return;
    if (isDriverOnline && token && !bgTracking) {
      bgStart();
    } else if (!isDriverOnline && bgTracking) {
      bgStop();
    }
  }, [isDriverOnline, token, bgTracking, bgStart, bgStop]);

  const gpsStatus: GpsStatus = (() => {
    if (!isNetworkOnline) return "offline";
    if (geoPermission === "prompt") return "permission_needed";
    if (geoWatchError) return "watch_error";
    const lastUpdateTime = lastSentTime || (geoLocation ? geoLocation.timestamp : null);
    if (lastUpdateTime && (Date.now() - lastUpdateTime) > GPS_STALE_THRESHOLD_MS) return "gps_stale";
    if (geoLocation && !geoWatchError) return "gps_active";
    return "permission_needed";
  })();

  const toggleActiveMutation = useMutation({
    mutationFn: (active: boolean) =>
      apiFetch("/api/driver/me/active", token, {
        method: "POST",
        body: JSON.stringify({ active }),
      }),
    onSuccess: (_data: any, active: boolean) => {
      queryClient.invalidateQueries({ queryKey: ["/api/driver/profile"] });
      toast({ title: active ? "You are now online" : "You are now offline" });
      if (isNativePlatform) {
        if (active) {
          bgStart();
        } else {
          bgStop();
        }
      }
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const breakMutation = useMutation({
    mutationFn: (onBreak: boolean) =>
      apiFetch("/api/driver/me/break", token, {
        method: "POST",
        body: JSON.stringify({ onBreak }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/driver/profile"] });
      toast({ title: isOnBreak ? "Break ended — you are back online" : "You are now on break" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ tripId, status }: { tripId: number; status: string }) =>
      apiFetch(`/api/trips/${tripId}/status`, token, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      toast({ title: "Trip status updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/driver/my-trips"] });
      queryClient.invalidateQueries({ queryKey: ["/api/driver/active-trip"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const [navChooserTrip, setNavChooserTrip] = useState<ActiveTripData | null>(null);
  const [showNavChooser, setShowNavChooser] = useState(false);
  const [rememberNav, setRememberNav] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ tripId: number; nextStatus: string; label: string } | null>(null);
  const [confirmNote, setConfirmNote] = useState("");
  const [needHelpOpen, setNeedHelpOpen] = useState(false);
  const [needHelpNote, setNeedHelpNote] = useState("");
  const [supportSubmitting, setSupportSubmitting] = useState(false);

  const goTimeQuery = useQuery<{ goTimeTrips: any[] }>({
    queryKey: ["/api/driver/upcoming-go-time"],
    queryFn: () => apiFetch("/api/driver/upcoming-go-time", token),
    enabled: !!token && isDriverActive,
    refetchInterval: 60000,
  });

  const offersQuery = useQuery<{ offers: any[] }>({
    queryKey: ["/api/driver/offers/active"],
    queryFn: () => apiFetch("/api/driver/offers/active", token),
    enabled: !!token && isDriverActive,
    refetchInterval: 10000,
  });

  const goTimeTrips = goTimeQuery.data?.goTimeTrips || [];
  const goTimeTrip = goTimeTrips.length > 0 ? goTimeTrips[0] : null;

  const [goTimeCountdown, setGoTimeCountdown] = useState<number>(0);
  useEffect(() => {
    if (goTimeTrip?.secondsUntilPickup != null) {
      setGoTimeCountdown(goTimeTrip.secondsUntilPickup);
    }
  }, [goTimeTrip?.secondsUntilPickup, goTimeTrip?.alertId]);

  useEffect(() => {
    if (!goTimeTrip) return;
    const iv = setInterval(() => {
      setGoTimeCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(iv);
  }, [goTimeTrip?.alertId]);

  const offers = offersQuery.data?.offers || [];
  const currentOfferRef = useRef<string | null>(null);
  const [stableOffer, setStableOffer] = useState<any>(null);
  const [offerCountdown, setOfferCountdown] = useState<number>(0);
  const [offerExpiredMsg, setOfferExpiredMsg] = useState(false);

  useEffect(() => {
    if (offers.length > 0) {
      const offer = offers[0];
      if (currentOfferRef.current !== offer.offerId) {
        currentOfferRef.current = offer.offerId;
        setStableOffer(offer);
        setOfferCountdown(offer.secondsRemaining || 0);
        setOfferExpiredMsg(false);
      }
    } else if (currentOfferRef.current && !offerExpiredMsg) {
      currentOfferRef.current = null;
      setStableOffer(null);
    }
  }, [offers, offerExpiredMsg]);

  useEffect(() => {
    if (!stableOffer) return;
    const iv = setInterval(() => {
      setOfferCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(iv);
          setOfferExpiredMsg(true);
          setTimeout(() => {
            setOfferExpiredMsg(false);
            setStableOffer(null);
            currentOfferRef.current = null;
          }, 3000);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [stableOffer?.offerId]);

  const acknowledgeMutation = useMutation({
    mutationFn: (alertId: string) =>
      apiFetch(`/api/driver/go-time/${alertId}/acknowledge`, token, {
        method: "POST",
      }),
  });

  const acceptOfferMutation = useMutation({
    mutationFn: (offerId: string) =>
      apiFetch(`/api/driver/offers/${offerId}/accept`, token, {
        method: "POST",
      }),
    onSuccess: () => {
      toast({ title: "Request accepted" });
      queryClient.invalidateQueries({ queryKey: ["/api/driver/offers/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/driver/my-trips"] });
      queryClient.invalidateQueries({ queryKey: ["/api/driver/active-trip"] });
      setStableOffer(null);
      currentOfferRef.current = null;
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const declineOfferMutation = useMutation({
    mutationFn: (offerId: string) =>
      apiFetch(`/api/driver/offers/${offerId}/decline`, token, {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/driver/offers/active"] });
      setStableOffer(null);
      currentOfferRef.current = null;
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const openNavigation = useCallback((trip: ActiveTripData) => {
    const savedApp = getSavedNavApp();
    if (savedApp) {
      window.open(getNavUrlForApp(trip, savedApp), "_blank");
    } else {
      setNavChooserTrip(trip);
      setShowNavChooser(true);
    }
  }, []);

  const handleNavSelect = useCallback((app: NavApp) => {
    if (!navChooserTrip) return;
    if (rememberNav) {
      setSavedNavApp(app);
    }
    window.open(getNavUrlForApp(navChooserTrip, app), "_blank");
    setShowNavChooser(false);
    setNavChooserTrip(null);
    setRememberNav(false);
  }, [navChooserTrip, rememberNav]);

  const handleGoTimeStartRoute = useCallback(async (alert: any) => {
    try {
      await acknowledgeMutation.mutateAsync(alert.alertId);
    } catch {}
    statusMutation.mutate({ tripId: alert.tripId, status: "EN_ROUTE_TO_PICKUP" });
    const tripForNav: ActiveTripData = {
      id: alert.tripId,
      publicId: alert.publicId || "",
      status: "ASSIGNED",
      pickupAddress: alert.pickupAddress || "",
      pickupLat: alert.pickupLat || null,
      pickupLng: alert.pickupLng || null,
      dropoffAddress: alert.dropoffAddress || "",
      dropoffLat: alert.dropoffLat || null,
      dropoffLng: alert.dropoffLng || null,
      routePolyline: null,
      lastEtaMinutes: null,
      lastEtaUpdatedAt: null,
      distanceMiles: null,
      scheduledDate: alert.scheduledDate || "",
      pickupTime: alert.pickupTime || "",
      patientName: alert.patientName || null,
    };
    openNavigation(tripForNav);
  }, [acknowledgeMutation, statusMutation, openNavigation]);

  const activeTrips = todayTrips.filter((t: any) => ACTIVE_STATUSES.includes(t.status));
  const completedToday = todayTrips.filter((t: any) => t.status === "COMPLETED");
  const scheduledToday = todayTrips.filter((t: any) => t.status === "SCHEDULED");
  const activeTrip = activeTripQuery.data?.trip || null;

  useAutoReroute(activeTrip, geoLocation, token);

  const nextPickup = todayTrips.find((t: any) => t.status === "SCHEDULED" || t.status === "ASSIGNED");

  const handleStatusWithConfirm = useCallback((tripId: number, currentStatus: string) => {
    const flow = STATUS_FLOW[currentStatus];
    if (!flow) return;
    setConfirmDialog({ tripId, nextStatus: flow.next, label: flow.label });
    setConfirmNote("");
  }, []);

  const flushActionQueue = useCallback(async () => {
    if (!token || !navigator.onLine) return;
    const queue = getQueuedActions();
    if (queue.length === 0) return;
    console.log("[QUEUE] Flushing", queue.length, "queued actions");
    let flushed = 0;
    let retryCount = 0;
    for (const action of queue) {
      try {
        if (action.type === "status_transition") {
          const res = await apiFetch(`/api/trips/${action.payload.tripId}/status`, token, {
            method: "PATCH",
            body: JSON.stringify({ status: action.payload.status, idempotencyKey: action.id }),
          }).catch((err: any) => {
            if (err?.message?.includes("already") || err?.status === 409) {
              return { ok: true, alreadyApplied: true };
            }
            throw err;
          });
          if (action.payload.note) {
            await apiFetch(`/api/trips/${action.payload.tripId}/messages`, token, {
              method: "POST",
              body: JSON.stringify({ message: `[Status Note] ${action.payload.note}` }),
            }).catch(() => {});
          }
        } else if (action.type === "support_event") {
          await apiFetch("/api/driver/support-event", token, {
            method: "POST",
            body: JSON.stringify({ ...action.payload, idempotencyKey: action.id }),
          }).catch(() => {});
        }
        removeActionFromQueue(action.id);
        flushed++;
      } catch {
        retryCount++;
        console.warn("[QUEUE] Failed to flush action, will retry later:", action.id);
        if (retryCount >= 3) break;
      }
    }
    if (flushed > 0) {
      queryClient.invalidateQueries({ queryKey: ["/api/driver/my-trips"] });
      queryClient.invalidateQueries({ queryKey: ["/api/driver/active-trip"] });
      toast({ title: `${flushed} change${flushed > 1 ? "s" : ""} synced` });
    }
  }, [token, toast]);

  useEffect(() => {
    if (isNetworkOnline && getQueuedActions().length > 0) {
      flushActionQueue();
    }
  }, [isNetworkOnline, flushActionQueue]);

  const handleConfirmSubmit = useCallback(async () => {
    if (!confirmDialog) return;
    const { tripId, nextStatus } = confirmDialog;
    const note = confirmNote.trim();
    setConfirmDialog(null);
    setConfirmNote("");
    if (!navigator.onLine) {
      queueAction({
        type: "status_transition",
        payload: { tripId, status: nextStatus, note: note || undefined },
      });
      toast({ title: "Offline - saved for sync", description: "Status change will sync when you reconnect." });
      return;
    }
    try {
      await apiFetch(`/api/trips/${tripId}/status`, token, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/driver/my-trips"] });
      queryClient.invalidateQueries({ queryKey: ["/api/driver/active-trip"] });
      if (note && token) {
        await apiFetch(`/api/trips/${tripId}/messages`, token, {
          method: "POST",
          body: JSON.stringify({ message: `[Status Note] ${note}` }),
        }).catch(() => {});
      }
    } catch (err: any) {
      toast({ title: "Status update failed", description: err?.message || "Try again", variant: "destructive" });
    }
  }, [confirmDialog, confirmNote, token, toast]);

  const handleSupportEvent = useCallback(async (eventType: string) => {
    if (!activeTrip || !token) return;
    setSupportSubmitting(true);
    if (!navigator.onLine) {
      queueAction({
        type: "support_event",
        payload: { tripId: activeTrip.id, eventType, notes: needHelpNote.trim() || undefined },
      });
      toast({ title: "Offline - saved for sync", description: "Support event will sync when you reconnect." });
      setNeedHelpOpen(false);
      setNeedHelpNote("");
      setSupportSubmitting(false);
      return;
    }
    try {
      await apiFetch("/api/driver/support-event", token, {
        method: "POST",
        body: JSON.stringify({ tripId: activeTrip.id, eventType, notes: needHelpNote.trim() || undefined }),
      });
      toast({ title: "Support event reported" });
      setNeedHelpOpen(false);
      setNeedHelpNote("");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSupportSubmitting(false);
    }
  }, [activeTrip, token, needHelpNote, toast]);

  const handleCopyAddress = useCallback(async (trip: ActiveTripData) => {
    const addr = getDestinationAddress(trip);
    const ok = await copyToClipboard(addr);
    if (ok) {
      toast({ title: "Address copied" });
    } else {
      toast({ title: "Could not copy", variant: "destructive" });
    }
  }, [toast]);

  if (geoPermission === "prompt") {
    return (
      <div className="flex items-center justify-center min-h-[60vh] p-4">
        <Card className="max-w-md w-full">
          <CardContent className="py-8 text-center space-y-4">
            <LocateFixed className="w-14 h-14 mx-auto text-primary" />
            <h2 className="text-xl font-semibold" data-testid="text-location-prompt">Enable Location</h2>
            <p className="text-base text-muted-foreground">
              Location access is required to manage trips, update your position, and appear on the dispatch map.
            </p>
            <Button onClick={requestPermission} className="min-h-[48px] text-base px-6" data-testid="button-enable-location">
              <MapPin className="w-5 h-5 mr-2" />
              Enable Location
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (geoPermission === "denied") {
    return (
      <div className="flex items-center justify-center min-h-[60vh] p-4">
        <Card className="max-w-md w-full">
          <CardContent className="py-8 space-y-4">
            <div className="text-center">
              <MapPinOff className="w-14 h-14 mx-auto text-destructive" />
              <h2 className="text-xl font-semibold mt-3" data-testid="text-location-required">Location Access Denied</h2>
              <p className="text-base text-muted-foreground mt-1">
                Location permission was denied. Please follow the steps below to enable it, then tap the button to try again.
              </p>
            </div>
            <div className="text-left space-y-2 bg-muted/50 rounded-md p-4">
              {isStandalone ? (
                <>
                  <p className="text-base font-medium">iPhone / iPad (Home Screen App):</p>
                  <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-1">
                    <li>Open <strong>Settings</strong> on your device</li>
                    <li>Tap <strong>Privacy &amp; Security</strong></li>
                    <li>Tap <strong>Location Services</strong> (make sure it is ON)</li>
                    <li>Scroll down, tap <strong>Safari Websites</strong></li>
                    <li>Set to <strong>While Using</strong></li>
                    <li>Enable <strong>Precise Location</strong></li>
                    <li>Return here and tap <strong>Try Again</strong></li>
                  </ol>
                </>
              ) : (
                <>
                  <p className="text-base font-medium">For iPhone / iPad (Safari):</p>
                  <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-1">
                    <li>Open <strong>Settings</strong> on your device</li>
                    <li>Scroll down and tap <strong>Safari</strong></li>
                    <li>Tap <strong>Location</strong></li>
                    <li>Set to <strong>Allow</strong> or <strong>Ask</strong></li>
                    <li>Return here and tap <strong>Try Again</strong></li>
                  </ol>
                </>
              )}
              <p className="text-base font-medium mt-3">For Android (Chrome):</p>
              <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-1">
                <li>Tap the <strong>lock icon</strong> in the address bar</li>
                <li>Tap <strong>Permissions</strong></li>
                <li>Enable <strong>Location</strong></li>
                <li>Reload the page</li>
              </ol>
            </div>
            <div className="flex gap-2 justify-center flex-wrap">
              <Button onClick={requestPermission} className="min-h-[48px] text-base" data-testid="button-retry-location">
                <LocateFixed className="w-5 h-5 mr-2" />
                Try Again
              </Button>
              <Button variant="outline" onClick={() => window.location.reload()} className="min-h-[48px] text-base" data-testid="button-reload-location">
                Reload Page
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!driver) {
    if (profileQuery.isLoading) {
      return (
        <div className="flex items-center justify-center min-h-[60vh]">
          <Skeleton className="h-24 w-64" />
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center min-h-[60vh] p-4">
        <Card className="max-w-md w-full">
          <CardContent className="py-6 text-center">
            <AlertTriangle className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
            <p className="text-base text-muted-foreground" data-testid="text-no-driver-profile">No driver profile linked to your account.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const metrics = metricsQuery.data;
  const bonus = bonusQuery.data;
  const scheduleChanges = scheduleChangeQuery.data || [];

  const nextPickupCountdown = (() => {
    if (!nextPickup?.pickupTime || !nextPickup?.scheduledDate) return null;
    try {
      const pickupDateTime = new Date(`${nextPickup.scheduledDate}T${nextPickup.pickupTime}`);
      const diffSec = Math.max(0, Math.floor((pickupDateTime.getTime() - Date.now()) / 1000));
      return diffSec;
    } catch { return null; }
  })();

  const [pickupCountdownVal, setPickupCountdownVal] = useState(0);
  useEffect(() => {
    if (nextPickupCountdown != null) setPickupCountdownVal(nextPickupCountdown);
  }, [nextPickupCountdown]);
  useEffect(() => {
    if (!nextPickup) return;
    const iv = setInterval(() => setPickupCountdownVal((p) => Math.max(0, p - 1)), 1000);
    return () => clearInterval(iv);
  }, [nextPickup?.id]);

  return (
    <div className="relative w-full h-[calc(100vh-3.5rem)] flex flex-col" data-testid="div-driver-map-home">
      {/* TODAY HOME DASHBOARD - scrollable card layout */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="px-4 py-4 space-y-4 max-w-lg mx-auto">
          {/* GPS status banner at top */}
          <GpsStatusBanner
            status={gpsStatus}
            lastSentTime={lastSentTime}
            onRequestPermission={requestPermission}
          />

          {/* Go-time alert banner */}
          {goTimeTrip && (
            <div
              className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-md shadow-lg px-4 py-3"
              data-testid="banner-go-time"
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <Bell className="w-6 h-6 flex-shrink-0" />
                  <span className="font-semibold text-base" data-testid="text-go-time-countdown">
                    Pickup in {formatCountdown(goTimeCountdown)}
                  </span>
                  <span className="text-sm truncate opacity-90" data-testid="text-go-time-address">
                    {goTimeTrip.pickupAddress?.length > 30
                      ? goTimeTrip.pickupAddress.substring(0, 30) + "..."
                      : goTimeTrip.pickupAddress}
                  </span>
                </div>
                <Button
                  onClick={() => handleGoTimeStartRoute(goTimeTrip)}
                  disabled={acknowledgeMutation.isPending || statusMutation.isPending}
                  className="min-h-[44px] text-base"
                  data-testid="button-go-time-start-route"
                >
                  <Navigation className="w-5 h-5 mr-2" />
                  Start Route
                </Button>
              </div>
            </div>
          )}

          {/* TRIP OFFER CARD */}
          {(stableOffer || offerExpiredMsg) && (
            <div data-testid="card-driver-offer">
              <Card className="shadow-xl border-2 border-primary/20">
                <CardContent className="py-4 space-y-3">
                  {offerExpiredMsg ? (
                    <p className="text-center text-base font-medium text-muted-foreground" data-testid="text-offer-expired">
                      Request expired
                    </p>
                  ) : stableOffer && (
                    <>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <MapPinned className="w-5 h-5 text-primary flex-shrink-0" />
                          <span className="font-mono text-sm font-medium" data-testid="text-offer-public-id">{stableOffer.publicId}</span>
                        </div>
                        <Badge variant="secondary" data-testid="badge-offer-countdown">
                          <Timer className="w-4 h-4 mr-1" />
                          Expires in {formatCountdown(offerCountdown)}
                        </Badge>
                      </div>
                      {stableOffer.patientName && (
                        <div className="flex items-center gap-2 text-base text-muted-foreground">
                          <User className="w-5 h-5" />
                          <span data-testid="text-offer-patient">{stableOffer.patientName}</span>
                        </div>
                      )}
                      <div className="space-y-1.5">
                        <div className="flex items-start gap-2 text-base">
                          <Navigation className="w-5 h-5 mt-0.5 flex-shrink-0 text-green-600" />
                          <span className="truncate" data-testid="text-offer-pickup">{stableOffer.pickupAddress}</span>
                        </div>
                        <div className="flex items-start gap-2 text-base">
                          <MapPin className="w-5 h-5 mt-0.5 flex-shrink-0 text-red-600" />
                          <span className="truncate" data-testid="text-offer-dropoff">{stableOffer.dropoffAddress}</span>
                        </div>
                      </div>
                      {stableOffer.pickupTime && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Clock className="w-4 h-4" />
                          <span data-testid="text-offer-pickup-time">{stableOffer.pickupTime}</span>
                        </div>
                      )}
                      <div className="flex gap-3">
                        <Button
                          className="flex-1 min-h-[48px] text-base font-semibold"
                          onClick={() => acceptOfferMutation.mutate(stableOffer.offerId)}
                          disabled={acceptOfferMutation.isPending || declineOfferMutation.isPending}
                          data-testid="button-accept-offer"
                        >
                          ACCEPT REQUEST
                        </Button>
                        <Button
                          variant="outline"
                          className="min-h-[48px] text-base px-6"
                          onClick={() => declineOfferMutation.mutate(stableOffer.offerId)}
                          disabled={acceptOfferMutation.isPending || declineOfferMutation.isPending}
                          data-testid="button-decline-offer"
                        >
                          Decline
                        </Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* BLOCK 2: Active Trip Card */}
          {activeTrip && (
            <Card data-testid="card-active-trip-overlay">
              <CardContent className="py-4 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-medium">{activeTrip.publicId}</span>
                    <Badge className={STATUS_COLORS[activeTrip.status] || ""} data-testid="badge-active-trip-status">
                      {PHASE_LABELS[activeTrip.status] || STATUS_LABELS[activeTrip.status] || activeTrip.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    {activeTrip.lastEtaMinutes != null && (
                      <span className="text-sm text-muted-foreground flex items-center gap-1" data-testid="text-active-trip-eta">
                        <Timer className="w-4 h-4" />
                        ~{activeTrip.lastEtaMinutes} min
                        {activeTrip.distanceMiles != null && ` / ${activeTrip.distanceMiles} mi`}
                      </span>
                    )}
                    <RealtimeDebugPanel
                      debugInfo={rtDebugInfo}
                      pollingActive={!rtConnected}
                      pollingIntervalMs={rtConnected ? false : 10000}
                      tripId={rtActiveTripId}
                    />
                  </div>
                </div>

                {activeTrip.patientName && (
                  <div className="flex items-center gap-2 text-base">
                    <User className="w-5 h-5 text-muted-foreground" />
                    <span className="font-medium">{activeTrip.patientName}</span>
                  </div>
                )}

                <div className="space-y-1.5">
                  <div className="flex items-start gap-2 text-base">
                    <Navigation className="w-5 h-5 mt-0.5 flex-shrink-0 text-green-600" />
                    <span className="truncate">{activeTrip.pickupAddress}</span>
                  </div>
                  <div className="flex items-start gap-2 text-base">
                    <MapPin className="w-5 h-5 mt-0.5 flex-shrink-0 text-red-600" />
                    <span className="truncate">{activeTrip.dropoffAddress}</span>
                  </div>
                </div>

                <div className="flex gap-2 flex-wrap">
                  {STATUS_FLOW[activeTrip.status] && (
                    <Button
                      onClick={() => handleStatusWithConfirm(activeTrip.id, activeTrip.status)}
                      disabled={statusMutation.isPending}
                      className="flex-1 min-h-[48px] text-base font-semibold"
                      data-testid="button-active-trip-action"
                    >
                      {(() => { const Icon = STATUS_FLOW[activeTrip.status].icon; return <Icon className="w-5 h-5 mr-2" />; })()}
                      {STATUS_FLOW[activeTrip.status].label}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => openNavigation(activeTrip)}
                    className="min-h-[48px] text-base"
                    data-testid="button-navigate"
                  >
                    <Navigation className="w-5 h-5 mr-2" />
                    Navigate
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleCopyAddress(activeTrip)}
                    data-testid="button-copy-address"
                  >
                    <ClipboardCopy className="w-5 h-5" />
                  </Button>
                </div>

                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    onClick={() => setShowMap(true)}
                    className="min-h-[44px] text-base"
                    data-testid="button-view-map"
                  >
                    <Eye className="w-5 h-5 mr-2" />
                    View Map
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setNeedHelpOpen(true)}
                    className="min-h-[44px] text-base"
                    data-testid="button-need-help"
                  >
                    <HelpCircle className="w-5 h-5 mr-2" />
                    Need Help
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* BLOCK 1: Next Pickup Card */}
          {!activeTrip && (
            <Card data-testid="card-next-pickup">
              <CardContent className="py-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-primary" />
                  <span className="font-semibold text-base">Next Pickup</span>
                </div>
                {nextPickup ? (
                  <>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="text-3xl font-bold font-mono" data-testid="text-next-pickup-countdown">
                        {pickupCountdownVal > 3600
                          ? `${Math.floor(pickupCountdownVal / 3600)}h ${Math.floor((pickupCountdownVal % 3600) / 60)}m`
                          : formatCountdown(pickupCountdownVal)}
                      </div>
                      <Badge className={STATUS_COLORS[nextPickup.status] || ""} data-testid="badge-next-pickup-status">
                        {STATUS_LABELS[nextPickup.status] || nextPickup.status}
                      </Badge>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CalendarDays className="w-4 h-4" />
                        <span data-testid="text-next-pickup-time">{nextPickup.pickupTime} - {nextPickup.scheduledDate}</span>
                      </div>
                      <div className="flex items-start gap-2 text-base">
                        <Navigation className="w-5 h-5 mt-0.5 flex-shrink-0 text-green-600" />
                        <span className="truncate" data-testid="text-next-pickup-address">{nextPickup.pickupAddress || "Pickup not set"}</span>
                      </div>
                    </div>
                    {nextPickup.status === "ASSIGNED" && (
                      <div className="flex gap-2">
                        <Button
                          onClick={() => handleStatusWithConfirm(nextPickup.id, nextPickup.status)}
                          disabled={statusMutation.isPending}
                          className="flex-1 min-h-[48px] text-base font-semibold"
                          data-testid="button-next-pickup-action"
                        >
                          <PlayCircle className="w-5 h-5 mr-2" />
                          Start Trip
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            const tripForNav: ActiveTripData = {
                              id: nextPickup.id, publicId: nextPickup.publicId || "", status: nextPickup.status,
                              pickupAddress: nextPickup.pickupAddress || "", pickupLat: nextPickup.pickupLat || null,
                              pickupLng: nextPickup.pickupLng || null, dropoffAddress: nextPickup.dropoffAddress || "",
                              dropoffLat: nextPickup.dropoffLat || null, dropoffLng: nextPickup.dropoffLng || null,
                              routePolyline: null, lastEtaMinutes: null, lastEtaUpdatedAt: null,
                              distanceMiles: null, scheduledDate: nextPickup.scheduledDate || "", pickupTime: nextPickup.pickupTime || "",
                              patientName: nextPickup.patientName || null,
                            };
                            openNavigation(tripForNav);
                          }}
                          className="min-h-[48px] text-base"
                          data-testid="button-next-pickup-navigate"
                        >
                          <Navigation className="w-5 h-5 mr-2" />
                          Navigate
                        </Button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-center py-4">
                    <CalendarDays className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
                    <p className="text-base text-muted-foreground" data-testid="text-no-upcoming-pickups">No upcoming pickups</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* BLOCK 3: Today's Schedule */}
          <Card data-testid="card-today-schedule">
            <CardContent className="py-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CalendarDays className="w-5 h-5 text-primary" />
                  <span className="font-semibold text-base">Today&apos;s Schedule</span>
                  <Badge variant="secondary">{todayTrips.length}</Badge>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    queryClient.invalidateQueries({ queryKey: ["/api/driver/my-trips"] });
                    queryClient.invalidateQueries({ queryKey: ["/api/driver/active-trip"] });
                  }}
                  data-testid="button-refresh-schedule"
                >
                  <RefreshCw className="w-5 h-5" />
                </Button>
              </div>
              {tripsQuery.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : todayTrips.length === 0 ? (
                <p className="text-base text-muted-foreground text-center py-3" data-testid="text-no-trips">
                  No trips scheduled for today.
                </p>
              ) : (
                <div className="space-y-2">
                  {todayTrips.map((trip: any) => (
                    <div
                      key={trip.id}
                      className="flex items-center gap-3 rounded-md bg-muted/50 px-3 py-2.5 min-h-[48px]"
                      data-testid={`card-trip-${trip.id}`}
                    >
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium" data-testid={`text-trip-time-${trip.id}`}>
                            {trip.pickupTime || "N/A"}
                          </span>
                          <Badge className={STATUS_COLORS[trip.status] || ""} data-testid={`badge-trip-status-${trip.id}`}>
                            {STATUS_LABELS[trip.status] || trip.status}
                          </Badge>
                        </div>
                        <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
                          <Navigation className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-green-600" />
                          <span className="truncate" data-testid={`text-pickup-${trip.id}`}>{trip.pickupAddress || "N/A"}</span>
                        </div>
                        <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
                          <MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-red-600" />
                          <span className="truncate" data-testid={`text-dropoff-${trip.id}`}>{trip.dropoffAddress || "N/A"}</span>
                        </div>
                      </div>
                      {ACTIVE_STATUSES.includes(trip.status) && STATUS_FLOW[trip.status] && (
                        <Button
                          onClick={() => handleStatusWithConfirm(trip.id, trip.status)}
                          disabled={statusMutation.isPending}
                          className="min-h-[44px] text-sm whitespace-nowrap"
                          data-testid={`button-trip-action-${trip.id}`}
                        >
                          {STATUS_FLOW[trip.status].label}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <Button
                variant="outline"
                className="w-full min-h-[44px] text-base"
                onClick={() => { setDrawerSection("trips"); setDrawerOpen(true); }}
                data-testid="button-view-all-trips"
              >
                View All Trips
              </Button>
            </CardContent>
          </Card>

          {/* BLOCK 4: Weekly Bonus Progress (compact) */}
          {bonus?.active && (
            <Card data-testid="card-bonus-compact">
              <CardContent className="py-4 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Trophy className={`w-5 h-5 ${bonus.qualifies ? "text-green-600" : "text-muted-foreground"}`} />
                    <span className="font-semibold text-base">Weekly Bonus</span>
                  </div>
                  <span className="text-lg font-bold" data-testid="text-bonus-compact-amount">
                    {bonus.weeklyAmountCents ? `$${(bonus.weeklyAmountCents / 100).toFixed(2)}` : ""}
                  </span>
                </div>
                <div className="w-full bg-muted rounded-full h-3 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      bonus.progressColor === "green" ? "bg-green-500" : bonus.progressColor === "yellow" ? "bg-yellow-500" : "bg-red-500"
                    }`}
                    style={{ width: `${Math.min(100, bonus.overallProgress || 0)}%` }}
                    data-testid="div-bonus-progress-bar"
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground">{bonus.overallProgress}% progress</span>
                  <button
                    onClick={() => { setDrawerSection("bonus"); setDrawerOpen(true); }}
                    className="text-sm text-primary font-medium min-h-[44px] flex items-center"
                    data-testid="button-view-bonus-breakdown"
                  >
                    View breakdown
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Menu button */}
          <Button
            variant="outline"
            className="w-full min-h-[48px] text-base"
            onClick={() => setDrawerOpen(true)}
            data-testid="button-open-drawer"
          >
            <Menu className="w-5 h-5 mr-2" />
            Menu
          </Button>
        </div>
      </div>

      {/* BOTTOM STRIP - Online/Offline only */}
      <div className="bg-background border-t border-border px-4 py-3 flex items-center justify-between gap-3" data-testid="div-bottom-strip">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-medium text-base truncate" data-testid="text-driver-name">{driver.firstName} {driver.lastName}</span>
          <Badge
            variant={isOnBreak ? "outline" : isDriverActive ? "default" : "secondary"}
            className={isOnBreak ? "border-amber-500 text-amber-700 dark:text-amber-400" : ""}
            data-testid="badge-dispatch-status"
          >
            {isOnBreak ? "On Break" : isDriverActive ? "Online" : "Offline"}
          </Badge>
          {gpsStatus === "gps_active" && (
            <div className="flex items-center gap-1.5 flex-shrink-0" data-testid="div-gps-active-indicator">
              <Satellite className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              {lastSentTime && (
                <span className="text-xs text-muted-foreground" data-testid="text-last-sent-time">
                  {formatTimeSince(lastSentTime)}
                </span>
              )}
            </div>
          )}
          {gpsStatus === "gps_stale" && (
            <div className="flex items-center gap-1.5 flex-shrink-0" data-testid="div-gps-stale-indicator">
              <Satellite className="w-4 h-4 text-amber-500" />
              <span className="text-xs text-amber-600 dark:text-amber-400" data-testid="text-gps-stale-time">
                Stale {lastSentTime ? formatTimeSince(lastSentTime) : ""}
              </span>
            </div>
          )}
          {gpsStatus === "offline" && (
            <div className="flex items-center gap-1.5 flex-shrink-0" data-testid="div-offline-indicator">
              <WifiOff className="w-4 h-4 text-red-500" />
              <span className="text-xs text-red-600 dark:text-red-400">
                Offline{getQueuedActions().length > 0 ? ` (${getQueuedActions().length} pending)` : ""}
              </span>
            </div>
          )}
        </div>
        <Button
          variant={isDriverOnline ? "destructive" : "default"}
          onClick={() => toggleActiveMutation.mutate(!isDriverOnline)}
          disabled={toggleActiveMutation.isPending}
          className="min-h-[44px] text-base px-5"
          data-testid="button-toggle-active"
        >
          {isDriverOnline ? <PowerOff className="w-5 h-5 mr-2" /> : <Power className="w-5 h-5 mr-2" />}
          {isDriverOnline ? "Go Offline" : "Go Online"}
        </Button>
      </div>

      {/* SLIDE-UP DRAWER */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" data-testid="div-drawer-overlay">
          <div className="absolute inset-0 bg-black/40" onClick={() => { setDrawerOpen(false); setDrawerSection(null); }} />
          <div className="relative bg-background rounded-t-xl max-h-[85vh] flex flex-col shadow-2xl animate-in slide-in-from-bottom duration-300">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <span className="text-lg font-semibold">
                {drawerSection === "trips" ? "My Trips" : drawerSection === "schedule" ? "My Schedule" : drawerSection === "schedule-change" ? "Request Day Change" : drawerSection === "metrics" ? "My Metrics" : drawerSection === "bonus" ? "Weekly Bonus" : "Menu"}
              </span>
              <div className="flex items-center gap-2">
                {drawerSection && (
                  <Button variant="ghost" size="icon" onClick={() => setDrawerSection(null)} data-testid="button-drawer-back" className="min-w-[44px] min-h-[44px]">
                    <ChevronRight className="w-5 h-5 rotate-180" />
                  </Button>
                )}
                <Button variant="ghost" size="icon" onClick={() => { setDrawerOpen(false); setDrawerSection(null); }} data-testid="button-close-drawer" className="min-w-[44px] min-h-[44px]">
                  <X className="w-5 h-5" />
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {!drawerSection && (
                <>
                  {/* S1: Driver Profile */}
                  <div className="flex items-center gap-3" data-testid="div-drawer-profile">
                    <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <User className="w-7 h-7 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-lg font-semibold truncate">{driver.firstName} {driver.lastName}</p>
                      {vehicle && (
                        <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                          <Car className="w-4 h-4" />
                          {vehicle.name} - {vehicle.licensePlate}
                        </p>
                      )}
                      <Badge
                        variant={isOnBreak ? "outline" : isDriverActive ? "default" : "secondary"}
                        className={`mt-1 ${isOnBreak ? "border-amber-500 text-amber-700 dark:text-amber-400" : ""}`}
                      >
                        {isOnBreak ? "On Break" : isDriverActive ? "Online" : "Offline"}
                      </Badge>
                    </div>
                  </div>

                  <div className="border-t pt-3 space-y-1">
                    {/* S2: Trips */}
                    <DrawerMenuItem
                      icon={CalendarDays}
                      label="My Trips"
                      sublabel={`${todayTrips.length} today`}
                      onClick={() => setDrawerSection("trips")}
                      testId="button-drawer-trips"
                    />

                    {/* S3: Schedule */}
                    <DrawerMenuItem
                      icon={CalendarClock}
                      label="My Schedule"
                      onClick={() => setDrawerSection("schedule")}
                      testId="button-drawer-schedule"
                    />

                    {/* S4: Request Day Change */}
                    <DrawerMenuItem
                      icon={FileText}
                      label="Request Day Change"
                      sublabel={scheduleChanges.filter((r: any) => r.status === "pending").length > 0 ? `${scheduleChanges.filter((r: any) => r.status === "pending").length} pending` : undefined}
                      onClick={() => setDrawerSection("schedule-change")}
                      testId="button-drawer-schedule-change"
                    />

                    {/* S5: Metrics */}
                    <DrawerMenuItem
                      icon={BarChart3}
                      label="My Metrics"
                      sublabel={metrics?.score != null ? `Score: ${metrics.score}` : undefined}
                      onClick={() => setDrawerSection("metrics")}
                      testId="button-drawer-metrics"
                    />

                    {/* S6: Weekly Bonus (only when active) */}
                    {bonus?.active && (
                      <DrawerMenuItem
                        icon={Trophy}
                        label="Weekly Bonus"
                        sublabel={bonus.qualifies ? "Qualified" : `${bonus.overallProgress}% progress`}
                        onClick={() => setDrawerSection("bonus")}
                        testId="button-drawer-bonus"
                        highlight={bonus.progressColor === "green"}
                      />
                    )}
                  </div>

                  {/* Break toggle in drawer */}
                  {isDriverOnline && !hasActiveTrip && (
                    <div className="border-t pt-3">
                      <Button
                        variant="outline"
                        className={`w-full min-h-[48px] text-base ${isOnBreak ? "border-green-500 text-green-700 dark:text-green-400" : "border-amber-500 text-amber-700 dark:text-amber-400"}`}
                        onClick={() => { breakMutation.mutate(!isOnBreak); setDrawerOpen(false); }}
                        disabled={breakMutation.isPending}
                        data-testid="button-toggle-break"
                      >
                        {isOnBreak ? <PlayCircle className="w-5 h-5 mr-2" /> : <Coffee className="w-5 h-5 mr-2" />}
                        {isOnBreak ? "Resume from Break" : "Take a Break"}
                      </Button>
                    </div>
                  )}

                  {/* S7: Background Tracking (native only) */}
                  {isNativePlatform && (
                    <div className="border-t pt-3">
                      <Card data-testid="card-background-tracking">
                        <CardContent className="py-4 space-y-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Radio className="w-5 h-5 text-primary" />
                              <span className="font-semibold text-base">Background Tracking</span>
                            </div>
                            <Badge variant={bgTracking ? (bgStale ? "secondary" : "default") : "outline"} data-testid="badge-bg-status">
                              {bgTracking ? (bgStale ? "Stale" : "Running") : "Stopped"}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            GPS continues sending your position to dispatch while the app is in the background.
                          </p>
                          {bgTracking && (
                            <div className="space-y-1">
                              {bgLastSent && (
                                <p className="text-xs text-muted-foreground" data-testid="text-bg-last-sent">
                                  Last sent: {formatTimeSince(bgLastSent)}
                                  {bgAccuracy !== null && ` · Accuracy: ${bgAccuracy}m`}
                                </p>
                              )}
                              {bgStale && (
                                <p className="text-xs text-destructive" data-testid="text-bg-stale-warning">
                                  GPS signal may be weak or blocked. Move to an open area.
                                </p>
                              )}
                            </div>
                          )}
                          {bgPermissionDenied && (
                            <Button
                              variant="outline"
                              className="w-full min-h-[44px] text-base"
                              onClick={bgOpenSettings}
                              data-testid="button-bg-open-settings"
                            >
                              <Settings className="w-5 h-5 mr-2" />
                              Open Location Settings
                            </Button>
                          )}
                          <Button
                            onClick={bgTracking ? bgStop : bgStart}
                            variant={bgTracking ? "destructive" : "default"}
                            className="w-full min-h-[44px] text-base"
                            data-testid={bgTracking ? "button-stop-bg-tracking" : "button-start-bg-tracking"}
                          >
                            <Satellite className="w-5 h-5 mr-2" />
                            {bgTracking ? "Stop Background GPS" : "Start Background GPS"}
                          </Button>
                        </CardContent>
                      </Card>
                    </div>
                  )}

                  {/* S8: Logout / Go Offline */}
                  <div className="border-t pt-3 space-y-2">
                    {isDriverOnline && (
                      <Button
                        variant="destructive"
                        className="w-full min-h-[48px] text-base"
                        onClick={() => { toggleActiveMutation.mutate(false); setDrawerOpen(false); }}
                        disabled={toggleActiveMutation.isPending}
                        data-testid="button-drawer-go-offline"
                      >
                        <PowerOff className="w-5 h-5 mr-2" />
                        Go Offline
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      className="w-full min-h-[48px] text-base text-destructive"
                      onClick={() => { logout(); }}
                      data-testid="button-drawer-logout"
                    >
                      <LogOut className="w-5 h-5 mr-2" />
                      Log Out
                    </Button>
                  </div>
                </>
              )}

              {/* TRIPS SECTION */}
              {drawerSection === "trips" && (
                <DrawerTripsSection
                  todayTrips={todayTrips}
                  allTrips={allTrips}
                  tripsTab={tripsTab}
                  setTripsTab={setTripsTab}
                  selectedDate={selectedDate}
                  setSelectedDate={setSelectedDate}
                  isLoading={tripsQuery.isLoading}
                  statusMutation={statusMutation}
                  setChatTripId={(id) => { setChatTripId(id); setDrawerOpen(false); }}
                  token={token}
                />
              )}

              {/* SCHEDULE SECTION */}
              {drawerSection === "schedule" && (
                <DrawerScheduleSection token={token} />
              )}

              {/* SCHEDULE CHANGE REQUEST SECTION */}
              {drawerSection === "schedule-change" && (
                <DrawerScheduleChangeSection
                  token={token}
                  scheduleChanges={scheduleChanges}
                  onSubmitSuccess={() => {
                    queryClient.invalidateQueries({ queryKey: ["/api/driver/schedule-change-requests"] });
                    toast({ title: "Request submitted to dispatch" });
                  }}
                />
              )}

              {/* METRICS SECTION */}
              {drawerSection === "metrics" && (
                <DrawerMetricsSection metrics={metrics} isLoading={metricsQuery.isLoading} />
              )}

              {/* BONUS SECTION */}
              {drawerSection === "bonus" && bonus?.active && (
                <DrawerBonusSection bonus={bonus} />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Nav chooser overlay */}
      {showNavChooser && navChooserTrip && (
        <div className="fixed inset-0 bg-background/80 z-50 flex items-end justify-center p-4 sm:items-center" data-testid="overlay-nav-chooser">
          <Card className="w-full max-w-md">
            <div className="flex items-center justify-between gap-2 p-4 border-b">
              <span className="text-lg font-semibold">Choose Navigation App</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => { setShowNavChooser(false); setNavChooserTrip(null); setRememberNav(false); }}
                className="min-w-[44px] min-h-[44px]"
                data-testid="button-close-nav-chooser"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
            <CardContent className="py-4 space-y-3">
              <Button
                variant="outline"
                className="w-full justify-start gap-3 min-h-[48px] text-base"
                onClick={() => handleNavSelect("google")}
                data-testid="button-nav-google"
              >
                <MapPin className="w-6 h-6 text-blue-500" />
                <span>Google Maps</span>
                <ExternalLink className="w-4 h-4 ml-auto text-muted-foreground" />
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start gap-3 min-h-[48px] text-base"
                onClick={() => handleNavSelect("waze")}
                data-testid="button-nav-waze"
              >
                <Navigation className="w-6 h-6 text-cyan-500" />
                <span>Waze</span>
                <ExternalLink className="w-4 h-4 ml-auto text-muted-foreground" />
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start gap-3 min-h-[48px] text-base"
                onClick={() => handleNavSelect("apple")}
                data-testid="button-nav-apple"
              >
                <MapPinned className="w-6 h-6 text-green-500" />
                <span>Apple Maps</span>
                <ExternalLink className="w-4 h-4 ml-auto text-muted-foreground" />
              </Button>
              <div className="flex items-center gap-2 pt-2">
                <Checkbox
                  id="remember-nav"
                  checked={rememberNav}
                  onCheckedChange={(checked) => setRememberNav(checked === true)}
                  data-testid="checkbox-remember-nav"
                />
                <label htmlFor="remember-nav" className="text-base text-muted-foreground cursor-pointer">
                  Always use this app
                </label>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Map overlay */}
      {showMap && (
        <div className="fixed inset-0 z-50 flex flex-col" data-testid="overlay-map">
          <div className="flex items-center justify-between gap-2 p-3 bg-background border-b">
            <span className="text-lg font-semibold">Live Map</span>
            <Button variant="ghost" size="icon" onClick={() => setShowMap(false)} data-testid="button-close-map">
              <X className="w-5 h-5" />
            </Button>
          </div>
          <div className="flex-1 relative min-h-0">
            <FullScreenMap
              driverLocation={geoLocation}
              activeTrip={activeTrip}
              mapsLoaded={mapsLoaded}
              gpsWatchError={geoWatchError}
            />
          </div>
        </div>
      )}

      {/* Confirm status dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 bg-background/80 z-50 flex items-end justify-center p-4 sm:items-center" data-testid="overlay-confirm-status">
          <Card className="w-full max-w-md">
            <div className="flex items-center justify-between gap-2 p-4 border-b">
              <span className="text-lg font-semibold">Confirm Action</span>
              <Button variant="ghost" size="icon" onClick={() => setConfirmDialog(null)} data-testid="button-cancel-confirm">
                <X className="w-5 h-5" />
              </Button>
            </div>
            <CardContent className="py-4 space-y-4">
              <p className="text-base font-medium" data-testid="text-confirm-action">
                {confirmDialog.label}?
              </p>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="w-4 h-4" />
                <span data-testid="text-confirm-timestamp">{new Date().toLocaleTimeString()}</span>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm text-muted-foreground">Quick note (optional)</label>
                <Textarea
                  value={confirmNote}
                  onChange={(e) => setConfirmNote(e.target.value)}
                  placeholder="Add a note..."
                  className="text-base"
                  rows={2}
                  data-testid="input-confirm-note"
                />
              </div>
              <div className="flex gap-3">
                <Button
                  className="flex-1 min-h-[48px] text-base font-semibold"
                  onClick={handleConfirmSubmit}
                  disabled={statusMutation.isPending}
                  data-testid="button-confirm-submit"
                >
                  <CheckCircle className="w-5 h-5 mr-2" />
                  Confirm
                </Button>
                <Button
                  variant="outline"
                  className="min-h-[48px] text-base px-6"
                  onClick={() => setConfirmDialog(null)}
                  data-testid="button-confirm-cancel"
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Need Help panel */}
      {needHelpOpen && activeTrip && (
        <div className="fixed inset-0 bg-background/80 z-50 flex items-end justify-center p-4 sm:items-center" data-testid="overlay-need-help">
          <Card className="w-full max-w-md">
            <div className="flex items-center justify-between gap-2 p-4 border-b">
              <span className="text-lg font-semibold">Need Help</span>
              <Button variant="ghost" size="icon" onClick={() => { setNeedHelpOpen(false); setNeedHelpNote(""); }} data-testid="button-close-help">
                <X className="w-5 h-5" />
              </Button>
            </div>
            <CardContent className="py-4 space-y-3">
              <p className="text-sm text-muted-foreground">Select an issue to report for trip {activeTrip.publicId}</p>
              <div className="space-y-2">
                {SUPPORT_EVENT_TYPES.map((evt) => {
                  const EvtIcon = evt.icon;
                  return (
                    <Button
                      key={evt.type}
                      variant="outline"
                      className="w-full justify-start gap-3 min-h-[48px] text-base"
                      onClick={() => handleSupportEvent(evt.type)}
                      disabled={supportSubmitting}
                      data-testid={`button-support-${evt.type}`}
                    >
                      <EvtIcon className="w-5 h-5" />
                      {evt.label}
                    </Button>
                  );
                })}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm text-muted-foreground">Additional notes (optional)</label>
                <Textarea
                  value={needHelpNote}
                  onChange={(e) => setNeedHelpNote(e.target.value)}
                  placeholder="Describe the issue..."
                  className="text-base"
                  rows={2}
                  data-testid="input-help-note"
                />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Chat overlay */}
      {chatTripId && (
        <TripChat
          tripId={chatTripId}
          token={token}
          onClose={() => setChatTripId(null)}
          userId={user?.id}
        />
      )}
    </div>
  );
}

function DrawerMenuItem({ icon: Icon, label, sublabel, onClick, testId, highlight }: {
  icon: any;
  label: string;
  sublabel?: string;
  onClick: () => void;
  testId: string;
  highlight?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-3 rounded-md hover-elevate min-h-[48px]"
      data-testid={testId}
    >
      <Icon className={`w-6 h-6 flex-shrink-0 ${highlight ? "text-green-600" : "text-muted-foreground"}`} />
      <div className="flex-1 text-left min-w-0">
        <p className="text-base font-medium">{label}</p>
        {sublabel && <p className="text-sm text-muted-foreground truncate">{sublabel}</p>}
      </div>
      <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
    </button>
  );
}

function DrawerTripsSection({ todayTrips, allTrips, tripsTab, setTripsTab, selectedDate, setSelectedDate, isLoading, statusMutation, setChatTripId, token }: {
  todayTrips: any[];
  allTrips: any[];
  tripsTab: "scheduled" | "history";
  setTripsTab: (t: "scheduled" | "history") => void;
  selectedDate: string;
  setSelectedDate: (d: string) => void;
  isLoading: boolean;
  statusMutation: any;
  setChatTripId: (id: number) => void;
  token: string | null;
}) {
  const displayTrips = tripsTab === "scheduled" ? todayTrips : allTrips;
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button
          variant={tripsTab === "scheduled" ? "default" : "outline"}
          className="flex-1 min-h-[44px] text-base"
          onClick={() => setTripsTab("scheduled")}
          data-testid="button-trips-scheduled"
        >
          <CalendarDays className="w-5 h-5 mr-2" />
          Scheduled
        </Button>
        <Button
          variant={tripsTab === "history" ? "default" : "outline"}
          className="flex-1 min-h-[44px] text-base"
          onClick={() => setTripsTab("history")}
          data-testid="button-trips-history"
        >
          <History className="w-5 h-5 mr-2" />
          History
        </Button>
      </div>

      {tripsTab === "scheduled" && (
        <div className="flex items-center gap-2">
          <Label className="text-base">Date</Label>
          <Input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-auto min-h-[44px] text-base"
            data-testid="input-driver-date"
          />
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : displayTrips.length === 0 ? (
        <div className="text-center py-8">
          {tripsTab === "scheduled" ? <CalendarDays className="w-10 h-10 mx-auto text-muted-foreground mb-2" /> : <History className="w-10 h-10 mx-auto text-muted-foreground mb-2" />}
          <p className="text-base text-muted-foreground" data-testid="text-no-trips">
            {tripsTab === "scheduled" ? "No trips scheduled for this date." : "No trip history available."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayTrips.map((trip: any) => (
            <TripCard
              key={trip.id}
              trip={trip}
              onStatusChange={tripsTab === "scheduled" ? (status) => statusMutation.mutate({ tripId: trip.id, status }) : undefined}
              isPending={statusMutation.isPending}
              readonly={tripsTab === "history"}
              onOpenChat={tripsTab === "scheduled" && ACTIVE_STATUSES.includes(trip.status) ? () => setChatTripId(trip.id) : undefined}
              token={token}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DrawerScheduleSection({ token }: { token: string | null }) {
  const today = new Date();
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    const dayOfWeek = today.getDay();
    d.setDate(today.getDate() - dayOfWeek + i);
    return d;
  });
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="space-y-3" data-testid="div-drawer-schedule">
      <p className="text-sm text-muted-foreground">This week&apos;s schedule (read-only)</p>
      <div className="grid grid-cols-7 gap-1">
        {weekDays.map((day, i) => {
          const isToday = day.toDateString() === today.toDateString();
          const isPast = day < today && !isToday;
          return (
            <div
              key={i}
              className={`text-center py-3 rounded-md ${isToday ? "bg-primary/10 border border-primary/30" : isPast ? "opacity-50" : "bg-muted/50"}`}
              data-testid={`div-schedule-day-${i}`}
            >
              <p className="text-xs font-medium text-muted-foreground">{dayNames[i]}</p>
              <p className={`text-lg font-bold ${isToday ? "text-primary" : ""}`}>{day.getDate()}</p>
            </div>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground text-center">
        Schedule details are managed by dispatch. Contact dispatch for changes.
      </p>
    </div>
  );
}

function DrawerScheduleChangeSection({ token, scheduleChanges, onSubmitSuccess }: {
  token: string | null;
  scheduleChanges: any[];
  onSubmitSuccess: () => void;
}) {
  const [reqDate, setReqDate] = useState("");
  const [reqType, setReqType] = useState("unavailable");
  const [reqNotes, setReqNotes] = useState("");

  const submitMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/driver/schedule-change-requests", token, {
        method: "POST",
        body: JSON.stringify({ requestedDate: reqDate, requestType: reqType, notes: reqNotes || undefined }),
      }),
    onSuccess: () => {
      setReqDate("");
      setReqNotes("");
      onSubmitSuccess();
    },
  });

  const statusColors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    approved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    denied: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  };

  return (
    <div className="space-y-4" data-testid="div-drawer-schedule-change">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-base">Date</Label>
          <Input
            type="date"
            value={reqDate}
            onChange={(e) => setReqDate(e.target.value)}
            className="min-h-[44px] text-base"
            data-testid="input-schedule-change-date"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-base">Type</Label>
          <div className="grid grid-cols-2 gap-2">
            {["unavailable", "swap", "cover", "other"].map((t) => (
              <Button
                key={t}
                variant={reqType === t ? "default" : "outline"}
                className="min-h-[44px] text-base capitalize"
                onClick={() => setReqType(t)}
                data-testid={`button-schedule-type-${t}`}
              >
                {t}
              </Button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-base">Notes (optional)</Label>
          <Textarea
            value={reqNotes}
            onChange={(e) => setReqNotes(e.target.value)}
            placeholder="Any additional details..."
            className="text-base"
            rows={3}
            data-testid="input-schedule-change-notes"
          />
        </div>
        <Button
          className="w-full min-h-[48px] text-base"
          onClick={() => submitMutation.mutate()}
          disabled={!reqDate || submitMutation.isPending}
          data-testid="button-submit-schedule-change"
        >
          <Send className="w-5 h-5 mr-2" />
          Submit Request
        </Button>
      </div>

      {scheduleChanges.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Previous Requests</p>
          {scheduleChanges.map((req: any) => (
            <div key={req.id} className="flex items-center justify-between gap-2 bg-muted/50 rounded-md px-3 py-2.5" data-testid={`div-schedule-change-${req.id}`}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{req.requestedDate} - <span className="capitalize">{req.requestType}</span></p>
                {req.notes && <p className="text-xs text-muted-foreground truncate">{req.notes}</p>}
                {req.decisionNotes && <p className="text-xs text-muted-foreground">Decision: {req.decisionNotes}</p>}
              </div>
              <Badge className={statusColors[req.status] || ""}>
                {req.status}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ScoreTrendChart({ token }: { token: string | null }) {
  const { data, isLoading, isError } = useQuery<{ history: Array<{ weekStart: string; overallScore: number; completionRate: number; onTimeRate: number }> }>({
    queryKey: ["/api/driver/score-history"],
    queryFn: () => token ? apiFetch("/api/driver/score-history", token) : Promise.resolve({ history: [] }),
    enabled: !!token,
    staleTime: 300000,
    retry: 1,
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (isError) return <p className="text-xs text-muted-foreground text-center py-2">Could not load score history</p>;
  if (!data?.history?.length) return <p className="text-xs text-muted-foreground text-center py-2">No score history yet</p>;

  const chartData = data.history.map(h => ({
    week: h.weekStart ? new Date(h.weekStart).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "",
    score: h.overallScore ?? 0,
    completion: h.completionRate ?? 0,
    onTime: h.onTimeRate ?? 0,
  }));

  return (
    <div className="space-y-2" data-testid="div-score-trend">
      <p className="text-sm font-medium">Score Trend</p>
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={chartData}>
          <defs>
            <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
              <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="week" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} className="fill-muted-foreground" />
          <Tooltip
            contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "13px" }}
            labelStyle={{ color: "hsl(var(--foreground))" }}
          />
          <Area type="monotone" dataKey="score" stroke="hsl(var(--primary))" fill="url(#scoreGrad)" strokeWidth={2} name="Score" />
          <Line type="monotone" dataKey="completion" stroke="hsl(var(--chart-2))" strokeWidth={1.5} dot={false} name="Completion %" />
          <Line type="monotone" dataKey="onTime" stroke="hsl(var(--chart-3))" strokeWidth={1.5} dot={false} name="On-Time %" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function DrawerMetricsSection({ metrics, isLoading }: { metrics: any; isLoading: boolean }) {
  const { token } = useAuth();

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (!metrics) {
    return <p className="text-base text-muted-foreground text-center py-4">No metrics available yet.</p>;
  }

  return (
    <div className="space-y-4" data-testid="div-drawer-metrics">
      <p className="text-sm text-muted-foreground">
        Week of {metrics.weekStart} to {metrics.weekEnd}
      </p>

      <div className="grid grid-cols-2 gap-3">
        <MetricCard icon={Target} label="Completion Rate" value={`${metrics.completionRate}%`} />
        <MetricCard icon={TrendingUp} label="On-Time Rate" value={metrics.onTimeRate != null ? `${metrics.onTimeRate}%` : "N/A"} />
        <MetricCard icon={CheckCircle} label="Completed" value={metrics.completedTrips} />
        <MetricCard icon={CalendarDays} label="Total Trips" value={metrics.totalTrips} />
        <MetricCard icon={AlertTriangle} label="Cancelled" value={metrics.cancelledTrips} />
        <MetricCard icon={Clock} label="No Shows" value={metrics.noShowTrips} />
      </div>

      {metrics.score != null && (
        <div className="bg-muted/50 rounded-md p-4 text-center">
          <p className="text-sm text-muted-foreground mb-1">Driver Score</p>
          <p className="text-4xl font-bold" data-testid="text-driver-score">{metrics.score}</p>
          <p className="text-sm text-muted-foreground">/100</p>
        </div>
      )}

      <ScoreTrendChart token={token} />
    </div>
  );
}

function MetricCard({ icon: Icon, label, value }: { icon: any; label: string; value: string | number }) {
  return (
    <div className="bg-muted/50 rounded-md p-3 text-center">
      <Icon className="w-5 h-5 mx-auto text-muted-foreground mb-1" />
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function DrawerBonusSection({ bonus }: { bonus: any }) {
  const progressColorClasses: Record<string, string> = {
    red: "bg-red-500",
    yellow: "bg-yellow-500",
    green: "bg-green-500",
  };

  const bonusAmount = bonus.weeklyAmountCents ? `$${(bonus.weeklyAmountCents / 100).toFixed(2)}` : "";

  return (
    <div className="space-y-4" data-testid="div-drawer-bonus">
      <div className="text-center">
        <Trophy className={`w-10 h-10 mx-auto mb-2 ${bonus.qualifies ? "text-green-600" : "text-muted-foreground"}`} />
        <p className="text-2xl font-bold" data-testid="text-bonus-amount">{bonusAmount}</p>
        <p className="text-sm text-muted-foreground">Weekly Bonus</p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span>Progress</span>
          <span className="font-medium">{bonus.overallProgress}%</span>
        </div>
        <div className="w-full bg-muted rounded-full h-4 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${progressColorClasses[bonus.progressColor] || "bg-muted-foreground"}`}
            style={{ width: `${Math.min(100, bonus.overallProgress)}%` }}
            data-testid="div-bonus-progress-bar"
          />
        </div>
      </div>

      {bonus.requirements && (
        <div className="space-y-2 text-sm">
          <BonusRequirement
            label="Trips"
            current={bonus.requirements.currentTrips}
            required={bonus.requirements.minTrips}
            met={bonus.requirements.currentTrips >= bonus.requirements.minTrips}
          />
          <BonusRequirement
            label="On-Time Rate"
            current={`${bonus.requirements.currentOnTimeRate}%`}
            required={`${bonus.requirements.minOnTimeRate}%`}
            met={bonus.requirements.currentOnTimeRate >= bonus.requirements.minOnTimeRate}
          />
          <BonusRequirement
            label="Completion Rate"
            current={`${bonus.requirements.currentCompletionRate}%`}
            required={`${bonus.requirements.minCompletionRate}%`}
            met={bonus.requirements.currentCompletionRate >= bonus.requirements.minCompletionRate}
          />
        </div>
      )}

      <div className="text-center">
        <Badge variant={bonus.qualifies ? "default" : "secondary"} className={bonus.qualifies ? "bg-green-600 text-white" : ""}>
          {bonus.qualifies ? "Qualified" : "Not Yet Qualified"}
        </Badge>
      </div>
    </div>
  );
}

function BonusRequirement({ label, current, required, met }: { label: string; current: string | number; required: string | number; met: boolean }) {
  return (
    <div className="flex items-center justify-between bg-muted/50 rounded-md px-3 py-2">
      <div className="flex items-center gap-2">
        {met ? <CheckCircle className="w-4 h-4 text-green-600" /> : <AlertTriangle className="w-4 h-4 text-amber-500" />}
        <span>{label}</span>
      </div>
      <span className="font-medium">{current} / {required}</span>
    </div>
  );
}

function TripCard({
  trip,
  onStatusChange,
  isPending,
  readonly,
  onOpenChat,
  token,
}: {
  trip: any;
  onStatusChange?: (status: string) => void;
  isPending?: boolean;
  readonly?: boolean;
  onOpenChat?: () => void;
  token?: string | null;
}) {
  const statusAction = STATUS_FLOW[trip.status];
  const statusColorClass = STATUS_COLORS[trip.status] || "";
  const isCompleted = trip.status === "COMPLETED";
  const isCancelled = trip.status === "CANCELLED" || trip.status === "NO_SHOW";
  const isLocked = isCompleted || isCancelled;

  const [showProgress, setShowProgress] = useState(false);

  return (
    <Card data-testid={`card-trip-${trip.id}`}>
      <CardContent className="py-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-2 flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm font-medium" data-testid={`text-trip-id-${trip.id}`}>{trip.publicId}</span>
              <Badge className={statusColorClass} data-testid={`badge-trip-status-${trip.id}`}>
                {STATUS_LABELS[trip.status] || trip.status.replace(/_/g, " ")}
              </Badge>
              {isLocked && <Lock className="w-4 h-4 text-muted-foreground" />}
            </div>

            <TripDateTimeHeader trip={trip} />

            <div className="space-y-1">
              <div className="flex items-start gap-2 text-base">
                <Navigation className="w-5 h-5 mt-0.5 flex-shrink-0 text-green-600" />
                <span className="truncate" data-testid={`text-pickup-${trip.id}`}>{trip.pickupAddress || "Pickup not set"}</span>
              </div>
              <div className="flex items-start gap-2 text-base">
                <MapPin className="w-5 h-5 mt-0.5 flex-shrink-0 text-red-600" />
                <span className="truncate" data-testid={`text-dropoff-${trip.id}`}>{trip.dropoffAddress || "Dropoff not set"}</span>
              </div>
            </div>

            <TripMetricsCard trip={trip} />

            {trip.patientName && (
              <div className="flex items-center gap-2 text-base text-muted-foreground">
                <User className="w-5 h-5" />
                <span>{trip.patientName}</span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 items-end">
            {!readonly && !isLocked && statusAction && onStatusChange && (
              <Button
                onClick={() => onStatusChange(statusAction.next)}
                disabled={isPending}
                className="min-h-[44px] text-base"
                data-testid={`button-trip-action-${trip.id}`}
              >
                <statusAction.icon className="w-5 h-5 mr-2" />
                {statusAction.label}
              </Button>
            )}
            {!isLocked && onOpenChat && ACTIVE_STATUSES.includes(trip.status) && (
              <Button
                variant="outline"
                onClick={onOpenChat}
                className="min-h-[44px] text-base"
                data-testid={`button-trip-chat-${trip.id}`}
              >
                <MessageSquare className="w-5 h-5 mr-2" />
                Contact Dispatch
              </Button>
            )}
          </div>
        </div>

        {(isCompleted || isCancelled || ACTIVE_STATUSES.includes(trip.status)) && (
          <div className="mt-3 border-t pt-3">
            <button
              type="button"
              className="text-sm text-muted-foreground flex items-center gap-1.5 mb-2 min-h-[44px]"
              onClick={() => setShowProgress(!showProgress)}
              data-testid={`button-toggle-progress-${trip.id}`}
            >
              <CheckCircle className="w-4 h-4" />
              {showProgress ? "Hide" : "Show"} Trip Progress
            </button>
            {showProgress && (
              <TripProgressTimeline trip={trip} compact showHeader={false} showMetrics={false} />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TripChat({
  tripId,
  token,
  onClose,
  userId,
}: {
  tripId: number;
  token: string | null;
  onClose: () => void;
  userId?: number;
}) {
  const { toast } = useToast();
  const [message, setMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const messagesQuery = useQuery<any[]>({
    queryKey: ["/api/trips", tripId, "messages"],
    queryFn: () => apiFetch(`/api/trips/${tripId}/messages`, token),
    enabled: !!token,
    refetchInterval: 60000,
  });

  const sendMutation = useMutation({
    mutationFn: (msg: string) =>
      apiFetch(`/api/trips/${tripId}/messages`, token, {
        method: "POST",
        body: JSON.stringify({ message: msg }),
      }),
    onSuccess: () => {
      setMessage("");
      queryClient.invalidateQueries({ queryKey: ["/api/trips", tripId, "messages"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messagesQuery.data]);

  const messages = messagesQuery.data || [];

  return (
    <div className="fixed inset-0 bg-background/80 z-50 flex items-end justify-center p-4 sm:items-center">
      <Card className="w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between gap-2 p-4 border-b">
          <span className="text-lg font-semibold">Trip Messages</span>
          <Button variant="ghost" size="icon" onClick={onClose} className="min-w-[44px] min-h-[44px]" data-testid="button-close-chat">
            <X className="w-5 h-5" />
          </Button>
        </div>
        <CardContent className="flex-1 overflow-y-auto min-h-[200px] space-y-2 pb-2">
          {messages.length === 0 ? (
            <p className="text-base text-muted-foreground text-center py-4">No messages yet. Start the conversation.</p>
          ) : (
            messages.map((msg: any) => (
              <div
                key={msg.id}
                className={`flex ${msg.senderId === userId ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-md px-3 py-2 text-base ${
                    msg.senderId === userId
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                  data-testid={`message-${msg.id}`}
                >
                  <p className="text-xs opacity-70 mb-1">
                    {msg.senderRole === "DRIVER" ? "Driver" : "Dispatch"} - {new Date(msg.createdAt).toLocaleTimeString()}
                  </p>
                  <p>{msg.message}</p>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </CardContent>
        <div className="p-3 border-t flex gap-2">
          <Textarea
            placeholder="Type a message..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="flex-1 min-h-[44px] resize-none text-base"
            rows={1}
            data-testid="input-chat-message"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (message.trim()) sendMutation.mutate(message.trim());
              }
            }}
          />
          <Button
            size="icon"
            onClick={() => { if (message.trim()) sendMutation.mutate(message.trim()); }}
            disabled={sendMutation.isPending || !message.trim()}
            className="min-w-[44px] min-h-[44px]"
            data-testid="button-send-message"
          >
            <Send className="w-5 h-5" />
          </Button>
        </div>
      </Card>
    </div>
  );
}
