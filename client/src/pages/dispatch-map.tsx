import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth, authHeaders } from "@/lib/auth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Truck,
  UserCheck,
  MapPin,
  Clock,
  Navigation,
  Zap,
  RefreshCw,
  CircleDot,
  ArrowRight,
  MessageSquare,
  Send,
  AlertTriangle,
  Route,
  Bell,
  XCircle,
  CheckCircle,
  Phone,
  Building2,
  RotateCcw,
  DollarSign,
} from "lucide-react";
import type { Driver, Vehicle, Trip, Patient, DriverVehicleAssignment } from "@shared/schema";
import { CalendarDays, ArrowLeftRight } from "lucide-react";

interface DriverWithVehicle extends Driver {
  vehicle: Vehicle | null;
}

interface MapData {
  drivers: DriverWithVehicle[];
  trips: Trip[];
  vehicles: Vehicle[];
  clinics: any[];
}

const DISPATCH_STATUS_COLORS: Record<string, string> = {
  available: "hsl(142, 76%, 36%)",
  enroute: "hsl(0, 84%, 60%)",
  hold: "hsl(45, 93%, 47%)",
  off: "hsl(0, 0%, 60%)",
};

const DISPATCH_STATUS_LABELS: Record<string, string> = {
  available: "Available",
  enroute: "En Route",
  hold: "Hold",
  off: "Off Duty",
};

const TRIP_STATUS_COLORS: Record<string, string> = {
  SCHEDULED: "hsl(217, 91%, 60%)",
  ASSIGNED: "hsl(25, 95%, 53%)",
  EN_ROUTE_TO_PICKUP: "hsl(38, 92%, 50%)",
  ARRIVED_PICKUP: "hsl(263, 70%, 50%)",
  PICKED_UP: "hsl(271, 91%, 65%)",
  EN_ROUTE_TO_DROPOFF: "hsl(0, 84%, 60%)",
  IN_PROGRESS: "hsl(142, 76%, 36%)",
  ARRIVED_DROPOFF: "hsl(187, 85%, 43%)",
  COMPLETED: "hsl(0, 0%, 60%)",
  CANCELLED: "hsl(0, 84%, 60%)",
  NO_SHOW: "hsl(0, 0%, 40%)",
};

function DriverMarker({ driver, onClick }: { driver: DriverWithVehicle; onClick: () => void }) {
  const statusColor = DISPATCH_STATUS_COLORS[driver.dispatchStatus] || DISPATCH_STATUS_COLORS.off;
  const vehicleColor = driver.vehicle?.colorHex || "#6366f1";
  const initials = `${driver.firstName[0]}${driver.lastName[0]}`;

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 p-2 rounded-md hover-elevate transition-all cursor-pointer bg-card border"
      data-testid={`marker-driver-${driver.id}`}
    >
      <div className="relative flex-shrink-0">
        <Avatar className="h-8 w-8" style={{ borderColor: statusColor, borderWidth: 3, borderStyle: "solid" }}>
          <AvatarFallback
            className="text-xs text-white font-bold"
            style={{ backgroundColor: vehicleColor }}
          >
            {initials}
          </AvatarFallback>
        </Avatar>
        <span
          className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background"
          style={{ backgroundColor: statusColor }}
          data-testid={`status-indicator-driver-${driver.id}`}
        />
      </div>
      <div className="min-w-0 text-left">
        <p className="text-xs font-medium truncate">{driver.firstName} {driver.lastName}</p>
        <p className="text-[10px] text-muted-foreground truncate">
          {driver.vehicle ? driver.vehicle.name : "No vehicle"}
        </p>
      </div>
    </button>
  );
}

function TripMarker({ trip, onClick }: { trip: Trip; onClick: () => void }) {
  const statusColor = TRIP_STATUS_COLORS[trip.status] || TRIP_STATUS_COLORS.SCHEDULED;

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 p-2 rounded-md hover-elevate transition-all cursor-pointer bg-card border"
      data-testid={`marker-trip-${trip.id}`}
    >
      <div className="flex-shrink-0">
        <div
          className="w-8 h-8 rounded-md flex items-center justify-center"
          style={{ backgroundColor: statusColor }}
        >
          <MapPin className="w-4 h-4 text-white" />
        </div>
      </div>
      <div className="min-w-0 text-left">
        <p className="text-xs font-medium truncate">{trip.publicId}</p>
        <p className="text-[10px] text-muted-foreground truncate">{trip.pickupAddress.substring(0, 30)}</p>
      </div>
    </button>
  );
}

export default function DispatchMapPage() {
  const { token, selectedCity } = useAuth();
  const { toast } = useToast();
  const [selectedDriver, setSelectedDriver] = useState<DriverWithVehicle | null>(null);
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [vehicleAssignOpen, setVehicleAssignOpen] = useState(false);
  const [assignDriverId, setAssignDriverId] = useState<string>("");
  const [assignVehicleId, setAssignVehicleId] = useState<string>("");
  const [smsDialogOpen, setSmsDialogOpen] = useState(false);
  const [smsTrip, setSmsTrip] = useState<Trip | null>(null);
  const [smsPatient, setSmsPatient] = useState<Patient | null>(null);
  const [smsCustomMessage, setSmsCustomMessage] = useState("");
  const [smsMode, setSmsMode] = useState<"template" | "custom">("template");
  const [overrideDialogOpen, setOverrideDialogOpen] = useState(false);
  const [overrideDriverId, setOverrideDriverId] = useState<string>("");
  const [overrideVehicleId, setOverrideVehicleId] = useState<string>("");

  const cityId = selectedCity?.id;
  const today = new Date().toLocaleDateString("en-CA");

  const { data: mapData, isLoading, refetch } = useQuery<MapData>({
    queryKey: ["/api/dispatch/map-data", cityId ? `?cityId=${cityId}` : ""],
    refetchInterval: 10000,
    enabled: true,
  });

  const { data: dailyAssignments, refetch: refetchAssignments } = useQuery<DriverVehicleAssignment[]>({
    queryKey: ["/api/vehicle-assignments", `?cityId=${cityId}&date=${today}`],
    enabled: !!cityId,
  });

  const assignTripMutation = useMutation({
    mutationFn: async ({ trip_id, driver_id }: { trip_id: number; driver_id: number }) => {
      const res = await fetch("/api/dispatch/assign-trip", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(token) },
        body: JSON.stringify({ trip_id, driver_id }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Assignment failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Trip assigned", description: data.eta ? `ETA: ${data.eta.minutes} min (${data.eta.distanceMiles} mi)` : "Trip assigned successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/map-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trips"] });
      setAssignDialogOpen(false);
      setSelectedTrip(null);
    },
    onError: (err: Error) => {
      toast({ title: "Assignment failed", description: err.message, variant: "destructive" });
    },
  });

  const assignVehicleMutation = useMutation({
    mutationFn: async ({ driver_id, vehicle_id }: { driver_id: number; vehicle_id: number }) => {
      const res = await fetch("/api/dispatch/assign-driver-vehicle", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(token) },
        body: JSON.stringify({ driver_id, vehicle_id }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Vehicle assignment failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Vehicle assigned" });
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/map-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/drivers"] });
      setVehicleAssignOpen(false);
      setSelectedDriver(null);
    },
    onError: (err: Error) => {
      toast({ title: "Vehicle assignment failed", description: err.message, variant: "destructive" });
    },
  });

  const autoAssignMutation = useMutation({
    mutationFn: async () => {
      if (!cityId) throw new Error("Select a city first");
      const res = await fetch("/api/dispatch/auto-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(token) },
        body: JSON.stringify({ city_id: cityId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Auto-assign failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Auto-assign complete", description: `Assigned: ${data.assigned}, Skipped: ${data.skipped}` });
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/map-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trips"] });
    },
    onError: (err: Error) => {
      toast({ title: "Auto-assign failed", description: err.message, variant: "destructive" });
    },
  });

  const overrideAssignMutation = useMutation({
    mutationFn: async ({ driver_id, vehicle_id, date }: { driver_id: number; vehicle_id: number; date: string }) => {
      const res = await fetch("/api/vehicle-assignments/override", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(token) },
        body: JSON.stringify({ driver_id, vehicle_id, date }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Override failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Vehicle assignment overridden" });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicle-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/map-data"] });
      setOverrideDialogOpen(false);
      setOverrideDriverId("");
      setOverrideVehicleId("");
    },
    onError: (err: Error) => {
      toast({ title: "Override failed", description: err.message, variant: "destructive" });
    },
  });

  const triggerAutoAssignMutation = useMutation({
    mutationFn: async () => {
      if (!cityId) throw new Error("Select a city first");
      const res = await fetch("/api/vehicle-assignments/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(token) },
        body: JSON.stringify({ city_id: cityId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Trigger failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Vehicle auto-assign complete", description: `Assigned: ${data.assigned}, Reused: ${data.reused}, Skipped: ${data.skipped}` });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicle-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/map-data"] });
    },
    onError: (err: Error) => {
      toast({ title: "Auto-assign failed", description: err.message, variant: "destructive" });
    },
  });

  const driverStatusMutation = useMutation({
    mutationFn: async ({ driver_id, status }: { driver_id: number; status: string }) => {
      const res = await fetch("/api/drivers/status", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(token) },
        body: JSON.stringify({ driver_id, status }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Status update failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Driver status updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/map-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/drivers"] });
      setSelectedDriver(null);
    },
    onError: (err: Error) => {
      toast({ title: "Status update failed", description: err.message, variant: "destructive" });
    },
  });

  const smsNotifyMutation = useMutation({
    mutationFn: async ({ tripId, status }: { tripId: number; status: string }) => {
      const res = await fetch(`/api/trips/${tripId}/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(token) },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Notification failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "SMS sent", description: `Notified ${data.patient}: ${data.status}` });
      setSmsDialogOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "SMS failed", description: err.message, variant: "destructive" });
    },
  });

  const smsDirectMutation = useMutation({
    mutationFn: async ({ to, message }: { to: string; message: string }) => {
      const res = await fetch("/api/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(token) },
        body: JSON.stringify({ to, message }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "SMS failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "SMS sent", description: "Custom message delivered" });
      setSmsDialogOpen(false);
      setSmsCustomMessage("");
    },
    onError: (err: Error) => {
      toast({ title: "SMS failed", description: err.message, variant: "destructive" });
    },
  });

  const { data: cancelRequests, refetch: refetchCancelRequests } = useQuery<any[]>({
    queryKey: ["/api/dispatch/cancel-requests", cityId ? `?cityId=${cityId}` : ""],
    refetchInterval: 15000,
    enabled: true,
  });

  const [approveModalOpen, setApproveModalOpen] = useState(false);
  const [approveTrip, setApproveTrip] = useState<any>(null);
  const [approveFaultParty, setApproveFaultParty] = useState("clinic");
  const [approveFeeOverride, setApproveFeeOverride] = useState("");
  const [approveOverrideNote, setApproveOverrideNote] = useState("");

  const CANCEL_FEE_SCHEDULE: Record<string, number> = {
    pre_assign: 0,
    assigned: 25,
    enroute_pickup: 50,
    arrived_pickup: 75,
    picked_up: 0,
  };

  const STAGE_LABELS: Record<string, string> = {
    pre_assign: "Pre-Assignment",
    assigned: "Assigned",
    enroute_pickup: "En Route to Pickup",
    arrived_pickup: "Arrived at Pickup",
    picked_up: "Patient Picked Up",
  };

  function getApproveIsBillable(faultParty: string): boolean {
    return !["driver", "dispatch"].includes(faultParty);
  }

  function getApproveBaseFee(cancelStage: string): number {
    return CANCEL_FEE_SCHEDULE[cancelStage] ?? 0;
  }

  function getApproveFinalFee(): number {
    if (!approveTrip) return 0;
    if (!getApproveIsBillable(approveFaultParty)) return 0;
    if (approveFeeOverride !== "") return Number(approveFeeOverride) || 0;
    return getApproveBaseFee(approveTrip.cancelStage || "pre_assign");
  }

  function openApproveModal(req: any) {
    setApproveTrip(req);
    setApproveFaultParty(req.faultParty || "clinic");
    setApproveFeeOverride("");
    setApproveOverrideNote("");
    setApproveModalOpen(true);
  }

  const approveCancelMutation = useMutation({
    mutationFn: async ({ tripId, faultParty, feeOverride, overrideNote }: {
      tripId: number; faultParty: string; feeOverride?: number; overrideNote?: string;
    }) => {
      const body: any = {
        reason: approveTrip?.cancelledReason || "Approved clinic cancellation request",
        type: "soft",
        faultParty,
      };
      if (feeOverride !== undefined) {
        body.feeOverride = feeOverride;
        body.overrideNote = overrideNote || "";
      }
      const res = await fetch(`/api/trips/${tripId}/cancel`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders(token) },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Approve failed");
      }
      return res.json();
    },
    onSuccess: (data: any) => {
      const feeMsg = data.billable && data.cancelFee > 0 ? ` | Fee: $${data.cancelFee}` : "";
      toast({ title: "Cancellation approved", description: `Trip cancelled.${feeMsg}` });
      setApproveModalOpen(false);
      setApproveTrip(null);
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/cancel-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/map-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trips"] });
    },
    onError: (err: Error) => {
      toast({ title: "Approve failed", description: err.message, variant: "destructive" });
    },
  });

  const rejectCancelMutation = useMutation({
    mutationFn: async (tripId: number) => {
      const res = await fetch(`/api/trips/${tripId}/reject-cancel`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders(token) },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Reject failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Cancellation rejected", description: "Trip remains active." });
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/cancel-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/map-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trips"] });
    },
    onError: (err: Error) => {
      toast({ title: "Reject failed", description: err.message, variant: "destructive" });
    },
  });

  const returnTripMutation = useMutation({
    mutationFn: async ({ tripId, notes }: { tripId: number; notes?: string }) => {
      const res = await fetch(`/api/trips/${tripId}/return-trip`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(token) },
        body: JSON.stringify({ notes }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Return trip failed");
      }
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Return trip created", description: `Trip ${data.publicId} created to return patient.` });
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/map-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trips"] });
    },
    onError: (err: Error) => {
      toast({ title: "Return trip failed", description: err.message, variant: "destructive" });
    },
  });

  async function openSmsDialog(trip: Trip) {
    setSmsTrip(trip);
    setSmsMode("template");
    setSmsCustomMessage("");
    try {
      const res = await fetch(`/api/patients?cityId=${trip.cityId}`, {
        headers: authHeaders(token),
      });
      if (res.ok) {
        const patients: Patient[] = await res.json();
        const found = patients.find((p) => p.id === trip.patientId);
        setSmsPatient(found || null);
      } else {
        setSmsPatient(null);
      }
    } catch {
      setSmsPatient(null);
    }
    setSmsDialogOpen(true);
  }

  const driversWithLocation = mapData?.drivers.filter((d) => d.lastLat && d.lastLng) || [];
  const driversWithoutLocation = mapData?.drivers.filter((d) => !d.lastLat || !d.lastLng) || [];
  const scheduledTrips = mapData?.trips.filter((t) => t.status === "SCHEDULED") || [];
  const TERMINAL_STATUSES = ["COMPLETED", "CANCELLED", "NO_SHOW", "SCHEDULED"];
  const assignedTrips = mapData?.trips.filter((t) => !TERMINAL_STATUSES.includes(t.status)) || [];
  const availableVehicles = mapData?.vehicles.filter((v) => v.status === "ACTIVE") || [];

  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Skeleton className="h-64" />
          <Skeleton className="h-64 lg:col-span-2" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-dispatch-title">Dispatch Center</h1>
          <p className="text-sm text-muted-foreground">
            {selectedCity ? `${selectedCity.name}, ${selectedCity.state}` : "All cities"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={() => refetch()}
            data-testid="button-refresh-map"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button
            onClick={() => autoAssignMutation.mutate()}
            disabled={autoAssignMutation.isPending || !cityId}
            data-testid="button-auto-assign"
          >
            <Zap className="w-4 h-4 mr-2" />
            {autoAssignMutation.isPending ? "Assigning..." : "Auto-Assign"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-lg font-semibold" data-testid="text-driver-count">{mapData?.drivers.length || 0}</p>
                <p className="text-xs text-muted-foreground">Drivers</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <CircleDot className="w-4 h-4 flex-shrink-0" style={{ color: DISPATCH_STATUS_COLORS.available }} />
              <div className="min-w-0">
                <p className="text-lg font-semibold" data-testid="text-available-count">
                  {mapData?.drivers.filter((d) => d.dispatchStatus === "available").length || 0}
                </p>
                <p className="text-xs text-muted-foreground">Available</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 flex-shrink-0" style={{ color: TRIP_STATUS_COLORS.SCHEDULED }} />
              <div className="min-w-0">
                <p className="text-lg font-semibold" data-testid="text-unassigned-count">{scheduledTrips.length}</p>
                <p className="text-xs text-muted-foreground">Unassigned</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <Navigation className="w-4 h-4 flex-shrink-0" style={{ color: TRIP_STATUS_COLORS.IN_PROGRESS }} />
              <div className="min-w-0">
                <p className="text-lg font-semibold" data-testid="text-active-count">{assignedTrips.length}</p>
                <p className="text-xs text-muted-foreground">Active Trips</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="space-y-4">
          <Card>
            <CardHeader className="p-3 pb-2 flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-sm">Drivers</CardTitle>
              <Badge variant="secondary" className="text-xs">{mapData?.drivers.length || 0}</Badge>
            </CardHeader>
            <CardContent className="p-2 space-y-1 max-h-80 overflow-y-auto">
              {mapData?.drivers.length === 0 && (
                <p className="text-xs text-muted-foreground p-2" data-testid="text-no-drivers">No drivers found</p>
              )}
              {mapData?.drivers.map((driver) => (
                <DriverMarker
                  key={driver.id}
                  driver={driver}
                  onClick={() => setSelectedDriver(driver)}
                />
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-3 pb-2 flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-sm">Unassigned Trips</CardTitle>
              <Badge variant="secondary" className="text-xs">{scheduledTrips.length}</Badge>
            </CardHeader>
            <CardContent className="p-2 space-y-1 max-h-60 overflow-y-auto">
              {scheduledTrips.length === 0 && (
                <p className="text-xs text-muted-foreground p-2" data-testid="text-no-trips">No unassigned trips</p>
              )}
              {scheduledTrips.map((trip) => (
                <TripMarker
                  key={trip.id}
                  trip={trip}
                  onClick={() => {
                    setSelectedTrip(trip);
                    setAssignDialogOpen(true);
                  }}
                />
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="p-3 pb-2 flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-sm">Active Trips</CardTitle>
              <Badge variant="secondary" className="text-xs">{assignedTrips.length}</Badge>
            </CardHeader>
            <CardContent className="p-2 space-y-2 max-h-96 overflow-y-auto">
              {assignedTrips.length === 0 && (
                <p className="text-xs text-muted-foreground p-2" data-testid="text-no-active-trips">No active trips</p>
              )}
              {assignedTrips.map((trip) => {
                const assignedDriver = mapData?.drivers.find((d) => d.id === trip.driverId);
                const assignedVehicle = mapData?.vehicles.find((v) => v.id === trip.vehicleId);
                const etaMinutes = trip.lastEtaMinutes;
                const distMiles = trip.distanceMiles ? parseFloat(trip.distanceMiles) : null;
                const etaAge = trip.lastEtaUpdatedAt
                  ? Math.round((Date.now() - new Date(trip.lastEtaUpdatedAt).getTime()) / 60000)
                  : null;
                const isEtaStale = etaAge !== null && etaAge > 3;
                const isArrivingSoon = etaMinutes !== null && etaMinutes !== undefined && etaMinutes <= 5;
                return (
                  <div
                    key={trip.id}
                    className={`flex items-center gap-3 p-3 rounded-md border bg-card ${isArrivingSoon ? "border-green-500/50" : ""}`}
                    data-testid={`active-trip-${trip.id}`}
                  >
                    <div
                      className="w-2 h-full min-h-[3rem] rounded-full flex-shrink-0"
                      style={{ backgroundColor: TRIP_STATUS_COLORS[trip.status] }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium" data-testid={`text-trip-id-${trip.id}`}>{trip.publicId}</span>
                        <Badge variant="outline" className="text-[10px]" data-testid={`badge-trip-status-${trip.id}`}>{trip.status.replace("_", " ")}</Badge>
                        {trip.fiveMinAlertSent && (
                          <Badge variant="secondary" className="text-[10px] text-green-600 dark:text-green-400" data-testid={`badge-alert-sent-${trip.id}`}>
                            <Bell className="w-3 h-3 mr-1" />
                            Alert Sent
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                        {etaMinutes !== null && etaMinutes !== undefined && (
                          <div className={`flex items-center gap-1 text-xs font-medium ${isArrivingSoon ? "text-green-600 dark:text-green-400" : ""}`} data-testid={`text-eta-${trip.id}`}>
                            <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                            <span>{etaMinutes} min</span>
                            {isEtaStale && <span className="text-[9px] text-muted-foreground">(stale)</span>}
                          </div>
                        )}
                        {distMiles !== null && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`text-distance-${trip.id}`}>
                            <Route className="w-3.5 h-3.5 flex-shrink-0" />
                            <span>{distMiles} mi</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground">
                        <MapPin className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">{trip.pickupAddress.substring(0, 40)}</span>
                        <ArrowRight className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">{trip.dropoffAddress.substring(0, 40)}</span>
                      </div>
                      {assignedDriver && (
                        <div className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground">
                          <UserCheck className="w-3 h-3 flex-shrink-0" />
                          <span>{assignedDriver.firstName} {assignedDriver.lastName}</span>
                          {assignedDriver.dispatchStatus && (
                            <Badge variant="outline" className="text-[9px] ml-1" data-testid={`badge-driver-status-${trip.id}`}>
                              <span
                                className="w-1.5 h-1.5 rounded-full mr-1"
                                style={{ backgroundColor: DISPATCH_STATUS_COLORS[assignedDriver.dispatchStatus] }}
                              />
                              {DISPATCH_STATUS_LABELS[assignedDriver.dispatchStatus]}
                            </Badge>
                          )}
                          {assignedVehicle && (
                            <>
                              <Truck className="w-3 h-3 flex-shrink-0 ml-1" />
                              <span>{assignedVehicle.name}</span>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => openSmsDialog(trip)}
                      data-testid={`button-sms-trip-${trip.id}`}
                    >
                      <MessageSquare className="w-4 h-4" />
                    </Button>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {cancelRequests && cancelRequests.length > 0 && (
            <Card>
              <CardHeader className="p-3 pb-2 flex flex-row items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <XCircle className="w-4 h-4 text-orange-500" />
                  <CardTitle className="text-sm">Cancel Requests</CardTitle>
                </div>
                <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200">
                  {cancelRequests.length}
                </Badge>
              </CardHeader>
              <CardContent className="p-2 space-y-2 max-h-72 overflow-y-auto">
                {cancelRequests.map((req: any) => {
                  const stage = req.cancelStage || "pre_assign";
                  const baseFee = CANCEL_FEE_SCHEDULE[stage] ?? 0;
                  const isPicked = stage === "picked_up";
                  return (
                    <div
                      key={req.id}
                      className="flex items-start gap-3 p-3 rounded-md border border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-950/20"
                      data-testid={`cancel-request-${req.id}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-medium" data-testid={`text-cancel-trip-id-${req.id}`}>{req.publicId}</span>
                          <Badge variant="outline" className="text-[10px]">{req.status?.replace(/_/g, " ")}</Badge>
                          <Badge variant="outline" className="text-[10px]">{STAGE_LABELS[stage] || stage}</Badge>
                        </div>
                        {req.patient && (
                          <div className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground">
                            <UserCheck className="w-3 h-3 flex-shrink-0" />
                            <span>{req.patient.firstName} {req.patient.lastName}</span>
                            {req.patient.phone && (
                              <a href={`tel:${req.patient.phone}`} className="text-blue-600 dark:text-blue-400 ml-1">
                                <Phone className="w-3 h-3 inline" />
                              </a>
                            )}
                          </div>
                        )}
                        {req.clinic && (
                          <div className="flex items-center gap-1 mt-0.5 text-[10px] text-muted-foreground">
                            <Building2 className="w-3 h-3 flex-shrink-0" />
                            <span>{req.clinic.name}</span>
                          </div>
                        )}
                        {req.cancelledReason && (
                          <p className="text-[10px] text-orange-700 dark:text-orange-300 mt-1" data-testid={`text-cancel-reason-${req.id}`}>
                            Reason: {req.cancelledReason}
                          </p>
                        )}
                        {req.cancelledByName && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            Requested by: {req.cancelledByName}
                          </p>
                        )}
                        {baseFee > 0 && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            <DollarSign className="w-3 h-3 inline" /> Est. fee: ${baseFee}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-center gap-1 flex-shrink-0">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-green-600 dark:text-green-400"
                          onClick={() => openApproveModal(req)}
                          data-testid={`button-approve-cancel-${req.id}`}
                          title="Approve cancellation"
                        >
                          <CheckCircle className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-red-600 dark:text-red-400"
                          onClick={() => rejectCancelMutation.mutate(req.id)}
                          disabled={rejectCancelMutation.isPending}
                          data-testid={`button-reject-cancel-${req.id}`}
                          title="Reject cancellation"
                        >
                          <XCircle className="w-4 h-4" />
                        </Button>
                        {isPicked && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-blue-600 dark:text-blue-400"
                            onClick={() => returnTripMutation.mutate({ tripId: req.id, notes: "Return after cancel request" })}
                            disabled={returnTripMutation.isPending}
                            data-testid={`button-return-trip-${req.id}`}
                            title="Create return trip"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="p-3 pb-2">
              <CardTitle className="text-sm">Legend</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1 font-medium">Driver Status</p>
                  {Object.entries(DISPATCH_STATUS_LABELS).map(([key, label]) => (
                    <div key={key} className="flex items-center gap-1.5 mb-0.5">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: DISPATCH_STATUS_COLORS[key] }} />
                      <span className="text-[10px]">{label}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground mb-1 font-medium">Trip Status</p>
                  {Object.entries(TRIP_STATUS_COLORS).filter(([k]) => !["COMPLETED", "CANCELLED", "NO_SHOW"].includes(k)).map(([key, color]) => (
                    <div key={key} className="flex items-center gap-1.5 mb-0.5">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                      <span className="text-[10px]">{key.replace(/_/g, " ")}</span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader className="p-3 pb-2 flex flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-sm">Daily Vehicle Assignments</CardTitle>
            <Badge variant="secondary" className="text-xs">{today}</Badge>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setOverrideDriverId("");
                setOverrideVehicleId("");
                setOverrideDialogOpen(true);
              }}
              disabled={!cityId}
              data-testid="button-override-assignment"
            >
              <ArrowLeftRight className="w-4 h-4 mr-1.5" />
              Override
            </Button>
            <Button
              size="sm"
              onClick={() => triggerAutoAssignMutation.mutate()}
              disabled={triggerAutoAssignMutation.isPending || !cityId}
              data-testid="button-trigger-auto-assign"
            >
              <Zap className="w-4 h-4 mr-1.5" />
              {triggerAutoAssignMutation.isPending ? "Running..." : "Auto-Assign Vehicles"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-2">
          {!dailyAssignments || dailyAssignments.length === 0 ? (
            <p className="text-xs text-muted-foreground p-2" data-testid="text-no-daily-assignments">
              No vehicle assignments for today. Click "Auto-Assign Vehicles" to generate.
            </p>
          ) : (
            <div className="space-y-1">
              {dailyAssignments.map((assignment) => {
                const driver = mapData?.drivers.find(d => d.id === assignment.driverId);
                const vehicle = mapData?.vehicles.find(v => v.id === assignment.vehicleId);
                return (
                  <div
                    key={assignment.id}
                    className="flex items-center gap-3 p-2 rounded-md border bg-card"
                    data-testid={`daily-assignment-${assignment.id}`}
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <UserCheck className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <span className="text-sm font-medium truncate">
                        {driver ? `${driver.firstName} ${driver.lastName}` : `Driver #${assignment.driverId}`}
                      </span>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Truck className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <span className="text-sm truncate">
                        {vehicle ? `${vehicle.name} (${vehicle.licensePlate})` : `Vehicle #${assignment.vehicleId}`}
                      </span>
                    </div>
                    <Badge
                      variant={assignment.assignedBy === "dispatch" ? "default" : "secondary"}
                      className="text-[10px] flex-shrink-0"
                      data-testid={`badge-assigned-by-${assignment.id}`}
                    >
                      {assignment.assignedBy === "dispatch" ? "Dispatch" : "Auto"}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {overrideDialogOpen && (
        <Dialog open={overrideDialogOpen} onOpenChange={(open) => !open && setOverrideDialogOpen(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Override Vehicle Assignment</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Assign a specific vehicle to a driver for today ({today}). This will override any existing auto-assignment.
              </p>
              <div>
                <label className="text-sm font-medium mb-1 block">Driver</label>
                <Select value={overrideDriverId} onValueChange={(val) => { setOverrideDriverId(val); setOverrideVehicleId(""); }}>
                  <SelectTrigger data-testid="select-override-driver">
                    <SelectValue placeholder="Select a driver" />
                  </SelectTrigger>
                  <SelectContent>
                    {mapData?.drivers
                      .filter(d => d.status === "ACTIVE")
                      .map(d => (
                        <SelectItem key={d.id} value={d.id.toString()} data-testid={`option-override-driver-${d.id}`}>
                          {d.firstName} {d.lastName} ({d.publicId})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Vehicle</label>
                <Select value={overrideVehicleId} onValueChange={setOverrideVehicleId}>
                  <SelectTrigger data-testid="select-override-vehicle">
                    <SelectValue placeholder="Select a vehicle" />
                  </SelectTrigger>
                  <SelectContent>
                    {(() => {
                      const selectedOvDriver = mapData?.drivers.find(d => d.id === parseInt(overrideDriverId));
                      const filteredVehicles = (mapData?.vehicles || []).filter(v =>
                        v.status === "ACTIVE" && (selectedOvDriver ? v.cityId === selectedOvDriver.cityId : true)
                      );
                      return filteredVehicles.length > 0 ? filteredVehicles.map(v => (
                        <SelectItem key={v.id} value={v.id.toString()} data-testid={`option-override-vehicle-${v.id}`}>
                          {v.name} - {v.licensePlate}
                          {v.wheelchairAccessible ? " (WC)" : ""}
                        </SelectItem>
                      )) : (
                        <div className="px-2 py-1.5 text-sm text-muted-foreground">
                          {overrideDriverId ? "No vehicles in this driver's city" : "Select a driver first"}
                        </div>
                      );
                    })()}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOverrideDialogOpen(false)}>Cancel</Button>
              <Button
                onClick={() => {
                  if (overrideDriverId && overrideVehicleId) {
                    overrideAssignMutation.mutate({
                      driver_id: parseInt(overrideDriverId),
                      vehicle_id: parseInt(overrideVehicleId),
                      date: today,
                    });
                  }
                }}
                disabled={!overrideDriverId || !overrideVehicleId || overrideAssignMutation.isPending}
                data-testid="button-confirm-override"
              >
                {overrideAssignMutation.isPending ? "Saving..." : "Override Assignment"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {selectedDriver && (
        <Dialog open={!!selectedDriver} onOpenChange={(open) => !open && setSelectedDriver(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Driver: {selectedDriver.firstName} {selectedDriver.lastName}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">ID:</span> {selectedDriver.publicId}
                </div>
                <div>
                  <span className="text-muted-foreground">Phone:</span> {selectedDriver.phone}
                </div>
                <div>
                  <span className="text-muted-foreground">Employment:</span> {selectedDriver.status}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Dispatch:</span>
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: DISPATCH_STATUS_COLORS[selectedDriver.dispatchStatus] }}
                  />
                  {DISPATCH_STATUS_LABELS[selectedDriver.dispatchStatus]}
                </div>
                <div>
                  <span className="text-muted-foreground">Vehicle:</span>{" "}
                  {selectedDriver.vehicle ? selectedDriver.vehicle.name : "None"}
                </div>
                {selectedDriver.lastLat && (
                  <div>
                    <span className="text-muted-foreground">Location:</span>{" "}
                    {selectedDriver.lastLat.toFixed(4)}, {selectedDriver.lastLng?.toFixed(4)}
                  </div>
                )}
              </div>

              <div>
                <p className="text-sm font-medium mb-2">Change Dispatch Status</p>
                <div className="flex gap-2 flex-wrap">
                  {(["available", "enroute", "hold", "off"] as const).map((status) => (
                    <Button
                      key={status}
                      variant={selectedDriver.dispatchStatus === status ? "default" : "outline"}
                      size="sm"
                      onClick={() => driverStatusMutation.mutate({ driver_id: selectedDriver.id, status })}
                      disabled={driverStatusMutation.isPending}
                      data-testid={`button-status-${status}`}
                    >
                      <span
                        className="w-2 h-2 rounded-full mr-1.5"
                        style={{ backgroundColor: DISPATCH_STATUS_COLORS[status] }}
                      />
                      {DISPATCH_STATUS_LABELS[status]}
                    </Button>
                  ))}
                </div>
              </div>

              <div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setVehicleAssignOpen(true);
                    setAssignVehicleId("");
                  }}
                  data-testid="button-assign-vehicle"
                >
                  <Truck className="w-4 h-4 mr-1.5" />
                  {selectedDriver.vehicleId ? "Change Vehicle" : "Assign Vehicle"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {vehicleAssignOpen && selectedDriver && (
        <Dialog open={vehicleAssignOpen} onOpenChange={(open) => !open && setVehicleAssignOpen(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Assign Vehicle to {selectedDriver.firstName}</DialogTitle>
            </DialogHeader>
            <Select value={assignVehicleId} onValueChange={setAssignVehicleId}>
              <SelectTrigger data-testid="select-vehicle-assign">
                <SelectValue placeholder="Select a vehicle" />
              </SelectTrigger>
              <SelectContent>
                {availableVehicles
                  .filter((v) => v.cityId === selectedDriver.cityId)
                  .map((v) => (
                    <SelectItem key={v.id} value={v.id.toString()} data-testid={`option-vehicle-${v.id}`}>
                      {v.name} - {v.licensePlate}
                      {v.wheelchairAccessible ? " (WC)" : ""}
                    </SelectItem>
                  ))}
                {availableVehicles.filter((v) => v.cityId === selectedDriver.cityId).length === 0 && (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground" data-testid="text-no-compatible-vehicles">
                    No vehicles available in this city
                  </div>
                )}
              </SelectContent>
            </Select>
            <DialogFooter>
              <Button variant="outline" onClick={() => setVehicleAssignOpen(false)}>Cancel</Button>
              <Button
                onClick={() => {
                  if (assignVehicleId && selectedDriver) {
                    assignVehicleMutation.mutate({
                      driver_id: selectedDriver.id,
                      vehicle_id: parseInt(assignVehicleId),
                    });
                  }
                }}
                disabled={!assignVehicleId || assignVehicleMutation.isPending}
                data-testid="button-confirm-vehicle-assign"
              >
                {assignVehicleMutation.isPending ? "Assigning..." : "Assign"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {assignDialogOpen && selectedTrip && (
        <Dialog open={assignDialogOpen} onOpenChange={(open) => !open && setAssignDialogOpen(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Assign Trip {selectedTrip.publicId}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="text-sm space-y-1">
                <div><span className="text-muted-foreground">Pickup:</span> {selectedTrip.pickupAddress}</div>
                <div><span className="text-muted-foreground">Dropoff:</span> {selectedTrip.dropoffAddress}</div>
                <div><span className="text-muted-foreground">Date:</span> {selectedTrip.scheduledDate} at {selectedTrip.scheduledTime}</div>
              </div>
              <Select value={assignDriverId} onValueChange={setAssignDriverId}>
                <SelectTrigger data-testid="select-driver-assign">
                  <SelectValue placeholder="Select a driver" />
                </SelectTrigger>
                <SelectContent>
                  {mapData?.drivers
                    .filter((d) => d.status === "ACTIVE" && d.vehicleId && d.cityId === selectedTrip.cityId)
                    .map((d) => (
                      <SelectItem key={d.id} value={d.id.toString()} data-testid={`option-driver-${d.id}`}>
                        {d.firstName} {d.lastName}
                        {d.vehicle ? ` (${d.vehicle.name})` : ""}
                        {" - "}
                        {DISPATCH_STATUS_LABELS[d.dispatchStatus]}
                      </SelectItem>
                    ))}
                  {(mapData?.drivers.filter((d) => d.status === "ACTIVE" && d.vehicleId && d.cityId === selectedTrip.cityId).length ?? 0) === 0 && (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground" data-testid="text-no-compatible-drivers">
                      No drivers available in this city
                    </div>
                  )}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>Cancel</Button>
              <Button
                onClick={() => {
                  if (assignDriverId && selectedTrip) {
                    assignTripMutation.mutate({
                      trip_id: selectedTrip.id,
                      driver_id: parseInt(assignDriverId),
                    });
                  }
                }}
                disabled={!assignDriverId || assignTripMutation.isPending}
                data-testid="button-confirm-trip-assign"
              >
                {assignTripMutation.isPending ? "Assigning..." : "Assign & Calculate ETA"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {smsDialogOpen && smsTrip && (
        <Dialog open={smsDialogOpen} onOpenChange={(open) => { if (!open) { setSmsDialogOpen(false); setSmsTrip(null); setSmsPatient(null); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5" />
                SMS Notification - {smsTrip.publicId}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              {!smsPatient ? (
                <div className="flex items-center gap-2 text-sm text-destructive p-3 rounded-md border border-destructive/30 bg-destructive/5">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>Loading patient data...</span>
                </div>
              ) : !smsPatient.phone ? (
                <div className="flex items-center gap-2 text-sm text-destructive p-3 rounded-md border border-destructive/30 bg-destructive/5" data-testid="text-sms-error">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>Patient phone missing. Cannot send SMS.</span>
                </div>
              ) : (
                <>
                  <div className="text-sm space-y-1">
                    <div><span className="text-muted-foreground">Patient:</span> {smsPatient.firstName} {smsPatient.lastName}</div>
                    <div><span className="text-muted-foreground">Phone:</span> {smsPatient.phone}</div>
                    <div><span className="text-muted-foreground">Trip:</span> {smsTrip.pickupAddress.substring(0, 40)}</div>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant={smsMode === "template" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSmsMode("template")}
                      data-testid="button-sms-template-mode"
                    >
                      Quick Templates
                    </Button>
                    <Button
                      variant={smsMode === "custom" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSmsMode("custom")}
                      data-testid="button-sms-custom-mode"
                    >
                      Custom Message
                    </Button>
                  </div>

                  {smsMode === "template" ? (
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        { status: "scheduled", label: "Scheduled" },
                        { status: "driver_assigned", label: "Driver Assigned" },
                        { status: "en_route", label: "En Route" },
                        { status: "arriving_soon", label: "Arriving Soon" },
                        { status: "arrived", label: "Arrived" },
                        { status: "picked_up", label: "Picked Up" },
                        { status: "completed", label: "Completed" },
                        { status: "canceled", label: "Canceled" },
                      ] as const).map(({ status, label }) => (
                        <Button
                          key={status}
                          variant="outline"
                          size="sm"
                          className="justify-start"
                          onClick={() => smsNotifyMutation.mutate({ tripId: smsTrip!.id, status })}
                          disabled={smsNotifyMutation.isPending}
                          data-testid={`button-sms-template-${status}`}
                        >
                          <Send className="w-3 h-3 mr-1.5 flex-shrink-0" />
                          {label}
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Textarea
                        value={smsCustomMessage}
                        onChange={(e) => setSmsCustomMessage(e.target.value)}
                        placeholder="Type your message..."
                        className="resize-none"
                        data-testid="input-sms-custom"
                      />
                      <Button
                        onClick={() => {
                          if (smsPatient?.phone && smsCustomMessage.trim()) {
                            smsDirectMutation.mutate({ to: smsPatient.phone, message: smsCustomMessage.trim() });
                          }
                        }}
                        disabled={!smsCustomMessage.trim() || smsDirectMutation.isPending}
                        data-testid="button-sms-send-custom"
                      >
                        <Send className="w-4 h-4 mr-2" />
                        {smsDirectMutation.isPending ? "Sending..." : "Send SMS"}
                      </Button>
                    </div>
                  )}

                  {smsNotifyMutation.isPending && (
                    <p className="text-xs text-muted-foreground">Sending notification...</p>
                  )}
                </>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={approveModalOpen} onOpenChange={setApproveModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Cancellation</DialogTitle>
          </DialogHeader>
          {approveTrip && (
            <div className="space-y-4">
              <div className="p-3 rounded-md border bg-muted/30">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{approveTrip.publicId}</span>
                  <Badge variant="outline" className="text-xs">{STAGE_LABELS[approveTrip.cancelStage] || approveTrip.cancelStage || "Unknown"}</Badge>
                </div>
                {approveTrip.patient && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Patient: {approveTrip.patient.firstName} {approveTrip.patient.lastName}
                  </p>
                )}
                {approveTrip.clinic && (
                  <p className="text-xs text-muted-foreground">
                    Clinic: {approveTrip.clinic.name}
                  </p>
                )}
                {approveTrip.cancelledReason && (
                  <p className="text-xs text-orange-700 dark:text-orange-300 mt-1">
                    Reason: {approveTrip.cancelledReason}
                  </p>
                )}
              </div>

              <div>
                <Label>Fault Party (required)</Label>
                <Select value={approveFaultParty} onValueChange={setApproveFaultParty}>
                  <SelectTrigger data-testid="select-fault-party">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="clinic">Clinic</SelectItem>
                    <SelectItem value="driver">Driver</SelectItem>
                    <SelectItem value="patient">Patient</SelectItem>
                    <SelectItem value="dispatch">Dispatch</SelectItem>
                    <SelectItem value="unknown">Unknown</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="p-3 rounded-md border">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-sm">Billable</Label>
                  <Badge className={getApproveIsBillable(approveFaultParty)
                    ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                    : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"}>
                    {getApproveIsBillable(approveFaultParty) ? "Yes" : "No"}
                  </Badge>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {["driver", "dispatch"].includes(approveFaultParty)
                    ? "Non-billable: fault is on driver/dispatch"
                    : "Billable: clinic/patient/unknown fault"}
                </p>
              </div>

              {getApproveIsBillable(approveFaultParty) && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm">Base Fee:</span>
                    <span className="text-sm font-medium">${getApproveBaseFee(approveTrip.cancelStage || "pre_assign")}</span>
                  </div>
                  {approveTrip.cancelStage === "picked_up" && (
                    <p className="text-xs text-orange-600 dark:text-orange-400">
                      Patient already picked up. Consider creating a return trip instead.
                    </p>
                  )}
                  <div>
                    <Label>Fee Override (optional)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder={`$${getApproveBaseFee(approveTrip.cancelStage || "pre_assign")} (default)`}
                      value={approveFeeOverride}
                      onChange={(e) => setApproveFeeOverride(e.target.value)}
                      data-testid="input-fee-override"
                    />
                  </div>
                  {approveFeeOverride !== "" && (
                    <div>
                      <Label>Override Reason (required if overriding)</Label>
                      <Textarea
                        placeholder="Why is the fee different?"
                        value={approveOverrideNote}
                        onChange={(e) => setApproveOverrideNote(e.target.value)}
                        data-testid="input-override-note"
                      />
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/50">
                    <span className="text-sm font-medium">Final Fee:</span>
                    <span className="text-lg font-bold">${getApproveFinalFee().toFixed(2)}</span>
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            {approveTrip?.cancelStage === "picked_up" && (
              <Button
                variant="outline"
                onClick={() => {
                  returnTripMutation.mutate({ tripId: approveTrip.id, notes: "Return after clinic cancel" });
                  setApproveModalOpen(false);
                }}
                disabled={returnTripMutation.isPending}
                data-testid="button-create-return-trip"
              >
                <RotateCcw className="w-4 h-4 mr-1" />
                Create Return Trip
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => setApproveModalOpen(false)}
              data-testid="button-cancel-approve-modal"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={approveCancelMutation.isPending || (approveFeeOverride !== "" && !approveOverrideNote.trim())}
              onClick={() => {
                if (!approveTrip) return;
                const params: any = {
                  tripId: approveTrip.id,
                  faultParty: approveFaultParty,
                };
                if (approveFeeOverride !== "") {
                  params.feeOverride = Number(approveFeeOverride);
                  params.overrideNote = approveOverrideNote;
                }
                approveCancelMutation.mutate(params);
              }}
              data-testid="button-confirm-approve-cancel"
            >
              {approveCancelMutation.isPending ? "Processing..." : "Approve Cancellation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
