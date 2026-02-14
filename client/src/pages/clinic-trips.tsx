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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  BarChart3,
  XCircle,
  ArrowUpRight,
  ArrowDownRight,
  Download,
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

function sevenDaysAgoStr(): string {
  return new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
}

export default function ClinicTripsPage() {
  const [mainTab, setMainTab] = useState("ops");
  const { t } = useTranslation();

  return (
    <div className="p-4 space-y-4 max-w-6xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold" data-testid="text-clinic-portal-title">
          Clinic Operations Control Panel
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Real-time operations, trips, performance, patients, and reports
        </p>
      </div>

      <Tabs value={mainTab} onValueChange={setMainTab}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="ops" data-testid="tab-clinic-ops" className="gap-1.5">
            <LayoutDashboard className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Ops Dashboard</span>
          </TabsTrigger>
          <TabsTrigger value="trips" data-testid="tab-clinic-trips" className="gap-1.5">
            <ClipboardList className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t("clinic.trips")}</span>
          </TabsTrigger>
          <TabsTrigger value="performance" data-testid="tab-clinic-performance" className="gap-1.5">
            <BarChart3 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Performance</span>
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

        <TabsContent value="ops" className="mt-4">
          <OpsDashboard />
        </TabsContent>
        <TabsContent value="trips" className="mt-4">
          <TripsSection />
        </TabsContent>
        <TabsContent value="performance" className="mt-4">
          <PerformanceSection />
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

function OpsDashboard() {
  const { token } = useAuth();
  const [trackingTripId, setTrackingTripId] = useState<number | null>(null);
  const [selectedOpsTrip, setSelectedOpsTrip] = useState<any>(null);

  const opsQuery = useQuery<any>({
    queryKey: ["/api/clinic/ops"],
    queryFn: () => apiFetch("/api/clinic/ops", token),
    enabled: !!token,
    refetchInterval: 15000,
  });

  const opsData = opsQuery.data;
  const kpis = opsData?.kpis || {};
  const activeTrips = opsData?.activeTrips || [];
  const alerts = opsData?.alerts || [];
  const clinic = opsData?.clinic;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="w-4 h-4 text-blue-500" />
          <h2 className="text-sm font-semibold" data-testid="text-ops-title">Operations Overview</h2>
          {clinic?.name && (
            <Badge variant="secondary" data-testid="text-clinic-name">{clinic.name}</Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <RefreshCw className={`w-3 h-3 ${opsQuery.isFetching ? "animate-spin" : ""}`} />
          Auto-refresh 15s
        </div>
      </div>

      {opsQuery.isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1, 2, 3, 4, 5, 6, 7, 8].map(i => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" data-testid="grid-kpi-cards">
          <Card data-testid="card-kpi-en-route">
            <CardContent className="py-3 px-4 text-center">
              <ArrowUpRight className="w-5 h-5 mx-auto mb-1 text-blue-500" />
              <p className="text-2xl font-bold" data-testid="text-kpi-en-route">{kpis.enRouteToClinic ?? 0}</p>
              <p className="text-xs text-muted-foreground">En Route to Clinic</p>
            </CardContent>
          </Card>
          <Card data-testid="card-kpi-leaving">
            <CardContent className="py-3 px-4 text-center">
              <ArrowDownRight className="w-5 h-5 mx-auto mb-1 text-purple-500" />
              <p className="text-2xl font-bold" data-testid="text-kpi-leaving">{kpis.leavingClinic ?? 0}</p>
              <p className="text-xs text-muted-foreground">Leaving Clinic</p>
            </CardContent>
          </Card>
          <Card data-testid="card-kpi-arrivals60">
            <CardContent className="py-3 px-4 text-center">
              <Clock className="w-5 h-5 mx-auto mb-1 text-green-500" />
              <p className="text-2xl font-bold" data-testid="text-kpi-arrivals60">{kpis.arrivalsNext60 ?? 0}</p>
              <p className="text-xs text-muted-foreground">Arrivals Next 60 Min</p>
            </CardContent>
          </Card>
          <Card data-testid="card-kpi-late-risk">
            <CardContent className="py-3 px-4 text-center">
              <AlertTriangle className={`w-5 h-5 mx-auto mb-1 text-red-500 ${(kpis.lateRisk ?? 0) > 0 ? "animate-pulse" : ""}`} />
              <p className={`text-2xl font-bold ${(kpis.lateRisk ?? 0) > 0 ? "text-red-600 dark:text-red-400" : ""}`} data-testid="text-kpi-late-risk">{kpis.lateRisk ?? 0}</p>
              <p className="text-xs text-muted-foreground">Late Risk</p>
            </CardContent>
          </Card>
          <Card data-testid="card-kpi-no-driver">
            <CardContent className="py-3 px-4 text-center">
              <Car className="w-5 h-5 mx-auto mb-1 text-orange-500" />
              <p className="text-2xl font-bold" data-testid="text-kpi-no-driver">{kpis.noDriverAssigned ?? 0}</p>
              <p className="text-xs text-muted-foreground">No Driver Assigned</p>
            </CardContent>
          </Card>
          <Card data-testid="card-kpi-completed">
            <CardContent className="py-3 px-4 text-center">
              <CheckCircle className="w-5 h-5 mx-auto mb-1 text-emerald-500" />
              <p className="text-2xl font-bold" data-testid="text-kpi-completed">{kpis.completedToday ?? 0}</p>
              <p className="text-xs text-muted-foreground">Completed Today</p>
            </CardContent>
          </Card>
          <Card data-testid="card-kpi-no-shows">
            <CardContent className="py-3 px-4 text-center">
              <XCircle className="w-5 h-5 mx-auto mb-1 text-red-500" />
              <p className="text-2xl font-bold" data-testid="text-kpi-no-shows">{kpis.noShowsToday ?? 0}</p>
              <p className="text-xs text-muted-foreground">No-Shows Today</p>
            </CardContent>
          </Card>
          <Card data-testid="card-kpi-recurring">
            <CardContent className="py-3 px-4 text-center">
              <Repeat className="w-5 h-5 mx-auto mb-1 text-blue-500" />
              <p className="text-2xl font-bold" data-testid="text-kpi-recurring">{kpis.recurringActive ?? 0}</p>
              <p className="text-xs text-muted-foreground">Recurring Active</p>
            </CardContent>
          </Card>
        </div>
      )}

      {alerts.length > 0 && <AlertPanel alerts={alerts} />}

      <OpsMapSection
        activeTrips={activeTrips}
        clinic={clinic}
        selectedTrip={selectedOpsTrip}
        onSelectTrip={setSelectedOpsTrip}
      />

      {selectedOpsTrip && (
        <Card data-testid="card-ops-selected-trip">
          <CardContent className="py-3 px-4 space-y-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold">{selectedOpsTrip.publicId}</span>
                <Badge className={STATUS_COLORS[selectedOpsTrip.status] || ""}>
                  {STATUS_LABELS[selectedOpsTrip.status] || selectedOpsTrip.status}
                </Badge>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setSelectedOpsTrip(null)} data-testid="button-deselect-ops-trip">
                Deselect
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              {selectedOpsTrip.patient && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Patient</p>
                  <p className="font-medium flex items-center gap-1">
                    <User className="w-3.5 h-3.5" />
                    {selectedOpsTrip.patient.firstName} {selectedOpsTrip.patient.lastName}
                  </p>
                  {selectedOpsTrip.patient.phone && (
                    <a href={`tel:${selectedOpsTrip.patient.phone}`} className="text-xs text-blue-600 dark:text-blue-400 flex items-center gap-1" data-testid="link-call-patient">
                      <Phone className="w-3 h-3" /> {selectedOpsTrip.patient.phone}
                    </a>
                  )}
                </div>
              )}
              {selectedOpsTrip.driver && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Driver</p>
                  <p className="font-medium flex items-center gap-1">
                    <Car className="w-3.5 h-3.5" />
                    {selectedOpsTrip.driver.firstName} {selectedOpsTrip.driver.lastName}
                  </p>
                  {selectedOpsTrip.driver.phone && (
                    <a href={`tel:${selectedOpsTrip.driver.phone}`} className="text-xs text-blue-600 dark:text-blue-400 flex items-center gap-1" data-testid="link-call-driver">
                      <Phone className="w-3 h-3" /> {selectedOpsTrip.driver.phone}
                    </a>
                  )}
                  <p className="text-xs text-muted-foreground">
                    GPS: {formatTimeAgo(selectedOpsTrip.driver.lastSeenAt)}
                  </p>
                </div>
              )}
            </div>
            {selectedOpsTrip.eta && (
              <p className="text-sm font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1" data-testid="text-ops-eta">
                <Navigation className="w-3.5 h-3.5" />
                ETA: {selectedOpsTrip.eta.minutes} min
              </p>
            )}
            <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1"><MapPin className="w-3 h-3 text-emerald-500" /> {selectedOpsTrip.pickupAddress || "Pickup"}</span>
              <ArrowRight className="w-3 h-3" />
              <span className="flex items-center gap-1"><MapPin className="w-3 h-3 text-red-500" /> {selectedOpsTrip.dropoffAddress || "Dropoff"}</span>
            </div>
          </CardContent>
        </Card>
      )}

      <ArrivalsBoard activeTrips={activeTrips} onTrack={setTrackingTripId} />

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

function AlertPanel({ alerts }: { alerts: any[] }) {
  const [open, setOpen] = useState(true);

  const dangerAlerts = alerts.filter(a => a.severity === "danger");
  const warningAlerts = alerts.filter(a => a.severity === "warning");
  const infoAlerts = alerts.filter(a => a.severity === "info");

  function severityColor(severity: string) {
    if (severity === "danger") return "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800";
    if (severity === "warning") return "bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800";
    return "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800";
  }

  function severityIcon(severity: string) {
    if (severity === "danger") return <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />;
    if (severity === "warning") return <AlertTriangle className="w-4 h-4 text-yellow-500 flex-shrink-0" />;
    return <Activity className="w-4 h-4 text-blue-500 flex-shrink-0" />;
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full justify-between gap-2" data-testid="button-toggle-alerts">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm font-medium">Alerts</span>
            <Badge variant="secondary" data-testid="text-alert-count">{alerts.length}</Badge>
            {dangerAlerts.length > 0 && (
              <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">{dangerAlerts.length} critical</Badge>
            )}
          </div>
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-2 mt-2" data-testid="list-alerts">
          {alerts.map((alert, idx) => (
            <div
              key={idx}
              className={`flex items-start gap-2 p-3 rounded-md border ${severityColor(alert.severity)}`}
              data-testid={`alert-item-${idx}`}
            >
              {severityIcon(alert.severity)}
              <div className="flex-1 min-w-0">
                <p className="text-sm">{alert.message}</p>
                {alert.tripPublicId && (
                  <p className="text-xs text-muted-foreground mt-0.5">Trip: {alert.tripPublicId}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function OpsMapSection({ activeTrips, clinic, selectedTrip, onSelectTrip }: {
  activeTrips: any[];
  clinic: any;
  selectedTrip: any;
  onSelectTrip: (trip: any) => void;
}) {
  const { token } = useAuth();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const mapsLoadedRef = useRef(false);
  const [mapAvailable, setMapAvailable] = useState(true);

  function lateStatusColor(lateStatus: string, isOnline: boolean): string {
    if (!isOnline) return "#9ca3af";
    if (lateStatus === "late") return "#ef4444";
    if (lateStatus === "at_risk") return "#eab308";
    return "#22c55e";
  }

  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (activeTrips.length === 0 && !clinic) return;

    if (mapsLoadedRef.current && mapInstanceRef.current) {
      updateOpsMarkers();
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
          initOpsMap();
          return;
        }
        const script = document.createElement("script");
        script.src = `https://maps.googleapis.com/maps/api/js?key=${json.key}&libraries=geometry,places`;
        script.async = true;
        script.onload = () => { mapsLoadedRef.current = true; initOpsMap(); };
        script.onerror = () => setMapAvailable(false);
        document.head.appendChild(script);
      })
      .catch(() => setMapAvailable(false));
  }, [activeTrips.length > 0 || !!clinic, token]);

  useEffect(() => {
    if (mapsLoadedRef.current && mapInstanceRef.current) {
      updateOpsMarkers();
    }
  }, [activeTrips, selectedTrip]);

  function initOpsMap() {
    if (!mapContainerRef.current) return;
    const center = clinic?.lat && clinic?.lng
      ? { lat: clinic.lat, lng: clinic.lng }
      : { lat: 29.76, lng: -95.36 };
    const map = new google.maps.Map(mapContainerRef.current, {
      center,
      zoom: 12,
      disableDefaultUI: true,
      zoomControl: true,
      styles: [{ featureType: "poi", stylers: [{ visibility: "off" }] }],
    });
    mapInstanceRef.current = map;
    updateOpsMarkers();
  }

  function updateOpsMarkers() {
    const map = mapInstanceRef.current;
    if (!map) return;

    const bounds = new google.maps.LatLngBounds();
    const currentKeys = new Set<string>();

    if (clinic?.lat && clinic?.lng) {
      const clinicKey = "clinic-marker";
      currentKeys.add(clinicKey);
      const pos = { lat: clinic.lat, lng: clinic.lng };
      bounds.extend(pos);
      if (!markersRef.current.has(clinicKey)) {
        const marker = new google.maps.Marker({
          position: pos,
          map,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            fillColor: "#3b82f6",
            fillOpacity: 1,
            strokeWeight: 3,
            strokeColor: "#fff",
            scale: 10,
          },
          title: clinic.name || "Clinic",
          zIndex: 20,
        });
        markersRef.current.set(clinicKey, marker);
      }
    }

    activeTrips.forEach(trip => {
      if (!trip.driver?.lastLat || !trip.driver?.lastLng) return;
      const key = `driver-${trip.tripId}`;
      currentKeys.add(key);
      const pos = { lat: trip.driver.lastLat, lng: trip.driver.lastLng };
      bounds.extend(pos);
      const color = lateStatusColor(trip.lateStatus || "on_time", trip.driver.isOnline !== false);

      if (!markersRef.current.has(key)) {
        const marker = new google.maps.Marker({
          position: pos,
          map,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            fillColor: color,
            fillOpacity: 1,
            strokeWeight: 2,
            strokeColor: "#fff",
            scale: 8,
          },
          title: `${trip.patient?.firstName || ""} ${trip.patient?.lastName || ""} - ${trip.publicId}`,
          zIndex: 10,
        });
        marker.addListener("click", () => onSelectTrip(trip));
        markersRef.current.set(key, marker);
      } else {
        const existing = markersRef.current.get(key)!;
        existing.setPosition(pos);
        existing.setIcon({
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: color,
          fillOpacity: 1,
          strokeWeight: 2,
          strokeColor: "#fff",
          scale: 8,
        });
      }
    });

    markersRef.current.forEach((marker, key) => {
      if (!currentKeys.has(key)) {
        marker.setMap(null);
        markersRef.current.delete(key);
      }
    });

    if (!bounds.isEmpty() && activeTrips.length > 0) {
      map.fitBounds(bounds, 60);
    }
  }

  const hasDrivers = activeTrips.some(t => t.driver?.lastLat && t.driver?.lastLng);

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <MapIcon className="w-4 h-4 text-blue-500" />
        <h3 className="text-sm font-semibold" data-testid="text-ops-map-title">Active Trips Map</h3>
        <Badge variant="secondary">{activeTrips.length} trips</Badge>
      </div>
      {mapAvailable && (hasDrivers || (clinic?.lat && clinic?.lng)) ? (
        <div ref={mapContainerRef} className="w-full h-64 sm:h-80 rounded-md border bg-muted" data-testid="div-ops-map" />
      ) : activeTrips.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground" data-testid="text-ops-map-empty">
            <MapPinned className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p>No active trips with driver locations</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            <MapPinned className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p>Map not available</p>
          </CardContent>
        </Card>
      )}
      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-500 inline-block" /> On Time</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-yellow-500 inline-block" /> At Risk</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-500 inline-block" /> Late</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-gray-400 inline-block" /> Offline</span>
      </div>
    </div>
  );
}

function ArrivalsBoard({ activeTrips, onTrack }: { activeTrips: any[]; onTrack: (id: number) => void }) {
  const sorted = [...activeTrips].sort((a, b) => {
    const etaA = a.eta?.minutes ?? 9999;
    const etaB = b.eta?.minutes ?? 9999;
    return etaA - etaB;
  });

  function rowBg(lateStatus: string) {
    if (lateStatus === "late") return "bg-red-50 dark:bg-red-950/30";
    if (lateStatus === "at_risk") return "bg-yellow-50 dark:bg-yellow-950/30";
    return "";
  }

  if (sorted.length === 0) {
    return (
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Activity className="w-4 h-4 text-blue-500" />
          <h3 className="text-sm font-semibold" data-testid="text-arrivals-title">Live Arrivals Board</h3>
        </div>
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground" data-testid="text-arrivals-empty">
            No active arrivals
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Activity className="w-4 h-4 text-blue-500" />
        <h3 className="text-sm font-semibold" data-testid="text-arrivals-title">Live Arrivals Board</h3>
        <Badge variant="secondary">{sorted.length}</Badge>
      </div>
      <Card>
        <Table data-testid="table-arrivals">
          <TableHeader>
            <TableRow>
              <TableHead>Patient</TableHead>
              <TableHead className="hidden sm:table-cell">From/To</TableHead>
              <TableHead>Scheduled</TableHead>
              <TableHead>ETA</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden sm:table-cell">Driver</TableHead>
              <TableHead>Late</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map(trip => (
              <TableRow
                key={trip.tripId}
                className={`cursor-pointer ${rowBg(trip.lateStatus || "on_time")}`}
                onClick={() => onTrack(trip.tripId)}
                data-testid={`row-arrival-${trip.tripId}`}
              >
                <TableCell className="py-2">
                  <span className="text-sm font-medium" data-testid={`text-arrival-patient-${trip.tripId}`}>
                    {trip.patient?.firstName} {trip.patient?.lastName}
                  </span>
                </TableCell>
                <TableCell className="py-2 hidden sm:table-cell">
                  <div className="text-xs text-muted-foreground">
                    <span className="truncate max-w-[120px] inline-block align-middle">
                      {trip.pickupAddress ? (trip.pickupAddress.length > 25 ? trip.pickupAddress.substring(0, 25) + "..." : trip.pickupAddress) : "N/A"}
                    </span>
                    <ArrowRight className="w-3 h-3 inline mx-1" />
                    <span className="truncate max-w-[120px] inline-block align-middle">
                      {trip.dropoffAddress ? (trip.dropoffAddress.length > 25 ? trip.dropoffAddress.substring(0, 25) + "..." : trip.dropoffAddress) : "N/A"}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="py-2">
                  <span className="text-xs">{trip.pickupTime || "N/A"}</span>
                </TableCell>
                <TableCell className="py-2">
                  {trip.eta?.minutes != null ? (
                    <span className="text-sm font-bold text-blue-600 dark:text-blue-400" data-testid={`text-arrival-eta-${trip.tripId}`}>
                      {trip.eta.minutes}m
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">--</span>
                  )}
                </TableCell>
                <TableCell className="py-2">
                  <Badge className={`${STATUS_COLORS[trip.status] || ""} text-xs`}>
                    {STATUS_LABELS[trip.status] || trip.status}
                  </Badge>
                </TableCell>
                <TableCell className="py-2 hidden sm:table-cell">
                  <span className="text-xs">
                    {trip.driver ? `${trip.driver.firstName} ${trip.driver.lastName}` : "Unassigned"}
                  </span>
                </TableCell>
                <TableCell className="py-2">
                  {trip.lateStatus === "late" ? (
                    <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 animate-pulse" data-testid={`badge-late-${trip.tripId}`}>
                      LATE
                    </Badge>
                  ) : trip.lateStatus === "at_risk" ? (
                    <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" data-testid={`badge-at-risk-${trip.tripId}`}>
                      AT RISK
                    </Badge>
                  ) : (
                    <Badge variant="secondary" data-testid={`badge-on-time-${trip.tripId}`}>OK</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function TripsSection() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [tripTab, setTripTab] = useState("live");
  const [tripTypeFilter, setTripTypeFilter] = useState("all");
  const [selectedTripId, setSelectedTripId] = useState<number | null>(null);
  const [showCreateTrip, setShowCreateTrip] = useState(false);
  const [trackingTripId, setTrackingTripId] = useState<number | null>(null);

  const queryParams = new URLSearchParams();
  queryParams.set("status", tripTab);
  if (tripTypeFilter !== "all") queryParams.set("tripType", tripTypeFilter);

  const tripsQuery = useQuery<any[]>({
    queryKey: ["/api/clinic/trips", tripTab, tripTypeFilter],
    queryFn: () => apiFetch(`/api/clinic/trips?${queryParams.toString()}`, token),
    enabled: !!token,
    refetchInterval: tripTab === "live" ? 15000 : 30000,
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
            <TabsTrigger value="live" data-testid="tab-trips-live">Live</TabsTrigger>
            <TabsTrigger value="scheduled" data-testid="tab-trips-scheduled">Scheduled</TabsTrigger>
            <TabsTrigger value="pending" data-testid="tab-trips-pending">Pending</TabsTrigger>
            <TabsTrigger value="completed" data-testid="tab-trips-completed">Completed</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button size="sm" onClick={() => setShowCreateTrip(true)} data-testid="button-create-trip" className="gap-1">
          <Plus className="w-3.5 h-3.5" />
          Request Trip
        </Button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">Filter:</span>
        <Button
          size="sm"
          variant={tripTypeFilter === "all" ? "default" : "outline"}
          onClick={() => setTripTypeFilter("all")}
          data-testid="button-filter-all"
          className="toggle-elevate"
        >
          All
        </Button>
        <Button
          size="sm"
          variant={tripTypeFilter === "recurring" ? "default" : "outline"}
          onClick={() => setTripTypeFilter("recurring")}
          data-testid="button-filter-recurring"
          className="toggle-elevate"
        >
          Recurring
        </Button>
        <Button
          size="sm"
          variant={tripTypeFilter === "one_time" ? "default" : "outline"}
          onClick={() => setTripTypeFilter("one_time")}
          data-testid="button-filter-onetime"
          className="toggle-elevate"
        >
          One-time
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

function PerformanceSection() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [startDate, setStartDate] = useState(sevenDaysAgoStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [exporting, setExporting] = useState(false);

  const metricsQuery = useQuery<any>({
    queryKey: ["/api/clinic/metrics", startDate, endDate],
    queryFn: () => apiFetch(`/api/clinic/metrics?startDate=${startDate}&endDate=${endDate}`, token),
    enabled: !!token && !!startDate && !!endDate,
  });

  const metrics = metricsQuery.data?.metrics || {};
  const dailyData = metricsQuery.data?.dailyData || [];

  function rateColor(rate: number): string {
    if (rate >= 80) return "text-green-600 dark:text-green-400";
    if (rate >= 60) return "text-yellow-600 dark:text-yellow-400";
    return "text-red-600 dark:text-red-400";
  }

  const handleWeeklyExport = async () => {
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
      a.download = `performance_${startDate}_to_${endDate}.csv`;
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

  const maxDailyTotal = Math.max(1, ...dailyData.map((d: any) => d.total || 0));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-blue-500" />
          <h2 className="text-sm font-semibold" data-testid="text-performance-title">Performance Metrics</h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="max-w-[150px]"
            data-testid="input-perf-start"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            className="max-w-[150px]"
            data-testid="input-perf-end"
          />
        </div>
      </div>

      {metricsQuery.isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3" data-testid="grid-metric-cards">
          <Card data-testid="card-metric-ontime">
            <CardContent className="py-3 px-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">On-Time Rate</p>
              <p className={`text-3xl font-bold ${rateColor(metrics.onTimeRate ?? 0)}`} data-testid="text-metric-ontime">
                {(metrics.onTimeRate ?? 0).toFixed(1)}%
              </p>
            </CardContent>
          </Card>
          <Card data-testid="card-metric-delay">
            <CardContent className="py-3 px-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">Avg Delay</p>
              <p className="text-3xl font-bold" data-testid="text-metric-delay">
                {(metrics.avgDelayMinutes ?? 0).toFixed(1)}
              </p>
              <p className="text-xs text-muted-foreground">minutes</p>
            </CardContent>
          </Card>
          <Card data-testid="card-metric-noshow">
            <CardContent className="py-3 px-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">No-Show Rate</p>
              <p className="text-3xl font-bold text-red-600 dark:text-red-400" data-testid="text-metric-noshow">
                {(metrics.noShowRate ?? 0).toFixed(1)}%
              </p>
            </CardContent>
          </Card>
          <Card data-testid="card-metric-tripsperday">
            <CardContent className="py-3 px-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">Trips Per Day</p>
              <p className="text-3xl font-bold" data-testid="text-metric-tripsperday">
                {(metrics.tripsPerDay ?? 0).toFixed(1)}
              </p>
            </CardContent>
          </Card>
          <Card data-testid="card-metric-recurring-reliability">
            <CardContent className="py-3 px-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">Recurring Reliability</p>
              <p className={`text-3xl font-bold ${rateColor(metrics.recurringReliability ?? 0)}`} data-testid="text-metric-recurring-reliability">
                {(metrics.recurringReliability ?? 0).toFixed(1)}%
              </p>
            </CardContent>
          </Card>
          <Card data-testid="card-metric-cancellation">
            <CardContent className="py-3 px-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">Cancellation Rate</p>
              <p className="text-3xl font-bold" data-testid="text-metric-cancellation">
                {(metrics.cancellationRate ?? 0).toFixed(1)}%
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {dailyData.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-2">
            <CardTitle className="text-base">Daily Trip Volume</CardTitle>
            <BarChart3 className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="space-y-2" data-testid="chart-daily-volume">
            {dailyData.map((day: any, idx: number) => {
              const pct = maxDailyTotal > 0 ? (day.total / maxDailyTotal) * 100 : 0;
              const completedPct = maxDailyTotal > 0 ? (day.completed / maxDailyTotal) * 100 : 0;
              const latePct = maxDailyTotal > 0 ? ((day.late || 0) / maxDailyTotal) * 100 : 0;
              const dateLabel = new Date(day.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
              return (
                <div key={idx} className="flex items-center gap-3" data-testid={`bar-day-${idx}`}>
                  <span className="text-xs text-muted-foreground w-24 flex-shrink-0 text-right">{dateLabel}</span>
                  <div className="flex-1 flex items-center gap-1">
                    <div className="flex-1 bg-muted rounded-sm overflow-visible h-5 relative">
                      <div
                        className="absolute left-0 top-0 h-5 bg-emerald-500 rounded-sm"
                        style={{ width: `${completedPct}%` }}
                      />
                      <div
                        className="absolute top-0 h-5 bg-red-400 rounded-sm"
                        style={{ left: `${completedPct}%`, width: `${latePct}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium w-8 text-right">{day.total}</span>
                  </div>
                </div>
              );
            })}
            <div className="flex items-center gap-4 text-xs text-muted-foreground mt-2 flex-wrap">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" /> Completed</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-400 inline-block" /> Late</span>
            </div>
          </CardContent>
        </Card>
      )}

      <Button onClick={handleWeeklyExport} disabled={exporting} className="gap-1.5" data-testid="button-export-weekly">
        <Download className="w-3.5 h-3.5" />
        {exporting ? "Exporting..." : "Download Weekly Summary CSV"}
      </Button>
    </div>
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

function ReportsSection() {
  const { token } = useAuth();
  const { toast } = useToast();
  const today = todayStr();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
  const [startDate, setStartDate] = useState(thirtyDaysAgo);
  const [endDate, setEndDate] = useState(today);
  const [exporting, setExporting] = useState(false);

  const weeklyMetricsQuery = useQuery<any>({
    queryKey: ["/api/clinic/metrics", "weekly-summary"],
    queryFn: () => apiFetch(`/api/clinic/metrics?startDate=${sevenDaysAgoStr()}&endDate=${todayStr()}`, token),
    enabled: !!token,
  });

  const weeklyMetrics = weeklyMetricsQuery.data?.metrics || {};

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

  const handleWeeklySummaryExport = async () => {
    setExporting(true);
    try {
      const sd = sevenDaysAgoStr();
      const ed = todayStr();
      const response = await fetch(`/api/clinic/trips/export?startDate=${sd}&endDate=${ed}`, {
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
      a.download = `weekly_summary_${sd}_to_${ed}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast({ title: "Weekly summary downloaded" });
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

      <Card data-testid="card-weekly-summary">
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-2">
          <CardTitle className="text-base">Weekly Summary (Last 7 Days)</CardTitle>
          <TrendingUp className="w-4 h-4 text-muted-foreground" />
        </CardHeader>
        <CardContent className="space-y-4">
          {weeklyMetricsQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-full" />
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3" data-testid="grid-weekly-summary">
              <div>
                <p className="text-xs text-muted-foreground">Total Trips</p>
                <p className="text-lg font-bold" data-testid="text-weekly-total">{weeklyMetrics.totalTrips ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Completed</p>
                <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400" data-testid="text-weekly-completed">{weeklyMetrics.completedTrips ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">On-Time Rate</p>
                <p className="text-lg font-bold" data-testid="text-weekly-ontime">{(weeklyMetrics.onTimeRate ?? 0).toFixed(1)}%</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">No-Shows</p>
                <p className="text-lg font-bold text-red-600 dark:text-red-400" data-testid="text-weekly-noshows">{weeklyMetrics.noShowTrips ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Cancelled</p>
                <p className="text-lg font-bold" data-testid="text-weekly-cancelled">{weeklyMetrics.cancelledTrips ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Avg Delay</p>
                <p className="text-lg font-bold" data-testid="text-weekly-delay">{(weeklyMetrics.avgDelayMinutes ?? 0).toFixed(1)} min</p>
              </div>
            </div>
          )}
          <Button onClick={handleWeeklySummaryExport} disabled={exporting} variant="outline" className="gap-1.5" data-testid="button-export-weekly-summary">
            <Download className="w-3.5 h-3.5" />
            {exporting ? "Exporting..." : "Download Weekly Summary"}
          </Button>
        </CardContent>
      </Card>
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
              {trip.tripType === "recurring" && (
                <Badge variant="secondary" className="gap-1">
                  <Repeat className="w-3 h-3" />
                  Recurring
                </Badge>
              )}
              {trip.direction && (
                <Badge variant="outline">{trip.direction === "to_clinic" ? "To Clinic" : "From Clinic"}</Badge>
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
