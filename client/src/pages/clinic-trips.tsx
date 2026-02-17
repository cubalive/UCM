import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTripRealtime } from "@/hooks/use-trip-realtime";
import { RealtimeDebugPanel } from "@/components/realtime-debug-panel";
import { queryClient } from "@/lib/queryClient";
import { apiFetch, rawAuthFetch } from "@/lib/api";
import { AddressAutocomplete, type StructuredAddress } from "@/components/address-autocomplete";
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
  DialogFooter,
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
import { downloadWithAuth } from "@/lib/export";
import SignaturePad from "@/components/SignaturePad";
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
  DollarSign,
  FileText,
  Pencil,
  CreditCard,
  Satellite,
} from "lucide-react";
import { TripProgressTimeline, TripDateTimeHeader, TripMetricsCard } from "@/components/trip-progress-timeline";

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

function DialysisReturnDialog({ tripId, onDismiss }: { tripId: number; onDismiss: () => void }) {
  const { token } = useAuth();
  const { toast } = useToast();

  const checkQuery = useQuery<any>({
    queryKey: ["/api/trips", tripId, "dialysis-return-check"],
    queryFn: () => apiFetch(`/api/trips/${tripId}/dialysis-return-check`, token),
    enabled: !!token && !!tripId,
  });

  const adjustMutation = useMutation({
    mutationFn: async (payload: { action: string; returnTripId: number; proposedPickupTime?: string }) => {
      return apiFetch(`/api/trips/${tripId}/dialysis-return-adjust`, token, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (data: any) => {
      if (data.action === "confirmed") {
        toast({ title: "Return time updated", description: `Return pickup time changed to ${data.newTime}` });
      } else {
        toast({ title: "Time kept", description: "Return pickup time was not changed." });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/clinic/trips"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clinic/ops"] });
      onDismiss();
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const data = checkQuery.data;

  useEffect(() => {
    if (!checkQuery.isLoading && data && (!data.applicable || !data.needsAdjustment)) {
      onDismiss();
    }
  }, [checkQuery.isLoading, data, onDismiss]);

  if (checkQuery.isLoading) return null;
  if (!data?.applicable || !data?.needsAdjustment) return null;

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) onDismiss(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" data-testid="text-dialysis-return-title">
            <Repeat className="w-4 h-4 text-blue-500" />
            Dialysis Return Trip Adjustment
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Outbound dialysis trip <span className="font-semibold text-foreground">{data.outboundPublicId}</span> completed.
            The linked return trip may need its pickup time adjusted.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Card>
              <CardContent className="py-3 px-4 text-center">
                <p className="text-xs text-muted-foreground mb-1">Current Return Time</p>
                <p className="text-lg font-bold" data-testid="text-current-return-time">{data.currentReturnPickupTime}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-3 px-4 text-center">
                <p className="text-xs text-muted-foreground mb-1">Proposed Time</p>
                <p className="text-lg font-bold text-blue-600 dark:text-blue-400" data-testid="text-proposed-return-time">{data.proposedReturnPickupTime}</p>
              </CardContent>
            </Card>
          </div>
          <p className="text-xs text-muted-foreground">
            Proposed = dropoff time + {data.bufferMinutes} min buffer.
            Return trip: <span className="font-medium">{data.returnPublicId}</span>
          </p>
          <div className="flex gap-3">
            <Button
              className="flex-1"
              onClick={() => adjustMutation.mutate({ action: "confirm", returnTripId: data.returnTripId, proposedPickupTime: data.proposedReturnPickupTime })}
              disabled={adjustMutation.isPending}
              data-testid="button-confirm-return-adjust"
            >
              <CheckCircle className="w-4 h-4 mr-1.5" />
              {adjustMutation.isPending ? "Updating..." : "Confirm New Time"}
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => adjustMutation.mutate({ action: "keep", returnTripId: data.returnTripId })}
              disabled={adjustMutation.isPending}
              data-testid="button-keep-return-time"
            >
              Keep Current
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OpsDashboard() {
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const [opsTab, setOpsTab] = useState("live");
  const [trackingTripId, setTrackingTripId] = useState<number | null>(null);
  const [selectedOpsTrip, setSelectedOpsTrip] = useState<any>(null);
  const [selectedCompletedTripId, setSelectedCompletedTripId] = useState<number | null>(null);
  const [dialysisCheckTripId, setDialysisCheckTripId] = useState<number | null>(null);
  const [dismissedDialysis, setDismissedDialysis] = useState<Set<number>>(new Set());

  const activeTripsQuery = useQuery<any>({
    queryKey: ["/api/clinic/active-trips"],
    queryFn: () => apiFetch("/api/clinic/active-trips", token),
    enabled: !!token,
    refetchInterval: 60000,
  });

  const opsQuery = useQuery<any>({
    queryKey: ["/api/clinic/ops"],
    queryFn: () => apiFetch("/api/clinic/ops", token),
    enabled: !!token,
    refetchInterval: 60000,
  });

  const scheduledTripsQuery = useQuery<any[]>({
    queryKey: ["/api/clinic/trips", "scheduled"],
    queryFn: () => apiFetch("/api/clinic/trips?status=scheduled", token),
    enabled: !!token && opsTab === "scheduled",
    refetchInterval: 60000,
  });

  const completedTripsQuery = useQuery<any[]>({
    queryKey: ["/api/clinic/trips", "completed"],
    queryFn: () => apiFetch("/api/clinic/trips?status=completed", token),
    enabled: !!token && opsTab === "completed",
    refetchInterval: 60000,
  });

  const completedTripDetailQuery = useQuery<any>({
    queryKey: ["/api/clinic/trips", selectedCompletedTripId],
    queryFn: () => apiFetch(`/api/clinic/trips/${selectedCompletedTripId}`, token),
    enabled: !!token && !!selectedCompletedTripId,
  });

  const activeData = activeTripsQuery.data;
  const liveTrips: any[] = activeData?.trips || [];
  const clinic = activeData?.clinic || opsQuery.data?.clinic;
  const kpis = opsQuery.data?.kpis || {};
  const alerts = opsQuery.data?.alerts || [];

  const completedDialysisQuery = useQuery<any[]>({
    queryKey: ["/api/clinic/trips", "completed", "dialysis"],
    queryFn: () => apiFetch("/api/clinic/trips?status=completed&tripType=dialysis", token),
    enabled: !!token,
    refetchInterval: 60000,
  });

  useEffect(() => {
    const completedDialysis = completedDialysisQuery.data || [];
    const todayDate = new Date().toISOString().split("T")[0];
    const todayCompleted = completedDialysis.filter((t: any) => t.scheduledDate === todayDate);
    for (const trip of todayCompleted) {
      if (!dismissedDialysis.has(trip.id) && !dialysisCheckTripId) {
        setDialysisCheckTripId(trip.id);
        break;
      }
    }
  }, [completedDialysisQuery.data, dismissedDialysis, dialysisCheckTripId]);

  const isFetching = activeTripsQuery.isFetching || opsQuery.isFetching;

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
          <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
          Auto-refresh 60s
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

      <Tabs value={opsTab} onValueChange={setOpsTab}>
        <TabsList>
          <TabsTrigger value="live" data-testid="tab-ops-live" className="gap-1.5">
            <Radio className="w-3.5 h-3.5" />
            Live
            {liveTrips.length > 0 && <Badge variant="secondary" className="ml-1">{liveTrips.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="scheduled" data-testid="tab-ops-scheduled" className="gap-1.5">
            <Calendar className="w-3.5 h-3.5" />
            Scheduled
          </TabsTrigger>
          <TabsTrigger value="completed" data-testid="tab-ops-completed" className="gap-1.5">
            <CheckCircle className="w-3.5 h-3.5" />
            Completed
          </TabsTrigger>
        </TabsList>

        <TabsContent value="live" className="mt-4 space-y-4">
          {activeTripsQuery.isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)}
            </div>
          ) : liveTrips.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <MapPinned className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <h3 className="text-base font-semibold mb-1" data-testid="text-no-active-routes-title">No active routes for your clinic</h3>
                <p className="text-sm text-muted-foreground" data-testid="text-no-active-routes-subtitle">The map will appear once a driver is assigned.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              <LiveTripCards
                trips={liveTrips}
                selectedTrip={selectedOpsTrip}
                onSelectTrip={setSelectedOpsTrip}
              />
              <OpsMapSection
                activeTrips={liveTrips}
                clinic={clinic}
                selectedTrip={selectedOpsTrip}
                onSelectTrip={setSelectedOpsTrip}
              />
            </>
          )}
        </TabsContent>

        <TabsContent value="scheduled" className="mt-4">
          {scheduledTripsQuery.isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : (scheduledTripsQuery.data || []).length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                <Calendar className="w-8 h-8 mx-auto mb-2 opacity-40" />
                No scheduled trips for today.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2" data-testid="list-scheduled-trips">
              {(scheduledTripsQuery.data || []).map((trip: any) => (
                <Card key={trip.id} data-testid={`card-scheduled-trip-${trip.id}`}>
                  <CardContent className="py-3 px-4">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{trip.publicId}</span>
                        <Badge className={STATUS_COLORS[trip.status] || ""}>{STATUS_LABELS[trip.status] || trip.status}</Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">{trip.pickupTime || "N/A"}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1 flex-wrap">
                      <span className="flex items-center gap-1"><User className="w-3 h-3" /> {trip.patientFirstName || ""} {trip.patientLastName || ""}</span>
                      <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {trip.pickupAddress ? (trip.pickupAddress.length > 30 ? trip.pickupAddress.substring(0, 30) + "..." : trip.pickupAddress) : "N/A"}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="completed" className="mt-4">
          {completedTripsQuery.isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : (completedTripsQuery.data || []).length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                <CheckCircle className="w-8 h-8 mx-auto mb-2 opacity-40" />
                No completed trips today.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2" data-testid="list-completed-trips">
              {(completedTripsQuery.data || []).map((trip: any) => (
                <Card
                  key={trip.id}
                  className="cursor-pointer hover-elevate active-elevate-2"
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/clinic-trip/${trip.id}`)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/clinic-trip/${trip.id}`); } }}
                  data-testid={`card-completed-trip-${trip.id}`}
                >
                  <CardContent className="py-3 px-4 min-h-[44px]">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{trip.publicId}</span>
                        <Badge className={STATUS_COLORS[trip.status] || ""}>{STATUS_LABELS[trip.status] || trip.status}</Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{trip.pickupTime || "N/A"}</span>
                        <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1 flex-wrap">
                      <span className="flex items-center gap-1"><User className="w-3 h-3" /> {trip.patientFirstName || ""} {trip.patientLastName || ""}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!selectedCompletedTripId} onOpenChange={(open) => { if (!open) setSelectedCompletedTripId(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              Trip Details
              {completedTripDetailQuery.data && (
                <Badge className={STATUS_COLORS[completedTripDetailQuery.data.status] || ""}>
                  {STATUS_LABELS[completedTripDetailQuery.data.status] || completedTripDetailQuery.data.status}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          {completedTripDetailQuery.isLoading ? (
            <div className="space-y-3 py-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : completedTripDetailQuery.data ? (
            <ClinicTripDetailsView trip={completedTripDetailQuery.data} token={token} />
          ) : null}
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

function LiveTripCards({ trips, selectedTrip, onSelectTrip }: {
  trips: any[];
  selectedTrip: any;
  onSelectTrip: (trip: any) => void;
}) {
  const { token } = useAuth();
  const { toast } = useToast();
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelTrip, setCancelTrip] = useState<any>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelNotes, setCancelNotes] = useState("");

  const cancelMutation = useMutation({
    mutationFn: async ({ tripId, reason, notes }: { tripId: number; reason: string; notes: string }) => {
      const res = await fetch(`/api/trips/${tripId}/cancel-request`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason: notes ? `${reason} - ${notes}` : reason }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Request failed" }));
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Cancel request submitted", description: "Dispatch will review your request." });
      setCancelModalOpen(false);
      setCancelTrip(null);
      setCancelReason("");
      setCancelNotes("");
      queryClient.invalidateQueries({ queryKey: ["/api/clinic/active-trips"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const sorted = [...trips].sort((a, b) => {
    const etaA = a.etaToClinic ?? 9999;
    const etaB = b.etaToClinic ?? 9999;
    return etaA - etaB;
  });

  return (
    <>
      <div className="space-y-2" data-testid="list-live-trip-cards">
        {sorted.map(trip => {
          const isSelected = selectedTrip?.tripId === trip.tripId;
          const isCancelRequested = trip.approvalStatus === "cancel_requested";
          return (
            <Card
              key={trip.tripId}
              className={`cursor-pointer transition-colors ${isSelected ? "ring-2 ring-blue-500" : ""} ${isCancelRequested ? "opacity-70" : ""}`}
              onClick={() => onSelectTrip(trip)}
              data-testid={`card-live-trip-${trip.tripId}`}
            >
              <CardContent className="py-3 px-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <User className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-semibold" data-testid={`text-live-patient-${trip.tripId}`}>
                      {trip.patient?.firstName || "Unknown"} {trip.patient?.lastName || ""}
                    </span>
                    {trip.patient?.phone && (
                      <span className="text-xs text-muted-foreground" data-testid={`text-patient-phone-${trip.tripId}`}>
                        {trip.patient.phone}
                      </span>
                    )}
                    <Badge className={STATUS_COLORS[trip.status] || ""}>
                      {STATUS_LABELS[trip.status] || trip.status}
                    </Badge>
                    {isCancelRequested && (
                      <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200">
                        Cancel Requested
                      </Badge>
                    )}
                  </div>
                  <div className="text-right">
                    {trip.stale ? (
                      <div className="flex items-center gap-1 text-xs text-orange-600 dark:text-orange-400" data-testid={`text-stale-${trip.tripId}`}>
                        <WifiOff className="w-3.5 h-3.5" />
                        Driver location not updating
                      </div>
                    ) : trip.etaToClinic != null ? (
                      <div data-testid={`text-eta-clinic-${trip.tripId}`}>
                        <span className="text-lg font-bold text-blue-600 dark:text-blue-400">
                          Arriving in ~{trip.etaToClinic} min
                        </span>
                        {trip.etaUpdatedAt && (
                          <p className="text-xs text-muted-foreground">
                            Updated {formatTimeAgo(trip.etaUpdatedAt)}
                          </p>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">ETA unavailable</span>
                    )}
                  </div>
                </div>
                {trip.lastEtaMinutes != null && !trip.stale && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1.5" data-testid={`text-route-eta-${trip.tripId}`}>
                    <Navigation className="w-3 h-3 text-indigo-500" />
                    <span>Route: ~{trip.lastEtaMinutes} min{trip.distanceMiles != null && ` / ${trip.distanceMiles} mi`}</span>
                  </div>
                )}
                <div className="flex items-center gap-4 text-xs text-muted-foreground mt-2 flex-wrap">
                  {trip.driver && (
                    <span className="flex items-center gap-1">
                      <Car className="w-3 h-3" />
                      {trip.driver.firstName} {trip.driver.lastName}
                      {trip.driver.phone && (
                        <span className="text-muted-foreground ml-0.5">{trip.driver.phone}</span>
                      )}
                      {trip.driver.stale && <WifiOff className="w-3 h-3 text-orange-500 ml-0.5" />}
                    </span>
                  )}
                  {!trip.driver && (
                    <span className="flex items-center gap-1 text-orange-600 dark:text-orange-400">
                      <Car className="w-3 h-3" /> Unassigned
                    </span>
                  )}
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {trip.pickupTime || "N/A"}</span>
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-emerald-500" />
                    {trip.pickupAddress ? (trip.pickupAddress.length > 25 ? trip.pickupAddress.substring(0, 25) + "..." : trip.pickupAddress) : "N/A"}
                  </span>
                  <ArrowRight className="w-3 h-3" />
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-red-500" />
                    {trip.dropoffAddress ? (trip.dropoffAddress.length > 25 ? trip.dropoffAddress.substring(0, 25) + "..." : trip.dropoffAddress) : "N/A"}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
                  {trip.driver?.phone && (
                    <Button
                      variant="outline"
                      size="sm"
                      asChild
                      data-testid={`button-call-driver-${trip.tripId}`}
                    >
                      <a href={`tel:${trip.driver.phone}`}>
                        <Phone className="w-3 h-3 mr-1" />
                        Call Driver
                      </a>
                    </Button>
                  )}
                  {trip.patient?.phone && (
                    <Button
                      variant="outline"
                      size="sm"
                      asChild
                      data-testid={`button-call-patient-${trip.tripId}`}
                    >
                      <a href={`tel:${trip.patient.phone}`}>
                        <Phone className="w-3 h-3 mr-1" />
                        Call Patient
                      </a>
                    </Button>
                  )}
                  {!isCancelRequested && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-600 dark:text-red-400 border-red-200 dark:border-red-800"
                      onClick={() => {
                        setCancelTrip(trip);
                        setCancelReason("");
                        setCancelNotes("");
                        setCancelModalOpen(true);
                      }}
                      data-testid={`button-request-cancel-${trip.tripId}`}
                    >
                      <XCircle className="w-3 h-3 mr-1" />
                      Request Cancel
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={cancelModalOpen} onOpenChange={setCancelModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Trip Cancellation</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Trip {cancelTrip?.publicId} for {cancelTrip?.patient?.firstName} {cancelTrip?.patient?.lastName}
            </p>
            <div>
              <Label htmlFor="cancel-reason">Reason (required)</Label>
              <Select value={cancelReason} onValueChange={setCancelReason}>
                <SelectTrigger data-testid="select-cancel-reason">
                  <SelectValue placeholder="Select a reason" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Clinic schedule change">Clinic schedule change</SelectItem>
                  <SelectItem value="Patient not ready">Patient not ready</SelectItem>
                  <SelectItem value="Duplicate request">Duplicate request</SelectItem>
                  <SelectItem value="No longer needed">No longer needed</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="cancel-notes">Additional notes (optional)</Label>
              <Textarea
                id="cancel-notes"
                value={cancelNotes}
                onChange={(e) => setCancelNotes(e.target.value)}
                placeholder="Any additional details..."
                data-testid="input-cancel-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCancelModalOpen(false)}
              data-testid="button-cancel-modal-close"
            >
              Close
            </Button>
            <Button
              variant="destructive"
              disabled={!cancelReason || cancelMutation.isPending}
              onClick={() => {
                if (cancelTrip && cancelReason) {
                  cancelMutation.mutate({
                    tripId: cancelTrip.tripId,
                    reason: cancelReason,
                    notes: cancelNotes,
                  });
                }
              }}
              data-testid="button-submit-cancel-request"
            >
              {cancelMutation.isPending ? "Submitting..." : "Submit Cancel Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
  const opsMapWrapperRef = useRef<HTMLDivElement>(null);
  const opsMapKeyRef = useRef("clinic-ops-map");
  const mapsLoadedRef = useRef(false);
  const [mapAvailable, setMapAvailable] = useState(true);

  interface OpsMapStore {
    map: google.maps.Map;
    container: HTMLDivElement;
    markers: Map<string, google.maps.Marker>;
    polylines: Map<string, google.maps.Polyline>;
    boundsFit: boolean;
  }
  function getOpsMapStore(): OpsMapStore | null {
    return ((window as any).__UCM_MAP__?.[opsMapKeyRef.current]) as OpsMapStore | null;
  }

  function lateStatusColor(lateStatus: string, isOnline: boolean): string {
    if (!isOnline) return "#9ca3af";
    if (lateStatus === "late") return "#ef4444";
    if (lateStatus === "at_risk") return "#eab308";
    return "#22c55e";
  }

  useEffect(() => {
    if (!opsMapWrapperRef.current) return;
    if (activeTrips.length === 0 && !clinic) return;

    if (mapsLoadedRef.current && getOpsMapStore()) {
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
    if (mapsLoadedRef.current && getOpsMapStore()) {
      updateOpsMarkers();
    }
  }, [activeTrips, selectedTrip]);

  function initOpsMap() {
    if (!opsMapWrapperRef.current) return;
    if (getOpsMapStore()) {
      const entry = getOpsMapStore()!;
      if (entry.container.parentNode !== opsMapWrapperRef.current) {
        opsMapWrapperRef.current.appendChild(entry.container);
        google.maps.event.trigger(entry.map, "resize");
      }
      updateOpsMarkers();
      return;
    }
    const center = clinic?.lat && clinic?.lng
      ? { lat: clinic.lat, lng: clinic.lng }
      : { lat: 29.76, lng: -95.36 };
    if (!(window as any).__UCM_MAP__) (window as any).__UCM_MAP__ = {};
    const container = document.createElement("div");
    container.className = "w-full h-full ucm-map-container";
    container.style.minHeight = "300px";
    console.log("MAP INIT clinic-ops-map");
    const map = new google.maps.Map(container, {
      center,
      zoom: 12,
      disableDefaultUI: true,
      zoomControl: true,
      styles: [{ featureType: "poi", stylers: [{ visibility: "off" }] }],
    });
    const entry: OpsMapStore = { map, container, markers: new Map(), polylines: new Map(), boundsFit: false };
    (window as any).__UCM_MAP__[opsMapKeyRef.current] = entry;
    opsMapWrapperRef.current.appendChild(container);
    updateOpsMarkers();
  }

  function updateOpsMarkers() {
    const entry = getOpsMapStore();
    if (!entry) return;
    const map = entry.map;

    const bounds = new google.maps.LatLngBounds();
    const currentKeys = new Set<string>();

    if (clinic?.lat && clinic?.lng) {
      const clinicKey = "clinic-marker";
      currentKeys.add(clinicKey);
      const pos = { lat: clinic.lat, lng: clinic.lng };
      bounds.extend(pos);
      if (!entry.markers.has(clinicKey)) {
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
        entry.markers.set(clinicKey, marker);
      }
    }

    const visibleTrips = activeTrips.filter((t: any) => t.driver?.lastLat && t.driver?.lastLng);
    visibleTrips.forEach(trip => {
      if (!trip.driver?.lastLat || !trip.driver?.lastLng) return;
      const key = `driver-${trip.tripId}`;
      currentKeys.add(key);
      const pos = { lat: trip.driver.lastLat, lng: trip.driver.lastLng };
      bounds.extend(pos);
      const color = trip.stale || trip.driver?.stale ? "#9ca3af" : lateStatusColor(trip.lateStatus || "on_time", trip.driver?.isOnline !== false);

      if (!entry.markers.has(key)) {
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
        entry.markers.set(key, marker);
      } else {
        const existing = entry.markers.get(key)!;
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

    const currentPolyKeys = new Set<string>();
    visibleTrips.forEach(trip => {
      const pKey = `poly-${trip.tripId}`;
      currentPolyKeys.add(pKey);
      if (trip.routePolyline && window.google?.maps?.geometry?.encoding) {
        try {
          const path = google.maps.geometry.encoding.decodePath(trip.routePolyline);
          const isSelected = selectedTrip?.tripId === trip.tripId;
          if (!entry.polylines.has(pKey)) {
            const polyline = new google.maps.Polyline({
              map,
              path,
              strokeColor: isSelected ? "#3b82f6" : "#6366f1",
              strokeWeight: isSelected ? 5 : 3,
              strokeOpacity: isSelected ? 0.9 : 0.5,
              zIndex: isSelected ? 5 : 2,
            });
            entry.polylines.set(pKey, polyline);
          } else {
            const existing = entry.polylines.get(pKey)!;
            existing.setPath(path);
            existing.setOptions({
              strokeColor: isSelected ? "#3b82f6" : "#6366f1",
              strokeWeight: isSelected ? 5 : 3,
              strokeOpacity: isSelected ? 0.9 : 0.5,
              zIndex: isSelected ? 5 : 2,
            });
          }
        } catch {}
      }

      if (trip.pickupLat && trip.pickupLng) {
        const pkKey = `pickup-${trip.tripId}`;
        currentKeys.add(pkKey);
        const pkPos = { lat: Number(trip.pickupLat), lng: Number(trip.pickupLng) };
        bounds.extend(pkPos);
        if (!entry.markers.has(pkKey)) {
          const marker = new google.maps.Marker({
            position: pkPos,
            map,
            icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: "#22c55e", fillOpacity: 1, strokeWeight: 2, strokeColor: "#fff", scale: 7 },
            title: `Pickup - ${trip.publicId}`,
            zIndex: 3,
          });
          marker.addListener("click", () => onSelectTrip(trip));
          entry.markers.set(pkKey, marker);
        } else {
          entry.markers.get(pkKey)!.setPosition(pkPos);
        }
      }

      if (trip.dropoffLat && trip.dropoffLng) {
        const doKey = `dropoff-${trip.tripId}`;
        currentKeys.add(doKey);
        const doPos = { lat: Number(trip.dropoffLat), lng: Number(trip.dropoffLng) };
        bounds.extend(doPos);
        if (!entry.markers.has(doKey)) {
          const marker = new google.maps.Marker({
            position: doPos,
            map,
            icon: { path: google.maps.SymbolPath.CIRCLE, fillColor: "#ef4444", fillOpacity: 1, strokeWeight: 2, strokeColor: "#fff", scale: 7 },
            title: `Dropoff - ${trip.publicId}`,
            zIndex: 3,
          });
          marker.addListener("click", () => onSelectTrip(trip));
          entry.markers.set(doKey, marker);
        } else {
          entry.markers.get(doKey)!.setPosition(doPos);
        }
      }
    });

    entry.polylines.forEach((poly, key) => {
      if (!currentPolyKeys.has(key)) {
        poly.setMap(null);
        entry.polylines.delete(key);
      }
    });

    entry.markers.forEach((marker, key) => {
      if (!currentKeys.has(key)) {
        marker.setMap(null);
        entry.markers.delete(key);
      }
    });

    if (!entry.boundsFit && !bounds.isEmpty() && visibleTrips.length > 0) {
      entry.boundsFit = true;
      map.fitBounds(bounds, 60);
    }
  }

  const clinicRerouteRef = useRef<{ tripId: number; time: number } | null>(null);

  useEffect(() => {
    if (!selectedTrip || !token) return;
    const CLINIC_REROUTE_INTERVAL_MS = 60000;
    const CLINIC_STALE_THRESHOLD_MS = 90000;

    const trip = activeTrips.find((t: any) => t.tripId === selectedTrip.tripId);
    if (!trip) return;

    const driverLastSeen = trip.driver?.lastSeenAt;
    if (!driverLastSeen) return;
    const driverAge = Date.now() - new Date(driverLastSeen).getTime();
    if (driverAge > CLINIC_STALE_THRESHOLD_MS) return;

    if (!trip.driver?.lastLat || !trip.driver?.lastLng) return;

    const last = clinicRerouteRef.current;
    if (last && last.tripId === selectedTrip.tripId && (Date.now() - last.time) < CLINIC_REROUTE_INTERVAL_MS) return;

    const etaAge = trip.lastEtaUpdatedAt ? Date.now() - new Date(trip.lastEtaUpdatedAt).getTime() : Infinity;
    if (etaAge < CLINIC_REROUTE_INTERVAL_MS) return;

    clinicRerouteRef.current = { tripId: selectedTrip.tripId, time: Date.now() };
    fetch(`/api/trips/${trip.tripId}/route/recompute`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ originLat: trip.driver.lastLat, originLng: trip.driver.lastLng }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.ok) {
          queryClient.invalidateQueries({ queryKey: ["/api/clinic/active-trips"] });
        }
      })
      .catch(() => {});
  }, [selectedTrip?.tripId, activeTrips, token]);

  const hasDrivers = activeTrips.some(t => t.driver?.lastLat && t.driver?.lastLng);

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <MapIcon className="w-4 h-4 text-blue-500" />
        <h3 className="text-sm font-semibold" data-testid="text-ops-map-title">Active Trips Map</h3>
        <Badge variant="secondary">{activeTrips.length} trip{activeTrips.length !== 1 ? "s" : ""}</Badge>
      </div>
      <div className="relative">
        <div
          ref={opsMapWrapperRef}
          className="w-full h-64 sm:h-80 rounded-md border bg-muted"
          data-testid="div-ops-map"
          style={{ display: mapAvailable && (hasDrivers || (clinic?.lat && clinic?.lng)) ? "block" : "none" }}
        />
      </div>
      {!mapAvailable ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            <MapPinned className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p>Map not available</p>
          </CardContent>
        </Card>
      ) : !hasDrivers && activeTrips.length > 0 ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground" data-testid="text-ops-map-hidden">
            <MapPinned className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p>Waiting for driver locations</p>
            <p className="text-xs mt-1">{activeTrips.length} active trip{activeTrips.length !== 1 ? "s" : ""}</p>
          </CardContent>
        </Card>
      ) : null}
      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-blue-500 inline-block" /> Clinic</span>
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
  const [, navigateTrips] = useLocation();
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
    refetchInterval: 60000,
  });

  const tripDetailQuery = useQuery<any>({
    queryKey: ["/api/clinic/trips", selectedTripId],
    queryFn: () => apiFetch(`/api/clinic/trips/${selectedTripId}`, token),
    enabled: !!token && !!selectedTripId,
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
              onSelect={() => {
                const isTerminal = ["COMPLETED", "CANCELLED", "NO_SHOW"].includes(trip.status);
                if (isTerminal) {
                  navigateTrips(`/clinic-trip/${trip.id}`);
                } else {
                  setSelectedTripId(trip.id);
                }
              }}
              onTrack={ACTIVE_TRIP_STATUSES.includes(trip.status) ? () => setTrackingTripId(trip.id) : undefined}
            />
          ))}
        </div>
      )}

      <Dialog open={!!selectedTripId} onOpenChange={(open) => { if (!open) setSelectedTripId(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
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
              <Skeleton className="h-24 w-full" />
            </div>
          ) : tripDetailQuery.data ? (
            <ClinicTripDetailsView trip={tripDetailQuery.data} token={token} />
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
            token={token}
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
    const ok = await downloadWithAuth(
      `/api/clinic/trips/export?startDate=${startDate}&endDate=${endDate}`,
      `performance_${startDate}_to_${endDate}.csv`,
      "text/csv; charset=utf-8",
      rawAuthFetch,
      (msg) => toast({ title: "Export failed", description: msg, variant: "destructive" }),
    );
    if (ok) toast({ title: "Export downloaded" });
    setExporting(false);
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
          <ClinicPatientForm loading={createMutation.isPending} onSubmit={(data) => createMutation.mutate(data)} token={token} />
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
              token={token}
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
    const ok = await downloadWithAuth(
      `/api/clinic/trips/export?startDate=${startDate}&endDate=${endDate}`,
      `trips_${startDate}_to_${endDate}.csv`,
      "text/csv; charset=utf-8",
      rawAuthFetch,
      (msg) => toast({ title: "Export failed", description: msg, variant: "destructive" }),
    );
    if (ok) toast({ title: "Export downloaded" });
    setExporting(false);
  };

  const handleWeeklySummaryExport = async () => {
    setExporting(true);
    const sd = sevenDaysAgoStr();
    const ed = todayStr();
    const ok = await downloadWithAuth(
      `/api/clinic/trips/export?startDate=${sd}&endDate=${ed}`,
      `weekly_summary_${sd}_to_${ed}.csv`,
      "text/csv; charset=utf-8",
      rawAuthFetch,
      (msg) => toast({ title: "Export failed", description: msg, variant: "destructive" }),
    );
    if (ok) toast({ title: "Weekly summary downloaded" });
    setExporting(false);
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
  const trackingWrapperRef = useRef<HTMLDivElement>(null);
  const trackingMapKeyRef = useRef(`clinic-tracking-${tripId}`);
  const mapsLoadedRef = useRef(false);
  const [mapAvailable, setMapAvailable] = useState(true);

  interface ClinicTrackingMapStore {
    map: google.maps.Map;
    container: HTMLDivElement;
    driverMarker: google.maps.Marker | null;
    pickupMarker: google.maps.Marker | null;
    dropoffMarker: google.maps.Marker | null;
    polyline: google.maps.Polyline | null;
    boundsFit: boolean;
  }
  function getTrackingStore(): ClinicTrackingMapStore | null {
    return ((window as any).__UCM_MAP__?.[trackingMapKeyRef.current]) as ClinicTrackingMapStore | null;
  }

  const handleWsDriverLocation = useCallback((locData: { lat: number; lng: number }) => {
    queryClient.setQueryData(["/api/clinic/trips", tripId, "tracking"], (old: any) => {
      if (!old) return old;
      return {
        ...old,
        driver: { ...old.driver, lat: locData.lat, lng: locData.lng, updated_at: new Date().toISOString() },
      };
    });
  }, [tripId]);

  const handleWsStatusChange = useCallback((statusData: { status: string }) => {
    queryClient.invalidateQueries({ queryKey: ["/api/clinic/trips", tripId, "tracking"] });
    queryClient.invalidateQueries({ queryKey: ["/api/clinic/trips"] });
    queryClient.invalidateQueries({ queryKey: ["/api/clinic/active-trips"] });
  }, [tripId]);

  const handleWsEtaUpdate = useCallback((etaData: { minutes: number; distanceMiles: number }) => {
    queryClient.setQueryData(["/api/clinic/trips", tripId, "tracking"], (old: any) => {
      if (!old) return old;
      return {
        ...old,
        eta: { ...old.eta, minutes: etaData.minutes, distance_text: `${etaData.distanceMiles} mi`, updated_at: new Date().toISOString() },
      };
    });
  }, [tripId]);

  const { connected: wsConnected, debugInfo: wsDebugInfo } = useTripRealtime({
    tripId,
    authToken: token,
    onDriverLocation: handleWsDriverLocation,
    onStatusChange: handleWsStatusChange,
    onEtaUpdate: handleWsEtaUpdate,
  });

  const trackingQuery = useQuery<any>({
    queryKey: ["/api/clinic/trips", tripId, "tracking"],
    queryFn: () => apiFetch(`/api/clinic/trips/${tripId}/tracking`, token),
    enabled: !!token && !!tripId,
    refetchInterval: wsConnected ? false : 10000,
  });

  const data = trackingQuery.data;

  useEffect(() => {
    if (!data?.driver?.lat || !trackingWrapperRef.current) return;
    if (data.completed) return;

    if (mapsLoadedRef.current) {
      updateMapMarkers(data);
      return;
    }

    if (window.google?.maps) {
      mapsLoadedRef.current = true;
      initMap(data);
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
    if (!trackingWrapperRef.current || !trackingData.driver) return;

    if (!(window as any).__UCM_MAP__) (window as any).__UCM_MAP__ = {};
    const store = (window as any).__UCM_MAP__ as Record<string, any>;
    let entry = store[trackingMapKeyRef.current] as ClinicTrackingMapStore | undefined;

    if (!entry) {
      const driverPos = { lat: trackingData.driver.lat, lng: trackingData.driver.lng };
      const container = document.createElement("div");
      container.className = "w-full h-full ucm-map-container";
      container.style.minHeight = "256px";
      console.log("MAP INIT clinic-tracking");
      const map = new google.maps.Map(container, {
        center: driverPos,
        zoom: 13,
        disableDefaultUI: true,
        zoomControl: true,
        styles: [
          { featureType: "poi", stylers: [{ visibility: "off" }] },
        ],
      });
      entry = { map, container, driverMarker: null, pickupMarker: null, dropoffMarker: null, polyline: null, boundsFit: false };
      store[trackingMapKeyRef.current] = entry;
      trackingWrapperRef.current.appendChild(container);
    } else {
      if (entry.container.parentNode !== trackingWrapperRef.current) {
        trackingWrapperRef.current.appendChild(entry.container);
        google.maps.event.trigger(entry.map, "resize");
      }
    }
    updateMapMarkers(trackingData);
  }

  function updateMapMarkers(trackingData: any) {
    const entry = getTrackingStore();
    if (!entry || !trackingData.driver) return;
    const map = entry.map;
    const driverPos = { lat: trackingData.driver.lat, lng: trackingData.driver.lng };
    const vColor = trackingData.driver.vehicleColor || "#3b82f6";

    if (entry.driverMarker) {
      entry.driverMarker.setPosition(driverPos);
    } else {
      entry.driverMarker = new google.maps.Marker({
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
      if (!entry.pickupMarker) {
        entry.pickupMarker = new google.maps.Marker({
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
      if (!entry.dropoffMarker) {
        entry.dropoffMarker = new google.maps.Marker({
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

    if (route?.routePolyline && window.google?.maps?.geometry?.encoding) {
      try {
        const path = google.maps.geometry.encoding.decodePath(route.routePolyline);
        if (!entry.polyline) {
          entry.polyline = new google.maps.Polyline({
            map,
            path,
            strokeColor: "#3b82f6",
            strokeWeight: 5,
            strokeOpacity: 0.8,
            zIndex: 2,
          });
        } else {
          entry.polyline.setPath(path);
        }
      } catch {}
    } else if (entry.polyline) {
      entry.polyline.setMap(null);
      entry.polyline = null;
    }

    if (!entry.boundsFit) {
      entry.boundsFit = true;
      const bounds = new google.maps.LatLngBounds();
      bounds.extend(driverPos);
      if (route?.pickupLat && route?.pickupLng) bounds.extend({ lat: route.pickupLat, lng: route.pickupLng });
      if (route?.dropoffLat && route?.dropoffLng) bounds.extend({ lat: route.dropoffLat, lng: route.dropoffLng });
      map.fitBounds(bounds, 60);
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

      <div className="relative">
        <div ref={trackingWrapperRef} className="w-full h-64 sm:h-80 bg-muted" data-testid="div-tracking-map" style={{ display: hasDriverLocation && mapAvailable ? "block" : "none" }} />
        <RealtimeDebugPanel
          debugInfo={wsDebugInfo}
          pollingActive={!wsConnected}
          pollingIntervalMs={wsConnected ? false : 10000}
          tripId={tripId}
        />
      </div>
      {!hasDriverLocation && (
        <div className="w-full h-48 bg-muted flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <MapPinned className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">{driver && !data.driverVisible ? "Driver location visible when ETA is under 15 min" : "Driver location not available yet"}</p>
          </div>
        </div>
      )}
      {hasDriverLocation && !mapAvailable && (
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

function CreateTripForm({ patients, clinic, loading, onSubmit, token }: {
  patients: any[];
  clinic: any;
  loading: boolean;
  onSubmit: (data: any) => void;
  token: string | null;
}) {
  const [form, setForm] = useState({
    patientId: "",
    scheduledDate: todayStr(),
    pickupTime: "09:00",
    estimatedArrivalTime: "10:00",
    tripType: "one_time",
    notes: "",
    direction: "" as "" | "to_clinic" | "from_clinic",
    roundTrip: false,
    returnPickupTime: "",
  });

  const [pickupAddr, setPickupAddr] = useState<StructuredAddress | null>(null);
  const [dropoffAddr, setDropoffAddr] = useState<StructuredAddress | null>(
    clinic?.address ? { formattedAddress: clinic.address, street: "", city: "", state: "", zip: clinic.addressZip || "", lat: clinic.lat || 0, lng: clinic.lng || 0, placeId: clinic.placeId || undefined } : null
  );

  const isDialysis = form.tripType === "dialysis";
  const roundTripLocked = isDialysis;
  const roundTripEnabled = isDialysis ? true : form.roundTrip;

  const selectedPatient = patients.find(p => p.id === Number(form.patientId));

  const handlePatientChange = (val: string) => {
    const patient = patients.find(p => p.id === Number(val));
    setForm({ ...form, patientId: val });
    if (patient?.address && !pickupAddr) {
      setPickupAddr({
        formattedAddress: patient.address,
        street: "", city: "", state: "",
        zip: patient.addressZip || "",
        lat: patient.lat || 0,
        lng: patient.lng || 0,
        placeId: patient.placeId || undefined,
      });
    }
  };

  const handleTripTypeChange = (v: string) => {
    if (v === "dialysis") {
      setForm({ ...form, tripType: v, roundTrip: true });
    } else {
      setForm({ ...form, tripType: v });
    }
  };

  const patientAddr = pickupAddr?.formattedAddress || selectedPatient?.address || "TBD";
  const patientLat = pickupAddr?.lat || selectedPatient?.lat || null;
  const patientLng = pickupAddr?.lng || selectedPatient?.lng || null;
  const patientZip = pickupAddr?.zip || selectedPatient?.addressZip || "00000";
  const clinicAddr = dropoffAddr?.formattedAddress || clinic?.address || "TBD";
  const clinicLat = dropoffAddr?.lat || clinic?.lat || null;
  const clinicLng = dropoffAddr?.lng || clinic?.lng || null;
  const clinicZip = dropoffAddr?.zip || clinic?.addressZip || "00000";

  function buildTrip(dir: "to_clinic" | "from_clinic", pickupTime: string, arrivalTime: string) {
    const isTo = dir === "to_clinic";
    return {
      patientId: Number(form.patientId),
      cityId: clinic?.cityId,
      clinicId: clinic?.id,
      scheduledDate: form.scheduledDate,
      scheduledTime: pickupTime,
      pickupTime,
      estimatedArrivalTime: arrivalTime,
      pickupAddress: isTo ? patientAddr : clinicAddr,
      pickupLat: isTo ? patientLat : clinicLat,
      pickupLng: isTo ? patientLng : clinicLng,
      pickupZip: isTo ? patientZip : clinicZip,
      dropoffAddress: isTo ? clinicAddr : patientAddr,
      dropoffLat: isTo ? clinicLat : patientLat,
      dropoffLng: isTo ? clinicLng : patientLng,
      dropoffZip: isTo ? clinicZip : patientZip,
      tripType: form.tripType,
      status: "SCHEDULED",
      notes: form.notes,
    };
  }

  const canSubmit = form.patientId
    && form.direction
    && (!roundTripEnabled || form.returnPickupTime);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    const outbound = buildTrip(form.direction as "to_clinic" | "from_clinic", form.pickupTime, form.estimatedArrivalTime);
    onSubmit(outbound);

    if (roundTripEnabled && form.returnPickupTime) {
      const returnDir = form.direction === "to_clinic" ? "from_clinic" : "to_clinic";
      const returnTrip = buildTrip(returnDir, form.returnPickupTime, "");
      setTimeout(() => onSubmit(returnTrip), 300);
    }
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
          <Label>Trip Type *</Label>
          <Select value={form.tripType} onValueChange={handleTripTypeChange}>
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

      <div className="space-y-2">
        <Label>Direction *</Label>
        <Select value={form.direction} onValueChange={v => setForm({ ...form, direction: v as any })}>
          <SelectTrigger data-testid="select-trip-direction">
            <SelectValue placeholder="Select direction" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="to_clinic">To Clinic (Patient Home → Clinic)</SelectItem>
            <SelectItem value="from_clinic">From Clinic (Clinic → Patient Home)</SelectItem>
          </SelectContent>
        </Select>
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

      <AddressAutocomplete
        label="Pickup Address"
        value={pickupAddr}
        onSelect={setPickupAddr}
        token={token}
        testIdPrefix="trip-pickup"
        required
      />
      <AddressAutocomplete
        label="Dropoff Address"
        value={dropoffAddr}
        onSelect={setDropoffAddr}
        token={token}
        testIdPrefix="trip-dropoff"
        required
      />

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label className="flex items-center gap-2">
            <Repeat className="w-3.5 h-3.5" />
            Round-Trip
          </Label>
          <Button
            type="button"
            size="sm"
            variant={roundTripEnabled ? "default" : "outline"}
            disabled={roundTripLocked}
            onClick={() => { if (!roundTripLocked) setForm({ ...form, roundTrip: !form.roundTrip }); }}
            data-testid="button-toggle-round-trip"
            className="toggle-elevate"
          >
            {roundTripEnabled ? "Enabled" : "Disabled"}
            {roundTripLocked && <Lock className="w-3 h-3 ml-1" />}
          </Button>
        </div>
        {isDialysis && (
          <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1" data-testid="text-dialysis-round-trip-notice">
            <AlertTriangle className="w-3 h-3 flex-shrink-0" />
            Dialysis trips always require return transportation.
          </p>
        )}
      </div>

      {roundTripEnabled && (
        <div className="space-y-2 p-3 rounded-md border bg-muted/50">
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <ArrowRight className="w-3 h-3" />
            Return Trip ({form.direction === "to_clinic" ? "Clinic → Patient Home" : "Patient Home → Clinic"})
          </p>
          <div className="space-y-2">
            <Label>Return Pickup Time *</Label>
            <Input
              type="time"
              value={form.returnPickupTime}
              onChange={e => setForm({ ...form, returnPickupTime: e.target.value })}
              required
              data-testid="input-trip-return-pickup-time"
            />
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label>Notes</Label>
        <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Additional notes..." data-testid="input-trip-notes" />
      </div>
      <Button type="submit" className="w-full" disabled={loading || !canSubmit} data-testid="button-submit-trip">
        {loading ? "Submitting..." : roundTripEnabled ? "Submit Round-Trip Request" : "Submit Trip Request"}
      </Button>
      <p className="text-xs text-muted-foreground text-center">
        {roundTripEnabled ? "Two trips (outbound + return) will be created" : "Trip requests require dispatch approval before scheduling"}
      </p>
    </form>
  );
}

function ClinicPatientForm({ onSubmit, loading, initialData, isEdit, token }: {
  onSubmit: (data: any) => void;
  loading: boolean;
  initialData?: any;
  isEdit?: boolean;
  token: string | null;
}) {
  const [form, setForm] = useState({
    firstName: initialData?.firstName || "",
    lastName: initialData?.lastName || "",
    phone: initialData?.phone || "",
    email: initialData?.email || "",
    dateOfBirth: initialData?.dateOfBirth || "",
    insuranceId: initialData?.insuranceId || "",
    notes: initialData?.notes || "",
  });

  const [patientAddr, setPatientAddr] = useState<StructuredAddress | null>(
    initialData?.address ? { formattedAddress: initialData.address, street: "", city: "", state: "", zip: initialData.addressZip || "", lat: initialData.lat || 0, lng: initialData.lng || 0, placeId: initialData.placeId || undefined } : null
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      firstName: form.firstName,
      lastName: form.lastName,
      phone: form.phone,
      email: form.email.trim() || null,
      address: patientAddr?.formattedAddress || "",
      addressZip: patientAddr?.zip || "",
      lat: patientAddr?.lat || null,
      lng: patientAddr?.lng || null,
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
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Phone</Label>
          <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} data-testid="input-clinic-patient-phone" />
        </div>
        <div className="space-y-2">
          <Label>Email</Label>
          <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="Optional" data-testid="input-clinic-patient-email" />
        </div>
      </div>
      <AddressAutocomplete
        label="Address"
        value={patientAddr}
        onSelect={setPatientAddr}
        token={token}
        testIdPrefix="clinic-patient-address"
      />
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
      className="cursor-pointer hover-elevate active-elevate-2"
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); } }}
      data-testid={`card-clinic-trip-${trip.id}`}
    >
      <CardContent className="py-3 px-4 min-h-[44px]">
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

const INVOICE_ROLES = ["SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"];

function InvoicePanel({ tripId, tripStatus }: { tripId: number; tripStatus: string }) {
  const { token, user } = useAuth();
  const { toast } = useToast();
  const [pdfLoading, setPdfLoading] = useState(false);

  const TERMINAL_STATUSES = ["COMPLETED", "CANCELLED", "NO_SHOW"];
  const isTerminal = TERMINAL_STATUSES.includes(tripStatus);
  const isBillable = tripStatus === "COMPLETED";
  const isClinicUser = user?.role === "CLINIC_USER";

  const invoiceQuery = useQuery<any>({
    queryKey: ["/api/trips", tripId, "invoice"],
    queryFn: () => apiFetch(`/api/trips/${tripId}/invoice`, token),
    enabled: !!token && !!tripId && isBillable,
  });

  const handleDownloadPdf = async () => {
    const inv = invoiceQuery.data?.invoice;
    if (!inv) return;
    setPdfLoading(true);
    await downloadWithAuth(`/api/invoices/${inv.id}/pdf`, `invoice-${inv.id}.pdf`, "application/pdf", (u, i) => rawAuthFetch(u, { ...i, method: "POST" }), (msg) => toast({ title: "Error", description: msg, variant: "destructive" }));
    setPdfLoading(false);
  };

  if (!isTerminal) return null;

  if (!isBillable) {
    return (
      <Card>
        <CardContent className="py-3 px-4 flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground" data-testid="text-invoice-not-billable">
            Trip not billable. No invoice.
          </span>
        </CardContent>
      </Card>
    );
  }

  if (invoiceQuery.isLoading) {
    return <Skeleton className="h-16 w-full" />;
  }

  const invoice = invoiceQuery.data?.invoice;

  if (!invoice) {
    return (
      <Card>
        <CardContent className="py-3 px-4 flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground" data-testid="text-invoice-not-generated">
            Invoice not generated yet.
          </span>
        </CardContent>
      </Card>
    );
  }

  const statusColors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    approved: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    paid: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  };

  return (
    <Card>
      <CardContent className="py-3 px-4 space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span className="text-sm font-medium">Invoice</span>
            <Badge className={statusColors[invoice.status] || ""} data-testid="badge-invoice-status">
              {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
            </Badge>
          </div>
          <span className="text-lg font-bold" data-testid="text-invoice-amount">
            ${parseFloat(invoice.amount).toFixed(2)}
          </span>
        </div>
        <div className="text-xs text-muted-foreground space-y-0.5">
          <div className="flex items-center gap-3 flex-wrap">
            <span data-testid="text-invoice-patient">{invoice.patientName}</span>
            <span data-testid="text-invoice-service-date">{invoice.serviceDate}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={handleDownloadPdf}
            disabled={pdfLoading}
            data-testid="button-download-invoice"
          >
            <FileText className="w-3 h-3" />
            {pdfLoading ? "Generating..." : "Download PDF"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ClinicTripDetailsView({ trip, token }: { trip: any; token: string | null }) {
  const { toast } = useToast();
  const [pdfLoading, setPdfLoading] = useState(false);
  const isTerminal = ["COMPLETED", "CANCELLED", "NO_SHOW"].includes(trip.status);

  const formatDate = (dateStr: string | null | undefined): string => {
    if (!dateStr) return "";
    try {
      const [y, m, d] = dateStr.split("-").map(Number);
      return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    } catch { return dateStr || ""; }
  };

  const fmtTimestamp = (isoStr: string | Date | null | undefined): string => {
    if (!isoStr) return "\u2014";
    try {
      const d = new Date(isoStr as string);
      if (isNaN(d.getTime())) return "\u2014";
      return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    } catch { return "\u2014"; }
  };

  const fmtPickupTime = (t: string | null | undefined): string => {
    if (!t) return "\u2014";
    try {
      const [h, m] = t.split(":").map(Number);
      return new Date(2000, 0, 1, h, m).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
    } catch { return t; }
  };

  const handleDownloadPdf = async () => {
    if (!token || !trip.id) return;
    setPdfLoading(true);
    await downloadWithAuth(`/api/clinic/trips/${trip.id}/pdf`, `trip-${trip.publicId || trip.id}.pdf`, "application/pdf", rawAuthFetch, (msg) => toast({ title: "Error", description: msg || "Failed to download PDF", variant: "destructive" }));
    setPdfLoading(false);
  };

  const outcomeColor = STATUS_COLORS[trip.status] || "";
  const serviceLabel = trip.mobilityRequirement === "WHEELCHAIR" ? "Wheelchair" : "Sedan";

  const FULL_TIMELINE: { label: string; value: string; reason?: string }[] = [
    { label: "Scheduled Pickup", value: fmtPickupTime(trip.pickupTime) },
    { label: "Scheduled Dropoff (ETA)", value: fmtPickupTime(trip.estimatedArrivalTime) },
    { label: "Created", value: fmtTimestamp(trip.createdAt) },
    { label: "Approved", value: fmtTimestamp(trip.approvedAt) },
    { label: "Assigned to Driver", value: fmtTimestamp(trip.assignedAt) },
    { label: "Driver Accepted", value: fmtTimestamp(trip.acceptedAt) },
    { label: "En Route to Pickup", value: fmtTimestamp(trip.startedAt) },
    { label: "Arrived at Pickup", value: fmtTimestamp(trip.arrivedPickupAt) },
    { label: "Picked Up", value: fmtTimestamp(trip.pickedUpAt) },
    { label: "En Route to Dropoff", value: fmtTimestamp(trip.enRouteDropoffAt) },
    { label: "Arrived at Dropoff", value: fmtTimestamp(trip.arrivedDropoffAt) },
  ];
  if (trip.status === "COMPLETED") {
    FULL_TIMELINE.push({ label: "Completed", value: fmtTimestamp(trip.completedAt) });
  } else if (trip.status === "CANCELLED") {
    FULL_TIMELINE.push({ label: "Cancelled", value: fmtTimestamp(trip.cancelledAt), reason: trip.cancelledReason || undefined });
  } else if (trip.status === "NO_SHOW") {
    FULL_TIMELINE.push({ label: "No-Show", value: fmtTimestamp(trip.cancelledAt), reason: trip.cancelledReason || undefined });
  } else {
    FULL_TIMELINE.push({ label: "Completed", value: "\u2014" });
  }

  return (
    <div className="space-y-4" data-testid="clinic-trip-details">
      {(trip.staticMapFullUrl || trip.staticMapThumbUrl) && (
        <div className="rounded-md overflow-hidden border">
          <img
            src={trip.staticMapFullUrl || trip.staticMapThumbUrl}
            alt="Route map"
            className="w-full h-auto"
            data-testid="img-route-map"
          />
        </div>
      )}

      <div className="space-y-1">
        <p className="text-base font-semibold" data-testid="text-trip-date">
          {formatDate(trip.scheduledDate)} {trip.pickupTime ? `\u2014 ${fmtPickupTime(trip.pickupTime)}` : ""}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-muted-foreground" data-testid="text-trip-id">Trip ID: {trip.publicId}</span>
          <Badge className={outcomeColor} data-testid="badge-trip-outcome">
            {STATUS_LABELS[trip.status] || trip.status}
          </Badge>
        </div>
      </div>

      <Card>
        <CardContent className="py-3 px-4 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Trip Information</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            {trip.patientName && (
              <>
                <span className="text-muted-foreground">Patient</span>
                <span className="font-medium" data-testid="text-patient-name">{trip.patientName}</span>
              </>
            )}
            {trip.clinicName && (
              <>
                <span className="text-muted-foreground">Clinic</span>
                <span data-testid="text-clinic-name">{trip.clinicName}</span>
              </>
            )}
            {trip.cityName && (
              <>
                <span className="text-muted-foreground">City</span>
                <span data-testid="text-city-name">{trip.cityName}</span>
              </>
            )}
            <span className="text-muted-foreground">Service Type</span>
            <span data-testid="text-service-type">{serviceLabel}</span>
            {trip.passengerCount > 1 && (
              <>
                <span className="text-muted-foreground">Passengers</span>
                <span data-testid="text-passenger-count">{trip.passengerCount}</span>
              </>
            )}
            {trip.wheelchairRequired && (
              <>
                <span className="text-muted-foreground">Special Needs</span>
                <span className="flex items-center gap-1" data-testid="text-special-needs">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  Wheelchair Required
                </span>
              </>
            )}
          </div>
          {trip.patientNotes && (
            <p className="text-xs text-muted-foreground mt-1" data-testid="text-patient-notes">
              Patient Notes: {trip.patientNotes}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-3 px-4 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Route</p>
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-[10px] font-bold text-white">A</span>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pickup</p>
                <p className="text-sm" data-testid="text-pickup-address">{trip.pickupAddress || "\u2014"}</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-[10px] font-bold text-white">B</span>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Dropoff</p>
                <p className="text-sm" data-testid="text-dropoff-address">{trip.dropoffAddress || "\u2014"}</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4 flex-wrap text-sm mt-1">
            <span className="flex items-center gap-1" data-testid="text-distance">
              <Navigation className="w-3.5 h-3.5 text-blue-500" />
              {trip.distanceMiles != null ? `${parseFloat(trip.distanceMiles).toFixed(1)} miles` : "\u2014"}
            </span>
            {trip.durationMinutes != null && (
              <span className="flex items-center gap-1" data-testid="text-duration">
                <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                {trip.durationMinutes} min est.
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {!isTerminal && trip.driverId && (
        <ClinicLiveTracking tripId={trip.id} token={token} />
      )}

      <Card>
        <CardContent className="py-3 px-4 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Full Timeline</p>
          <div className="space-y-1">
            {FULL_TIMELINE.map((evt, idx) => {
              const isDash = evt.value === "\u2014";
              const isNegative = evt.label === "Cancelled" || evt.label === "No-Show";
              return (
                <div key={idx} data-testid={`timeline-row-${idx}`}>
                  <div className={`flex items-center justify-between gap-2 py-1 px-2 rounded text-sm ${
                    isNegative ? "text-destructive" : isDash ? "text-muted-foreground" : ""
                  }`}>
                    <div className="flex items-center gap-2">
                      {isDash ? (
                        <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/30 flex-shrink-0" />
                      ) : isNegative ? (
                        <XCircle className="w-4 h-4 text-destructive flex-shrink-0" />
                      ) : (
                        <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                      )}
                      <span>{evt.label}</span>
                    </div>
                    <span className={`text-xs tabular-nums flex-shrink-0 ${isDash ? "text-muted-foreground/50" : isNegative ? "text-destructive/70" : "text-muted-foreground"}`}>
                      {evt.value}
                    </span>
                  </div>
                  {evt.reason && (
                    <p className="text-xs text-muted-foreground pl-8 mt-0.5">Reason: {evt.reason}</p>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-3 px-4 space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Driver & Vehicle</p>
          {trip.driverName ? (
            <>
              <p className="text-sm font-medium flex items-center gap-1" data-testid="text-driver-name">
                <User className="w-3.5 h-3.5" />
                {trip.driverName}
              </p>
              {(trip.vehicleLabel || trip.vehicleColor) && (
                <p className="text-sm text-muted-foreground flex items-center gap-1" data-testid="text-vehicle-info">
                  <Car className="w-3.5 h-3.5" />
                  {[trip.vehicleColor, trip.vehicleMake, trip.vehicleModel].filter(Boolean).join(" ") || ""}
                  {trip.vehicleLabel && ` (${trip.vehicleLabel})`}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="text-driver-unassigned">Unassigned</p>
          )}
        </CardContent>
      </Card>

      {trip.billingOutcome && (
        <Card>
          <CardContent className="py-3 px-4 space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Billing</p>
            <p className="text-sm" data-testid="text-billing-outcome">Outcome: {trip.billingOutcome}</p>
            {trip.billingReason && (
              <p className="text-sm text-muted-foreground" data-testid="text-billing-reason">Reason: {trip.billingReason}</p>
            )}
          </CardContent>
        </Card>
      )}

      {trip.cancelledReason && (
        <Card>
          <CardContent className="py-3 px-4 space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Cancellation</p>
            <p className="text-sm" data-testid="text-cancel-reason">{trip.cancelledReason}</p>
          </CardContent>
        </Card>
      )}

      {isTerminal && (
        <ClinicSignatureSection tripId={trip.id} token={token} />
      )}

      {isTerminal && (
        <div className="text-center">
          <Badge variant="secondary" className="gap-1">
            <Lock className="w-3 h-3" />
            This trip is completed and locked
          </Badge>
        </div>
      )}

      <Button
        className="w-full gap-2"
        variant="outline"
        onClick={handleDownloadPdf}
        disabled={pdfLoading}
        data-testid="button-download-trip-pdf"
      >
        <Download className="w-4 h-4" />
        {pdfLoading ? "Generating PDF..." : "Download PDF Report"}
      </Button>
    </div>
  );
}

function ClinicSignatureSection({ tripId, token }: { tripId: number; token: string | null }) {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  const sigQuery = useQuery<any>({
    queryKey: ["/api/trips", tripId, "signature"],
    queryFn: async () => {
      if (!token) return null;
      const res = await apiFetch(`/api/trips/${tripId}/signature`, token);
      return res;
    },
    enabled: !!token,
  });

  const handleSave = async (dataUrl: string) => {
    if (!token) return;
    setSubmitting(true);
    try {
      await apiFetch(`/api/trips/${tripId}/signature/clinic`, token, {
        method: "POST",
        body: JSON.stringify({ signature: dataUrl }),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/trips", tripId, "signature"] });
      toast({ title: "Signature saved" });
    } catch (err: any) {
      toast({ title: "Error", description: err?.message || "Failed to save signature", variant: "destructive" });
    }
    setSubmitting(false);
  };

  const data = sigQuery.data;

  return (
    <Card>
      <CardContent className="py-3 px-4 space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Signatures</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          <span className="text-muted-foreground">Driver</span>
          <span data-testid="text-driver-signed">
            {data?.driverSigned ? (
              <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <CheckCircle className="w-3.5 h-3.5" />
                Signed {data.driverSignedAt ? new Date(data.driverSignedAt).toLocaleDateString() : ""}
              </span>
            ) : (
              <span className="text-muted-foreground">Not signed</span>
            )}
          </span>
          <span className="text-muted-foreground">Clinic</span>
          <span data-testid="text-clinic-signed">
            {data?.clinicSigned ? (
              <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <CheckCircle className="w-3.5 h-3.5" />
                Signed {data.clinicSignedAt ? new Date(data.clinicSignedAt).toLocaleDateString() : ""}
              </span>
            ) : (
              <span className="text-muted-foreground">Not signed</span>
            )}
          </span>
        </div>
        {!data?.clinicSigned && (
          <div className="pt-2">
            {submitting ? (
              <div className="text-sm text-muted-foreground">Saving...</div>
            ) : (
              <SignaturePad
                label="Clinic Signature"
                onSave={handleSave}
                height={100}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TripDetail({ trip, onTrack }: { trip: any; onTrack: () => void }) {
  const { user } = useAuth();
  const isCompleted = trip.status === "COMPLETED" || trip.status === "CANCELLED" || trip.status === "NO_SHOW";
  const isActive = ACTIVE_TRIP_STATUSES.includes(trip.status);
  const currentStepIndex = TRIP_PROGRESS_STEPS.findIndex((s) => s.key === trip.status);
  const TERMINAL = ["COMPLETED", "CANCELLED", "NO_SHOW"];
  const canSeeInvoice = user && (INVOICE_ROLES.includes(user.role) || user.role === "CLINIC_USER") && TERMINAL.includes(trip.status);

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

        <TripDateTimeHeader trip={trip} />

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

        <TripMetricsCard trip={trip} />

        <div className="flex items-center gap-4 text-sm flex-wrap">
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

      <TripProgressTimeline trip={trip} showHeader={false} showMetrics={false} />

      {trip.notes && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">Notes</p>
          <p className="text-sm">{trip.notes}</p>
        </div>
      )}

      {canSeeInvoice && (
        <InvoicePanel tripId={trip.id} tripStatus={trip.status} />
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

function ClinicLiveTracking({ tripId, token }: { tripId: number; token: string | null }) {
  const liveQuery = useQuery<{
    ok: boolean;
    driver_location: { lat: number; lng: number; last_update_seconds_ago: number; gps_stale: boolean; stale_reason: string | null } | null;
    driver_name: string | null;
    eta: { minutes: number; distance_miles: number | null; destination: string; source: string } | null;
    trip_status: string;
    gps_stale: boolean;
    hide_eta: boolean;
  }>({
    queryKey: ["/api/trips", tripId, "live"],
    queryFn: () => apiFetch(`/api/trips/${tripId}/live`, token),
    enabled: !!token && !!tripId,
    refetchInterval: 15000,
  });

  const data = liveQuery.data;
  if (liveQuery.isLoading) {
    return (
      <Card>
        <CardContent className="py-3 px-4">
          <div className="flex items-center gap-2">
            <Satellite className="w-4 h-4 text-muted-foreground animate-pulse" />
            <span className="text-sm text-muted-foreground">Loading live tracking...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data?.ok || !data.driver_location) {
    return (
      <Card>
        <CardContent className="py-3 px-4">
          <div className="flex items-center gap-2">
            <WifiOff className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Driver location not available</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const loc = data.driver_location;
  const eta = data.eta;

  const formatLastSeen = (seconds: number): string => {
    if (seconds < 10) return "Just now";
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  };

  return (
    <Card data-testid="card-live-tracking">
      <CardContent className="py-3 px-4 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Satellite className="w-3.5 h-3.5" />
            Live Tracking
          </p>
          {loc.gps_stale ? (
            <Badge variant="secondary" className="text-amber-600 dark:text-amber-400" data-testid="badge-gps-stale">
              <AlertTriangle className="w-3 h-3 mr-1" />
              GPS Stale
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-emerald-600 dark:text-emerald-400" data-testid="badge-gps-live">
              <Radio className="w-3 h-3 mr-1" />
              Live
            </Badge>
          )}
        </div>

        {data.driver_name && (
          <p className="text-sm font-medium flex items-center gap-1.5" data-testid="text-live-driver-name">
            <User className="w-3.5 h-3.5 text-muted-foreground" />
            {data.driver_name}
          </p>
        )}

        <div className="flex items-center gap-4 flex-wrap text-sm">
          <span className="flex items-center gap-1 text-muted-foreground" data-testid="text-last-seen">
            <Clock className="w-3.5 h-3.5" />
            Last seen: {formatLastSeen(loc.last_update_seconds_ago)}
          </span>
          {eta && !data.hide_eta && (
            <span className="flex items-center gap-1 font-medium" data-testid="text-live-eta">
              <Navigation className="w-3.5 h-3.5 text-blue-500" />
              ETA: {eta.minutes} min{eta.distance_miles != null ? ` (${eta.distance_miles.toFixed(1)} mi)` : ""}
              <span className="text-xs text-muted-foreground ml-1">
                to {eta.destination}
              </span>
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
