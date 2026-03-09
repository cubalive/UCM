import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiFetch } from "@/lib/api";
import { TripRef } from "@/components/trip-ref";
import { useSoundNotifications } from "@/hooks/use-sound-notifications";
import { useRealtimeTrips } from "@/hooks/use-realtime-trips";
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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
  Repeat,
  Briefcase,
  Timer,
  Send,
  XCircle,
  ChevronDown,
  ChevronUp,
  Volume2,
} from "lucide-react";

import { getTripStatusStyle, getTripStatusLabel, getTripMarkerColor, TRIP_STATUS_MAP } from "@/lib/tripStatusMapping";

function getStatusBadgeClass(status: string): string {
  const s = getTripStatusStyle(status);
  return `${s.bgColor} ${s.color}`;
}
const STATUS_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(TRIP_STATUS_MAP).map(([k, v]) => [k, `${v.bgColor} ${v.color}`])
);
const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(TRIP_STATUS_MAP).map(([k, v]) => [k, v.label])
);

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
  today_trip_count: number;
  performance_score: number | null;
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

type OriginFilter = "" | "clinic" | "private" | "dialysis_recurring";

interface ClinicGroup {
  clinicId: number;
  clinicName: string;
  trips: any[];
}

export default function DispatchBoardPage() {
  const { user, token, selectedCity } = useAuth();
  const { toast } = useToast();
  const { play: playSound, enabled: soundEnabled, toggle: soundToggle } = useSoundNotifications();
  const prevTripIdsRef = useRef<Set<number> | null>(null);
  const [activeTab, setActiveTab] = useState("unassigned");
  const [originFilter, setOriginFilter] = useState<OriginFilter>("");
  const [search, setSearch] = useState("");
  const [assignTrip, setAssignTrip] = useState<any | null>(null);
  const [reassignTrip, setReassignTrip] = useState<any | null>(null);
  const [confirmAssign, setConfirmAssign] = useState<{ tripId: number; driverId: number; vehicleId?: number; warning: string } | null>(null);
  const [showAutoAssignConfirm, setShowAutoAssignConfirm] = useState(false);
  const [autoAssignResult, setAutoAssignResult] = useState<AutoAssignResult | null>(null);
  const [pendingOffer, setPendingOffer] = useState<{
    offerId: number;
    tripId: number;
    driverName: string;
    expiresAt: string;
    status: string;
    tripPublicId?: string;
  } | null>(null);
  const [peekTrip, setPeekTrip] = useState<any | null>(null);
  const [offerCountdown, setOfferCountdown] = useState(0);
  const offerPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cityId = selectedCity?.id;

  useRealtimeTrips({
    companyId: user?.companyId || null,
    enabled: !!token,
    invalidateKeys: ["/api/dispatch/trips", "/api/dispatch/drivers/status"],
  });

  const tripsQuery = useQuery<any>({
    queryKey: ["/api/dispatch/trips", activeTab, cityId, search, originFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (originFilter) params.set("origin", originFilter);
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

  const stopOfferPolling = useCallback(() => {
    if (offerPollRef.current) {
      clearInterval(offerPollRef.current);
      offerPollRef.current = null;
    }
  }, []);

  const startOfferPolling = useCallback((offerId: number) => {
    stopOfferPolling();
    offerPollRef.current = setInterval(async () => {
      try {
        const result = await apiFetch(`/api/dispatch/offers/${offerId}/status`, token);
        if (result.status === "accepted") {
          stopOfferPolling();
          setPendingOffer(null);
          toast({ title: "Driver accepted the trip" });
          queryClient.invalidateQueries({ queryKey: ["/api/dispatch/trips"] });
          queryClient.invalidateQueries({ queryKey: ["/api/dispatch/drivers/status"] });
        } else if (result.status === "expired" || result.status === "cancelled") {
          stopOfferPolling();
          setPendingOffer((prev) => prev ? { ...prev, status: result.status } : null);
          if (result.status === "expired") {
            toast({ title: "Driver did not respond", description: "The 30-second window expired. You can reassign.", variant: "destructive" });
          } else {
            toast({ title: "Driver declined the trip", description: "You can reassign to another driver.", variant: "destructive" });
          }
          queryClient.invalidateQueries({ queryKey: ["/api/dispatch/trips"] });
        } else {
          setPendingOffer((prev) => prev ? { ...prev, status: result.status } : null);
          setOfferCountdown(result.secondsRemaining || 0);
        }
      } catch {}
    }, 2000);
  }, [token, stopOfferPolling, toast]);

  useEffect(() => {
    if (!pendingOffer || pendingOffer.status !== "pending") return;
    const timer = setInterval(() => {
      const remaining = Math.max(0, Math.floor((new Date(pendingOffer.expiresAt).getTime() - Date.now()) / 1000));
      setOfferCountdown(remaining);
      if (remaining <= 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [pendingOffer?.offerId, pendingOffer?.status]);

  useEffect(() => {
    return () => stopOfferPolling();
  }, [stopOfferPolling]);

  const assignDriverMutation = useMutation({
    mutationFn: ({ tripId, driverId, vehicleId, force }: { tripId: number; driverId: number; vehicleId?: number; force?: boolean }) =>
      apiFetch(`/api/trips/${tripId}/assign`, token, {
        method: "PATCH",
        body: JSON.stringify({ driverId, vehicleId, force: force || false }),
      }),
    onSuccess: (data: any) => {
      if (data.offerSent) {
        setPendingOffer({
          offerId: data.offerId,
          tripId: data.tripId,
          driverName: data.driverName,
          expiresAt: data.expiresAt,
          status: "pending",
          tripPublicId: assignTrip?.publicId || undefined,
        });
        setOfferCountdown(data.secondsRemaining || 30);
        startOfferPolling(data.offerId);
        setAssignTrip(null);
        setConfirmAssign(null);
      } else {
        toast({ title: "Driver assigned successfully" });
        setAssignTrip(null);
        setConfirmAssign(null);
        queryClient.invalidateQueries({ queryKey: ["/api/dispatch/trips"] });
        queryClient.invalidateQueries({ queryKey: ["/api/dispatch/drivers/status"] });
      }
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

  const rawData = tripsQuery.data;
  const isClinicGrouped = originFilter === "clinic" && rawData?.grouped;
  const clinicGroups: ClinicGroup[] = isClinicGrouped ? rawData.grouped : [];
  const trips: any[] = isClinicGrouped
    ? clinicGroups.flatMap(g => g.trips)
    : (Array.isArray(rawData) ? rawData : []);
  const driverStatus = driverStatusQuery.data || { available: [], on_trip: [], paused: [], hold: [], logged_out: [] };

  const prevScopeRef = useRef<string>("");
  const scopePrimedRef = useRef(false);
  useEffect(() => {
    const scopeKey = `${activeTab}|${search}|${originFilter}`;
    if (scopeKey !== prevScopeRef.current) {
      prevScopeRef.current = scopeKey;
      prevTripIdsRef.current = null;
      scopePrimedRef.current = false;
    }
    const currentIds = new Set(trips.map((t: any) => t.id as number));
    if (!scopePrimedRef.current) {
      scopePrimedRef.current = true;
      prevTripIdsRef.current = currentIds;
      return;
    }
    const prev = prevTripIdsRef.current;
    if (prev && prev.size > 0) {
      for (const id of currentIds) {
        if (!prev.has(id)) {
          playSound("notification");
          break;
        }
      }
    }
    prevTripIdsRef.current = currentIds;
  }, [trips, activeTab, search, originFilter, playSound]);

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
          <Button
            variant="ghost"
            size="icon"
            onClick={() => { soundToggle(!soundEnabled); }}
            title={soundEnabled ? "Mute sounds" : "Enable sounds"}
            data-testid="button-toggle-sounds"
          >
            <Volume2 className={`w-4 h-4 ${soundEnabled ? "text-foreground" : "text-muted-foreground opacity-40"}`} />
          </Button>
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
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center gap-1.5 flex-wrap" data-testid="origin-filter-bar">
            {([
              { key: "" as OriginFilter, label: "All Trips", icon: null },
              { key: "clinic" as OriginFilter, label: "Clinic Trips", icon: <Building2 className="w-3.5 h-3.5" /> },
              { key: "private" as OriginFilter, label: "Private Trips", icon: <Briefcase className="w-3.5 h-3.5" /> },
              { key: "dialysis_recurring" as OriginFilter, label: "Dialysis Recurring", icon: <Repeat className="w-3.5 h-3.5" /> },
            ]).map(({ key, label, icon }) => (
              <Button
                key={key}
                size="sm"
                variant={originFilter === key ? "default" : "outline"}
                className="toggle-elevate"
                onClick={() => setOriginFilter(key)}
                data-testid={`button-origin-${key || "all"}`}
              >
                {icon}
                {label}
              </Button>
            ))}
          </div>

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
              {isClinicGrouped ? (
                <ClinicGroupedTripList
                  groups={clinicGroups}
                  loading={tripsQuery.isLoading}
                  tab="unassigned"
                  onAssign={(trip) => setAssignTrip(trip)}
                  onReassign={(trip) => setReassignTrip(trip)}
                  onPeek={setPeekTrip}
                />
              ) : (
                <TripList
                  trips={trips}
                  loading={tripsQuery.isLoading}
                  tab="unassigned"
                  onAssign={(trip) => setAssignTrip(trip)}
                  onReassign={(trip) => setReassignTrip(trip)}
                  onPeek={setPeekTrip}
                />
              )}
            </TabsContent>
            <TabsContent value="scheduled" className="mt-4">
              {isClinicGrouped ? (
                <ClinicGroupedTripList groups={clinicGroups} loading={tripsQuery.isLoading} tab="scheduled" onAssign={(trip) => setAssignTrip(trip)} onReassign={(trip) => setReassignTrip(trip)} onPeek={setPeekTrip} />
              ) : (
                <TripList trips={trips} loading={tripsQuery.isLoading} tab="scheduled" onAssign={(trip) => setAssignTrip(trip)} onReassign={(trip) => setReassignTrip(trip)} onPeek={setPeekTrip} />
              )}
            </TabsContent>
            <TabsContent value="active" className="mt-4">
              {isClinicGrouped ? (
                <ClinicGroupedTripList groups={clinicGroups} loading={tripsQuery.isLoading} tab="active" onReassign={(trip) => setReassignTrip(trip)} onPeek={setPeekTrip} />
              ) : (
                <TripList trips={trips} loading={tripsQuery.isLoading} tab="active" onReassign={(trip) => setReassignTrip(trip)} onPeek={setPeekTrip} />
              )}
            </TabsContent>
            <TabsContent value="completed" className="mt-4">
              {isClinicGrouped ? (
                <ClinicGroupedTripList groups={clinicGroups} loading={tripsQuery.isLoading} tab="completed" onPeek={setPeekTrip} />
              ) : (
                <TripList trips={trips} loading={tripsQuery.isLoading} tab="completed" onPeek={setPeekTrip} />
              )}
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

      <Dialog open={!!pendingOffer} onOpenChange={(open) => {
        if (!open && pendingOffer?.status !== "pending") {
          stopOfferPolling();
          setPendingOffer(null);
        }
      }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {pendingOffer?.status === "pending" ? (
                <><Send className="w-4 h-4 text-primary" /> Waiting for Driver</>
              ) : pendingOffer?.status === "expired" ? (
                <><Timer className="w-4 h-4 text-destructive" /> No Response</>
              ) : pendingOffer?.status === "cancelled" ? (
                <><XCircle className="w-4 h-4 text-destructive" /> Declined</>
              ) : (
                <><CheckCircle className="w-4 h-4 text-green-600" /> Accepted</>
              )}
            </DialogTitle>
          </DialogHeader>
          {pendingOffer && (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-sm text-muted-foreground">Trip</span>
                  <span className="text-sm font-medium font-mono" data-testid="text-offer-trip-id">{pendingOffer.tripPublicId || `#${pendingOffer.tripId}`}</span>
                </div>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-sm text-muted-foreground">Driver</span>
                  <span className="text-sm font-medium" data-testid="text-offer-driver-name">{pendingOffer.driverName}</span>
                </div>
              </div>

              {pendingOffer.status === "pending" && (
                <div className="flex flex-col items-center gap-2 py-2">
                  <div className="relative w-16 h-16">
                    <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
                      <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" className="text-muted" strokeWidth="4" />
                      <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" className="text-primary" strokeWidth="4"
                        strokeDasharray={`${(offerCountdown / 30) * 175.9} 175.9`}
                        strokeLinecap="round"
                      />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-lg font-mono font-bold" data-testid="text-offer-countdown">
                      {offerCountdown}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground text-center">
                    Waiting for driver to accept...
                  </p>
                </div>
              )}

              {pendingOffer.status === "expired" && (
                <div className="text-center space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Driver did not respond within 30 seconds.
                  </p>
                  <div className="flex gap-2 justify-center">
                    <Button
                      variant="outline"
                      onClick={() => {
                        stopOfferPolling();
                        setPendingOffer(null);
                      }}
                      data-testid="button-offer-dismiss"
                    >
                      Dismiss
                    </Button>
                    <Button
                      onClick={() => {
                        const tripId = pendingOffer.tripId;
                        stopOfferPolling();
                        setPendingOffer(null);
                        const trip = tripsQuery.data?.trips?.find?.((t: any) => t.id === tripId) ||
                          tripsQuery.data?.find?.((t: any) => t.id === tripId);
                        if (trip) {
                          setAssignTrip(trip);
                        } else {
                          queryClient.invalidateQueries({ queryKey: ["/api/dispatch/trips"] });
                          toast({ title: "Select the trip to reassign from the list" });
                        }
                      }}
                      data-testid="button-offer-reassign"
                    >
                      Reassign to Another Driver
                    </Button>
                  </div>
                </div>
              )}

              {pendingOffer.status === "cancelled" && (
                <div className="text-center space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Driver declined this trip request.
                  </p>
                  <div className="flex gap-2 justify-center">
                    <Button
                      variant="outline"
                      onClick={() => {
                        stopOfferPolling();
                        setPendingOffer(null);
                      }}
                      data-testid="button-decline-dismiss"
                    >
                      Dismiss
                    </Button>
                    <Button
                      onClick={() => {
                        const tripId = pendingOffer.tripId;
                        stopOfferPolling();
                        setPendingOffer(null);
                        const trip = tripsQuery.data?.trips?.find?.((t: any) => t.id === tripId) ||
                          tripsQuery.data?.find?.((t: any) => t.id === tripId);
                        if (trip) {
                          setAssignTrip(trip);
                        } else {
                          queryClient.invalidateQueries({ queryKey: ["/api/dispatch/trips"] });
                          toast({ title: "Select the trip to reassign from the list" });
                        }
                      }}
                      data-testid="button-decline-reassign"
                    >
                      Reassign to Another Driver
                    </Button>
                  </div>
                </div>
              )}
            </div>
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

      <Sheet open={!!peekTrip} onOpenChange={(o) => { if (!o) setPeekTrip(null); }}>
        <SheetContent className="w-[400px] sm:w-[450px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              Trip {peekTrip?.publicId || `#${peekTrip?.id}`}
              {peekTrip && <Badge className={STATUS_COLORS[peekTrip.status] || ""}>{STATUS_LABELS[peekTrip.status] || peekTrip.status}</Badge>}
            </SheetTitle>
          </SheetHeader>
          {peekTrip && (
            <div className="space-y-4 mt-4">
              <div className="space-y-2 text-sm">
                {peekTrip.patientName && (
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium" data-testid="text-peek-patient">{peekTrip.patientName}</span>
                  </div>
                )}
                {peekTrip.clinicName && (
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span data-testid="text-peek-clinic">{peekTrip.clinicName}</span>
                  </div>
                )}
                {peekTrip.pickupTime && (
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span data-testid="text-peek-time">{peekTrip.pickupTime} on {peekTrip.scheduledDate}</span>
                  </div>
                )}
              </div>
              <div className="space-y-2 text-sm">
                <p className="text-xs font-medium text-muted-foreground uppercase">Addresses</p>
                <div className="flex items-start gap-2">
                  <Navigation className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                  <span data-testid="text-peek-pickup">{peekTrip.pickupAddress}</span>
                </div>
                <div className="flex items-start gap-2">
                  <MapPin className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                  <span data-testid="text-peek-dropoff">{peekTrip.dropoffAddress}</span>
                </div>
              </div>
              {(peekTrip.driverName || peekTrip.vehicleLabel) && (
                <div className="space-y-2 text-sm">
                  <p className="text-xs font-medium text-muted-foreground uppercase">Assignment</p>
                  {peekTrip.driverName && (
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <span data-testid="text-peek-driver">{peekTrip.driverName}</span>
                    </div>
                  )}
                  {peekTrip.vehicleLabel && (
                    <div className="flex items-center gap-2">
                      <Car className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <span data-testid="text-peek-vehicle">{peekTrip.vehicleLabel}</span>
                    </div>
                  )}
                </div>
              )}
              {peekTrip.lastEtaMinutes != null && (
                <div className="space-y-2 text-sm">
                  <p className="text-xs font-medium text-muted-foreground uppercase">Live Data</p>
                  <div className="flex items-center gap-2">
                    <Timer className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="font-medium" data-testid="text-peek-eta">ETA: {peekTrip.lastEtaMinutes} min</span>
                  </div>
                </div>
              )}
              <div className="space-y-2 text-sm" data-testid="peek-timeline">
                <p className="text-xs font-medium text-muted-foreground uppercase">Status Timeline</p>
                {[
                  { label: "Scheduled", ts: peekTrip.createdAt, status: "SCHEDULED" },
                  { label: "Assigned", ts: peekTrip.driverId ? (peekTrip.assignedAt || peekTrip.updatedAt) : null, status: "ASSIGNED" },
                  { label: "En Route to Pickup", ts: peekTrip.startedAt, status: "EN_ROUTE_TO_PICKUP" },
                  { label: "Arrived Pickup", ts: peekTrip.arrivedPickupAt, status: "ARRIVED_PICKUP" },
                  { label: "Picked Up", ts: peekTrip.pickedUpAt, status: "PICKED_UP" },
                  { label: "En Route to Dropoff", ts: peekTrip.enRouteDropoffAt, status: "EN_ROUTE_TO_DROPOFF" },
                  { label: "Arrived Dropoff", ts: peekTrip.arrivedDropoffAt, status: "ARRIVED_DROPOFF" },
                  { label: "Completed", ts: peekTrip.completedAt, status: "COMPLETED" },
                ].map((step, i) => {
                  const reached = !!step.ts;
                  const isCurrent = step.status === peekTrip.status;
                  const style = getTripStatusStyle(step.status);
                  return (
                    <div key={i} className="flex items-center gap-2" data-testid={`timeline-step-${step.status}`}>
                      <div
                        className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${reached ? '' : 'opacity-30'}`}
                        style={{ backgroundColor: style.markerColor }}
                      />
                      <span className={`text-xs ${isCurrent ? 'font-semibold' : reached ? '' : 'text-muted-foreground'}`} data-testid={`timeline-label-${step.status}`}>
                        {step.label}
                      </span>
                      {step.ts && (
                        <span className="text-[10px] text-muted-foreground ml-auto" data-testid={`timeline-time-${step.status}`}>
                          {new Date(step.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                  );
                })}
                {(peekTrip.status === "CANCELLED" || peekTrip.status === "NO_SHOW") && (
                  <div className="flex items-center gap-2" data-testid={`timeline-step-${peekTrip.status}`}>
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: getTripStatusStyle(peekTrip.status).markerColor }} />
                    <span className="text-xs font-semibold">{peekTrip.status === "CANCELLED" ? "Cancelled" : "No-show"}</span>
                    {peekTrip.cancelledAt && (
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        {new Date(peekTrip.cancelledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                )}
              </div>
              {peekTrip.notes && (
                <div className="space-y-1 text-sm">
                  <p className="text-xs font-medium text-muted-foreground uppercase">Notes</p>
                  <p className="text-muted-foreground" data-testid="text-peek-notes">{peekTrip.notes}</p>
                </div>
              )}
              <Button className="w-full" onClick={() => { setPeekTrip(null); window.location.href = `/trips/${peekTrip.id}`; }} data-testid="button-peek-view-full">
                View Full Details
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
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
                  <TripRef tripId={item.tripId} publicId={item.tripPublicId} className="text-sm font-medium" />
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
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(`ucm_dispatch_section_${variant}`) === "collapsed"; } catch { return isOffline; }
  });

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(`ucm_dispatch_section_${variant}`, next ? "collapsed" : "open"); } catch {}
  };

  return (
    <Card data-testid={`section-drivers-${variant}`}>
      <CardHeader
        className="py-2 px-3 flex flex-row items-center justify-between gap-2 space-y-0 cursor-pointer select-none"
        onClick={toggleCollapsed}
        data-testid={`toggle-section-${variant}`}
      >
        <div className="flex items-center gap-2">
          {icon}
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="secondary" className="text-xs">{drivers.length}</Badge>
          {collapsed ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronUp className="w-4 h-4 text-muted-foreground" />}
        </div>
      </CardHeader>
      {!collapsed && drivers.length > 0 && (
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
  onPeek,
}: {
  trips: any[];
  loading: boolean;
  tab: string;
  onAssign?: (trip: any) => void;
  onReassign?: (trip: any) => void;
  onPeek?: (trip: any) => void;
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
        <TripCard key={trip.id} trip={trip} tab={tab} onAssign={onAssign} onReassign={onReassign} onPeek={onPeek} />
      ))}
    </div>
  );
}

function ClinicGroupedTripList({
  groups,
  loading,
  tab,
  onAssign,
  onReassign,
  onPeek,
}: {
  groups: ClinicGroup[];
  loading: boolean;
  tab: string;
  onAssign?: (trip: any) => void;
  onReassign?: (trip: any) => void;
  onPeek?: (trip: any) => void;
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

  if (groups.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground" data-testid={`text-empty-clinic-${tab}`}>
        No clinic {tab} trips
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid={`list-clinic-grouped-${tab}`}>
      {groups.map((group) => (
        <div key={group.clinicId} data-testid={`clinic-group-${group.clinicId}`}>
          <div className="flex items-center gap-2 mb-2 px-1">
            <Building2 className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-semibold" data-testid={`text-clinic-name-${group.clinicId}`}>
              {group.clinicName}
            </span>
            <Badge variant="secondary" className="text-xs">{group.trips.length}</Badge>
          </div>
          <div className="space-y-2">
            {group.trips.map((trip) => (
              <TripCard key={trip.id} trip={trip} tab={tab} onAssign={onAssign} onReassign={onReassign} onPeek={onPeek} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TripCard({ trip, tab, onAssign, onReassign, onPeek }: { trip: any; tab: string; onAssign?: (trip: any) => void; onReassign?: (trip: any) => void; onPeek?: (trip: any) => void }) {
  const [, navigate] = useLocation();
  const isCompleted = tab === "completed" || ["COMPLETED", "CANCELLED", "NO_SHOW"].includes(trip.status);
  const canAssign = !isCompleted && onAssign && (tab === "unassigned" || tab === "scheduled");

  const showReassign = !isCompleted && onReassign && isTripNearPickup(trip) && isDriverNotReady(trip);

  return (
    <Card data-testid={`card-trip-${trip.id}`} className="hover-elevate cursor-pointer" onClick={() => navigate(`/trips/${trip.id}`)}>
      <CardContent className="py-3 px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <TripRef tripId={trip.id} publicId={trip.publicId} className="text-sm font-medium" size="md" />
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

          <div className="flex flex-col gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            {onPeek && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onPeek(trip)}
                data-testid={`button-peek-${trip.id}`}
              >
                <Eye className="w-3.5 h-3.5" />
              </Button>
            )}
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

  const bestAvailableId = sortedAvailable.length > 0 && etaMap.get(sortedAvailable[0].id)?.eta != null
    ? sortedAvailable[0].id : null;

  const renderDriverRow = (d: DriverInfo) => {
    const etaInfo = etaMap.get(d.id);
    const isOffline = d.group === "logged_out";
    const isBest = d.id === bestAvailableId;
    return (
      <button
        key={d.id}
        onClick={() => {
          if (!loading) onAssign(d.id, d.vehicle_id || undefined);
        }}
        disabled={loading}
        className={`w-full text-left rounded-md border p-2.5 transition-colors hover-elevate ${
          isOffline ? "opacity-50" : ""
        } ${isBest ? "border-green-500 bg-green-50 dark:bg-green-950/30" : ""}`}
        data-testid={`assign-driver-row-${d.id}`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <CircleDot className={`w-3.5 h-3.5 flex-shrink-0 ${getDriverDotColor(d)}`} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium truncate" data-testid={`text-assign-driver-name-${d.id}`}>
                  {d.name}
                </span>
                {isBest && (
                  <Badge variant="default" className="text-[10px] px-1.5 py-0 bg-green-600" data-testid={`badge-best-pick-${d.id}`}>
                    Best Pick
                  </Badge>
                )}
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
                {d.today_trip_count > 0 && (
                  <span className="text-[10px]" data-testid={`text-driver-workload-${d.id}`}>
                    {d.today_trip_count} trip{d.today_trip_count > 1 ? "s" : ""} today
                  </span>
                )}
                {d.performance_score != null && (
                  <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${d.performance_score >= 80 ? "border-green-500 text-green-700" : d.performance_score >= 60 ? "border-yellow-500 text-yellow-700" : "border-red-500 text-red-700"}`} data-testid={`badge-driver-score-${d.id}`}>
                    Score: {d.performance_score}
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
            <div className="flex items-center gap-1.5">
              {etaInfo?.eta != null && (
                <span className="text-xs font-medium text-muted-foreground" data-testid={`text-driver-eta-${d.id}`}>
                  {etaInfo.eta} min
                </span>
              )}
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">{getDriverStatusLabel(d)}</Badge>
            </div>
            {etaInfo?.dist != null && (
              <span className="text-[10px] text-muted-foreground" data-testid={`text-driver-dist-${d.id}`}>
                {etaInfo.dist.toFixed(1)} mi away
              </span>
            )}
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
                    c.dispatch_status === "available" ? "text-green-500" : "text-emerald-500"
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
