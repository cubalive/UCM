import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
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
  Home,
  Car,
  BarChart3,
  Trophy,
  DollarSign,
  Calendar,
  Settings,
  MapPin,
  Clock,
  CheckCircle,
  PlayCircle,
  Navigation,
  User,
  AlertTriangle,
  Power,
  PowerOff,
  LocateFixed,
  Satellite,
  WifiOff,
  Coffee,
  X,
  ChevronRight,
  LogOut,
  Target,
  ClipboardCopy,
  ExternalLink,
  MapPinned,
  Bell,
  Send,
  ChevronDown,
  ChevronUp,
  Shield,
  Fuel,
  Sparkles,
  TrendingUp,
  Hash,
  FileText,
  Loader2,
} from "lucide-react";

type TabId = "home" | "trips" | "performance" | "bonuses" | "earnings" | "schedule" | "settings";

const TABS: { id: TabId; label: string; icon: any }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "trips", label: "Trips", icon: Car },
  { id: "performance", label: "Perform", icon: BarChart3 },
  { id: "bonuses", label: "Bonuses", icon: Trophy },
  { id: "earnings", label: "Earnings", icon: DollarSign },
  { id: "schedule", label: "Schedule", icon: Calendar },
  { id: "settings", label: "Settings", icon: Settings },
];

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
const PICKUP_STAGES = ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP"];

const TIMELINE_STEPS = [
  { key: "scheduledDate", label: "Scheduled" },
  { key: "arrivedPickupAt", label: "Arrived Pickup" },
  { key: "pickedUpAt", label: "Picked Up" },
  { key: "arrivedDropoffAt", label: "Arrived Dropoff" },
  { key: "completedAt", label: "Completed" },
];

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
  arrivedPickupAt?: string | null;
  pickedUpAt?: string | null;
  arrivedDropoffAt?: string | null;
  completedAt?: string | null;
}

const isStandalone =
  typeof window !== "undefined" &&
  (window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true);

const isNativePlatform = typeof (window as any).Capacitor !== "undefined" && (window as any).Capacitor.isNativePlatform?.() === true;

function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

function formatTimeSince(timestamp: number): string {
  const diff = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
  }
  return Promise.resolve(false);
}

function getDestinationAddress(trip: ActiveTripData): string {
  const isPickupPhase = PICKUP_STAGES.includes(trip.status);
  return isPickupPhase ? trip.pickupAddress : trip.dropoffAddress;
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
    if (!navigator.geolocation) {
      setPermission("denied");
    }
  }, []);

  const requestPermission = useCallback(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, timestamp: pos.timestamp });
        setPermission("granted");
        setWatchError(false);
        retryCountRef.current = 0;
      },
      (err) => {
        if (err.code === 1) {
          setPermission("denied");
        } else if (err.code === 3) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, timestamp: pos.timestamp });
              setPermission("granted");
              setWatchError(false);
              retryCountRef.current = 0;
            },
            (err2) => {
              if (err2.code === 1) setPermission("denied");
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
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
      setWatchError(false);
      watchRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, timestamp: pos.timestamp });
          setWatchError(false);
          retryCountRef.current = 0;
        },
        () => {
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
      if (watchRef.current !== null) { navigator.geolocation.clearWatch(watchRef.current); watchRef.current = null; }
      if (retryRef.current !== null) { clearTimeout(retryRef.current); retryRef.current = null; }
    };
  }, [isActive, permission]);

  return { permission, location, watchError, requestPermission, isStandalone };
}

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
      if (Prefs) Prefs.set({ key: "ucm_driver_jwt", value: token }).catch(() => {});
    }
  }, [token]);

  const startTracking = useCallback(async () => {
    if (!isNativePlatform || !tokenRef.current) return;
    if (watcherIdRef.current) return;
    try {
      const cap = (window as any).Capacitor;
      const BackgroundGeolocation = cap.Plugins?.BackgroundGeolocation;
      if (!BackgroundGeolocation) return;
      const id = await BackgroundGeolocation.addWatcher(
        { backgroundMessage: "UCM Driver is tracking your location.", backgroundTitle: "UCM Driver - Location Active", requestPermissions: true, stale: false, distanceFilter: 25 },
        (location: any, error: any) => {
          if (error) { if (error.code === "NOT_AUTHORIZED") setBgPermissionDenied(true); return; }
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
            const host = window.location.origin || "https://driver.unitedcaremobility.com";
            fetch(`${host}/api/driver/me/location`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${currentToken}` },
              body: JSON.stringify({ lat: location.latitude, lng: location.longitude, accuracy: location.accuracy, timestamp: location.time || now }),
            }).then((res) => {
              if (res.ok) { setBgLastSent(Date.now()); setBgAccuracy(Math.round(location.accuracy)); bgLastLatRef.current = location.latitude; bgLastLngRef.current = location.longitude; }
            }).catch(() => {});
          }
        }
      );
      watcherIdRef.current = id;
      setTracking(true);
      setBgPermissionDenied(false);
    } catch {}
  }, []);

  const stopTracking = useCallback(async () => {
    if (!isNativePlatform || !watcherIdRef.current) return;
    try {
      const cap = (window as any).Capacitor;
      const BackgroundGeolocation = cap.Plugins?.BackgroundGeolocation;
      if (BackgroundGeolocation) await BackgroundGeolocation.removeWatcher({ id: watcherIdRef.current });
      watcherIdRef.current = null;
      setTracking(false);
    } catch {}
  }, []);

  const isStale = bgLastSent !== null && (Date.now() - bgLastSent > 120000);

  return { tracking, bgLastSent, bgAccuracy, bgPermissionDenied, isStale, startTracking, stopTracking };
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
    permission_needed: { bg: "bg-blue-600", icon: LocateFixed, label: "Location permission needed", action: true },
    gps_stale: { bg: "bg-amber-600", icon: Satellite, label: "GPS signal stale", sublabel: lastSentTime ? `Last update ${formatTimeSince(lastSentTime)}` : "No recent update" },
    offline: { bg: "bg-red-700", icon: WifiOff, label: "Device offline", sublabel: "Locations queued for retry" },
    watch_error: { bg: "bg-amber-600", icon: AlertTriangle, label: "GPS signal lost", sublabel: "Attempting to reconnect..." },
  };
  const c = config[status];
  const Icon = c.icon;
  return (
    <div className={`${c.bg} text-white rounded-md shadow-lg px-4 py-2.5 flex items-center gap-3`} data-testid={`banner-gps-${status.replace("_", "-")}`}>
      <Icon className="w-5 h-5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="font-medium text-sm">{c.label}</span>
        {c.sublabel && <span className="text-xs opacity-90 ml-2">{c.sublabel}</span>}
      </div>
      {c.action && (
        <Button onClick={onRequestPermission} variant="outline" className="text-white border-white/40 min-h-[36px] text-sm px-3" data-testid="button-gps-banner-enable">
          Enable
        </Button>
      )}
    </div>
  );
}

function getChecklistKey(): string {
  return `ucm_driver_checklist_${getToday()}`;
}

function getStoredChecklist(): boolean {
  try {
    return localStorage.getItem(getChecklistKey()) === "done";
  } catch { return false; }
}

function storeChecklistDone() {
  try { localStorage.setItem(getChecklistKey(), "done"); } catch {}
}

function BottomNav({ activeTab, onTabChange }: { activeTab: TabId; onTabChange: (tab: TabId) => void }) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-background border-t border-border safe-area-bottom" data-testid="nav-bottom">
      <div className="flex items-stretch justify-around max-w-lg mx-auto">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex flex-col items-center justify-center gap-0.5 min-h-[56px] min-w-[44px] flex-1 py-1.5 transition-colors ${
                isActive ? "text-primary" : "text-muted-foreground"
              }`}
              data-testid={`tab-${tab.id}`}
            >
              <Icon className={`w-5 h-5 ${isActive ? "text-primary" : ""}`} />
              <span className={`text-[10px] font-medium leading-tight ${isActive ? "text-primary" : ""}`}>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function PreConnectChecklist({ vehicle, onConfirm, onClose }: { vehicle: any; onConfirm: () => void; onClose: () => void }) {
  const [clean, setClean] = useState(false);
  const [fuel, setFuel] = useState(false);
  const [ramp, setRamp] = useState(false);
  const isWheelchair = vehicle?.capability === "WHEELCHAIR";
  const allChecked = clean && fuel && (!isWheelchair || ramp);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" data-testid="modal-preconnect-checklist">
      <Card className="w-full max-w-sm">
        <CardContent className="py-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-lg font-semibold" data-testid="text-checklist-title">Pre-Trip Checklist</h3>
            <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-close-checklist">
              <X className="w-5 h-5" />
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">Confirm before going online</p>
          <div className="space-y-3">
            <label className="flex items-center gap-3 min-h-[44px] cursor-pointer" data-testid="checklist-vehicle-clean">
              <button
                type="button"
                role="switch"
                aria-checked={clean}
                onClick={() => setClean(!clean)}
                className={`w-11 h-6 rounded-full relative transition-colors flex-shrink-0 ${clean ? "bg-green-500" : "bg-muted"}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${clean ? "translate-x-5" : ""}`} />
              </button>
              <span className="text-base">Vehicle Clean</span>
            </label>
            <label className="flex items-center gap-3 min-h-[44px] cursor-pointer" data-testid="checklist-fuel-ok">
              <button
                type="button"
                role="switch"
                aria-checked={fuel}
                onClick={() => setFuel(!fuel)}
                className={`w-11 h-6 rounded-full relative transition-colors flex-shrink-0 ${fuel ? "bg-green-500" : "bg-muted"}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${fuel ? "translate-x-5" : ""}`} />
              </button>
              <span className="text-base">Fuel Level OK</span>
            </label>
            {isWheelchair && (
              <label className="flex items-center gap-3 min-h-[44px] cursor-pointer" data-testid="checklist-ramp-ok">
                <button
                  type="button"
                  role="switch"
                  aria-checked={ramp}
                  onClick={() => setRamp(!ramp)}
                  className={`w-11 h-6 rounded-full relative transition-colors flex-shrink-0 ${ramp ? "bg-green-500" : "bg-muted"}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${ramp ? "translate-x-5" : ""}`} />
                </button>
                <span className="text-base">Ramp/Lift OK</span>
              </label>
            )}
          </div>
          <Button
            onClick={() => { storeChecklistDone(); onConfirm(); }}
            disabled={!allChecked}
            className="w-full min-h-[48px] text-base"
            data-testid="button-checklist-confirm"
          >
            <Power className="w-5 h-5 mr-2" />
            Go Online
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function NavChooser({ trip, onClose }: { trip: ActiveTripData; onClose: () => void }) {
  const [remember, setRemember] = useState(false);
  const handleSelect = (app: NavApp) => {
    if (remember) setSavedNavApp(app);
    window.open(getNavUrlForApp(trip, app), "_blank");
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center p-4 sm:items-center" data-testid="overlay-nav-chooser">
      <Card className="w-full max-w-md">
        <div className="flex items-center justify-between gap-2 p-4 border-b">
          <span className="text-lg font-semibold">Choose Navigation App</span>
          <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-close-nav-chooser">
            <X className="w-5 h-5" />
          </Button>
        </div>
        <CardContent className="py-4 space-y-3">
          <Button variant="outline" className="w-full justify-start gap-3 min-h-[48px] text-base" onClick={() => handleSelect("google")} data-testid="button-nav-google">
            <MapPin className="w-6 h-6 text-blue-500" /> <span>Google Maps</span> <ExternalLink className="w-4 h-4 ml-auto text-muted-foreground" />
          </Button>
          <Button variant="outline" className="w-full justify-start gap-3 min-h-[48px] text-base" onClick={() => handleSelect("waze")} data-testid="button-nav-waze">
            <Navigation className="w-6 h-6 text-cyan-500" /> <span>Waze</span> <ExternalLink className="w-4 h-4 ml-auto text-muted-foreground" />
          </Button>
          <Button variant="outline" className="w-full justify-start gap-3 min-h-[48px] text-base" onClick={() => handleSelect("apple")} data-testid="button-nav-apple">
            <MapPinned className="w-6 h-6 text-green-500" /> <span>Apple Maps</span> <ExternalLink className="w-4 h-4 ml-auto text-muted-foreground" />
          </Button>
          <label className="flex items-center gap-2 pt-2 min-h-[44px] cursor-pointer" data-testid="label-remember-nav">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="w-4 h-4 rounded" />
            <span className="text-base text-muted-foreground">Always use this app</span>
          </label>
        </CardContent>
      </Card>
    </div>
  );
}

function ConfirmStatusDialog({ label, onConfirm, onCancel }: { label: string; onConfirm: (note: string) => void; onCancel: () => void }) {
  const [note, setNote] = useState("");
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" data-testid="dialog-confirm-status">
      <Card className="w-full max-w-sm">
        <CardContent className="py-6 space-y-4">
          <h3 className="text-lg font-semibold" data-testid="text-confirm-title">Confirm: {label}</h3>
          <p className="text-sm text-muted-foreground">Are you sure you want to proceed?</p>
          <div className="space-y-2">
            <Label htmlFor="confirm-note">Note (optional)</Label>
            <Textarea id="confirm-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note..." className="min-h-[44px] text-base" data-testid="input-confirm-note" />
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={onCancel} className="flex-1 min-h-[44px]" data-testid="button-confirm-cancel">Cancel</Button>
            <Button onClick={() => onConfirm(note)} className="flex-1 min-h-[44px]" data-testid="button-confirm-submit">Confirm</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TripCardCompact({ trip, onTap }: { trip: any; onTap: () => void }) {
  return (
    <button
      onClick={onTap}
      className="w-full text-left rounded-md bg-muted/50 px-3 py-2.5 min-h-[48px] space-y-1 hover-elevate"
      data-testid={`card-trip-compact-${trip.id}`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium" data-testid={`text-trip-time-${trip.id}`}>{trip.pickupTime || "N/A"}</span>
        <Badge className={STATUS_COLORS[trip.status] || ""} data-testid={`badge-trip-status-${trip.id}`}>
          {STATUS_LABELS[trip.status] || trip.status}
        </Badge>
        {trip.publicId && <span className="text-xs text-muted-foreground font-mono">{trip.publicId}</span>}
      </div>
      <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
        <Navigation className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-green-600" />
        <span className="truncate">{trip.pickupAddress || "N/A"}</span>
      </div>
      <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
        <MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-red-600" />
        <span className="truncate">{trip.dropoffAddress || "N/A"}</span>
      </div>
    </button>
  );
}

function TripDetailModal({ trip, token, onClose, onStatusChange, isPending }: {
  trip: any;
  token: string | null;
  onClose: () => void;
  onStatusChange: (tripId: number, status: string) => void;
  isPending: boolean;
}) {
  const { toast } = useToast();
  const statusAction = STATUS_FLOW[trip.status];
  const isLocked = trip.status === "COMPLETED" || trip.status === "CANCELLED" || trip.status === "NO_SHOW";

  const openNavigation = useCallback(() => {
    const savedApp = getSavedNavApp();
    if (savedApp) {
      window.open(getNavUrlForApp(trip, savedApp), "_blank");
    } else {
      const url = getNavUrlForApp(trip, "google");
      window.open(url, "_blank");
    }
  }, [trip]);

  const handleCopy = async () => {
    const addr = getDestinationAddress(trip);
    const ok = await copyToClipboard(addr);
    toast({ title: ok ? "Address copied" : "Could not copy" });
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center sm:items-center sm:p-4" data-testid="modal-trip-detail">
      <Card className="w-full sm:max-w-lg max-h-[90vh] flex flex-col rounded-t-xl sm:rounded-xl">
        <div className="flex items-center justify-between gap-2 p-4 border-b flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span className="font-semibold text-lg">Trip Detail</span>
            {trip.publicId && <span className="text-sm text-muted-foreground font-mono">{trip.publicId}</span>}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-close-trip-detail">
            <X className="w-5 h-5" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="rounded-md bg-muted/30 h-32 flex items-center justify-center text-muted-foreground text-sm" data-testid="div-trip-map-placeholder">
            Map
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={STATUS_COLORS[trip.status] || ""} data-testid="badge-detail-status">
              {STATUS_LABELS[trip.status] || trip.status}
            </Badge>
            {trip.patientName && (
              <span className="text-sm text-muted-foreground flex items-center gap-1"><User className="w-4 h-4" />{trip.patientName}</span>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <Navigation className="w-5 h-5 mt-0.5 flex-shrink-0 text-green-600" />
              <div className="flex-1 min-w-0">
                <span className="text-xs text-muted-foreground">Pickup</span>
                <p className="text-sm" data-testid="text-detail-pickup">{trip.pickupAddress || "N/A"}</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <MapPin className="w-5 h-5 mt-0.5 flex-shrink-0 text-red-600" />
              <div className="flex-1 min-w-0">
                <span className="text-xs text-muted-foreground">Dropoff</span>
                <p className="text-sm" data-testid="text-detail-dropoff">{trip.dropoffAddress || "N/A"}</p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium text-muted-foreground">Timeline</span>
            <div className="space-y-1.5">
              {TIMELINE_STEPS.map((step, idx) => {
                const val = step.key === "scheduledDate" ? `${trip.scheduledDate} ${trip.pickupTime || ""}` : (trip[step.key] || null);
                const isDone = !!val;
                return (
                  <div key={step.key} className="flex items-center gap-2" data-testid={`timeline-step-${step.key}`}>
                    <div className={`w-3 h-3 rounded-full flex-shrink-0 ${isDone ? "bg-green-500" : "bg-muted"}`} />
                    <span className={`text-sm flex-1 ${isDone ? "" : "text-muted-foreground"}`}>{step.label}</span>
                    {val && <span className="text-xs text-muted-foreground">{typeof val === "string" && val.includes("T") ? new Date(val).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : val}</span>}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            {!isLocked && (
              <Button variant="outline" onClick={openNavigation} className="flex-1 min-h-[44px]" data-testid="button-detail-navigate">
                <Navigation className="w-5 h-5 mr-2" /> Navigate
              </Button>
            )}
            {!isLocked && (
              <Button variant="outline" onClick={handleCopy} className="min-h-[44px]" data-testid="button-detail-copy">
                <ClipboardCopy className="w-5 h-5" />
              </Button>
            )}
          </div>

          {!isLocked && statusAction && (
            <Button
              onClick={() => onStatusChange(trip.id, trip.status)}
              disabled={isPending}
              className="w-full min-h-[48px] text-base"
              data-testid="button-detail-status-action"
            >
              <statusAction.icon className="w-5 h-5 mr-2" />
              {statusAction.label}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

function HomePage({
  driver, vehicle, token, gpsStatus, lastSentTime, requestPermission,
  isDriverActive, isOnBreak, isDriverOnline, hasActiveTrip, activeTrip,
  todayTrips, toggleActiveMutation, breakMutation, onStatusChange, statusIsPending,
  onOpenNavigation, isNetworkOnline,
}: {
  driver: any; vehicle: any; token: string | null;
  gpsStatus: GpsStatus; lastSentTime: number | null; requestPermission: () => void;
  isDriverActive: boolean; isOnBreak: boolean; isDriverOnline: boolean; hasActiveTrip: boolean;
  activeTrip: ActiveTripData | null; todayTrips: any[];
  toggleActiveMutation: any; breakMutation: any;
  onStatusChange: (tripId: number, currentStatus: string) => void; statusIsPending: boolean;
  onOpenNavigation: (trip: ActiveTripData) => void; isNetworkOnline: boolean;
}) {
  const { toast } = useToast();
  const [showChecklist, setShowChecklist] = useState(false);

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
  const offers = offersQuery.data?.offers || [];
  const currentOffer = offers.length > 0 ? offers[0] : null;

  const [goTimeCountdown, setGoTimeCountdown] = useState(0);
  useEffect(() => {
    if (goTimeTrip?.secondsUntilPickup != null) setGoTimeCountdown(goTimeTrip.secondsUntilPickup);
  }, [goTimeTrip?.secondsUntilPickup, goTimeTrip?.alertId]);
  useEffect(() => {
    if (!goTimeTrip) return;
    const iv = setInterval(() => setGoTimeCountdown((p) => Math.max(0, p - 1)), 1000);
    return () => clearInterval(iv);
  }, [goTimeTrip?.alertId]);

  const [offerCountdown, setOfferCountdown] = useState(0);
  useEffect(() => {
    if (currentOffer) setOfferCountdown(currentOffer.secondsRemaining || 0);
  }, [currentOffer?.offerId]);
  useEffect(() => {
    if (!currentOffer) return;
    const iv = setInterval(() => setOfferCountdown((p) => Math.max(0, p - 1)), 1000);
    return () => clearInterval(iv);
  }, [currentOffer?.offerId]);

  const acknowledgeMutation = useMutation({
    mutationFn: (alertId: string) => apiFetch(`/api/driver/go-time/${alertId}/acknowledge`, token, { method: "POST" }),
  });

  const acceptOfferMutation = useMutation({
    mutationFn: (offerId: string) => apiFetch(`/api/driver/offers/${offerId}/accept`, token, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Trip accepted" });
      queryClient.invalidateQueries({ queryKey: ["/api/driver/offers/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/driver/my-trips"] });
      queryClient.invalidateQueries({ queryKey: ["/api/driver/active-trip"] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const declineOfferMutation = useMutation({
    mutationFn: (offerId: string) => apiFetch(`/api/driver/offers/${offerId}/decline`, token, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/driver/offers/active"] }),
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleConnect = () => {
    if (getStoredChecklist()) {
      toggleActiveMutation.mutate(true);
    } else {
      setShowChecklist(true);
    }
  };

  const nextPickup = todayTrips.find((t: any) => t.status === "SCHEDULED" || t.status === "ASSIGNED");
  const scheduledCount = todayTrips.length;
  const completedCount = todayTrips.filter((t: any) => t.status === "COMPLETED").length;

  const handleCopy = async (trip: ActiveTripData) => {
    const addr = getDestinationAddress(trip);
    const ok = await copyToClipboard(addr);
    toast({ title: ok ? "Address copied" : "Could not copy" });
  };

  return (
    <div className="space-y-4 p-4" data-testid="page-home">
      <GpsStatusBanner status={gpsStatus} lastSentTime={lastSentTime} onRequestPermission={requestPermission} />

      {!isNetworkOnline && (
        <div className="bg-red-700 text-white rounded-md px-4 py-2.5 flex items-center gap-2" data-testid="banner-offline">
          <WifiOff className="w-5 h-5" />
          <span className="text-sm font-medium">You are offline</span>
        </div>
      )}

      <Card data-testid="card-connect-status">
        <CardContent className="py-6">
          {!isDriverOnline ? (
            <div className="text-center space-y-4">
              <div className="w-20 h-20 rounded-full bg-muted mx-auto flex items-center justify-center">
                <PowerOff className="w-10 h-10 text-muted-foreground" />
              </div>
              <p className="text-lg font-semibold text-muted-foreground" data-testid="text-status-offline">You are offline</p>
              <Button
                onClick={handleConnect}
                disabled={toggleActiveMutation.isPending}
                className="w-full min-h-[56px] text-lg bg-green-600 border-green-700 text-white"
                data-testid="button-connect"
              >
                {toggleActiveMutation.isPending ? <Loader2 className="w-6 h-6 mr-2 animate-spin" /> : <Power className="w-6 h-6 mr-2" />}
                CONNECT
              </Button>
            </div>
          ) : isOnBreak ? (
            <div className="text-center space-y-4">
              <div className="w-20 h-20 rounded-full bg-amber-100 dark:bg-amber-900/30 mx-auto flex items-center justify-center">
                <Coffee className="w-10 h-10 text-amber-600" />
              </div>
              <p className="text-lg font-semibold text-amber-600" data-testid="text-status-break">ON BREAK</p>
              <Button
                onClick={() => breakMutation.mutate(false)}
                disabled={breakMutation.isPending}
                className="w-full min-h-[48px] text-base"
                data-testid="button-resume-break"
              >
                <PlayCircle className="w-5 h-5 mr-2" /> Resume
              </Button>
            </div>
          ) : (
            <div className="text-center space-y-3">
              <div className="w-20 h-20 rounded-full bg-green-100 dark:bg-green-900/30 mx-auto flex items-center justify-center">
                <Satellite className="w-10 h-10 text-green-600" />
              </div>
              <p className="text-lg font-semibold text-green-600" data-testid="text-status-connected">CONNECTED</p>
              <div className="flex gap-2 justify-center">
                {!hasActiveTrip && (
                  <Button variant="outline" onClick={() => breakMutation.mutate(true)} disabled={breakMutation.isPending} className="min-h-[44px]" data-testid="button-take-break">
                    <Coffee className="w-5 h-5 mr-2" /> Break
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {goTimeTrip && (
        <Card className="border-amber-500 dark:border-amber-400" data-testid="card-go-time">
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <Bell className="w-6 h-6 text-amber-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-base">Go Time!</p>
                <p className="text-sm text-muted-foreground">Pickup in {formatCountdown(goTimeCountdown)}</p>
                <p className="text-sm text-muted-foreground truncate">{goTimeTrip.pickupAddress}</p>
              </div>
              <Button
                onClick={async () => {
                  try { await acknowledgeMutation.mutateAsync(goTimeTrip.alertId); } catch {}
                  onStatusChange(goTimeTrip.tripId, "ASSIGNED");
                }}
                className="min-h-[44px]"
                data-testid="button-go-time-start"
              >
                Start
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {currentOffer && (
        <Card className="border-primary" data-testid="card-offer">
          <CardContent className="py-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="font-semibold text-base">New Trip Offer</span>
              <Badge variant="outline" data-testid="badge-offer-countdown">
                {offerCountdown > 0 ? `${formatCountdown(offerCountdown)}` : "Expired"}
              </Badge>
            </div>
            <div className="space-y-1">
              <div className="flex items-start gap-1.5 text-sm"><Navigation className="w-4 h-4 mt-0.5 flex-shrink-0 text-green-600" /><span className="truncate">{currentOffer.pickupAddress}</span></div>
              <div className="flex items-start gap-1.5 text-sm"><MapPin className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-600" /><span className="truncate">{currentOffer.dropoffAddress}</span></div>
              {currentOffer.pickupTime && <div className="flex items-center gap-1.5 text-sm text-muted-foreground"><Clock className="w-4 h-4" /><span>{currentOffer.pickupTime}</span></div>}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => declineOfferMutation.mutate(currentOffer.offerId)} disabled={declineOfferMutation.isPending} className="flex-1 min-h-[44px]" data-testid="button-decline-offer">
                Decline
              </Button>
              <Button onClick={() => acceptOfferMutation.mutate(currentOffer.offerId)} disabled={acceptOfferMutation.isPending || offerCountdown <= 0} className="flex-1 min-h-[44px]" data-testid="button-accept-offer">
                Accept
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {activeTrip && (
        <Card data-testid="card-active-trip">
          <CardContent className="py-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="font-semibold text-base">Active Trip</span>
              <Badge className={STATUS_COLORS[activeTrip.status] || ""} data-testid="badge-active-trip-status">
                {STATUS_LABELS[activeTrip.status] || activeTrip.status}
              </Badge>
            </div>
            <div className="space-y-1">
              <div className="flex items-start gap-1.5 text-sm"><Navigation className="w-4 h-4 mt-0.5 flex-shrink-0 text-green-600" /><span className="truncate" data-testid="text-active-pickup">{activeTrip.pickupAddress}</span></div>
              <div className="flex items-start gap-1.5 text-sm"><MapPin className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-600" /><span className="truncate" data-testid="text-active-dropoff">{activeTrip.dropoffAddress}</span></div>
            </div>
            {activeTrip.lastEtaMinutes != null && (
              <p className="text-sm text-muted-foreground" data-testid="text-active-eta">ETA: {activeTrip.lastEtaMinutes} min</p>
            )}
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" onClick={() => onOpenNavigation(activeTrip)} className="flex-1 min-h-[44px]" data-testid="button-active-navigate">
                <Navigation className="w-5 h-5 mr-2" /> Navigate
              </Button>
              <Button variant="outline" onClick={() => handleCopy(activeTrip)} className="min-h-[44px]" data-testid="button-active-copy">
                <ClipboardCopy className="w-5 h-5" />
              </Button>
            </div>
            {STATUS_FLOW[activeTrip.status] && (
              <Button
                onClick={() => onStatusChange(activeTrip.id, activeTrip.status)}
                disabled={statusIsPending}
                className="w-full min-h-[48px] text-base"
                data-testid="button-active-status"
              >
                {STATUS_FLOW[activeTrip.status].icon && (() => { const I = STATUS_FLOW[activeTrip.status].icon; return <I className="w-5 h-5 mr-2" />; })()}
                {STATUS_FLOW[activeTrip.status].label}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {!activeTrip && nextPickup && (
        <Card data-testid="card-next-pickup">
          <CardContent className="py-4 space-y-2">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-primary" />
              <span className="font-semibold text-base">Next Pickup</span>
            </div>
            <p className="text-sm" data-testid="text-next-pickup-time">{nextPickup.pickupTime || "N/A"} - {nextPickup.scheduledDate}</p>
            <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
              <Navigation className="w-4 h-4 mt-0.5 flex-shrink-0 text-green-600" />
              <span className="truncate" data-testid="text-next-pickup-addr">{nextPickup.pickupAddress || "N/A"}</span>
            </div>
          </CardContent>
        </Card>
      )}

      <Card data-testid="card-today-summary">
        <CardContent className="py-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-base">Today's Schedule</span>
            <Badge variant="secondary" data-testid="badge-today-count">{completedCount}/{scheduledCount} trips</Badge>
          </div>
          {todayTrips.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-2" data-testid="text-no-trips-today">No trips scheduled for today.</p>
          ) : (
            <div className="space-y-1.5">
              {todayTrips.slice(0, 5).map((trip: any) => (
                <div key={trip.id} className="flex items-center gap-2 text-sm min-h-[36px]" data-testid={`summary-trip-${trip.id}`}>
                  <span className="font-medium w-14 flex-shrink-0">{trip.pickupTime || "N/A"}</span>
                  <Badge className={`${STATUS_COLORS[trip.status] || ""} text-[10px]`}>{STATUS_LABELS[trip.status] || trip.status}</Badge>
                  <span className="truncate text-muted-foreground flex-1 min-w-0">{trip.pickupAddress || ""}</span>
                </div>
              ))}
              {todayTrips.length > 5 && (
                <p className="text-xs text-muted-foreground text-center">+{todayTrips.length - 5} more trips</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {showChecklist && (
        <PreConnectChecklist
          vehicle={vehicle}
          onConfirm={() => { setShowChecklist(false); toggleActiveMutation.mutate(true); }}
          onClose={() => setShowChecklist(false)}
        />
      )}
    </div>
  );
}

type TripsSubTab = "offers" | "today" | "scheduled" | "completed";

function TripsPage({ token, onStatusChange, statusIsPending }: {
  token: string | null;
  onStatusChange: (tripId: number, currentStatus: string) => void;
  statusIsPending: boolean;
}) {
  const [subTab, setSubTab] = useState<TripsSubTab>("today");
  const [selectedTrip, setSelectedTrip] = useState<any>(null);
  const [completedPage, setCompletedPage] = useState(1);
  const isDriverActive = true;

  const offersQuery = useQuery<{ offers: any[] }>({
    queryKey: ["/api/driver/offers/active"],
    queryFn: () => apiFetch("/api/driver/offers/active", token),
    enabled: !!token && subTab === "offers",
    refetchInterval: 10000,
  });

  const todayQuery = useQuery<any>({
    queryKey: ["/api/driver/trips", "today"],
    queryFn: () => apiFetch("/api/driver/trips?scope=today", token),
    enabled: !!token && subTab === "today",
  });

  const scheduledQuery = useQuery<any>({
    queryKey: ["/api/driver/trips", "scheduled"],
    queryFn: () => apiFetch("/api/driver/trips?scope=scheduled", token),
    enabled: !!token && subTab === "scheduled",
  });

  const completedQuery = useQuery<any>({
    queryKey: ["/api/driver/trips", "completed", completedPage],
    queryFn: () => apiFetch(`/api/driver/trips?scope=completed&page=${completedPage}&pageSize=10`, token),
    enabled: !!token && subTab === "completed",
  });

  const { toast } = useToast();

  const acceptOfferMutation = useMutation({
    mutationFn: (offerId: string) => apiFetch(`/api/driver/offers/${offerId}/accept`, token, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Trip accepted" });
      queryClient.invalidateQueries({ queryKey: ["/api/driver/offers/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/driver/trips"] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const declineOfferMutation = useMutation({
    mutationFn: (offerId: string) => apiFetch(`/api/driver/offers/${offerId}/decline`, token, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/driver/offers/active"] }),
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const tabs: { id: TripsSubTab; label: string }[] = [
    { id: "offers", label: "Offers" },
    { id: "today", label: "Today" },
    { id: "scheduled", label: "Scheduled" },
    { id: "completed", label: "Completed" },
  ];

  const renderTrips = (trips: any[], isLoading: boolean) => {
    if (isLoading) return <div className="space-y-2"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>;
    if (!trips || trips.length === 0) return <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-trips">No trips found.</p>;
    return (
      <div className="space-y-2">
        {trips.map((trip: any) => (
          <TripCardCompact key={trip.id} trip={trip} onTap={() => setSelectedTrip(trip)} />
        ))}
      </div>
    );
  };

  const getTripsList = (data: any): any[] => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (data.trips) return data.trips;
    if (data.todayTrips) return data.todayTrips;
    return [];
  };

  return (
    <div className="p-4 space-y-4" data-testid="page-trips">
      <div className="flex gap-1 bg-muted/50 rounded-md p-1" data-testid="trips-tab-bar">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSubTab(tab.id)}
            className={`flex-1 text-center py-2 rounded-md text-sm font-medium min-h-[44px] transition-colors ${
              subTab === tab.id ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"
            }`}
            data-testid={`trips-tab-${tab.id}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {subTab === "offers" && (
        <div className="space-y-3">
          {offersQuery.isLoading ? (
            <div className="space-y-2"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
          ) : (offersQuery.data?.offers || []).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-offers">No active offers.</p>
          ) : (
            (offersQuery.data?.offers || []).map((offer: any) => (
              <Card key={offer.offerId} data-testid={`card-offer-${offer.offerId}`}>
                <CardContent className="py-4 space-y-2">
                  <div className="flex items-start gap-1.5 text-sm"><Navigation className="w-4 h-4 mt-0.5 flex-shrink-0 text-green-600" /><span className="truncate">{offer.pickupAddress}</span></div>
                  <div className="flex items-start gap-1.5 text-sm"><MapPin className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-600" /><span className="truncate">{offer.dropoffAddress}</span></div>
                  {offer.pickupTime && <div className="flex items-center gap-1.5 text-sm text-muted-foreground"><Clock className="w-4 h-4" />{offer.pickupTime}</div>}
                  <div className="flex gap-2 pt-1">
                    <Button variant="outline" onClick={() => declineOfferMutation.mutate(offer.offerId)} disabled={declineOfferMutation.isPending} className="flex-1 min-h-[44px]" data-testid={`button-decline-${offer.offerId}`}>Decline</Button>
                    <Button onClick={() => acceptOfferMutation.mutate(offer.offerId)} disabled={acceptOfferMutation.isPending} className="flex-1 min-h-[44px]" data-testid={`button-accept-${offer.offerId}`}>Accept</Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {subTab === "today" && renderTrips(getTripsList(todayQuery.data), todayQuery.isLoading)}
      {subTab === "scheduled" && renderTrips(getTripsList(scheduledQuery.data), scheduledQuery.isLoading)}
      {subTab === "completed" && (
        <div className="space-y-3">
          {renderTrips(getTripsList(completedQuery.data), completedQuery.isLoading)}
          <div className="flex items-center justify-center gap-2 pt-2">
            <Button variant="outline" size="sm" disabled={completedPage <= 1} onClick={() => setCompletedPage((p) => p - 1)} className="min-h-[44px]" data-testid="button-prev-page">Prev</Button>
            <span className="text-sm text-muted-foreground" data-testid="text-page-number">Page {completedPage}</span>
            <Button variant="outline" size="sm" onClick={() => setCompletedPage((p) => p + 1)} className="min-h-[44px]" data-testid="button-next-page">Next</Button>
          </div>
        </div>
      )}

      {selectedTrip && (
        <TripDetailModal
          trip={selectedTrip}
          token={token}
          onClose={() => setSelectedTrip(null)}
          onStatusChange={onStatusChange}
          isPending={statusIsPending}
        />
      )}
    </div>
  );
}

function PerformancePage({ token }: { token: string | null }) {
  const metricsQuery = useQuery<any>({
    queryKey: ["/api/driver/metrics"],
    queryFn: () => apiFetch("/api/driver/metrics", token),
    enabled: !!token,
  });

  const metrics = metricsQuery.data;

  if (metricsQuery.isLoading) {
    return (
      <div className="p-4 space-y-4" data-testid="page-performance">
        <Skeleton className="h-40 w-full" />
        <div className="grid grid-cols-2 gap-3"><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
      </div>
    );
  }

  const score = metrics?.score ?? 0;
  const circumference = 2 * Math.PI * 54;
  const strokeDashoffset = circumference - (circumference * Math.min(score, 100)) / 100;

  return (
    <div className="p-4 space-y-4" data-testid="page-performance">
      <Card data-testid="card-score">
        <CardContent className="py-6 flex flex-col items-center gap-3">
          <div className="relative w-32 h-32">
            <svg className="w-32 h-32 -rotate-90" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="54" fill="none" strokeWidth="8" className="stroke-muted" />
              <circle cx="60" cy="60" r="54" fill="none" strokeWidth="8" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={strokeDashoffset}
                className={score >= 80 ? "stroke-green-500" : score >= 60 ? "stroke-amber-500" : "stroke-red-500"} />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-3xl font-bold" data-testid="text-score">{score}</span>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">Driver Score</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <MetricCard label="On-time Rate" value={metrics?.onTimeRate != null ? `${metrics.onTimeRate}%` : "--"} icon={Clock} testId="metric-ontime" />
        <MetricCard label="Completion" value={metrics?.completionRate != null ? `${metrics.completionRate}%` : "--"} icon={CheckCircle} testId="metric-completion" />
        <MetricCard label="Trips Done" value={metrics?.tripsCompleted ?? "--"} icon={Car} testId="metric-trips" />
        <MetricCard label="Late Count" value={metrics?.lateCount ?? "--"} icon={AlertTriangle} testId="metric-late" />
        <MetricCard label="No-Shows" value={metrics?.noShowCount ?? "--"} icon={User} testId="metric-noshow" />
        {metrics?.weeklyRank && (
          <MetricCard label="Weekly Rank" value={`#${metrics.weeklyRank} of ${metrics.totalDrivers || "?"}`} icon={Trophy} testId="metric-rank" />
        )}
      </div>
    </div>
  );
}

function MetricCard({ label, value, icon: Icon, testId }: { label: string; value: string | number; icon: any; testId: string }) {
  return (
    <Card data-testid={`card-${testId}`}>
      <CardContent className="py-4 flex items-center gap-3">
        <Icon className="w-5 h-5 text-muted-foreground flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold" data-testid={`text-${testId}`}>{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function BonusesPage({ token }: { token: string | null }) {
  const bonusQuery = useQuery<any>({
    queryKey: ["/api/driver/bonus-progress"],
    queryFn: () => apiFetch("/api/driver/bonus-progress", token),
    enabled: !!token,
  });

  const bonus = bonusQuery.data;

  if (bonusQuery.isLoading) {
    return (
      <div className="p-4 space-y-4" data-testid="page-bonuses">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (!bonus?.active) {
    return (
      <div className="p-4" data-testid="page-bonuses">
        <Card>
          <CardContent className="py-8 text-center">
            <Trophy className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
            <p className="text-lg font-semibold text-muted-foreground" data-testid="text-no-bonus">No active bonus program</p>
            <p className="text-sm text-muted-foreground mt-1">Check back later for weekly bonus opportunities.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const amount = bonus.weeklyAmountCents ? `$${(bonus.weeklyAmountCents / 100).toFixed(2)}` : "$0.00";
  const progressPct = Math.min(100, bonus.overallProgress || 0);
  const progressColor = bonus.progressColor === "green" ? "bg-green-500" : bonus.progressColor === "yellow" ? "bg-yellow-500" : "bg-red-500";

  return (
    <div className="p-4 space-y-4" data-testid="page-bonuses">
      <Card data-testid="card-bonus-amount">
        <CardContent className="py-6 text-center space-y-3">
          <Trophy className={`w-10 h-10 mx-auto ${bonus.qualifies ? "text-green-600" : "text-amber-500"}`} />
          <p className="text-3xl font-bold" data-testid="text-bonus-amount">{amount}</p>
          <p className="text-sm text-muted-foreground">Weekly Bonus</p>
          <div className="w-full bg-muted rounded-full h-3">
            <div className={`h-full rounded-full transition-all duration-500 ${progressColor}`} style={{ width: `${progressPct}%` }} data-testid="div-bonus-progress" />
          </div>
          <p className="text-sm text-muted-foreground">{progressPct}% progress</p>
          {!bonus.qualifies && bonus.weeklyAmountCents > 0 && (
            <p className="text-sm font-medium text-primary" data-testid="text-unlock-motivation">
              Unlock {amount}!
            </p>
          )}
        </CardContent>
      </Card>

      <div className="space-y-3">
        {bonus.goals?.map((goal: any, idx: number) => (
          <Card key={idx} data-testid={`card-goal-${idx}`}>
            <CardContent className="py-4">
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <span className="font-medium text-sm">{goal.label || goal.type}</span>
                <Badge variant={goal.met ? "default" : "secondary"} className={goal.met ? "bg-green-600 text-white" : ""} data-testid={`badge-goal-${idx}`}>
                  {goal.met ? "Met" : "In Progress"}
                </Badge>
              </div>
              <div className="w-full bg-muted rounded-full h-2 mb-1">
                <div className={`h-full rounded-full ${goal.met ? "bg-green-500" : "bg-primary"}`} style={{ width: `${Math.min(100, goal.progress || 0)}%` }} />
              </div>
              <p className="text-xs text-muted-foreground" data-testid={`text-goal-detail-${idx}`}>
                {goal.current}/{goal.required} {goal.unit || ""} {!goal.met && goal.remaining != null ? `- ${goal.remaining} remaining` : ""}
              </p>
            </CardContent>
          </Card>
        ))}

        {!bonus.goals && (
          <>
            {bonus.tripGoal && (
              <GoalTile label="Trip Count" current={bonus.tripGoal.current} required={bonus.tripGoal.required} met={bonus.tripGoal.met} testId="goal-trips" />
            )}
            {bonus.onTimeGoal && (
              <GoalTile label="On-time Rate" current={`${bonus.onTimeGoal.current}%`} required={`${bonus.onTimeGoal.required}%`} met={bonus.onTimeGoal.met} testId="goal-ontime" />
            )}
            {bonus.completionGoal && (
              <GoalTile label="Completion Rate" current={`${bonus.completionGoal.current}%`} required={`${bonus.completionGoal.required}%`} met={bonus.completionGoal.met} testId="goal-completion" />
            )}
          </>
        )}
      </div>

      <div className="text-center">
        <Badge variant={bonus.qualifies ? "default" : "secondary"} className={bonus.qualifies ? "bg-green-600 text-white" : ""} data-testid="badge-qualification">
          {bonus.qualifies ? "Qualified" : "Not Yet Qualified"}
        </Badge>
      </div>
    </div>
  );
}

function GoalTile({ label, current, required, met, testId }: { label: string; current: string | number; required: string | number; met: boolean; testId: string }) {
  return (
    <Card data-testid={`card-${testId}`}>
      <CardContent className="py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {met ? <CheckCircle className="w-5 h-5 text-green-600" /> : <Target className="w-5 h-5 text-amber-500" />}
          <span className="text-sm font-medium">{label}</span>
        </div>
        <span className="text-sm font-semibold" data-testid={`text-${testId}`}>{current} / {required}</span>
      </CardContent>
    </Card>
  );
}

type EarningsRange = "today" | "week" | "month";

function EarningsPage({ token }: { token: string | null }) {
  const [range, setRange] = useState<EarningsRange>("today");

  const earningsQuery = useQuery<any>({
    queryKey: ["/api/driver/earnings", range],
    queryFn: () => apiFetch(`/api/driver/earnings?range=${range}`, token),
    enabled: !!token,
  });

  const earnings = earningsQuery.data;
  const ranges: { id: EarningsRange; label: string }[] = [
    { id: "today", label: "Today" },
    { id: "week", label: "Week" },
    { id: "month", label: "Month" },
  ];

  return (
    <div className="p-4 space-y-4" data-testid="page-earnings">
      <div className="flex gap-1 bg-muted/50 rounded-md p-1" data-testid="earnings-range-control">
        {ranges.map((r) => (
          <button
            key={r.id}
            onClick={() => setRange(r.id)}
            className={`flex-1 text-center py-2 rounded-md text-sm font-medium min-h-[44px] transition-colors ${
              range === r.id ? "bg-background shadow-sm text-foreground" : "text-muted-foreground"
            }`}
            data-testid={`earnings-range-${r.id}`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {earningsQuery.isLoading ? (
        <div className="space-y-3"><Skeleton className="h-32 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
      ) : (
        <>
          <Card data-testid="card-earnings-total">
            <CardContent className="py-6 text-center space-y-2">
              <DollarSign className="w-10 h-10 mx-auto text-green-600" />
              <p className="text-3xl font-bold" data-testid="text-earnings-total">
                ${earnings?.totalCents != null ? (earnings.totalCents / 100).toFixed(2) : earnings?.total != null ? Number(earnings.total).toFixed(2) : "0.00"}
              </p>
              <p className="text-sm text-muted-foreground">{ranges.find(r => r.id === range)?.label} Earnings</p>
              {earnings?.tripCount != null && (
                <p className="text-sm text-muted-foreground" data-testid="text-earnings-trips">{earnings.tripCount} trips</p>
              )}
            </CardContent>
          </Card>

          {earnings?.items && earnings.items.length > 0 && (
            <Card data-testid="card-earnings-list">
              <CardContent className="py-4 space-y-2">
                <p className="text-sm font-medium text-muted-foreground mb-2">Recent</p>
                {earnings.items.map((item: any, idx: number) => (
                  <div key={idx} className="flex items-center justify-between gap-2 py-1.5 border-b border-border last:border-0 min-h-[36px]" data-testid={`earning-item-${idx}`}>
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-medium">{item.publicId || item.tripId || `Trip ${idx + 1}`}</span>
                      {item.date && <span className="text-xs text-muted-foreground ml-2">{item.date}</span>}
                    </div>
                    <span className="text-sm font-semibold text-green-600" data-testid={`text-earning-amount-${idx}`}>
                      ${item.amountCents != null ? (item.amountCents / 100).toFixed(2) : item.amount != null ? Number(item.amount).toFixed(2) : "0.00"}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function SchedulePage({ token }: { token: string | null }) {
  const { toast } = useToast();
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [reqDate, setReqDate] = useState("");
  const [reqType, setReqType] = useState("unavailable");
  const [reqNotes, setReqNotes] = useState("");

  const requestsQuery = useQuery<any[]>({
    queryKey: ["/api/driver/schedule-change-requests"],
    queryFn: () => apiFetch("/api/driver/schedule-change-requests", token),
    enabled: !!token,
  });

  const submitMutation = useMutation({
    mutationFn: (data: { date: string; type: string; notes: string }) =>
      apiFetch("/api/driver/schedule-change-requests", token, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      toast({ title: "Request submitted" });
      queryClient.invalidateQueries({ queryKey: ["/api/driver/schedule-change-requests"] });
      setShowRequestForm(false);
      setReqDate("");
      setReqType("unavailable");
      setReqNotes("");
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const requests = requestsQuery.data || [];
  const today = new Date();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay() + 1);
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    return d;
  });

  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const statusBadgeClass: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    approved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    denied: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  };

  const typeOptions = [
    { value: "unavailable", label: "Unavailable" },
    { value: "swap", label: "Swap" },
    { value: "cover", label: "Cover" },
    { value: "other", label: "Other" },
  ];

  return (
    <div className="p-4 space-y-4" data-testid="page-schedule">
      <Card data-testid="card-week-view">
        <CardContent className="py-4">
          <div className="grid grid-cols-7 gap-1 text-center">
            {weekDays.map((d, i) => {
              const isToday = d.toDateString() === today.toDateString();
              return (
                <div key={i} className="flex flex-col items-center gap-1" data-testid={`week-day-${i}`}>
                  <span className="text-xs text-muted-foreground">{dayNames[i]}</span>
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-medium ${
                    isToday ? "bg-primary text-primary-foreground" : ""
                  }`}>
                    {d.getDate()}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Button
        variant="outline"
        onClick={() => setShowRequestForm(!showRequestForm)}
        className="w-full min-h-[44px] text-base"
        data-testid="button-request-change"
      >
        <FileText className="w-5 h-5 mr-2" />
        Request Day Change
      </Button>

      {showRequestForm && (
        <Card data-testid="card-request-form">
          <CardContent className="py-4 space-y-3">
            <div className="space-y-2">
              <Label htmlFor="req-date">Date</Label>
              <Input id="req-date" type="date" value={reqDate} onChange={(e) => setReqDate(e.target.value)} className="min-h-[44px]" data-testid="input-req-date" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="req-type">Type</Label>
              <div className="flex gap-1 flex-wrap" data-testid="select-req-type">
                {typeOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setReqType(opt.value)}
                    className={`px-3 py-2 rounded-md text-sm min-h-[44px] border transition-colors ${
                      reqType === opt.value ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"
                    }`}
                    data-testid={`req-type-${opt.value}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="req-notes">Notes</Label>
              <Textarea id="req-notes" value={reqNotes} onChange={(e) => setReqNotes(e.target.value)} placeholder="Optional notes..." className="min-h-[44px] text-base" data-testid="input-req-notes" />
            </div>
            <Button
              onClick={() => submitMutation.mutate({ date: reqDate, type: reqType, notes: reqNotes })}
              disabled={!reqDate || submitMutation.isPending}
              className="w-full min-h-[44px]"
              data-testid="button-submit-request"
            >
              {submitMutation.isPending ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Send className="w-5 h-5 mr-2" />}
              Submit Request
            </Button>
          </CardContent>
        </Card>
      )}

      {requests.length > 0 && (
        <Card data-testid="card-existing-requests">
          <CardContent className="py-4 space-y-2">
            <p className="text-sm font-medium text-muted-foreground mb-2">Your Requests</p>
            {requests.map((req: any, idx: number) => (
              <div key={req.id || idx} className="flex items-center justify-between gap-2 py-2 border-b border-border last:border-0 min-h-[44px] flex-wrap" data-testid={`request-${req.id || idx}`}>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{req.date}</p>
                  <p className="text-xs text-muted-foreground">{req.type}{req.notes ? ` - ${req.notes}` : ""}</p>
                </div>
                <Badge className={statusBadgeClass[req.status] || ""} data-testid={`badge-request-status-${req.id || idx}`}>
                  {req.status}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SettingsPage({ driver, vehicle, token, isDriverOnline, toggleActiveMutation, geoLocation }: {
  driver: any; vehicle: any; token: string | null;
  isDriverOnline: boolean; toggleActiveMutation: any;
  geoLocation: { lat: number; lng: number } | null;
}) {
  const { toast } = useToast();
  const { logout } = useAuth();
  const [showEmergencyConfirm, setShowEmergencyConfirm] = useState(false);
  const [emergencyNote, setEmergencyNote] = useState("");

  const emergencyMutation = useMutation({
    mutationFn: (data: { lat?: number; lng?: number; note?: string }) =>
      apiFetch("/api/driver/emergency", token, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      toast({ title: "Emergency alert sent" });
      setShowEmergencyConfirm(false);
      setEmergencyNote("");
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const logoutMutation = useMutation({
    mutationFn: () => apiFetch("/api/auth/driver-logout", token, { method: "POST" }),
    onSuccess: () => { logout(); },
    onError: () => { logout(); },
  });

  return (
    <div className="p-4 space-y-4" data-testid="page-settings">
      <Card data-testid="card-driver-info">
        <CardContent className="py-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <User className="w-7 h-7 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-semibold truncate" data-testid="text-settings-name">{driver?.firstName} {driver?.lastName}</p>
              {vehicle && (
                <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <Car className="w-4 h-4" /> {vehicle.name} - {vehicle.licensePlate}
                </p>
              )}
              {vehicle?.capability && (
                <Badge variant="secondary" className="mt-1" data-testid="badge-vehicle-capability">{vehicle.capability}</Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {isDriverOnline && (
        <Button
          variant="outline"
          className="w-full min-h-[48px] text-base"
          onClick={() => toggleActiveMutation.mutate(false)}
          disabled={toggleActiveMutation.isPending}
          data-testid="button-disconnect"
        >
          <PowerOff className="w-5 h-5 mr-2" /> Disconnect (Go Offline)
        </Button>
      )}

      <Button
        variant="destructive"
        className="w-full min-h-[48px] text-base"
        onClick={() => setShowEmergencyConfirm(true)}
        data-testid="button-emergency"
      >
        <AlertTriangle className="w-5 h-5 mr-2" /> Emergency Alert
      </Button>

      <Button
        variant="outline"
        className="w-full min-h-[48px] text-base text-destructive"
        onClick={() => logoutMutation.mutate()}
        disabled={logoutMutation.isPending}
        data-testid="button-logout"
      >
        <LogOut className="w-5 h-5 mr-2" /> Log Out
      </Button>

      <div className="text-center text-xs text-muted-foreground pt-4" data-testid="text-app-version">
        UCM Driver Portal v2.0
      </div>

      {showEmergencyConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" data-testid="dialog-emergency">
          <Card className="w-full max-w-sm">
            <CardContent className="py-6 space-y-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-6 h-6 text-red-600" />
                <h3 className="text-lg font-semibold text-red-600">Emergency Alert</h3>
              </div>
              <p className="text-sm text-muted-foreground">This will alert dispatch immediately. Are you sure?</p>
              <div className="space-y-2">
                <Label htmlFor="emergency-note">Note (optional)</Label>
                <Textarea id="emergency-note" value={emergencyNote} onChange={(e) => setEmergencyNote(e.target.value)} placeholder="Describe the emergency..." className="min-h-[44px] text-base" data-testid="input-emergency-note" />
              </div>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => { setShowEmergencyConfirm(false); setEmergencyNote(""); }} className="flex-1 min-h-[44px]" data-testid="button-emergency-cancel">Cancel</Button>
                <Button
                  variant="destructive"
                  onClick={() => emergencyMutation.mutate({
                    lat: geoLocation?.lat,
                    lng: geoLocation?.lng,
                    note: emergencyNote.trim() || undefined,
                  })}
                  disabled={emergencyMutation.isPending}
                  className="flex-1 min-h-[44px]"
                  data-testid="button-emergency-confirm"
                >
                  {emergencyMutation.isPending ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : null}
                  Send Alert
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

export default function DriverPortal() {
  const { token, logout } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const [confirmDialog, setConfirmDialog] = useState<{ tripId: number; nextStatus: string; label: string } | null>(null);
  const [navChooserTrip, setNavChooserTrip] = useState<ActiveTripData | null>(null);

  const profileQuery = useQuery<any>({
    queryKey: ["/api/driver/profile"],
    queryFn: () => apiFetch("/api/driver/profile", token),
    enabled: !!token,
  });

  const activeTripQuery = useQuery<{ trip: ActiveTripData | null }>({
    queryKey: ["/api/driver/active-trip"],
    queryFn: () => apiFetch("/api/driver/active-trip", token),
    enabled: !!token,
    refetchInterval: 10000,
  });

  const tripsQuery = useQuery<any>({
    queryKey: ["/api/driver/my-trips", getToday()],
    queryFn: () => apiFetch(`/api/driver/my-trips?date=${getToday()}`, token),
    enabled: !!token,
    refetchInterval: 60000,
  });

  const driver = profileQuery.data?.driver;
  const vehicle = profileQuery.data?.vehicle;
  const todayTrips = tripsQuery.data?.todayTrips || [];
  const activeTrip = activeTripQuery.data?.trip || null;

  const isDriverActive = driver?.dispatchStatus === "available";
  const isOnBreak = driver?.dispatchStatus === "hold";
  const isDriverOnline = isDriverActive || isOnBreak;
  const hasActiveTrip = todayTrips.some((t: any) => ACTIVE_STATUSES.includes(t.status));

  const { permission: geoPermission, location: geoLocation, watchError: geoWatchError, requestPermission } = useGeolocation(isDriverOnline || hasActiveTrip);
  const isNetworkOnline = useNetworkStatus();
  const { tracking: bgTracking, startTracking: bgStart, stopTracking: bgStop } = useNativeBackgroundTracking(token);

  const lastSentRef = useRef<{ lat: number; lng: number; time: number } | null>(null);
  const [lastSentTime, setLastSentTime] = useState<number | null>(null);
  const [, forceRender] = useState(0);
  const gpsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const iv = setInterval(() => forceRender((c) => c + 1), 10000);
    return () => clearInterval(iv);
  }, []);

  const sendLocation = useCallback(async (lat: number, lng: number, accuracy?: number, timestamp?: number) => {
    if (!token) return;
    const ts = timestamp ?? Date.now();
    if (!navigator.onLine) { queueLocation(lat, lng, accuracy ?? null, ts); return; }
    try {
      await apiFetch("/api/driver/me/location", token, {
        method: "POST",
        body: JSON.stringify({ lat, lng, accuracy: accuracy ?? null, timestamp: ts }),
      });
      lastSentRef.current = { lat, lng, time: Date.now() };
      setLastSentTime(Date.now());
    } catch {
      queueLocation(lat, lng, accuracy ?? null, ts);
    }
  }, [token]);

  const flushQueue = useCallback(async () => {
    if (!token || !navigator.onLine) return;
    const queue = getQueuedLocations();
    if (queue.length === 0) return;
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
    if (isNetworkOnline) flushQueue();
  }, [isNetworkOnline, flushQueue]);

  useEffect(() => {
    const shouldTrack = isDriverOnline || hasActiveTrip;
    if (!shouldTrack || !geoLocation) {
      if (gpsTimerRef.current) { clearInterval(gpsTimerRef.current); gpsTimerRef.current = null; }
      return;
    }
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
      if (!last) { sendLocation(geoLocation.lat, geoLocation.lng, geoLocation.accuracy, geoLocation.timestamp); return; }
      const elapsed = now - last.time;
      const dist = distanceMeters(last.lat, last.lng, geoLocation.lat, geoLocation.lng);
      if (dist >= 25 || elapsed >= 15000) {
        sendLocation(geoLocation.lat, geoLocation.lng, geoLocation.accuracy, geoLocation.timestamp);
      }
    }
    checkAndSend();
    if (gpsTimerRef.current) clearInterval(gpsTimerRef.current);
    gpsTimerRef.current = setInterval(checkAndSend, 5000);
    return () => { if (gpsTimerRef.current) { clearInterval(gpsTimerRef.current); gpsTimerRef.current = null; } };
  }, [isDriverOnline, hasActiveTrip, geoLocation?.lat, geoLocation?.lng, sendLocation]);

  useEffect(() => {
    if (!isDriverOnline || !token || !isNetworkOnline) return;
    const sendHeartbeat = () => { apiFetch("/api/driver/heartbeat", token, { method: "POST" }).catch(() => {}); };
    sendHeartbeat();
    const hbInterval = setInterval(sendHeartbeat, 30000);
    return () => clearInterval(hbInterval);
  }, [isDriverOnline, token, isNetworkOnline]);

  useEffect(() => {
    if (!isNativePlatform) return;
    if (isDriverOnline && token && !bgTracking) bgStart();
    else if (!isDriverOnline && bgTracking) bgStop();
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
      apiFetch("/api/driver/me/active", token, { method: "POST", body: JSON.stringify({ active }) }),
    onSuccess: (_data: any, active: boolean) => {
      queryClient.invalidateQueries({ queryKey: ["/api/driver/profile"] });
      toast({ title: active ? "You are now online" : "You are now offline" });
      if (isNativePlatform) { if (active) bgStart(); else bgStop(); }
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const breakMutation = useMutation({
    mutationFn: (onBreak: boolean) =>
      apiFetch("/api/driver/me/break", token, { method: "POST", body: JSON.stringify({ onBreak }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/driver/profile"] });
      toast({ title: isOnBreak ? "Break ended" : "You are now on break" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ tripId, status }: { tripId: number; status: string }) =>
      apiFetch(`/api/trips/${tripId}/status`, token, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => {
      toast({ title: "Trip status updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/driver/my-trips"] });
      queryClient.invalidateQueries({ queryKey: ["/api/driver/active-trip"] });
      queryClient.invalidateQueries({ queryKey: ["/api/driver/trips"] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const flushActionQueue = useCallback(async () => {
    if (!token || !navigator.onLine) return;
    const queue = getQueuedActions();
    if (queue.length === 0) return;
    let flushed = 0;
    for (const action of queue) {
      try {
        if (action.type === "status_transition") {
          await apiFetch(`/api/trips/${action.payload.tripId}/status`, token, {
            method: "PATCH",
            body: JSON.stringify({ status: action.payload.status, idempotencyKey: action.id }),
          }).catch((err: any) => {
            if (err?.message?.includes("already") || err?.status === 409) return { ok: true };
            throw err;
          });
        }
        removeActionFromQueue(action.id);
        flushed++;
      } catch { break; }
    }
    if (flushed > 0) {
      queryClient.invalidateQueries({ queryKey: ["/api/driver/my-trips"] });
      queryClient.invalidateQueries({ queryKey: ["/api/driver/active-trip"] });
      toast({ title: `${flushed} change${flushed > 1 ? "s" : ""} synced` });
    }
  }, [token, toast]);

  useEffect(() => {
    if (isNetworkOnline && getQueuedActions().length > 0) flushActionQueue();
  }, [isNetworkOnline, flushActionQueue]);

  const handleStatusWithConfirm = useCallback((tripId: number, currentStatus: string) => {
    const flow = STATUS_FLOW[currentStatus];
    if (!flow) return;
    setConfirmDialog({ tripId, nextStatus: flow.next, label: flow.label });
  }, []);

  const handleConfirmSubmit = useCallback(async (note: string) => {
    if (!confirmDialog) return;
    const { tripId, nextStatus } = confirmDialog;
    setConfirmDialog(null);
    if (!navigator.onLine) {
      queueAction({ type: "status_transition", payload: { tripId, status: nextStatus, note: note.trim() || undefined } });
      toast({ title: "Offline - saved for sync" });
      return;
    }
    try {
      await apiFetch(`/api/trips/${tripId}/status`, token, { method: "PATCH", body: JSON.stringify({ status: nextStatus }) });
      queryClient.invalidateQueries({ queryKey: ["/api/driver/my-trips"] });
      queryClient.invalidateQueries({ queryKey: ["/api/driver/active-trip"] });
      queryClient.invalidateQueries({ queryKey: ["/api/driver/trips"] });
      if (note.trim() && token) {
        await apiFetch(`/api/trips/${tripId}/messages`, token, {
          method: "POST",
          body: JSON.stringify({ message: `[Status Note] ${note.trim()}` }),
        }).catch(() => {});
      }
      toast({ title: "Trip status updated" });
    } catch (err: any) {
      toast({ title: "Status update failed", description: err?.message || "Try again", variant: "destructive" });
    }
  }, [confirmDialog, token, toast]);

  const openNavigation = useCallback((trip: ActiveTripData) => {
    const savedApp = getSavedNavApp();
    if (savedApp) {
      window.open(getNavUrlForApp(trip, savedApp), "_blank");
    } else {
      setNavChooserTrip(trip);
    }
  }, []);

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
              <MapPin className="w-5 h-5 mr-2" /> Enable Location
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
          <CardContent className="py-8 text-center space-y-4">
            <AlertTriangle className="w-14 h-14 mx-auto text-destructive" />
            <h2 className="text-xl font-semibold" data-testid="text-location-denied">Location Blocked</h2>
            <p className="text-base text-muted-foreground">
              Location permission was denied. Please enable it in your browser or device settings, then reload.
            </p>
            <Button onClick={() => window.location.reload()} className="min-h-[48px] text-base px-6" data-testid="button-reload">
              Reload Page
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (profileQuery.isLoading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (profileQuery.isError || !driver) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] p-4">
        <Card className="max-w-md w-full">
          <CardContent className="py-8 text-center space-y-4">
            <AlertTriangle className="w-14 h-14 mx-auto text-destructive" />
            <h2 className="text-xl font-semibold" data-testid="text-profile-error">Unable to load profile</h2>
            <p className="text-base text-muted-foreground">Please try again or contact support.</p>
            <Button onClick={() => profileQuery.refetch()} className="min-h-[48px] text-base px-6" data-testid="button-retry-profile">
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-background" data-testid="driver-portal">
      <div className="flex-1 overflow-y-auto pb-20">
        {activeTab === "home" && (
          <HomePage
            driver={driver}
            vehicle={vehicle}
            token={token}
            gpsStatus={gpsStatus}
            lastSentTime={lastSentTime}
            requestPermission={requestPermission}
            isDriverActive={isDriverActive}
            isOnBreak={isOnBreak}
            isDriverOnline={isDriverOnline}
            hasActiveTrip={hasActiveTrip}
            activeTrip={activeTrip}
            todayTrips={todayTrips}
            toggleActiveMutation={toggleActiveMutation}
            breakMutation={breakMutation}
            onStatusChange={handleStatusWithConfirm}
            statusIsPending={statusMutation.isPending}
            onOpenNavigation={openNavigation}
            isNetworkOnline={isNetworkOnline}
          />
        )}
        {activeTab === "trips" && (
          <TripsPage token={token} onStatusChange={handleStatusWithConfirm} statusIsPending={statusMutation.isPending} />
        )}
        {activeTab === "performance" && <PerformancePage token={token} />}
        {activeTab === "bonuses" && <BonusesPage token={token} />}
        {activeTab === "earnings" && <EarningsPage token={token} />}
        {activeTab === "schedule" && <SchedulePage token={token} />}
        {activeTab === "settings" && (
          <SettingsPage
            driver={driver}
            vehicle={vehicle}
            token={token}
            isDriverOnline={isDriverOnline}
            toggleActiveMutation={toggleActiveMutation}
            geoLocation={geoLocation}
          />
        )}
      </div>

      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />

      {confirmDialog && (
        <ConfirmStatusDialog
          label={confirmDialog.label}
          onConfirm={handleConfirmSubmit}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      {navChooserTrip && (
        <NavChooser trip={navChooserTrip} onClose={() => setNavChooserTrip(null)} />
      )}
    </div>
  );
}
