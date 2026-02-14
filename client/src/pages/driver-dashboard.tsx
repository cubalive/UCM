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
  ArrowRight,
  LocateFixed,
  Timer,
  ExternalLink,
  MapPinned,
  Bell,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

type ViewType = "map" | "mytrips" | "history";

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

const isStandalone =
  typeof window !== "undefined" &&
  (window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true);

function useGeolocation(isActive: boolean) {
  const [permission, setPermission] = useState<"granted" | "denied" | "prompt">("prompt");
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
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
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
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
              setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
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
          setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
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
  scheduledDate: string;
  pickupTime: string;
  patientName: string | null;
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
  lastFitKey: string;
}

function getOrCreateDriverMap(key: string, center: { lat: number; lng: number }): DriverMapStore | null {
  if (!window.google?.maps) return null;
  if (!window.__UCM_MAP__) (window as any).__UCM_MAP__ = {};
  const store = (window as any).__UCM_MAP__ as Record<string, any>;
  if (store[key]) return store[key] as DriverMapStore;

  const container = document.createElement("div");
  container.className = "w-full h-full ucm-map-container";
  container.setAttribute("data-testid", "div-driver-live-map");

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

  const entry: DriverMapStore = { map, container, driverMarker: null, pickupMarker: null, dropoffMarker: null, polyline: null, lastFitKey: "" };
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

    const fitKey = [
      driverLocation?.lat, driverLocation?.lng,
      activeTrip?.pickupLat, activeTrip?.pickupLng,
      activeTrip?.dropoffLat, activeTrip?.dropoffLng,
      activeTrip?.id,
    ].join(",");

    if (fitKey !== entry.lastFitKey) {
      entry.lastFitKey = fitKey;
      const bounds = new google.maps.LatLngBounds();
      let hasPoints = false;
      if (driverLocation) { bounds.extend(driverLocation); hasPoints = true; }
      if (activeTrip?.pickupLat && activeTrip?.pickupLng) { bounds.extend({ lat: activeTrip.pickupLat, lng: activeTrip.pickupLng }); hasPoints = true; }
      if (activeTrip?.dropoffLat && activeTrip?.dropoffLng) { bounds.extend({ lat: activeTrip.dropoffLat, lng: activeTrip.dropoffLng }); hasPoints = true; }
      if (hasPoints) {
        map.fitBounds(bounds, { top: 40, right: 40, bottom: 200, left: 40 });
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
      {isGpsStale && (
        <div className="absolute top-3 left-3 bg-amber-600 text-white text-xs font-medium px-2.5 py-1.5 rounded-md flex items-center gap-1.5 shadow-md" data-testid="badge-gps-stale">
          <AlertTriangle className="w-3.5 h-3.5" />
          GPS Signal Lost
        </div>
      )}
    </div>
  );
}

export default function DriverDashboard() {
  const { token, user } = useAuth();
  const { toast } = useToast();
  const [selectedDate, setSelectedDate] = useState(getToday());
  const [chatTripId, setChatTripId] = useState<number | null>(null);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [currentView, setCurrentView] = useState<ViewType>("map");

  const mapsLoaded = useLoadGoogleMaps(token);

  const activeTripQuery = useQuery<{ trip: ActiveTripData | null }>({
    queryKey: ["/api/driver/active-trip"],
    queryFn: () => apiFetch("/api/driver/active-trip", token),
    enabled: !!token,
    refetchInterval: 10000,
  });

  const profileQuery = useQuery<any>({
    queryKey: ["/api/driver/profile"],
    queryFn: () => apiFetch("/api/driver/profile", token),
    enabled: !!token,
  });

  const tripsQuery = useQuery<any>({
    queryKey: ["/api/driver/my-trips", selectedDate],
    queryFn: () => apiFetch(`/api/driver/my-trips?date=${selectedDate}`, token),
    enabled: !!token,
    refetchInterval: 15000,
  });

  const driver = profileQuery.data?.driver;
  const vehicle = profileQuery.data?.vehicle;
  const todayTrips = tripsQuery.data?.todayTrips || [];
  const allTrips = tripsQuery.data?.allTrips || [];

  const isDriverActive = driver?.dispatchStatus === "available";
  const hasActiveTrip = todayTrips.some((t: any) => ACTIVE_STATUSES.includes(t.status));

  const { permission: geoPermission, location: geoLocation, watchError: geoWatchError, requestPermission } = useGeolocation(isDriverActive || hasActiveTrip);

  const locationHeartbeat = useCallback(async () => {
    if (!geoLocation || !token) return;
    try {
      await apiFetch("/api/driver/me/location", token, {
        method: "POST",
        body: JSON.stringify({ lat: geoLocation.lat, lng: geoLocation.lng }),
      });
    } catch {}
  }, [geoLocation, token]);

  const gpsIntervalMs = hasActiveTrip ? 10000 : isDriverActive ? 30000 : 0;

  useEffect(() => {
    if (gpsIntervalMs === 0) return;
    if (!geoLocation) return;
    locationHeartbeat();
    const interval = setInterval(locationHeartbeat, gpsIntervalMs);
    return () => clearInterval(interval);
  }, [gpsIntervalMs, locationHeartbeat, geoLocation]);

  const toggleActiveMutation = useMutation({
    mutationFn: (active: boolean) =>
      apiFetch("/api/driver/me/active", token, {
        method: "POST",
        body: JSON.stringify({ active }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/driver/profile"] });
      toast({ title: isDriverActive ? "You are now offline" : "You are now online" });
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

  if (geoPermission === "prompt") {
    return (
      <div className="flex items-center justify-center min-h-[60vh] p-4">
        <Card className="max-w-md w-full">
          <CardContent className="py-8 text-center space-y-4">
            <LocateFixed className="w-12 h-12 mx-auto text-primary" />
            <h2 className="text-lg font-semibold" data-testid="text-location-prompt">Enable Location</h2>
            <p className="text-sm text-muted-foreground">
              Location access is required to manage trips, update your position, and appear on the dispatch map.
            </p>
            <Button onClick={requestPermission} data-testid="button-enable-location">
              <MapPin className="w-4 h-4 mr-2" />
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
              <MapPinOff className="w-12 h-12 mx-auto text-destructive" />
              <h2 className="text-lg font-semibold mt-3" data-testid="text-location-required">Location Access Denied</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Location permission was denied. Please follow the steps below to enable it, then tap the button to try again.
              </p>
            </div>
            <div className="text-left space-y-2 bg-muted/50 rounded-md p-4">
              {isStandalone ? (
                <>
                  <p className="text-sm font-medium">iPhone / iPad (Home Screen App):</p>
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
                  <p className="text-sm font-medium">For iPhone / iPad (Safari):</p>
                  <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-1">
                    <li>Open <strong>Settings</strong> on your device</li>
                    <li>Scroll down and tap <strong>Safari</strong></li>
                    <li>Tap <strong>Location</strong></li>
                    <li>Set to <strong>Allow</strong> or <strong>Ask</strong></li>
                    <li>Return here and tap <strong>Try Again</strong></li>
                  </ol>
                </>
              )}
              <p className="text-sm font-medium mt-3">For Android (Chrome):</p>
              <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-1">
                <li>Tap the <strong>lock icon</strong> in the address bar</li>
                <li>Tap <strong>Permissions</strong></li>
                <li>Enable <strong>Location</strong></li>
                <li>Reload the page</li>
              </ol>
            </div>
            <div className="flex gap-2 justify-center">
              <Button onClick={requestPermission} data-testid="button-retry-location">
                <LocateFixed className="w-4 h-4 mr-2" />
                Try Again
              </Button>
              <Button variant="outline" onClick={() => window.location.reload()} data-testid="button-reload-location">
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
            <AlertTriangle className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-muted-foreground" data-testid="text-no-driver-profile">No driver profile linked to your account.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isListView = currentView === "mytrips" || currentView === "history";

  return (
    <>
    {isListView && (() => {
      const displayTrips = currentView === "mytrips" ? todayTrips : allTrips;
      const title = currentView === "mytrips" ? "My Trips" : "Trip History";
      const emptyIcon = currentView === "mytrips" ? CalendarDays : History;
      const emptyText = currentView === "mytrips" ? "No trips scheduled for this date." : "No trip history available.";
      return (
        <div className="p-4 space-y-4 max-w-4xl mx-auto">
          <div className="flex items-center gap-3 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => setCurrentView("map")} data-testid="button-back-to-map">
              <ArrowRight className="w-4 h-4 mr-1 rotate-180" />
              Back to Map
            </Button>
            <h1 className="text-lg font-semibold" data-testid="text-trips-title">{title}</h1>
          </div>

          {currentView === "mytrips" && (
            <div className="flex items-center gap-2">
              <Label>Date</Label>
              <Input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-auto"
                data-testid="input-driver-date"
              />
            </div>
          )}

          {tripsQuery.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : displayTrips.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                {(() => { const Icon = emptyIcon; return <Icon className="w-8 h-8 mx-auto text-muted-foreground mb-2" />; })()}
                <p className="text-muted-foreground" data-testid="text-no-trips">{emptyText}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {displayTrips.map((trip: any) => (
                <TripCard
                  key={trip.id}
                  trip={trip}
                  onStatusChange={currentView === "mytrips" ? (status) => statusMutation.mutate({ tripId: trip.id, status }) : undefined}
                  isPending={statusMutation.isPending}
                  readonly={currentView === "history"}
                  onOpenChat={currentView === "mytrips" && ACTIVE_STATUSES.includes(trip.status) ? () => setChatTripId(trip.id) : undefined}
                  token={token}
                />
              ))}
            </div>
          )}

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
    })()}

    <div style={{ display: isListView ? "none" : undefined }} className="relative w-full h-[calc(100vh-3.5rem)] flex flex-col" data-testid="div-driver-map-home">
      <div className="flex-1 relative">
        <FullScreenMap
          driverLocation={geoLocation}
          activeTrip={activeTrip}
          mapsLoaded={mapsLoaded}
          gpsWatchError={geoWatchError}
        />

        {goTimeTrip && (
          <div
            className="absolute top-10 left-3 right-3 z-20 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-md shadow-lg px-3 py-2.5"
            data-testid="banner-go-time"
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Bell className="w-4 h-4 flex-shrink-0" />
                <span className="font-semibold text-sm" data-testid="text-go-time-countdown">
                  Pickup in {formatCountdown(goTimeCountdown)}
                </span>
                <span className="text-xs truncate opacity-90" data-testid="text-go-time-address">
                  {goTimeTrip.pickupAddress?.length > 30
                    ? goTimeTrip.pickupAddress.substring(0, 30) + "..."
                    : goTimeTrip.pickupAddress}
                </span>
                {goTimeTrip.patientName && (
                  <span className="text-xs opacity-80 flex-shrink-0" data-testid="text-go-time-patient">
                    {goTimeTrip.patientName}
                  </span>
                )}
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => handleGoTimeStartRoute(goTimeTrip)}
                disabled={acknowledgeMutation.isPending || statusMutation.isPending}
                data-testid="button-go-time-start-route"
              >
                <Navigation className="w-4 h-4 mr-1" />
                Start Route
              </Button>
            </div>
          </div>
        )}

        {activeTrip && (
          <div className="absolute top-3 right-3 z-10">
            <Button
              size="sm"
              onClick={() => openNavigation(activeTrip)}
              className="shadow-lg"
              data-testid="button-navigate"
            >
              <Navigation className="w-4 h-4 mr-1" />
              Navigate
            </Button>
          </div>
        )}
      </div>

      {(stableOffer || offerExpiredMsg) && (
        <div className="relative z-30 px-3 pb-1" data-testid="card-driver-offer">
          <Card>
            <CardContent className="py-3 space-y-2">
              {offerExpiredMsg ? (
                <p className="text-center text-sm font-medium text-muted-foreground" data-testid="text-offer-expired">
                  Request expired
                </p>
              ) : stableOffer && (
                <>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <MapPinned className="w-4 h-4 text-primary flex-shrink-0" />
                      <span className="font-mono text-xs font-medium" data-testid="text-offer-public-id">{stableOffer.publicId}</span>
                    </div>
                    <Badge variant="secondary" data-testid="badge-offer-countdown">
                      <Timer className="w-3 h-3 mr-1" />
                      Expires in {formatCountdown(offerCountdown)}
                    </Badge>
                  </div>
                  {stableOffer.patientName && (
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <User className="w-3.5 h-3.5" />
                      <span data-testid="text-offer-patient">{stableOffer.patientName}</span>
                    </div>
                  )}
                  <div className="space-y-1">
                    <div className="flex items-start gap-1 text-sm">
                      <Navigation className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-green-600" />
                      <span className="truncate" data-testid="text-offer-pickup">{stableOffer.pickupAddress}</span>
                    </div>
                    <div className="flex items-start gap-1 text-sm">
                      <MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-red-600" />
                      <span className="truncate" data-testid="text-offer-dropoff">{stableOffer.dropoffAddress}</span>
                    </div>
                  </div>
                  {stableOffer.pickupTime && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      <span data-testid="text-offer-pickup-time">{stableOffer.pickupTime}</span>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button
                      className="flex-1"
                      onClick={() => acceptOfferMutation.mutate(stableOffer.offerId)}
                      disabled={acceptOfferMutation.isPending || declineOfferMutation.isPending}
                      data-testid="button-accept-offer"
                    >
                      ACCEPT REQUEST
                    </Button>
                    <Button
                      variant="outline"
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

      <div
        className={`bg-background border-t border-border transition-all duration-300 ease-in-out ${
          sheetExpanded ? "max-h-[60vh]" : "max-h-[220px]"
        } overflow-hidden flex flex-col`}
        data-testid="div-bottom-sheet"
      >
        <button
          onClick={() => setSheetExpanded(!sheetExpanded)}
          className="w-full flex items-center justify-center py-1.5 hover-elevate"
          data-testid="button-sheet-toggle"
        >
          <div className="w-10 h-1 bg-muted-foreground/30 rounded-full" />
        </button>

        <div className="px-4 pb-3 overflow-y-auto flex-1 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <User className="w-4 h-4 text-muted-foreground" />
                <span className="font-medium text-sm" data-testid="text-driver-name">{driver.firstName} {driver.lastName}</span>
              </div>
              <Badge variant={isDriverActive ? "default" : "secondary"} data-testid="badge-dispatch-status">
                {isDriverActive ? "Online" : "Offline"}
              </Badge>
              {geoLocation && !geoWatchError && (
                <div className="flex items-center gap-0.5 text-xs text-emerald-600 dark:text-emerald-400">
                  <LocateFixed className="w-3 h-3" />
                </div>
              )}
            </div>
            <Button
              variant={isDriverActive ? "destructive" : "default"}
              size="sm"
              onClick={() => toggleActiveMutation.mutate(!isDriverActive)}
              disabled={toggleActiveMutation.isPending}
              data-testid="button-toggle-active"
            >
              {isDriverActive ? <PowerOff className="w-4 h-4 mr-1.5" /> : <Power className="w-4 h-4 mr-1.5" />}
              {isDriverActive ? "Go Offline" : "Go Online"}
            </Button>
          </div>

          {activeTrip && (
            <Card data-testid="card-active-trip">
              <CardContent className="py-3">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-medium">{activeTrip.publicId}</span>
                      <Badge className={STATUS_COLORS[activeTrip.status] || ""} data-testid="badge-active-trip-status">
                        {STATUS_LABELS[activeTrip.status] || activeTrip.status}
                      </Badge>
                      {activeTrip.lastEtaMinutes != null && (
                        <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                          <Timer className="w-3 h-3" />
                          {activeTrip.lastEtaMinutes} min
                        </span>
                      )}
                    </div>
                    <div className="flex items-start gap-1 text-xs">
                      <Navigation className="w-3 h-3 mt-0.5 flex-shrink-0 text-green-600" />
                      <span className="truncate">{activeTrip.pickupAddress}</span>
                    </div>
                    <div className="flex items-start gap-1 text-xs">
                      <MapPin className="w-3 h-3 mt-0.5 flex-shrink-0 text-red-600" />
                      <span className="truncate">{activeTrip.dropoffAddress}</span>
                    </div>
                    {activeTrip.patientName && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <User className="w-3 h-3" />
                        <span>{activeTrip.patientName}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5 items-end">
                    {STATUS_FLOW[activeTrip.status] && (
                      <Button
                        size="sm"
                        onClick={() => statusMutation.mutate({ tripId: activeTrip.id, status: STATUS_FLOW[activeTrip.status].next })}
                        disabled={statusMutation.isPending}
                        data-testid="button-active-trip-action"
                      >
                        {(() => { const Icon = STATUS_FLOW[activeTrip.status].icon; return <Icon className="w-4 h-4 mr-1" />; })()}
                        {STATUS_FLOW[activeTrip.status].label}
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-4 gap-2">
            <div className="text-center py-1.5">
              <p className="text-lg font-bold" data-testid="text-total-trips">{todayTrips.length}</p>
              <p className="text-[10px] text-muted-foreground">Total</p>
            </div>
            <div className="text-center py-1.5">
              <p className="text-lg font-bold" data-testid="text-active-trips">{activeTrips.length}</p>
              <p className="text-[10px] text-muted-foreground">Active</p>
            </div>
            <div className="text-center py-1.5">
              <p className="text-lg font-bold" data-testid="text-completed-trips">{completedToday.length}</p>
              <p className="text-[10px] text-muted-foreground">Done</p>
            </div>
            <div className="text-center py-1.5">
              <p className="text-lg font-bold" data-testid="text-scheduled-trips">{scheduledToday.length}</p>
              <p className="text-[10px] text-muted-foreground">Scheduled</p>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => setCurrentView("mytrips")}
              data-testid="button-view-my-trips"
            >
              <CalendarDays className="w-4 h-4 mr-1.5" />
              My Trips
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => setCurrentView("history")}
              data-testid="button-view-history"
            >
              <History className="w-4 h-4 mr-1.5" />
              Trip History
            </Button>
          </div>

          {sheetExpanded && (
            <div className="space-y-2">
              {vehicle && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Car className="w-4 h-4" />
                  <span data-testid="text-vehicle-name">{vehicle.name} - {vehicle.licensePlate}</span>
                </div>
              )}

              {scheduledToday.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Upcoming</p>
                  {scheduledToday.slice(0, 3).map((trip: any) => (
                    <div key={trip.id} className="flex items-center justify-between gap-2 text-sm bg-muted/50 rounded-md px-3 py-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Clock className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <span className="font-mono text-xs">{trip.pickupTime || "TBD"}</span>
                        <span className="truncate text-xs">{trip.pickupAddress || "Pickup TBD"}</span>
                      </div>
                      <Badge variant="secondary" className="text-[10px]">
                        {trip.publicId}
                      </Badge>
                    </div>
                  ))}
                  {scheduledToday.length > 3 && (
                    <button
                      onClick={() => setCurrentView("mytrips")}
                      className="text-xs text-primary hover:underline"
                      data-testid="button-see-all-scheduled"
                    >
                      +{scheduledToday.length - 3} more scheduled
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showNavChooser && navChooserTrip && (
        <div className="fixed inset-0 bg-background/80 z-50 flex items-end justify-center p-4 sm:items-center" data-testid="overlay-nav-chooser">
          <Card className="w-full max-w-md">
            <div className="flex items-center justify-between gap-2 p-3 border-b">
              <span className="text-base font-semibold">Choose Navigation App</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setShowNavChooser(false); setNavChooserTrip(null); setRememberNav(false); }}
                data-testid="button-close-nav-chooser"
              >
                Close
              </Button>
            </div>
            <CardContent className="py-4 space-y-3">
              <Button
                variant="outline"
                className="w-full justify-start gap-3"
                onClick={() => handleNavSelect("google")}
                data-testid="button-nav-google"
              >
                <MapPin className="w-5 h-5 text-blue-500" />
                <span>Google Maps</span>
                <ExternalLink className="w-3.5 h-3.5 ml-auto text-muted-foreground" />
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start gap-3"
                onClick={() => handleNavSelect("waze")}
                data-testid="button-nav-waze"
              >
                <Navigation className="w-5 h-5 text-cyan-500" />
                <span>Waze</span>
                <ExternalLink className="w-3.5 h-3.5 ml-auto text-muted-foreground" />
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start gap-3"
                onClick={() => handleNavSelect("apple")}
                data-testid="button-nav-apple"
              >
                <MapPinned className="w-5 h-5 text-green-500" />
                <span>Apple Maps</span>
                <ExternalLink className="w-3.5 h-3.5 ml-auto text-muted-foreground" />
              </Button>
              <div className="flex items-center gap-2 pt-2">
                <Checkbox
                  id="remember-nav"
                  checked={rememberNav}
                  onCheckedChange={(checked) => setRememberNav(checked === true)}
                  data-testid="checkbox-remember-nav"
                />
                <label htmlFor="remember-nav" className="text-sm text-muted-foreground cursor-pointer">
                  Always use this app
                </label>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {chatTripId && (
        <TripChat
          tripId={chatTripId}
          token={token}
          onClose={() => setChatTripId(null)}
          userId={user?.id}
        />
      )}
    </div>
    </>
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
              {isLocked && <Lock className="w-3.5 h-3.5 text-muted-foreground" />}
            </div>

            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Clock className="w-3.5 h-3.5 flex-shrink-0" />
              <span data-testid={`text-trip-time-${trip.id}`}>{trip.pickupTime || trip.scheduledTime || "—"}</span>
              <span className="mx-1">|</span>
              <span>{trip.scheduledDate}</span>
            </div>

            <div className="space-y-1">
              <div className="flex items-start gap-1 text-sm">
                <Navigation className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-green-600" />
                <span className="truncate" data-testid={`text-pickup-${trip.id}`}>{trip.pickupAddress || "Pickup not set"}</span>
              </div>
              <div className="flex items-start gap-1 text-sm">
                <MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-red-600" />
                <span className="truncate" data-testid={`text-dropoff-${trip.id}`}>{trip.dropoffAddress || "Dropoff not set"}</span>
              </div>
            </div>

            {trip.patientName && (
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <User className="w-3.5 h-3.5" />
                <span>{trip.patientName}</span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 items-end">
            {!readonly && !isLocked && statusAction && onStatusChange && (
              <Button
                onClick={() => onStatusChange(statusAction.next)}
                disabled={isPending}
                data-testid={`button-trip-action-${trip.id}`}
              >
                <statusAction.icon className="w-4 h-4 mr-2" />
                {statusAction.label}
              </Button>
            )}
            {!isLocked && onOpenChat && ACTIVE_STATUSES.includes(trip.status) && (
              <Button
                variant="outline"
                size="sm"
                onClick={onOpenChat}
                data-testid={`button-trip-chat-${trip.id}`}
              >
                <MessageSquare className="w-4 h-4 mr-2" />
                Contact Dispatch
              </Button>
            )}
          </div>
        </div>
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
    refetchInterval: 5000,
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
        <div className="flex items-center justify-between gap-2 p-3 border-b">
          <span className="text-base font-semibold">Trip Messages</span>
          <Button variant="ghost" size="sm" onClick={onClose} data-testid="button-close-chat">
            Close
          </Button>
        </div>
        <CardContent className="flex-1 overflow-y-auto min-h-[200px] space-y-2 pb-2">
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No messages yet. Start the conversation.</p>
          ) : (
            messages.map((msg: any) => (
              <div
                key={msg.id}
                className={`flex ${msg.senderId === userId ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-md px-3 py-2 text-sm ${
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
            className="flex-1 min-h-[40px] resize-none"
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
            data-testid="button-send-message"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </Card>
    </div>
  );
}
