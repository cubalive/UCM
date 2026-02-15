import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiFetch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Search,
  UserPlus,
  Clock,
  MapPin,
  Navigation,
  User,
  Building2,
  Accessibility,
  Lock,
  Radio,
  ArrowRight,
  Car,
  CircleDot,
  Truck,
  Coffee,
  LogOut,
  CheckCircle,
  PauseCircle,
  AlertTriangle,
  RefreshCw,
  Zap,
  Eye,
  EyeOff,
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
  EN_ROUTE_TO_PICKUP: "En Route Pickup",
  ARRIVED_PICKUP: "Arrived Pickup",
  PICKED_UP: "Picked Up",
  EN_ROUTE_TO_DROPOFF: "En Route Dropoff",
  ARRIVED_DROPOFF: "Arrived Dropoff",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  NO_SHOW: "No Show",
};

interface DriverStatusData {
  available: DriverInfo[];
  on_trip: DriverInfo[];
  paused: DriverInfo[];
  hold: DriverInfo[];
  logged_out: DriverInfo[];
}

interface DriverInfo {
  id: number;
  name: string;
  firstName: string;
  lastName: string;
  publicId: string;
  phone: string;
  dispatch_status: string;
  is_online: boolean;
  last_seen_at: string | null;
  vehicle_id: number | null;
  vehicle_name: string | null;
  vehicle_color_hex: string | null;
  active_trip_id: number | null;
  active_trip_public_id: string | null;
  active_trip_status: string | null;
  cityId: number;
  group: string;
}

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

interface ReassignCandidateInfo {
  id: number;
  name: string;
  publicId: string;
  phone: string;
  dispatch_status: string;
  vehicle_name: string | null;
  vehicle_id: number | null;
  distance_miles: number | null;
  has_active_trip: boolean;
  assigned_trips_2h: number;
  proximity_score: number;
  load_score: number;
  score: number;
}

function isTripNearPickup(trip: any): boolean {
  if (!trip.pickupTime || !trip.scheduledDate) return false;
  const [h, m] = trip.pickupTime.split(":").map(Number);
  const pickupDate = new Date(`${trip.scheduledDate}T${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:00`);
  const now = new Date();
  const diffMs = pickupDate.getTime() - now.getTime();
  return diffMs <= 10 * 60 * 1000 && diffMs > -30 * 60 * 1000;
}

function isDriverNotReady(trip: any): boolean {
  if (!trip.driverId) return true;
  if (trip.driverDispatchStatus === "off" || trip.driverDispatchStatus === "hold") return true;
  if (trip.driverLastSeenAt) {
    const elapsed = Date.now() - new Date(trip.driverLastSeenAt).getTime();
    if (elapsed > 120_000) return true;
  } else {
    return true;
  }
  return false;
}

interface AutoAssignResult {
  assigned: { tripId: number; tripPublicId: string; driverId: number; driverName: string; vehicleName: string | null }[];
  needsAttention: { tripId: number; tripPublicId: string; patientName: string; pickupTime: string; pickupAddress?: string; dropoffAddress?: string; pickupLat?: number | null; pickupLng?: number | null; reason: string }[];
  message?: string;
}

export default function DispatchBoardPage() {
  const { token, selectedCity } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("unassigned");
  const [search, setSearch] = useState("");
  const [assignTrip, setAssignTrip] = useState<any | null>(null);
  const [reassignTrip, setReassignTrip] = useState<any | null>(null);
  const [confirmAssign, setConfirmAssign] = useState<{ tripId: number; driverId: number; vehicleId?: number; warning: string } | null>(null);
  const [showAutoAssignConfirm, setShowAutoAssignConfirm] = useState(false);
  const [autoAssignResult, setAutoAssignResult] = useState<AutoAssignResult | null>(null);

  const cityId = selectedCity?.id;

  const tripsQuery = useQuery<any[]>({
    queryKey: ["/api/dispatch/trips", activeTab, cityId, search],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const qs = params.toString();
      return apiFetch(`/api/dispatch/trips/${activeTab}${qs ? `?${qs}` : ""}`, token);
    },
    enabled: !!token,
    refetchInterval: 15000,
  });

  const driverStatusQuery = useQuery<DriverStatusData>({
    queryKey: ["/api/dispatch/drivers/status", cityId],
    queryFn: () => apiFetch(`/api/dispatch/drivers/status${cityId ? `?city_id=${cityId}` : ""}`, token),
    enabled: !!token,
    refetchInterval: 15000,
  });

  const assignDriverMutation = useMutation({
    mutationFn: ({ tripId, driverId, vehicleId, force }: { tripId: number; driverId: number; vehicleId?: number; force?: boolean }) =>
      apiFetch(`/api/trips/${tripId}/assign`, token, {
        method: "PATCH",
        body: JSON.stringify({ driverId, vehicleId, force: force || false }),
      }),
    onSuccess: () => {
      toast({ title: "Driver assigned successfully" });
      setAssignTrip(null);
      setConfirmAssign(null);
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/trips"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/drivers/status"] });
    },
    onError: (err: any) => {
      toast({ title: "Assignment failed", description: err.message, variant: "destructive" });
    },
  });

  const reassignMutation = useMutation({
    mutationFn: ({ tripId, newDriverId }: { tripId: number; newDriverId: number }) =>
      apiFetch(`/api/dispatch/trips/${tripId}/reassign`, token, {
        method: "POST",
        body: JSON.stringify({ new_driver_id: newDriverId, reason: "readiness_escalation" }),
      }),
    onSuccess: () => {
      toast({ title: "Trip reassigned successfully" });
      setReassignTrip(null);
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/trips"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/drivers/status"] });
    },
    onError: (err: any) => {
      toast({ title: "Reassignment failed", description: err.message, variant: "destructive" });
    },
  });

  const todayDate = new Date().toLocaleDateString("en-CA");

  const autoAssignMutation = useMutation({
    mutationFn: () => {
      if (!cityId) throw new Error("Select a city first");
      return apiFetch("/api/dispatch/auto-assign-day", token, {
        method: "POST",
        body: JSON.stringify({ date: todayDate, city_id: cityId }),
      });
    },
    onSuccess: (data: AutoAssignResult) => {
      setShowAutoAssignConfirm(false);
      setAutoAssignResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/trips"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/drivers/status"] });
      if (data.assigned.length > 0) {
        toast({ title: `${data.assigned.length} trips assigned successfully` });
      } else if (data.message) {
        toast({ title: data.message });
      }
    },
    onError: (err: any) => {
      setShowAutoAssignConfirm(false);
      toast({ title: "Auto-assign failed", description: err.message, variant: "destructive" });
    },
  });

  const trips = tripsQuery.data || [];
  const driverStatus = driverStatusQuery.data || { available: [], on_trip: [], paused: [], hold: [], logged_out: [] };

  return (
    <div className="p-4 space-y-4 max-w-full mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-dispatch-board-title">
            Dispatch Operations Board
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {selectedCity ? selectedCity.name : "All Cities"}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            size="lg"
            onClick={() => setShowAutoAssignConfirm(true)}
            disabled={!cityId || autoAssignMutation.isPending}
            data-testid="button-auto-assign-day"
          >
            {autoAssignMutation.isPending ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Assigning...
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 mr-2" />
                Auto Assign Day
              </>
            )}
          </Button>
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search trips..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              data-testid="input-dispatch-search"
            />
          </div>
        </div>
      </div>

      {autoAssignResult && autoAssignResult.needsAttention.length > 0 && (
        <NeedsAttentionPanel
          items={autoAssignResult.needsAttention}
          onAssign={(trip) => setAssignTrip(trip)}
          onDismiss={() => setAutoAssignResult(null)}
          assignedCount={autoAssignResult.assigned.length}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="unassigned" data-testid="tab-unassigned">
                Unassigned
                {activeTab === "unassigned" && trips.length > 0 && (
                  <Badge variant="secondary" className="ml-1">{trips.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="scheduled" data-testid="tab-scheduled">
                Scheduled
              </TabsTrigger>
              <TabsTrigger value="active" data-testid="tab-active">
                Active
              </TabsTrigger>
              <TabsTrigger value="completed" data-testid="tab-completed">
                Completed
              </TabsTrigger>
            </TabsList>

            <TabsContent value="unassigned" className="mt-4">
              <TripList
                trips={trips}
                loading={tripsQuery.isLoading}
                tab="unassigned"
                onAssign={(trip) => setAssignTrip(trip)}
                onReassign={(trip) => setReassignTrip(trip)}
              />
            </TabsContent>
            <TabsContent value="scheduled" className="mt-4">
              <TripList trips={trips} loading={tripsQuery.isLoading} tab="scheduled" onAssign={(trip) => setAssignTrip(trip)} onReassign={(trip) => setReassignTrip(trip)} />
            </TabsContent>
            <TabsContent value="active" className="mt-4">
              <TripList trips={trips} loading={tripsQuery.isLoading} tab="active" onReassign={(trip) => setReassignTrip(trip)} />
            </TabsContent>
            <TabsContent value="completed" className="mt-4">
              <TripList trips={trips} loading={tripsQuery.isLoading} tab="completed" />
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground" data-testid="text-driver-panel-title">
            Driver Status Panel
          </h2>

          {driverStatusQuery.isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          ) : (
            <>
              <DriverSection
                title="Available Now"
                icon={<CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />}
                drivers={driverStatus.available}
                variant="available"
              />
              <DriverSection
                title="Busy / In Trip"
                icon={<Truck className="w-4 h-4 text-orange-500 dark:text-orange-400" />}
                drivers={[...(driverStatus.on_trip || []), ...(driverStatus.paused || []), ...(driverStatus.hold || [])]}
                variant="busy"
              />
              <DriverSection
                title="Offline"
                icon={<LogOut className="w-4 h-4 text-muted-foreground" />}
                drivers={driverStatus.logged_out}
                variant="offline"
              />
            </>
          )}
        </div>
      </div>

      <Dialog open={!!assignTrip} onOpenChange={(open) => { if (!open) { setAssignTrip(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Driver to {assignTrip?.publicId}</DialogTitle>
          </DialogHeader>
          <AssignDriverPanel
            trip={assignTrip}
            token={token}
            cityId={cityId}
            driverStatus={driverStatus}
            onAssign={(driverId, vehicleId) => {
              if (!assignTrip) return;
              const allDrivers = [...(driverStatus.available || []), ...(driverStatus.on_trip || []), ...(driverStatus.paused || []), ...(driverStatus.hold || []), ...(driverStatus.logged_out || [])];
              const driver = allDrivers.find(d => d.id === driverId);
              const needsConfirm = driver && (driver.group === "paused" || driver.group === "hold" || driver.group === "logged_out");
              if (needsConfirm) {
                const warning = driver.group === "logged_out"
                  ? "This driver is offline. They will not see the trip until they log in."
                  : driver.group === "hold"
                  ? "This driver is on break. They may not see the trip until they resume."
                  : "This driver's GPS is paused. They may not see the trip immediately.";
                setConfirmAssign({ tripId: assignTrip.id, driverId, vehicleId, warning });
              } else {
                assignDriverMutation.mutate({ tripId: assignTrip.id, driverId, vehicleId, force: true });
              }
            }}
            loading={assignDriverMutation.isPending}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmAssign} onOpenChange={(open) => { if (!open) setConfirmAssign(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Confirm Assignment
            </DialogTitle>
          </DialogHeader>
          {confirmAssign && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground" data-testid="text-confirm-warning">
                {confirmAssign.warning}
              </p>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setConfirmAssign(null)} data-testid="button-cancel-confirm">
                  Cancel
                </Button>
                <Button
                  variant="default"
                  onClick={() => {
                    assignDriverMutation.mutate({
                      tripId: confirmAssign.tripId,
                      driverId: confirmAssign.driverId,
                      vehicleId: confirmAssign.vehicleId,
                      force: true,
                    });
                  }}
                  disabled={assignDriverMutation.isPending}
                  data-testid="button-force-assign"
                >
                  Assign Anyway
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!reassignTrip} onOpenChange={(open) => { if (!open) setReassignTrip(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500" />
              Reassign Trip {reassignTrip?.publicId}
            </DialogTitle>
          </DialogHeader>
          {reassignTrip && (
            <ReassignPanel
              trip={reassignTrip}
              token={token}
              onReassign={(newDriverId) => {
                reassignMutation.mutate({ tripId: reassignTrip.id, newDriverId });
              }}
              loading={reassignMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showAutoAssignConfirm} onOpenChange={setShowAutoAssignConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-4 h-4" />
              Auto Assign Day
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground" data-testid="text-auto-assign-confirm">
              This will automatically assign all unassigned trips for today ({todayDate}) in {selectedCity?.name || "the selected city"} to available drivers.
            </p>
            <p className="text-sm text-muted-foreground">
              Matching considers wheelchair requirements, city, and 30-minute gap between trips.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowAutoAssignConfirm(false)} data-testid="button-cancel-auto-assign">
                Cancel
              </Button>
              <Button
                onClick={() => autoAssignMutation.mutate()}
                disabled={autoAssignMutation.isPending}
                data-testid="button-confirm-auto-assign"
              >
                {autoAssignMutation.isPending ? "Running..." : "Run Auto Assign"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NeedsAttentionPanel({
  items,
  onAssign,
  onDismiss,
  assignedCount,
}: {
  items: AutoAssignResult["needsAttention"];
  onAssign: (trip: any) => void;
  onDismiss: () => void;
  assignedCount: number;
}) {
  return (
    <Card className="border-amber-300 dark:border-amber-700" data-testid="panel-needs-attention">
      <CardHeader className="py-3 px-4 flex flex-row items-center justify-between gap-2 space-y-0">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          <CardTitle className="text-sm font-semibold">
            Needs Attention ({items.length})
          </CardTitle>
          {assignedCount > 0 && (
            <Badge variant="secondary" className="text-xs">{assignedCount} assigned</Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onDismiss} data-testid="button-dismiss-attention">
          Dismiss
        </Button>
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-0">
        <div className="space-y-2" data-testid="list-needs-attention">
          {items.map((item) => (
            <div
              key={item.tripId}
              className="flex items-center justify-between gap-3 rounded-md border border-amber-200 dark:border-amber-800 p-3"
              data-testid={`attention-trip-${item.tripId}`}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium" data-testid={`text-attention-trip-id-${item.tripId}`}>{item.tripPublicId}</span>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {item.pickupTime}
                  </span>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <User className="w-3 h-3" />
                    {item.patientName}
                  </span>
                </div>
                <p className="text-xs text-amber-700 dark:text-amber-400" data-testid={`text-attention-reason-${item.tripId}`}>
                  {item.reason}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onAssign({
                  id: item.tripId,
                  publicId: item.tripPublicId,
                  pickupAddress: item.pickupAddress,
                  dropoffAddress: item.dropoffAddress,
                  pickupLat: item.pickupLat,
                  pickupLng: item.pickupLng,
                  pickupTime: item.pickupTime,
                  patientName: item.patientName,
                })}
                data-testid={`button-manual-assign-${item.tripId}`}
              >
                <UserPlus className="w-3.5 h-3.5 mr-1" />
                Assign
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function getDriverDotColor(driver: DriverInfo): string {
  if (driver.group === "available") return "text-green-500";
  if (driver.group === "on_trip") {
    if (driver.active_trip_status?.includes("EN_ROUTE")) return "text-orange-500";
    return "text-red-500";
  }
  if (driver.group === "paused") return "text-orange-500";
  if (driver.group === "hold") return "text-orange-500";
  return "text-muted-foreground";
}

function getDriverStatusLabel(driver: DriverInfo): string {
  if (driver.group === "available") return "Available";
  if (driver.group === "on_trip") {
    if (driver.active_trip_status?.includes("EN_ROUTE")) return "En Route";
    return "In Trip";
  }
  if (driver.group === "paused") return "GPS Paused";
  if (driver.group === "hold") return "On Break";
  return "Offline";
}

function DriverSection({
  title,
  icon,
  drivers,
  variant,
}: {
  title: string;
  icon: React.ReactNode;
  drivers: DriverInfo[];
  variant: "available" | "busy" | "offline";
}) {
  const isOffline = variant === "offline";

  return (
    <Card data-testid={`section-drivers-${variant}`}>
      <CardHeader className="py-2 px-3 flex flex-row items-center justify-between gap-2 space-y-0">
        <div className="flex items-center gap-2">
          {icon}
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
        </div>
        <Badge variant="secondary" className="text-xs">{drivers.length}</Badge>
      </CardHeader>
      {drivers.length > 0 && (
        <CardContent className="px-3 pb-2 pt-0">
          <div className="space-y-1">
            {drivers.map((d) => (
              <div
                key={d.id}
                className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-xs ${
                  isOffline ? "opacity-50" : ""
                }`}
                data-testid={`driver-card-${d.id}`}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <CircleDot className={`w-3 h-3 flex-shrink-0 ${getDriverDotColor(d)}`} />
                  <span className="font-medium truncate" data-testid={`text-driver-name-${d.id}`}>{d.name}</span>
                  {variant === "busy" && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">{getDriverStatusLabel(d)}</Badge>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {d.vehicle_name ? (
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Car className="w-3 h-3" />
                      <span className="hidden xl:inline truncate max-w-[80px]">{d.vehicle_name.split("(")[0].trim()}</span>
                    </span>
                  ) : (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">No Vehicle</Badge>
                  )}
                  {d.active_trip_public_id && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{d.active_trip_public_id}</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function TripList({
  trips,
  loading,
  tab,
  onAssign,
  onReassign,
}: {
  trips: any[];
  loading: boolean;
  tab: string;
  onAssign?: (trip: any) => void;
  onReassign?: (trip: any) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (trips.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground" data-testid={`text-empty-${tab}`}>
        No {tab} trips
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid={`list-${tab}-trips`}>
      {trips.map((trip) => (
        <TripCard key={trip.id} trip={trip} tab={tab} onAssign={onAssign} onReassign={onReassign} />
      ))}
    </div>
  );
}

function TripCard({ trip, tab, onAssign, onReassign }: { trip: any; tab: string; onAssign?: (trip: any) => void; onReassign?: (trip: any) => void }) {
  const isCompleted = tab === "completed" || ["COMPLETED", "CANCELLED", "NO_SHOW"].includes(trip.status);
  const canAssign = !isCompleted && onAssign && (tab === "unassigned" || tab === "scheduled");

  const showReassign = !isCompleted && onReassign && isTripNearPickup(trip) && isDriverNotReady(trip);

  return (
    <Card data-testid={`card-trip-${trip.id}`}>
      <CardContent className="py-3 px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium" data-testid={`text-trip-id-${trip.id}`}>
                {trip.publicId}
              </span>
              <Badge className={STATUS_COLORS[trip.status] || ""}>{STATUS_LABELS[trip.status] || trip.status}</Badge>
              {trip.tripType === "recurring" && <Badge variant="outline">Recurring</Badge>}
              {trip.notes?.toLowerCase().includes("wheelchair") && (
                <Badge variant="outline" className="gap-1">
                  <Accessibility className="w-3 h-3" />
                  Wheelchair
                </Badge>
              )}
              {isCompleted && (
                <Badge variant="secondary" className="gap-1">
                  <Lock className="w-3 h-3" />
                  Locked
                </Badge>
              )}
              {showReassign && (
                <Badge variant="destructive" className="gap-1" data-testid={`badge-rescue-${trip.id}`}>
                  <AlertTriangle className="w-3 h-3" />
                  Driver Not Ready
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
              {trip.clinicName && (
                <span className="flex items-center gap-1">
                  <Building2 className="w-3 h-3 flex-shrink-0" />
                  {trip.clinicName}
                </span>
              )}
              {trip.pickupTime && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3 flex-shrink-0" />
                  {trip.pickupTime} on {trip.scheduledDate}
                </span>
              )}
              {trip.cityName && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3 flex-shrink-0" />
                  {trip.cityName}
                </span>
              )}
            </div>

            <div className="text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Navigation className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">{trip.pickupAddress}</span>
                <ArrowRight className="w-3 h-3 flex-shrink-0 mx-0.5" />
                <span className="truncate">{trip.dropoffAddress}</span>
              </span>
            </div>

            {(tab === "scheduled" || tab === "active") && trip.driverName && (
              <div className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1 text-foreground font-medium">
                  <User className="w-3 h-3" />
                  {trip.driverName}
                </span>
                {trip.vehicleLabel && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Car className="w-3 h-3" />
                    {trip.vehicleLabel}
                  </span>
                )}
              </div>
            )}

            {tab === "active" && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {trip.driverLastSeenAt && (
                  <span className="flex items-center gap-1">
                    <Radio className="w-3 h-3" />
                    GPS: {formatTimeAgo(trip.driverLastSeenAt)}
                  </span>
                )}
                {trip.lastEtaMinutes != null && (
                  <span className="flex items-center gap-1 font-medium text-foreground">
                    <Clock className="w-3 h-3" />
                    ETA: {trip.lastEtaMinutes} min
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1 flex-shrink-0">
            {canAssign && (
              <Button
                size="sm"
                onClick={() => onAssign!(trip)}
                data-testid={`button-assign-${trip.id}`}
              >
                <UserPlus className="w-3.5 h-3.5 mr-1" />
                Assign
              </Button>
            )}
            {showReassign && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => onReassign!(trip)}
                data-testid={`button-reassign-${trip.id}`}
              >
                <Zap className="w-3.5 h-3.5 mr-1" />
                Reassign Now
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AssignDriverPanel({
  trip,
  token,
  cityId,
  driverStatus,
  onAssign,
  loading,
}: {
  trip: any;
  token: string | null;
  cityId?: number;
  driverStatus: DriverStatusData;
  onAssign: (driverId: number, vehicleId?: number) => void;
  loading: boolean;
}) {
  const [showOffline, setShowOffline] = useState(false);

  const availableDrivers = driverStatus.available || [];
  const busyDrivers = [...(driverStatus.on_trip || []), ...(driverStatus.paused || []), ...(driverStatus.hold || [])];
  const offlineDrivers = driverStatus.logged_out || [];

  const allOnlineIds = [...availableDrivers, ...busyDrivers].map(d => d.id);
  const hasPickupCoords = trip?.pickupLat != null && trip?.pickupLng != null;

  const etaQuery = useQuery<{ drivers: { driver_id: number; eta_minutes: number | null; distance_miles: number | null }[] }>({
    queryKey: ["/api/dispatch/nearest-driver", trip?.id, allOnlineIds.join(",")],
    queryFn: () => apiFetch("/api/dispatch/nearest-driver", token, {
      method: "POST",
      body: JSON.stringify({
        pickupLat: trip.pickupLat,
        pickupLng: trip.pickupLng,
        driverIds: allOnlineIds.slice(0, 25),
      }),
    }),
    enabled: !!token && hasPickupCoords && allOnlineIds.length > 0,
    refetchInterval: 60000,
    staleTime: 55000,
  });

  const etaMap = new Map<number, { eta: number | null; dist: number | null }>();
  if (etaQuery.data?.drivers) {
    for (const d of etaQuery.data.drivers) {
      etaMap.set(d.driver_id, { eta: d.eta_minutes, dist: d.distance_miles });
    }
  }

  const sortByEta = (list: DriverInfo[]) => [...list].sort((a, b) => {
    const etaA = etaMap.get(a.id)?.eta;
    const etaB = etaMap.get(b.id)?.eta;
    if (etaA != null && etaB != null) return etaA - etaB;
    if (etaA != null) return -1;
    if (etaB != null) return 1;
    return 0;
  });

  const sortedAvailable = sortByEta(availableDrivers);
  const sortedBusy = sortByEta(busyDrivers);

  const renderDriverRow = (d: DriverInfo) => {
    const etaInfo = etaMap.get(d.id);
    const isOffline = d.group === "logged_out";
    return (
      <button
        key={d.id}
        onClick={() => {
          if (!loading) onAssign(d.id, d.vehicle_id || undefined);
        }}
        disabled={loading}
        className={`w-full text-left rounded-md border p-2.5 transition-colors hover-elevate ${
          isOffline ? "opacity-50" : ""
        }`}
        data-testid={`assign-driver-row-${d.id}`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <CircleDot className={`w-3.5 h-3.5 flex-shrink-0 ${getDriverDotColor(d)}`} />
            <div className="min-w-0">
              <div className="text-sm font-medium truncate" data-testid={`text-assign-driver-name-${d.id}`}>
                {d.name}
              </div>
              <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                {d.vehicle_name ? (
                  <span className="flex items-center gap-1">
                    <Car className="w-3 h-3" />
                    {d.vehicle_name.split("(")[0].trim()}
                  </span>
                ) : (
                  <span className="italic">No Vehicle</span>
                )}
                {d.active_trip_public_id && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">{d.active_trip_public_id}</Badge>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {etaInfo?.eta != null && (
              <span className="text-xs font-medium text-muted-foreground" data-testid={`text-driver-eta-${d.id}`}>
                {etaInfo.eta} min
              </span>
            )}
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{getDriverStatusLabel(d)}</Badge>
          </div>
        </div>
      </button>
    );
  };

  const noDriversAtAll = availableDrivers.length === 0 && busyDrivers.length === 0 && offlineDrivers.length === 0;

  return (
    <div className="space-y-3">
      {noDriversAtAll ? (
        <p className="text-sm text-muted-foreground py-4 text-center" data-testid="text-no-drivers-available">
          No drivers found in this city.
        </p>
      ) : (
        <ScrollArea className="max-h-[400px]">
          <div className="space-y-3 pr-2">
            {sortedAvailable.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Available Now
                  </span>
                  <Badge variant="secondary" className="text-[10px]">{sortedAvailable.length}</Badge>
                </div>
                <div className="space-y-1" data-testid="list-assign-available">
                  {sortedAvailable.map(renderDriverRow)}
                </div>
              </div>
            )}

            {sortedBusy.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <Truck className="w-3.5 h-3.5 text-orange-500" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Busy / In Trip
                  </span>
                  <Badge variant="secondary" className="text-[10px]">{sortedBusy.length}</Badge>
                </div>
                <div className="space-y-1" data-testid="list-assign-busy">
                  {sortedBusy.map(renderDriverRow)}
                </div>
              </div>
            )}

            {offlineDrivers.length > 0 && (
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowOffline(!showOffline)}
                  className="w-full justify-start gap-2 text-xs text-muted-foreground"
                  data-testid="button-toggle-offline"
                >
                  {showOffline ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  {showOffline ? "Hide" : "Show"} Offline Drivers ({offlineDrivers.length})
                </Button>
                {showOffline && (
                  <div className="space-y-1 mt-1" data-testid="list-assign-offline">
                    {offlineDrivers.map(renderDriverRow)}
                  </div>
                )}
              </div>
            )}

            {availableDrivers.length === 0 && busyDrivers.length === 0 && (
              <p className="text-sm text-muted-foreground py-2 text-center" data-testid="text-no-online-drivers">
                No online drivers available. Toggle offline drivers below if needed.
              </p>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

function ReassignPanel({
  trip,
  token,
  onReassign,
  loading,
}: {
  trip: any;
  token: string | null;
  onReassign: (newDriverId: number) => void;
  loading: boolean;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const candidatesQuery = useQuery<{ candidates: ReassignCandidateInfo[] }>({
    queryKey: ["/api/dispatch/trips", trip.id, "reassign-candidates"],
    queryFn: () => apiFetch(`/api/dispatch/trips/${trip.id}/reassign-candidates`, token),
    enabled: !!token && !!trip.id,
  });

  const candidates = candidatesQuery.data?.candidates || [];
  const bestCandidate = candidates.length > 0 ? candidates[0] : null;

  return (
    <div className="space-y-4" data-testid="panel-reassign">
      <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 text-xs space-y-1">
        <p className="font-medium text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" />
          Dispatch Rescue
        </p>
        <p className="text-amber-700 dark:text-amber-400">
          Trip pickup is imminent but the assigned driver is not ready.
          Select a LIVE driver below to reassign immediately.
        </p>
      </div>

      {trip.driverName && (
        <div className="text-xs text-muted-foreground">
          Current driver: <span className="font-medium text-foreground">{trip.driverName}</span>
          {trip.driverDispatchStatus && (
            <Badge variant="outline" className="ml-2 text-[10px]">{trip.driverDispatchStatus}</Badge>
          )}
        </div>
      )}

      {candidatesQuery.isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : candidates.length === 0 ? (
        <div className="py-4 text-center text-sm text-muted-foreground" data-testid="text-no-candidates">
          No available LIVE drivers found for reassignment.
        </div>
      ) : (
        <div className="space-y-1.5" data-testid="list-reassign-candidates">
          {candidates.map((c, idx) => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className={`w-full text-left rounded-md border p-3 transition-colors ${
                selectedId === c.id
                  ? "border-primary bg-primary/5"
                  : "border-border"
              }`}
              data-testid={`candidate-${c.id}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <CircleDot className={`w-3 h-3 flex-shrink-0 ${
                    c.dispatch_status === "available" ? "text-green-500" : "text-blue-500"
                  }`} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium flex items-center gap-1.5 flex-wrap">
                      {c.name}
                      {idx === 0 && (
                        <Badge variant="secondary" className="text-[10px]">Best Match</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                      {c.vehicle_name && (
                        <span className="flex items-center gap-1">
                          <Car className="w-3 h-3" />
                          {c.vehicle_name}
                        </span>
                      )}
                      {c.distance_miles != null && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {c.distance_miles} mi
                        </span>
                      )}
                      {c.has_active_trip && (
                        <Badge variant="outline" className="text-[10px]">Has Trip</Badge>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <DialogFooter>
        <Button
          variant="destructive"
          onClick={() => {
            if (selectedId) onReassign(selectedId);
          }}
          disabled={loading || !selectedId}
          data-testid="button-confirm-reassign"
        >
          {loading ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" />
              Reassigning...
            </>
          ) : (
            <>
              <Zap className="w-3.5 h-3.5 mr-1" />
              Confirm Reassign
            </>
          )}
        </Button>
      </DialogFooter>
    </div>
  );
}
