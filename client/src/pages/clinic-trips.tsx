import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiFetch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import {
  Clock,
  MapPin,
  User,
  Navigation,
  ArrowRight,
  Car,
  Phone,
  CheckCircle,
  Lock,
  Radio,
  Plus,
  Users,
  FileDown,
  Calendar,
  ClipboardList,
  LayoutDashboard,
  Eye,
  MapPinned,
  Repeat,
  Activity,
  Map as MapIcon,
  WifiOff,
  RefreshCw,
} from "lucide-react";

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

const TRIP_PROGRESS_STEPS = [
  { key: "SCHEDULED", label: "Scheduled" },
  { key: "ASSIGNED", label: "Assigned" },
  { key: "EN_ROUTE_TO_PICKUP", label: "Driver En Route" },
  { key: "ARRIVED_PICKUP", label: "Arrived at Pickup" },
  { key: "PICKED_UP", label: "Patient Picked Up" },
  { key: "EN_ROUTE_TO_DROPOFF", label: "En Route to Dropoff" },
  { key: "ARRIVED_DROPOFF", label: "Arrived at Dropoff" },
  { key: "COMPLETED", label: "Completed" },
];

const ACTIVE_TRIP_STATUSES = [
  "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP",
  "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"
];

const DAY_LABELS: Record<string, string> = {
  Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday",
  Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday",
};

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return "N/A";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

export default function ClinicTripsPage() {
  const [mainTab, setMainTab] = useState("dashboard");
  const { t } = useTranslation();

  return (
    <div className="p-4 space-y-4 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold" data-testid="text-clinic-portal-title">
          {t("clinic.title")}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {t("clinic.dashboard")}, {t("clinic.trips").toLowerCase()}, {t("clinic.patients").toLowerCase()}, {t("clinic.reports").toLowerCase()}
        </p>
      </div>

      <Tabs value={mainTab} onValueChange={setMainTab}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="dashboard" data-testid="tab-clinic-dashboard" className="gap-1.5">
            <LayoutDashboard className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t("clinic.dashboard")}</span>
          </TabsTrigger>
          <TabsTrigger value="livemap" data-testid="tab-clinic-livemap" className="gap-1.5">
            <MapIcon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Live Map</span>
          </TabsTrigger>
          <TabsTrigger value="trips" data-testid="tab-clinic-trips" className="gap-1.5">
            <ClipboardList className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t("clinic.trips")}</span>
          </TabsTrigger>
          <TabsTrigger value="patients" data-testid="tab-clinic-patients" className="gap-1.5">
            <Users className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t("clinic.patients")}</span>
          </TabsTrigger>
          <TabsTrigger value="reports" data-testid="tab-clinic-reports" className="gap-1.5">
            <FileDown className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t("clinic.reports")}</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-4">
          <DashboardSection onSwitchTab={setMainTab} />
        </TabsContent>
        <TabsContent value="livemap" className="mt-4">
          <ClinicLiveMapSection />
        </TabsContent>
        <TabsContent value="trips" className="mt-4">
          <TripsSection />
        </TabsContent>
        <TabsContent value="patients" className="mt-4">
          <PatientsSection />
        </TabsContent>
        <TabsContent value="reports" className="mt-4">
          <ReportsSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DashboardSection({ onSwitchTab }: { onSwitchTab: (tab: string) => void }) {
  const { token } = useAuth();
  const [trackingTripId, setTrackingTripId] = useState<number | null>(null);

  const todayTripsQuery = useQuery<any[]>({
    queryKey: ["/api/clinic/trips", "today"],
    queryFn: () => apiFetch(`/api/clinic/trips?status=today`, token),
    enabled: !!token,
    refetchInterval: 15000,
  });

  const activeTripsQuery = useQuery<any[]>({
    queryKey: ["/api/clinic/trips", "active"],
    queryFn: () => apiFetch(`/api/clinic/trips?status=active`, token),
    enabled: !!token,
    refetchInterval: 15000,
  });

  const scheduledTripsQuery = useQuery<any[]>({
    queryKey: ["/api/clinic/trips", "scheduled"],
    queryFn: () => apiFetch(`/api/clinic/trips?status=scheduled`, token),
    enabled: !!token,
  });

  const schedulesQuery = useQuery<any[]>({
    queryKey: ["/api/clinic/recurring-schedules"],
    queryFn: () => apiFetch("/api/clinic/recurring-schedules", token),
    enabled: !!token,
  });

  const patientsQuery = useQuery<any[]>({
    queryKey: ["/api/clinic/patients"],
    queryFn: () => apiFetch("/api/clinic/patients", token),
    enabled: !!token,
  });

  const todayTrips = todayTripsQuery.data || [];
  const activeTrips = (activeTripsQuery.data || []).filter(t => ACTIVE_TRIP_STATUSES.includes(t.status));
  const scheduledTrips = scheduledTripsQuery.data || [];
  const schedules = schedulesQuery.data || [];
  const patients = patientsQuery.data || [];

  const patientMap = new Map(patients.map(p => [p.id, `${p.firstName} ${p.lastName}`]));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card data-testid="card-stat-today">
          <CardContent className="py-3 px-4 text-center">
            <p className="text-2xl font-bold">{todayTrips.length}</p>
            <p className="text-xs text-muted-foreground">Today's Trips</p>
          </CardContent>
        </Card>
        <Card data-testid="card-stat-active">
          <CardContent className="py-3 px-4 text-center">
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{activeTrips.length}</p>
            <p className="text-xs text-muted-foreground">Active Now</p>
          </CardContent>
        </Card>
        <Card data-testid="card-stat-scheduled">
          <CardContent className="py-3 px-4 text-center">
            <p className="text-2xl font-bold">{scheduledTrips.length}</p>
            <p className="text-xs text-muted-foreground">Scheduled</p>
          </CardContent>
        </Card>
        <Card data-testid="card-stat-patients">
          <CardContent className="py-3 px-4 text-center">
            <p className="text-2xl font-bold">{patients.length}</p>
            <p className="text-xs text-muted-foreground">Patients</p>
          </CardContent>
        </Card>
      </div>

      {activeTrips.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-blue-500" />
            <h2 className="text-sm font-semibold">Active Trips - Live Tracking</h2>
          </div>
          <div className="space-y-2">
            {activeTrips.map(trip => (
              <Card key={trip.id} className="hover-elevate cursor-pointer" onClick={() => setTrackingTripId(trip.id)} data-testid={`card-active-trip-${trip.id}`}>
                <CardContent className="py-3 px-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{trip.publicId}</span>
                        <Badge className={STATUS_COLORS[trip.status] || ""}>
                          {STATUS_LABELS[trip.status] || trip.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        {trip.patientName && (
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" /> {trip.patientName}
                          </span>
                        )}
                        {trip.driverName && (
                          <span className="flex items-center gap-1 text-foreground font-medium">
                            <Car className="w-3 h-3" /> {trip.driverName}
                          </span>
                        )}
                        {trip.lastEtaMinutes != null && (
                          <span className="flex items-center gap-1 font-medium text-blue-600 dark:text-blue-400">
                            <Navigation className="w-3 h-3" /> ETA: {trip.lastEtaMinutes} min
                          </span>
                        )}
                      </div>
                    </div>
                    <Button size="sm" variant="outline" className="gap-1" data-testid={`button-track-trip-${trip.id}`}>
                      <MapPinned className="w-3.5 h-3.5" />
                      Track
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Today's Trips</h2>
          </div>
          <Button size="sm" variant="outline" onClick={() => onSwitchTab("trips")} data-testid="button-view-all-trips">
            View All
          </Button>
        </div>
        {todayTripsQuery.isLoading ? (
          <div className="space-y-2">
            {[1, 2].map(i => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : todayTrips.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground" data-testid="text-no-today-trips">
              No trips scheduled for today
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2" data-testid="list-today-trips">
            {todayTrips.map(trip => (
              <Card key={trip.id} data-testid={`card-today-trip-${trip.id}`}>
                <CardContent className="py-3 px-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{trip.publicId}</span>
                        <Badge className={STATUS_COLORS[trip.status] || ""}>
                          {STATUS_LABELS[trip.status] || trip.status}
                        </Badge>
                        {trip.approvalStatus === "pending" && (
                          <Badge variant="secondary">Pending Approval</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        {trip.patientName && (
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" /> {trip.patientName}
                          </span>
                        )}
                        {trip.pickupTime && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {trip.pickupTime}
                          </span>
                        )}
                        {trip.driverName && (
                          <span className="flex items-center gap-1">
                            <Car className="w-3 h-3" /> {trip.driverName}
                          </span>
                        )}
                      </div>
                    </div>
                    {ACTIVE_TRIP_STATUSES.includes(trip.status) && (
                      <Button size="sm" variant="outline" className="gap-1" onClick={() => setTrackingTripId(trip.id)} data-testid={`button-track-today-${trip.id}`}>
                        <MapPinned className="w-3.5 h-3.5" />
                        Track
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {schedules.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Repeat className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Recurring Schedules</h2>
          </div>
          <div className="space-y-2" data-testid="list-recurring-schedules">
            {schedules.map((sched: any) => (
              <Card key={sched.id} data-testid={`card-schedule-${sched.id}`}>
                <CardContent className="py-3 px-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="space-y-1">
                      <p className="text-sm font-medium flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5" />
                        {patientMap.get(sched.patientId) || `Patient #${sched.patientId}`}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {sched.pickupTime}
                        </span>
                        <span>
                          {(sched.days || []).map((d: string) => DAY_LABELS[d] || d).join(", ")}
                        </span>
                      </div>
                    </div>
                    <Badge variant={sched.active ? "default" : "secondary"}>
                      {sched.active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <Dialog open={!!trackingTripId} onOpenChange={(open) => { if (!open) setTrackingTripId(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0">
          {trackingTripId && (
            <TripTrackingView tripId={trackingTripId} onClose={() => setTrackingTripId(null)} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TripTrackingView({ tripId, onClose }: { tripId: number; onClose: () => void }) {
  const { token } = useAuth();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const driverMarkerRef = useRef<google.maps.Marker | null>(null);
  const pickupMarkerRef = useRef<google.maps.Marker | null>(null);
  const dropoffMarkerRef = useRef<google.maps.Marker | null>(null);
  const directionsRendererRef = useRef<google.maps.DirectionsRenderer | null>(null);
  const mapsLoadedRef = useRef(false);
  const [mapAvailable, setMapAvailable] = useState(true);

  const trackingQuery = useQuery<any>({
    queryKey: ["/api/clinic/trips", tripId, "tracking"],
    queryFn: () => apiFetch(`/api/clinic/trips/${tripId}/tracking`, token),
    enabled: !!token && !!tripId,
    refetchInterval: 10000,
  });

  const data = trackingQuery.data;

  useEffect(() => {
    if (!data?.driver?.lat || !mapRef.current) return;
    if (data.completed) return;

    if (mapsLoadedRef.current) {
      updateMapMarkers(data);
      return;
    }

    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    fetch("/api/maps/client-key", { headers })
      .then(r => r.ok ? r.json() : fetch("/api/public/maps/key").then(rr => rr.json()))
      .then(json => {
        if (!json.key) {
          setMapAvailable(false);
          return;
        }
        if (window.google?.maps) {
          mapsLoadedRef.current = true;
          initMap(data);
          return;
        }
        const script = document.createElement("script");
        script.src = `https://maps.googleapis.com/maps/api/js?key=${json.key}&libraries=geometry,places`;
        script.async = true;
        script.onload = () => {
          mapsLoadedRef.current = true;
          initMap(data);
        };
        script.onerror = () => setMapAvailable(false);
        document.head.appendChild(script);
      })
      .catch(() => setMapAvailable(false));
  }, [data, token]);

  function createCarSvg(color: string) {
    const fill = color || "#3b82f6";
    return `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24">
      <path d="M5 17a1 1 0 0 1-1-1v-5l2-6h12l2 6v5a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H8v1a1 1 0 0 1-1 1H5z"
        fill="${fill}" stroke="#fff" stroke-width="1"/>
      <circle cx="7.5" cy="14.5" r="1.5" fill="#fff"/>
      <circle cx="16.5" cy="14.5" r="1.5" fill="#fff"/>
      <path d="M6.5 8L8 4h8l1.5 4H6.5z" fill="${fill}" opacity="0.6" stroke="#fff" stroke-width="0.5"/>
    </svg>`;
  }

  function initMap(trackingData: any) {
    if (!mapRef.current || !trackingData.driver) return;
    const driverPos = { lat: trackingData.driver.lat, lng: trackingData.driver.lng };
    const map = new google.maps.Map(mapRef.current, {
      center: driverPos,
      zoom: 13,
      disableDefaultUI: true,
      zoomControl: true,
      styles: [
        { featureType: "poi", stylers: [{ visibility: "off" }] },
      ],
    });
    mapInstanceRef.current = map;
    directionsRendererRef.current = new google.maps.DirectionsRenderer({
      map,
      suppressMarkers: true,
      polylineOptions: { strokeColor: "#3b82f6", strokeWeight: 4, strokeOpacity: 0.7 },
    });
    updateMapMarkers(trackingData);
  }

  function updateMapMarkers(trackingData: any) {
    if (!mapInstanceRef.current || !trackingData.driver) return;
    const map = mapInstanceRef.current;
    const driverPos = { lat: trackingData.driver.lat, lng: trackingData.driver.lng };
    const vColor = trackingData.driver.vehicleColor || "#3b82f6";

    if (driverMarkerRef.current) {
      driverMarkerRef.current.setPosition(driverPos);
    } else {
      driverMarkerRef.current = new google.maps.Marker({
        position: driverPos,
        map,
        icon: {
          url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(createCarSvg(vColor)),
          scaledSize: new google.maps.Size(36, 36),
          anchor: new google.maps.Point(18, 18),
        },
        title: trackingData.driver.name || "Driver",
        zIndex: 10,
      });
    }

    const route = trackingData.route;
    if (route?.pickupLat && route?.pickupLng) {
      const pickupPos = { lat: route.pickupLat, lng: route.pickupLng };
      if (!pickupMarkerRef.current) {
        pickupMarkerRef.current = new google.maps.Marker({
          position: pickupPos,
          map,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            fillColor: "#22c55e",
            fillOpacity: 1,
            strokeWeight: 2,
            strokeColor: "#fff",
            scale: 8,
          },
          title: "Pickup",
          zIndex: 5,
        });
      }
    }

    if (route?.dropoffLat && route?.dropoffLng) {
      const dropoffPos = { lat: route.dropoffLat, lng: route.dropoffLng };
      if (!dropoffMarkerRef.current) {
        dropoffMarkerRef.current = new google.maps.Marker({
          position: dropoffPos,
          map,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            fillColor: "#ef4444",
            fillOpacity: 1,
            strokeWeight: 2,
            strokeColor: "#fff",
            scale: 8,
          },
          title: "Dropoff",
          zIndex: 5,
        });
      }
    }

    const bounds = new google.maps.LatLngBounds();
    bounds.extend(driverPos);
    if (route?.pickupLat && route?.pickupLng) bounds.extend({ lat: route.pickupLat, lng: route.pickupLng });
    if (route?.dropoffLat && route?.dropoffLng) bounds.extend({ lat: route.dropoffLat, lng: route.dropoffLng });
    map.fitBounds(bounds, 60);

    if (directionsRendererRef.current && route?.pickupLat && route?.dropoffLat) {
      const origin = driverPos;
      const destination = ["PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF"].includes(trackingData.status)
        ? { lat: route.dropoffLat, lng: route.dropoffLng }
        : { lat: route.pickupLat, lng: route.pickupLng };

      const directionsService = new google.maps.DirectionsService();
      directionsService.route(
        { origin, destination, travelMode: google.maps.TravelMode.DRIVING },
        (result, status) => {
          if (status === "OK" && result) {
            directionsRendererRef.current?.setDirections(result);
          }
        }
      );
    }
  }

  if (trackingQuery.isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        Unable to load tracking data
      </div>
    );
  }

  if (data.completed) {
    return (
      <div className="p-6 space-y-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Trip {data.publicId || `#${data.tripId}`}
            <Badge className={STATUS_COLORS[data.status] || ""}>
              {STATUS_LABELS[data.status] || data.status}
            </Badge>
          </DialogTitle>
        </DialogHeader>
        <div className="py-8 text-center">
          <Lock className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">This trip has been completed</p>
          <p className="text-xs text-muted-foreground mt-1">Live tracking is no longer available</p>
        </div>
      </div>
    );
  }

  const driver = data.driver;
  const route = data.route;
  const hasDriverLocation = driver && driver.lat && driver.lng;
  const statusColor = driver?.connected ? "text-emerald-500" : "text-muted-foreground";

  return (
    <div className="flex flex-col">
      <div className="px-4 pt-4 pb-2 border-b">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span>Trip {data.publicId || `#${data.tripId}`}</span>
            <Badge className={STATUS_COLORS[data.status] || ""}>
              {STATUS_LABELS[data.status] || data.status}
            </Badge>
            {driver?.connected && (
              <Badge variant="secondary" className="gap-1">
                <Activity className="w-3 h-3 text-emerald-500" />
                Live
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>
      </div>

      {hasDriverLocation && mapAvailable ? (
        <div ref={mapRef} className="w-full h-64 sm:h-80 bg-muted" data-testid="div-tracking-map" />
      ) : !hasDriverLocation ? (
        <div className="w-full h-48 bg-muted flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <MapPinned className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">Driver location not available yet</p>
          </div>
        </div>
      ) : (
        <div className="w-full h-48 bg-muted flex items-center justify-center">
          <p className="text-sm text-muted-foreground">Map not available</p>
        </div>
      )}

      <div className="p-4 space-y-4">
        {driver && (
          <Card>
            <CardContent className="py-3 px-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="space-y-1">
                  <p className="text-sm font-medium flex items-center gap-1.5">
                    <Car className="w-4 h-4" style={{ color: driver.vehicleColor || "#3b82f6" }} />
                    {driver.name}
                  </p>
                  {driver.vehicleLabel && (
                    <p className="text-xs text-muted-foreground">{driver.vehicleLabel}</p>
                  )}
                  {driver.phone && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Phone className="w-3 h-3" /> {driver.phone}
                    </p>
                  )}
                </div>
                <div className="text-right space-y-1">
                  {route?.etaMinutes != null && (
                    <p className="text-lg font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                      <Navigation className="w-4 h-4" />
                      {route.etaMinutes} min
                    </p>
                  )}
                  {route?.distanceMiles != null && (
                    <p className="text-xs text-muted-foreground">{route.distanceMiles} mi</p>
                  )}
                  <p className={`text-xs flex items-center gap-1 justify-end ${statusColor}`}>
                    <Radio className="w-3 h-3" />
                    {driver.connected ? "Connected" : `Last seen ${formatTimeAgo(driver.lastSeenAt)}`}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {route && (
          <div className="grid grid-cols-1 gap-2 text-sm">
            <div className="flex items-start gap-2">
              <MapPin className="w-4 h-4 mt-0.5 text-emerald-500 flex-shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Pickup</p>
                <p>{route.pickupAddress}</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <MapPin className="w-4 h-4 mt-0.5 text-red-500 flex-shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Dropoff</p>
                <p>{route.dropoffAddress}</p>
              </div>
            </div>
          </div>
        )}

        {data.pickupTime && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="w-3.5 h-3.5" />
            {data.pickupTime} on {data.scheduledDate}
          </div>
        )}

        <TripProgressBar status={data.status} />
      </div>
    </div>
  );
}

function TripProgressBar({ status }: { status: string }) {
  const currentStepIndex = TRIP_PROGRESS_STEPS.findIndex(s => s.key === status);

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-2">Trip Progress</p>
      <div className="space-y-1">
        {TRIP_PROGRESS_STEPS.map((step, idx) => {
          const isPast = idx <= currentStepIndex;
          const isCurrent = idx === currentStepIndex;
          return (
            <div
              key={step.key}
              className={`flex items-center gap-2 py-1 px-2 rounded text-sm ${
                isCurrent ? "bg-primary/10 font-medium text-primary"
                : isPast ? "text-muted-foreground"
                : "text-muted-foreground/40"
              }`}
              data-testid={`step-${step.key}`}
            >
              {isPast ? (
                <CheckCircle className={`w-4 h-4 flex-shrink-0 ${isCurrent ? "text-primary" : "text-emerald-500"}`} />
              ) : (
                <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/30 flex-shrink-0" />
              )}
              <span>{step.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ClinicLiveMapSection() {
  const { token } = useAuth();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const directionsRendererRef = useRef<google.maps.DirectionsRenderer | null>(null);
  const mapsLoadedRef = useRef(false);
  const [mapAvailable, setMapAvailable] = useState(true);
  const [selectedTrip, setSelectedTrip] = useState<any>(null);

  const mapQuery = useQuery<any>({
    queryKey: ["/api/clinic/map"],
    queryFn: () => apiFetch("/api/clinic/map", token),
    enabled: !!token,
    refetchInterval: 10000,
  });

  const mapTrips: any[] = mapQuery.data?.trips || [];

  function createCarSvg(color: string) {
    const fill = color || "#3b82f6";
    return `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24">
      <path d="M5 17a1 1 0 0 1-1-1v-5l2-6h12l2 6v5a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H8v1a1 1 0 0 1-1 1H5z"
        fill="${fill}" stroke="#fff" stroke-width="1"/>
      <circle cx="7.5" cy="14.5" r="1.5" fill="#fff"/>
      <circle cx="16.5" cy="14.5" r="1.5" fill="#fff"/>
      <path d="M6.5 8L8 4h8l1.5 4H6.5z" fill="${fill}" opacity="0.6" stroke="#fff" stroke-width="0.5"/>
    </svg>`;
  }

  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapTrips.length === 0) return;

    if (mapsLoadedRef.current && mapInstanceRef.current) {
      updateMapView();
      return;
    }

    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    fetch("/api/maps/client-key", { headers })
      .then(r => r.ok ? r.json() : fetch("/api/public/maps/key").then(rr => rr.json()))
      .then(json => {
        if (!json.key) { setMapAvailable(false); return; }
        if (window.google?.maps) {
          mapsLoadedRef.current = true;
          initLiveMap();
          return;
        }
        const script = document.createElement("script");
        script.src = `https://maps.googleapis.com/maps/api/js?key=${json.key}&libraries=geometry,places`;
        script.async = true;
        script.onload = () => { mapsLoadedRef.current = true; initLiveMap(); };
        script.onerror = () => setMapAvailable(false);
        document.head.appendChild(script);
      })
      .catch(() => setMapAvailable(false));
  }, [mapTrips.length > 0, token]);

  useEffect(() => {
    if (mapsLoadedRef.current && mapInstanceRef.current && mapTrips.length > 0) {
      updateMapView();
    }
  }, [mapTrips]);

  function initLiveMap() {
    if (!mapContainerRef.current) return;
    const map = new google.maps.Map(mapContainerRef.current, {
      center: { lat: 29.76, lng: -95.36 },
      zoom: 11,
      disableDefaultUI: true,
      zoomControl: true,
      styles: [{ featureType: "poi", stylers: [{ visibility: "off" }] }],
    });
    mapInstanceRef.current = map;
    directionsRendererRef.current = new google.maps.DirectionsRenderer({
      map,
      suppressMarkers: true,
      polylineOptions: { strokeColor: "#3b82f6", strokeWeight: 4, strokeOpacity: 0.7 },
    });
    updateMapView();
  }

  function updateMapView() {
    const map = mapInstanceRef.current;
    if (!map) return;

    const bounds = new google.maps.LatLngBounds();
    const currentKeys = new Set<string>();

    mapTrips.forEach(trip => {
      if (trip.pickupLat && trip.pickupLng) {
        const key = `pickup-${trip.tripId}`;
        currentKeys.add(key);
        const pos = { lat: trip.pickupLat, lng: trip.pickupLng };
        bounds.extend(pos);
        if (!markersRef.current.has(key)) {
          const marker = new google.maps.Marker({
            position: pos, map,
            icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: "#22c55e", fillOpacity: 1, strokeWeight: 2, strokeColor: "#fff", scale: 7 },
            title: `Pickup: ${trip.publicId}`, zIndex: 3,
          });
          marker.addListener("click", () => setSelectedTrip(trip));
          markersRef.current.set(key, marker);
        } else {
          markersRef.current.get(key)!.setPosition(pos);
        }
      }

      if (trip.dropoffLat && trip.dropoffLng) {
        const key = `dropoff-${trip.tripId}`;
        currentKeys.add(key);
        const pos = { lat: trip.dropoffLat, lng: trip.dropoffLng };
        bounds.extend(pos);
        if (!markersRef.current.has(key)) {
          const marker = new google.maps.Marker({
            position: pos, map,
            icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: "#ef4444", fillOpacity: 1, strokeWeight: 2, strokeColor: "#fff", scale: 7 },
            title: `Dropoff: ${trip.publicId}`, zIndex: 3,
          });
          marker.addListener("click", () => setSelectedTrip(trip));
          markersRef.current.set(key, marker);
        } else {
          markersRef.current.get(key)!.setPosition(pos);
        }
      }

      if (trip.driver?.lastLat && trip.driver?.lastLng) {
        const key = `driver-${trip.tripId}`;
        currentKeys.add(key);
        const pos = { lat: trip.driver.lastLat, lng: trip.driver.lastLng };
        bounds.extend(pos);
        const vColor = trip.driver.vehicleColor || "#3b82f6";
        if (!markersRef.current.has(key)) {
          const marker = new google.maps.Marker({
            position: pos, map,
            icon: {
              url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(createCarSvg(vColor)),
              scaledSize: new google.maps.Size(36, 36),
              anchor: new google.maps.Point(18, 18),
            },
            title: `${trip.driver.firstName} ${trip.driver.lastName}`,
            zIndex: 10,
          });
          marker.addListener("click", () => setSelectedTrip(trip));
          markersRef.current.set(key, marker);
        } else {
          markersRef.current.get(key)!.setPosition(pos);
        }
      }
    });

    markersRef.current.forEach((marker, key) => {
      if (!currentKeys.has(key)) {
        marker.setMap(null);
        markersRef.current.delete(key);
      }
    });

    if (mapTrips.length > 0 && !bounds.isEmpty()) {
      map.fitBounds(bounds, 60);
    }

    if (selectedTrip && directionsRendererRef.current) {
      const trip = mapTrips.find(t => t.tripId === selectedTrip.tripId);
      if (trip?.driver?.lastLat && trip?.driver?.lastLng && trip.pickupLat) {
        const origin = { lat: trip.driver.lastLat, lng: trip.driver.lastLng };
        const dest = ["PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF"].includes(trip.status)
          ? { lat: trip.dropoffLat, lng: trip.dropoffLng }
          : { lat: trip.pickupLat, lng: trip.pickupLng };
        if (dest.lat && dest.lng) {
          new google.maps.DirectionsService().route(
            { origin, destination: dest, travelMode: google.maps.TravelMode.DRIVING },
            (result, status) => {
              if (status === "OK" && result) directionsRendererRef.current?.setDirections(result);
            }
          );
        }
      }
    } else if (directionsRendererRef.current) {
      directionsRendererRef.current.setDirections({ routes: [] } as any);
    }
  }

  const onlineTrips = mapTrips.filter(t => t.driver?.isOnline);
  const offlineTrips = mapTrips.filter(t => t.driver && !t.driver.isOnline);
  const noDriverTrips = mapTrips.filter(t => !t.driver);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <MapIcon className="w-4 h-4 text-blue-500" />
          <h2 className="text-sm font-semibold" data-testid="text-livemap-title">Live Map</h2>
          <Badge variant="secondary" className="gap-1">
            <Activity className="w-3 h-3 text-emerald-500" />
            {mapTrips.length} active
          </Badge>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <RefreshCw className={`w-3 h-3 ${mapQuery.isFetching ? "animate-spin" : ""}`} />
          Auto-refresh 10s
        </div>
      </div>

      {mapAvailable && mapTrips.length > 0 ? (
        <div ref={mapContainerRef} className="w-full h-64 sm:h-80 md:h-96 rounded-md border bg-muted" data-testid="div-clinic-livemap" />
      ) : mapTrips.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground" data-testid="text-livemap-empty">
            <MapPinned className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p>No active trips right now</p>
            <p className="text-xs mt-1">Active trips will appear here with live driver tracking</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            <MapPinned className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p>Map not available</p>
          </CardContent>
        </Card>
      )}

      {selectedTrip && (
        <Card data-testid="card-selected-trip">
          <CardContent className="py-3 px-4 space-y-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold">{selectedTrip.publicId}</span>
                <Badge className={STATUS_COLORS[selectedTrip.status] || ""}>
                  {STATUS_LABELS[selectedTrip.status] || selectedTrip.status}
                </Badge>
                {selectedTrip.driver?.isOnline && (
                  <Badge variant="secondary" className="gap-1">
                    <Activity className="w-3 h-3 text-emerald-500" /> Live
                  </Badge>
                )}
              </div>
              <Button size="sm" variant="ghost" onClick={() => setSelectedTrip(null)} data-testid="button-deselect-trip">
                Deselect
              </Button>
            </div>
            {selectedTrip.driver && (
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 text-sm">
                  <Car className="w-4 h-4" style={{ color: selectedTrip.driver.vehicleColor || "#3b82f6" }} />
                  <span>{selectedTrip.driver.firstName} {selectedTrip.driver.lastName}</span>
                  {selectedTrip.driver.vehicleLabel && (
                    <span className="text-xs text-muted-foreground">{selectedTrip.driver.vehicleLabel}</span>
                  )}
                </div>
                <div className="text-right">
                  {selectedTrip.eta && selectedTrip.driver.isOnline ? (
                    <p className="text-sm font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1" data-testid="text-eta-value">
                      <Navigation className="w-3.5 h-3.5" />
                      Arriving in {selectedTrip.eta.minutes} min
                    </p>
                  ) : selectedTrip.driver && !selectedTrip.driver.isOnline ? (
                    <p className="text-xs text-muted-foreground flex items-center gap-1" data-testid="text-driver-offline">
                      <WifiOff className="w-3 h-3" />
                      Driver offline - last seen {formatTimeAgo(selectedTrip.driver.lastSeenAt)}
                    </p>
                  ) : null}
                  {selectedTrip.eta?.updatedAt && (
                    <p className="text-xs text-muted-foreground">Updated {formatTimeAgo(selectedTrip.eta.updatedAt)}</p>
                  )}
                </div>
              </div>
            )}
            <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1"><MapPin className="w-3 h-3 text-emerald-500" /> {selectedTrip.pickupAddress || "Pickup"}</span>
              <ArrowRight className="w-3 h-3" />
              <span className="flex items-center gap-1"><MapPin className="w-3 h-3 text-red-500" /> {selectedTrip.dropoffAddress || "Dropoff"}</span>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2" data-testid="list-livemap-trips">
        {mapTrips.map(trip => {
          const isSelected = selectedTrip?.tripId === trip.tripId;
          return (
            <Card
              key={trip.tripId}
              className={`hover-elevate cursor-pointer ${isSelected ? "ring-2 ring-primary" : ""}`}
              onClick={() => setSelectedTrip(isSelected ? null : trip)}
              data-testid={`card-livemap-trip-${trip.tripId}`}
            >
              <CardContent className="py-3 px-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{trip.publicId}</span>
                      <Badge className={STATUS_COLORS[trip.status] || ""}>
                        {STATUS_LABELS[trip.status] || trip.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      {trip.driver ? (
                        <span className="flex items-center gap-1 text-foreground font-medium">
                          <Car className="w-3 h-3" style={{ color: trip.driver.vehicleColor || "#3b82f6" }} />
                          {trip.driver.firstName} {trip.driver.lastName}
                        </span>
                      ) : (
                        <span className="italic">No driver assigned</span>
                      )}
                      {trip.pickupTime && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {trip.pickupTime}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right space-y-0.5 flex-shrink-0">
                    {trip.eta && trip.driver?.isOnline ? (
                      <p className="text-sm font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1">
                        <Navigation className="w-3.5 h-3.5" />
                        {trip.eta.minutes} min
                      </p>
                    ) : trip.driver && !trip.driver.isOnline ? (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <WifiOff className="w-3 h-3" />
                        Offline
                      </p>
                    ) : null}
                    {trip.driver?.isOnline && (
                      <p className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                        <Radio className="w-3 h-3" /> Live
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function TripsSection() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [tripTab, setTripTab] = useState("active");
  const [selectedTripId, setSelectedTripId] = useState<number | null>(null);
  const [showCreateTrip, setShowCreateTrip] = useState(false);
  const [trackingTripId, setTrackingTripId] = useState<number | null>(null);

  const tripsQuery = useQuery<any[]>({
    queryKey: ["/api/clinic/trips", tripTab],
    queryFn: () => apiFetch(`/api/clinic/trips?status=${tripTab}`, token),
    enabled: !!token,
    refetchInterval: tripTab === "active" ? 15000 : 30000,
  });

  const tripDetailQuery = useQuery<any>({
    queryKey: ["/api/clinic/trips", selectedTripId],
    queryFn: () => apiFetch(`/api/clinic/trips/${selectedTripId}`, token),
    enabled: !!token && !!selectedTripId,
    refetchInterval: 30000,
  });

  const patientsQuery = useQuery<any[]>({
    queryKey: ["/api/clinic/patients"],
    queryFn: () => apiFetch("/api/clinic/patients", token),
    enabled: !!token,
  });

  const clinicQuery = useQuery<any>({
    queryKey: ["/api/clinic/profile"],
    queryFn: () => apiFetch("/api/clinic/profile", token),
    enabled: !!token,
  });

  const createTripMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiFetch("/api/trips", token, {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinic/trips"] });
      setShowCreateTrip(false);
      toast({ title: "Trip requested", description: "Your trip request has been submitted for approval." });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const tripsList = tripsQuery.data || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Tabs value={tripTab} onValueChange={setTripTab}>
          <TabsList>
            <TabsTrigger value="active" data-testid="tab-trips-active">Active</TabsTrigger>
            <TabsTrigger value="scheduled" data-testid="tab-trips-scheduled">Scheduled</TabsTrigger>
            <TabsTrigger value="completed" data-testid="tab-trips-completed">Completed</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button size="sm" onClick={() => setShowCreateTrip(true)} data-testid="button-create-trip" className="gap-1">
          <Plus className="w-3.5 h-3.5" />
          Request Trip
        </Button>
      </div>

      {tripsQuery.isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : tripsList.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground" data-testid="text-empty-trips">
          No {tripTab} trips
        </div>
      ) : (
        <div className="space-y-2" data-testid="list-clinic-trips">
          {tripsList.map((trip) => (
            <ClinicTripCard
              key={trip.id}
              trip={trip}
              isCompleted={tripTab === "completed"}
              onSelect={() => setSelectedTripId(trip.id)}
              onTrack={ACTIVE_TRIP_STATUSES.includes(trip.status) ? () => setTrackingTripId(trip.id) : undefined}
            />
          ))}
        </div>
      )}

      <Dialog open={!!selectedTripId} onOpenChange={(open) => { if (!open) setSelectedTripId(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Trip Details
              {tripDetailQuery.data && (
                <Badge className={STATUS_COLORS[tripDetailQuery.data.status] || ""}>
                  {STATUS_LABELS[tripDetailQuery.data.status] || tripDetailQuery.data.status}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          {tripDetailQuery.isLoading ? (
            <div className="space-y-3 py-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : tripDetailQuery.data ? (
            <TripDetail trip={tripDetailQuery.data} onTrack={() => { setSelectedTripId(null); setTrackingTripId(tripDetailQuery.data.id); }} />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={showCreateTrip} onOpenChange={setShowCreateTrip}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Request a Trip</DialogTitle>
          </DialogHeader>
          <CreateTripForm
            patients={patientsQuery.data || []}
            clinic={clinicQuery.data}
            loading={createTripMutation.isPending}
            onSubmit={(data) => createTripMutation.mutate(data)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={!!trackingTripId} onOpenChange={(open) => { if (!open) setTrackingTripId(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0">
          {trackingTripId && (
            <TripTrackingView tripId={trackingTripId} onClose={() => setTrackingTripId(null)} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateTripForm({ patients, clinic, loading, onSubmit }: {
  patients: any[];
  clinic: any;
  loading: boolean;
  onSubmit: (data: any) => void;
}) {
  const [form, setForm] = useState({
    patientId: "",
    scheduledDate: todayStr(),
    pickupTime: "09:00",
    estimatedArrivalTime: "10:00",
    pickupAddress: "",
    dropoffAddress: clinic?.address || "",
    tripType: "one_time",
    notes: "",
  });

  const selectedPatient = patients.find(p => p.id === Number(form.patientId));

  const handlePatientChange = (val: string) => {
    const patient = patients.find(p => p.id === Number(val));
    setForm({
      ...form,
      patientId: val,
      pickupAddress: patient?.address || form.pickupAddress,
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.patientId) return;
    onSubmit({
      patientId: Number(form.patientId),
      cityId: clinic?.cityId,
      clinicId: clinic?.id,
      scheduledDate: form.scheduledDate,
      scheduledTime: form.pickupTime,
      pickupTime: form.pickupTime,
      estimatedArrivalTime: form.estimatedArrivalTime,
      pickupAddress: form.pickupAddress || selectedPatient?.address || "TBD",
      pickupLat: selectedPatient?.lat || null,
      pickupLng: selectedPatient?.lng || null,
      pickupZip: selectedPatient?.addressZip || "00000",
      dropoffAddress: form.dropoffAddress || clinic?.address || "TBD",
      dropoffLat: clinic?.lat || null,
      dropoffLng: clinic?.lng || null,
      dropoffZip: clinic?.addressZip || "00000",
      tripType: form.tripType,
      status: "SCHEDULED",
      notes: form.notes,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Patient *</Label>
        <Select value={form.patientId} onValueChange={handlePatientChange}>
          <SelectTrigger data-testid="select-trip-patient">
            <SelectValue placeholder="Select patient" />
          </SelectTrigger>
          <SelectContent>
            {patients.map(p => (
              <SelectItem key={p.id} value={String(p.id)} data-testid={`option-patient-${p.id}`}>
                {p.firstName} {p.lastName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Date *</Label>
          <Input type="date" value={form.scheduledDate} onChange={e => setForm({ ...form, scheduledDate: e.target.value })} required data-testid="input-trip-date" />
        </div>
        <div className="space-y-2">
          <Label>Trip Type</Label>
          <Select value={form.tripType} onValueChange={v => setForm({ ...form, tripType: v })}>
            <SelectTrigger data-testid="select-trip-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="one_time">One Time</SelectItem>
              <SelectItem value="recurring">Recurring</SelectItem>
              <SelectItem value="dialysis">Dialysis</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Pickup Time *</Label>
          <Input type="time" value={form.pickupTime} onChange={e => setForm({ ...form, pickupTime: e.target.value })} required data-testid="input-trip-pickup-time" />
        </div>
        <div className="space-y-2">
          <Label>Arrival Time *</Label>
          <Input type="time" value={form.estimatedArrivalTime} onChange={e => setForm({ ...form, estimatedArrivalTime: e.target.value })} required data-testid="input-trip-arrival-time" />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Pickup Address</Label>
        <Input value={form.pickupAddress} onChange={e => setForm({ ...form, pickupAddress: e.target.value })} placeholder="Patient's address (auto-filled)" data-testid="input-trip-pickup" />
      </div>
      <div className="space-y-2">
        <Label>Dropoff Address</Label>
        <Input value={form.dropoffAddress} onChange={e => setForm({ ...form, dropoffAddress: e.target.value })} placeholder="Clinic address (auto-filled)" data-testid="input-trip-dropoff" />
      </div>
      <div className="space-y-2">
        <Label>Notes</Label>
        <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Additional notes..." data-testid="input-trip-notes" />
      </div>
      <Button type="submit" className="w-full" disabled={loading || !form.patientId} data-testid="button-submit-trip">
        {loading ? "Submitting..." : "Submit Trip Request"}
      </Button>
      <p className="text-xs text-muted-foreground text-center">
        Trip requests require dispatch approval before scheduling
      </p>
    </form>
  );
}

function PatientsSection() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [showAddPatient, setShowAddPatient] = useState(false);
  const [editPatient, setEditPatient] = useState<any>(null);
  const [search, setSearch] = useState("");

  const patientsQuery = useQuery<any[]>({
    queryKey: ["/api/clinic/patients"],
    queryFn: () => apiFetch("/api/clinic/patients", token),
    enabled: !!token,
  });

  const clinicQuery = useQuery<any>({
    queryKey: ["/api/clinic/profile"],
    queryFn: () => apiFetch("/api/clinic/profile", token),
    enabled: !!token,
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiFetch("/api/patients", token, {
        method: "POST",
        body: JSON.stringify({ ...data, cityId: clinicQuery.data?.cityId }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinic/patients"] });
      setShowAddPatient(false);
      toast({ title: "Patient added" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      return apiFetch(`/api/patients/${id}`, token, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinic/patients"] });
      setEditPatient(null);
      toast({ title: "Patient updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const patientsList = (patientsQuery.data || []).filter(p => {
    if (!search) return true;
    const s = search.toLowerCase();
    return `${p.firstName} ${p.lastName}`.toLowerCase().includes(s) || (p.phone || "").includes(s);
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Input
          placeholder="Search patients..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-xs"
          data-testid="input-search-patients"
        />
        <Button size="sm" onClick={() => setShowAddPatient(true)} data-testid="button-add-patient" className="gap-1">
          <Plus className="w-3.5 h-3.5" />
          Add Patient
        </Button>
      </div>

      {patientsQuery.isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : patientsList.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground" data-testid="text-empty-patients">
          No patients found
        </div>
      ) : (
        <div className="space-y-2" data-testid="list-clinic-patients">
          {patientsList.map(p => (
            <Card key={p.id} className="cursor-pointer hover-elevate" onClick={() => setEditPatient(p)} data-testid={`card-patient-${p.id}`}>
              <CardContent className="py-3 px-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5" />
                      {p.firstName} {p.lastName}
                    </p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      {p.phone && <span>{p.phone}</span>}
                      {p.address && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {p.address.length > 40 ? p.address.substring(0, 40) + "..." : p.address}
                        </span>
                      )}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" data-testid={`button-edit-patient-${p.id}`}>
                    Edit
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showAddPatient} onOpenChange={setShowAddPatient}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Patient</DialogTitle></DialogHeader>
          <ClinicPatientForm loading={createMutation.isPending} onSubmit={(data) => createMutation.mutate(data)} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!editPatient} onOpenChange={(open) => { if (!open) setEditPatient(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit Patient</DialogTitle></DialogHeader>
          {editPatient && (
            <ClinicPatientForm
              initialData={editPatient}
              isEdit
              loading={updateMutation.isPending}
              onSubmit={(data) => updateMutation.mutate({ id: editPatient.id, data })}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ClinicPatientForm({ onSubmit, loading, initialData, isEdit }: {
  onSubmit: (data: any) => void;
  loading: boolean;
  initialData?: any;
  isEdit?: boolean;
}) {
  const [form, setForm] = useState({
    firstName: initialData?.firstName || "",
    lastName: initialData?.lastName || "",
    phone: initialData?.phone || "",
    address: initialData?.address || "",
    dateOfBirth: initialData?.dateOfBirth || "",
    insuranceId: initialData?.insuranceId || "",
    notes: initialData?.notes || "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      firstName: form.firstName,
      lastName: form.lastName,
      phone: form.phone,
      address: form.address,
      dateOfBirth: form.dateOfBirth,
      insuranceId: form.insuranceId,
      notes: form.notes,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>First Name *</Label>
          <Input value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} required data-testid="input-clinic-patient-first" />
        </div>
        <div className="space-y-2">
          <Label>Last Name *</Label>
          <Input value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} required data-testid="input-clinic-patient-last" />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Phone</Label>
        <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} data-testid="input-clinic-patient-phone" />
      </div>
      <div className="space-y-2">
        <Label>Address</Label>
        <Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} data-testid="input-clinic-patient-address" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Date of Birth</Label>
          <Input type="date" value={form.dateOfBirth} onChange={e => setForm({ ...form, dateOfBirth: e.target.value })} data-testid="input-clinic-patient-dob" />
        </div>
        <div className="space-y-2">
          <Label>Insurance ID</Label>
          <Input value={form.insuranceId} onChange={e => setForm({ ...form, insuranceId: e.target.value })} data-testid="input-clinic-patient-insurance" />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Notes</Label>
        <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} data-testid="input-clinic-patient-notes" />
      </div>
      <Button type="submit" className="w-full" disabled={loading} data-testid="button-submit-clinic-patient">
        {loading ? (isEdit ? "Saving..." : "Adding...") : (isEdit ? "Save Changes" : "Add Patient")}
      </Button>
    </form>
  );
}

function ReportsSection() {
  const { token } = useAuth();
  const { toast } = useToast();
  const today = todayStr();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
  const [startDate, setStartDate] = useState(thirtyDaysAgo);
  const [endDate, setEndDate] = useState(today);
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (!startDate || !endDate) {
      toast({ title: "Please select both dates", variant: "destructive" });
      return;
    }
    setExporting(true);
    try {
      const response = await fetch(`/api/clinic/trips/export?startDate=${startDate}&endDate=${endDate}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message || "Export failed");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `trips_${startDate}_to_${endDate}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast({ title: "Export downloaded" });
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-2">
          <CardTitle className="text-base">Trip Report Export</CardTitle>
          <FileDown className="w-4 h-4 text-muted-foreground" />
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Download a CSV report of all trips for your clinic within a date range.
            Includes patient name, addresses, pickup time, status, driver, ETA, and mileage.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} data-testid="input-export-start" />
            </div>
            <div className="space-y-2">
              <Label>End Date</Label>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} data-testid="input-export-end" />
            </div>
          </div>
          <Button onClick={handleExport} disabled={exporting} className="gap-1.5" data-testid="button-export-csv">
            <FileDown className="w-3.5 h-3.5" />
            {exporting ? "Exporting..." : "Download CSV"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function ClinicTripCard({ trip, isCompleted, onSelect, onTrack }: { trip: any; isCompleted: boolean; onSelect: () => void; onTrack?: () => void }) {
  return (
    <Card
      className="cursor-pointer hover-elevate"
      onClick={onSelect}
      data-testid={`card-clinic-trip-${trip.id}`}
    >
      <CardContent className="py-3 px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">{trip.publicId}</span>
              <Badge className={STATUS_COLORS[trip.status] || ""}>
                {STATUS_LABELS[trip.status] || trip.status}
              </Badge>
              {trip.approvalStatus === "pending" && (
                <Badge variant="secondary">Pending Approval</Badge>
              )}
              {isCompleted && (
                <Badge variant="secondary" className="gap-1">
                  <Lock className="w-3 h-3" />
                  Locked
                </Badge>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {trip.patientName && (
                <span className="flex items-center gap-1">
                  <User className="w-3 h-3 flex-shrink-0" />
                  {trip.patientName}
                </span>
              )}
              {trip.pickupTime && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3 flex-shrink-0" />
                  {trip.pickupTime} on {trip.scheduledDate}
                </span>
              )}
              {trip.driverName && (
                <span className="flex items-center gap-1 text-foreground font-medium">
                  <Car className="w-3 h-3 flex-shrink-0" />
                  {trip.driverName}
                </span>
              )}
              {trip.lastEtaMinutes != null && (
                <span className="flex items-center gap-1 font-medium text-foreground">
                  <Navigation className="w-3 h-3 flex-shrink-0" />
                  ETA: {trip.lastEtaMinutes} min
                </span>
              )}
            </div>

            <div className="text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">{trip.pickupAddress}</span>
                <ArrowRight className="w-3 h-3 flex-shrink-0 mx-0.5" />
                <span className="truncate">{trip.dropoffAddress}</span>
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            {onTrack && (
              <Button size="sm" variant="outline" className="gap-1" onClick={(e) => { e.stopPropagation(); onTrack(); }} data-testid={`button-track-trip-${trip.id}`}>
                <MapPinned className="w-3.5 h-3.5" />
                Track
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onSelect(); }} data-testid={`button-view-trip-${trip.id}`}>
              <Eye className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TripDetail({ trip, onTrack }: { trip: any; onTrack: () => void }) {
  const isCompleted = trip.status === "COMPLETED" || trip.status === "CANCELLED" || trip.status === "NO_SHOW";
  const isActive = ACTIVE_TRIP_STATUSES.includes(trip.status);
  const currentStepIndex = TRIP_PROGRESS_STEPS.findIndex((s) => s.key === trip.status);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-sm font-semibold">{trip.publicId}</span>
          <div className="flex items-center gap-2 flex-wrap">
            {trip.patientName && (
              <span className="text-sm text-muted-foreground flex items-center gap-1">
                <User className="w-3.5 h-3.5" /> {trip.patientName}
              </span>
            )}
            {isActive && (
              <Button size="sm" variant="outline" className="gap-1" onClick={onTrack} data-testid="button-detail-track">
                <MapPinned className="w-3.5 h-3.5" />
                Live Track
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 text-sm">
          <div className="flex items-start gap-2">
            <MapPin className="w-4 h-4 mt-0.5 text-emerald-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Pickup</p>
              <p>{trip.pickupAddress}</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <MapPin className="w-4 h-4 mt-0.5 text-red-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Dropoff</p>
              <p>{trip.dropoffAddress}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 text-sm flex-wrap">
          {trip.pickupTime && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Clock className="w-3.5 h-3.5" />
              {trip.pickupTime} on {trip.scheduledDate}
            </span>
          )}
          {trip.lastEtaMinutes != null && (
            <span className="flex items-center gap-1 font-medium">
              <Navigation className="w-3.5 h-3.5 text-blue-500" />
              ETA: {trip.lastEtaMinutes} min
            </span>
          )}
        </div>
      </div>

      {trip.driverName && (
        <Card>
          <CardContent className="py-3 px-4">
            <p className="text-xs text-muted-foreground mb-1">Driver</p>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="space-y-0.5">
                <p className="text-sm font-medium flex items-center gap-1">
                  <User className="w-3.5 h-3.5" />
                  {trip.driverName}
                </p>
                {trip.vehicleLabel && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Car className="w-3 h-3" />
                    {trip.vehicleLabel}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {trip.driverLastSeenAt && (
                  <span className="flex items-center gap-1">
                    <Radio className="w-3 h-3" />
                    GPS: {formatTimeAgo(trip.driverLastSeenAt)}
                  </span>
                )}
                {trip.driverPhone && (
                  <span className="flex items-center gap-1">
                    <Phone className="w-3 h-3" />
                    {trip.driverPhone}
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <TripProgressBar status={trip.status} />

      {trip.notes && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">Notes</p>
          <p className="text-sm">{trip.notes}</p>
        </div>
      )}

      {isCompleted && (
        <div className="text-center py-2">
          <Badge variant="secondary" className="gap-1">
            <Lock className="w-3 h-3" />
            This trip is completed and locked
          </Badge>
        </div>
      )}
    </div>
  );
}
