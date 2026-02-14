import { useState } from "react";
import { useAuth, authHeaders } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiFetch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Truck,
  UserCheck,
  AlertTriangle,
  RefreshCw,
  ArrowLeftRight,
  Calendar,
  MapPin,
  Play,
  CheckCircle,
  CheckCircle2,
  XCircle,
  Clock,
  UserPlus,
  CircleDot,
  Coffee,
  LogOut,
  PauseCircle,
  Car,
  Navigation,
  ArrowRight,
  User,
} from "lucide-react";

interface Assignment {
  id: number;
  driverId: number;
  vehicleId: number;
  date: string;
  cityId: number;
  shiftStartTime: string;
  assignedBy: string;
  status: string;
  notes: string | null;
  updatedBy: number | null;
  updatedAt: string | null;
  createdAt: string;
}

interface DriverInfo {
  id: number;
  firstName: string;
  lastName: string;
  publicId: string;
  phone: string;
  cityId: number;
  status: string;
}

interface VehicleInfo {
  id: number;
  name: string;
  publicId: string;
  licensePlate: string;
  status: string;
  active: boolean;
}

interface DriverStatusInfo {
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
}

interface DriverStatusData {
  available: DriverStatusInfo[];
  on_trip: DriverStatusInfo[];
  paused: DriverStatusInfo[];
  hold: DriverStatusInfo[];
  logged_out: DriverStatusInfo[];
}

export default function AssignmentsPage() {
  const { token, user, cities, selectedCity } = useAuth();
  const { toast } = useToast();
  const [cityId, setCityId] = useState<number | null>(selectedCity?.id ?? null);
  const [mainTab, setMainTab] = useState("scheduler");

  const selectedCityData = cities.find((c) => c.id === cityId);
  const getLocalDate = () => {
    const tz = (selectedCityData as any)?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    return new Date().toLocaleDateString("en-CA", { timeZone: tz });
  };

  const [selectedDate, setSelectedDate] = useState(getLocalDate());
  const [reassignDialog, setReassignDialog] = useState<{ assignment: Assignment; driverName: string; currentVehicleName: string } | null>(null);
  const [reassignVehicleId, setReassignVehicleId] = useState<string>("");
  const [reassignNotes, setReassignNotes] = useState("");
  const [reassignUpdateTrips, setReassignUpdateTrips] = useState(true);
  const [swapDialog, setSwapDialog] = useState<{ assignmentA: Assignment; driverAName: string } | null>(null);
  const [swapAssignmentBId, setSwapAssignmentBId] = useState<string>("");
  const [swapNotes, setSwapNotes] = useState("");
  const [swapUpdateTrips, setSwapUpdateTrips] = useState(true);

  const isSuperAdmin = user?.role === "SUPER_ADMIN";

  const { data: assignments, isLoading: assignmentsLoading, isError: assignmentsError, refetch: refetchAssignments } = useQuery<Assignment[]>({
    queryKey: ["/api/vehicle-assignments", cityId, selectedDate],
    queryFn: async () => {
      if (!cityId || !selectedDate) return [];
      const res = await fetch(`/api/vehicle-assignments?cityId=${cityId}&date=${selectedDate}`, {
        headers: authHeaders(token),
      });
      if (!res.ok) throw new Error("Failed to load assignments");
      return res.json();
    },
    enabled: !!cityId && !!selectedDate,
  });

  const { data: driversData } = useQuery<DriverInfo[]>({
    queryKey: ["/api/drivers", cityId],
    queryFn: async () => {
      if (!cityId) return [];
      const res = await fetch(`/api/drivers?cityId=${cityId}`, {
        headers: authHeaders(token),
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!cityId,
  });

  const { data: vehiclesData } = useQuery<VehicleInfo[]>({
    queryKey: ["/api/vehicles", cityId],
    queryFn: async () => {
      if (!cityId) return [];
      const res = await fetch(`/api/vehicles?cityId=${cityId}`, {
        headers: authHeaders(token),
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!cityId,
  });

  const { data: healthData } = useQuery({
    queryKey: ["/api/assignments/health"],
    queryFn: async () => {
      const res = await fetch("/api/assignments/health", { headers: authHeaders(token) });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const activeDrivers = (driversData || []).filter(d => d.status === "ACTIVE");
  const activeVehicles = (vehiclesData || []).filter(v => v.status === "ACTIVE" && v.active);

  const getDriverName = (driverId: number) => {
    const d = (driversData || []).find(dr => dr.id === driverId);
    return d ? `${d.firstName} ${d.lastName}` : `Driver #${driverId}`;
  };

  const getDriverPublicId = (driverId: number) => {
    const d = (driversData || []).find(dr => dr.id === driverId);
    return d?.publicId || "";
  };

  const getVehicleName = (vehicleId: number) => {
    const v = (vehiclesData || []).find(ve => ve.id === vehicleId);
    return v ? v.name : `Vehicle #${vehicleId}`;
  };

  const getVehiclePlate = (vehicleId: number) => {
    const v = (vehiclesData || []).find(ve => ve.id === vehicleId);
    return v?.licensePlate || "";
  };

  const assignedDriverIds = new Set((assignments || []).map(a => a.driverId));
  const unassignedDrivers = activeDrivers.filter(d => !assignedDriverIds.has(d.id));

  const reassignMutation = useMutation({
    mutationFn: async (data: { assignmentId: number; newVehicleId: number; updateTrips: boolean; notes?: string }) => {
      const res = await apiFetch("/api/dispatch/assignments/reassign-vehicle", token, {
        method: "POST",
        body: JSON.stringify(data),
      });
      return res;
    },
    onSuccess: () => {
      toast({ title: "Vehicle reassigned successfully" });
      setReassignDialog(null);
      setReassignVehicleId("");
      setReassignNotes("");
      queryClient.invalidateQueries({ queryKey: ["/api/vehicle-assignments", cityId, selectedDate] });
    },
    onError: (err: any) => {
      toast({ title: "Reassign failed", description: err.message, variant: "destructive" });
    },
  });

  const swapMutation = useMutation({
    mutationFn: async (data: { assignmentIdA: number; assignmentIdB: number; updateTrips: boolean; notes?: string }) => {
      const res = await apiFetch("/api/dispatch/assignments/swap-drivers", token, {
        method: "POST",
        body: JSON.stringify(data),
      });
      return res;
    },
    onSuccess: () => {
      toast({ title: "Drivers swapped successfully" });
      setSwapDialog(null);
      setSwapAssignmentBId("");
      setSwapNotes("");
      queryClient.invalidateQueries({ queryKey: ["/api/vehicle-assignments", cityId, selectedDate] });
    },
    onError: (err: any) => {
      toast({ title: "Swap failed", description: err.message, variant: "destructive" });
    },
  });

  const runTodayMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/assignments/run-today", token, {
        method: "POST",
        body: JSON.stringify({}),
      });
      return res;
    },
    onSuccess: (data: any) => {
      const summary = Object.entries(data.results || {})
        .map(([city, r]: [string, any]) => `${city}: ${r.assigned} assigned, ${r.reused} reused, ${r.skipped} skipped`)
        .join("; ");
      toast({ title: "Auto-assign completed", description: summary || "No cities processed" });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicle-assignments"] });
    },
    onError: (err: any) => {
      toast({ title: "Run failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto" data-testid="page-assignments">
      <div className="flex flex-row flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Daily Assignments</h1>
        <div className="flex flex-row flex-wrap items-center gap-2">
          {isSuperAdmin && (
            <Button
              variant="outline"
              onClick={() => runTodayMutation.mutate()}
              disabled={runTodayMutation.isPending}
              data-testid="button-run-today"
            >
              <Play className="mr-1 h-4 w-4" />
              {runTodayMutation.isPending ? "Running..." : "Run Today"}
            </Button>
          )}
          <Button variant="outline" onClick={() => refetchAssignments()} data-testid="button-refresh">
            <RefreshCw className="mr-1 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex flex-row flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">City</Label>
          <Select
            value={cityId?.toString() || ""}
            onValueChange={(v) => setCityId(parseInt(v))}
          >
            <SelectTrigger className="w-[200px]" data-testid="select-city">
              <SelectValue placeholder="Select city" />
            </SelectTrigger>
            <SelectContent>
              {cities.map((c) => (
                <SelectItem key={c.id} value={c.id.toString()} data-testid={`select-city-option-${c.id}`}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Date</Label>
          <Input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-[180px]"
            data-testid="input-date"
          />
        </div>

        {healthData && (
          <Badge variant={healthData.ok ? "default" : "destructive"} data-testid="badge-health">
            {healthData.ok ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <XCircle className="mr-1 h-3 w-3" />}
            Scheduler {healthData.ok ? "Active" : "Down"}
          </Badge>
        )}
      </div>

      <Tabs value={mainTab} onValueChange={setMainTab}>
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="scheduler" data-testid="tab-scheduler">Scheduler</TabsTrigger>
          <TabsTrigger value="manual" data-testid="tab-manual-assign">Manual Assign</TabsTrigger>
        </TabsList>

        <TabsContent value="scheduler" className="mt-4">
          <SchedulerTab
            cityId={cityId}
            selectedDate={selectedDate}
            assignments={assignments || []}
            assignmentsLoading={assignmentsLoading}
            assignmentsError={assignmentsError}
            unassignedDrivers={unassignedDrivers}
            activeDrivers={activeDrivers}
            activeVehicles={activeVehicles}
            getDriverName={getDriverName}
            getDriverPublicId={getDriverPublicId}
            getVehicleName={getVehicleName}
            getVehiclePlate={getVehiclePlate}
            onReassign={(a) => {
              setReassignDialog({
                assignment: a,
                driverName: getDriverName(a.driverId),
                currentVehicleName: getVehicleName(a.vehicleId),
              });
              setReassignVehicleId("");
              setReassignNotes("");
            }}
            onSwap={(a) => {
              setSwapDialog({
                assignmentA: a,
                driverAName: getDriverName(a.driverId),
              });
              setSwapAssignmentBId("");
              setSwapNotes("");
            }}
            refetch={refetchAssignments}
          />
        </TabsContent>

        <TabsContent value="manual" className="mt-4">
          <ManualAssignTab cityId={cityId} token={token} />
        </TabsContent>
      </Tabs>

      <Dialog open={!!reassignDialog} onOpenChange={(open) => { if (!open) setReassignDialog(null); }}>
        <DialogContent data-testid="dialog-reassign">
          <DialogHeader>
            <DialogTitle>Reassign Vehicle</DialogTitle>
            <DialogDescription>
              Change vehicle for {reassignDialog?.driverName} (currently: {reassignDialog?.currentVehicleName})
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>New Vehicle</Label>
              <Select value={reassignVehicleId} onValueChange={setReassignVehicleId}>
                <SelectTrigger data-testid="select-reassign-vehicle">
                  <SelectValue placeholder="Select vehicle" />
                </SelectTrigger>
                <SelectContent>
                  {activeVehicles
                    .filter(v => v.id !== reassignDialog?.assignment.vehicleId)
                    .map(v => (
                      <SelectItem key={v.id} value={v.id.toString()} data-testid={`select-reassign-option-${v.id}`}>
                        {v.name} ({v.licensePlate})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Notes (optional)</Label>
              <Textarea
                value={reassignNotes}
                onChange={(e) => setReassignNotes(e.target.value)}
                placeholder="Reason for reassignment"
                data-testid="textarea-reassign-notes"
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="reassignTrips"
                checked={reassignUpdateTrips}
                onCheckedChange={(v) => setReassignUpdateTrips(!!v)}
                data-testid="checkbox-reassign-trips"
              />
              <Label htmlFor="reassignTrips" className="text-sm">Update today's trips to new vehicle</Label>
            </div>
            <Button
              onClick={() => {
                if (!reassignDialog || !reassignVehicleId) return;
                reassignMutation.mutate({
                  assignmentId: reassignDialog.assignment.id,
                  newVehicleId: parseInt(reassignVehicleId),
                  updateTrips: reassignUpdateTrips,
                  notes: reassignNotes || undefined,
                });
              }}
              disabled={!reassignVehicleId || reassignMutation.isPending}
              className="w-full"
              data-testid="button-confirm-reassign"
            >
              {reassignMutation.isPending ? "Reassigning..." : "Confirm Reassign"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!swapDialog} onOpenChange={(open) => { if (!open) setSwapDialog(null); }}>
        <DialogContent data-testid="dialog-swap">
          <DialogHeader>
            <DialogTitle>Swap Drivers</DialogTitle>
            <DialogDescription>
              Swap vehicle between {swapDialog?.driverAName} and another driver
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Swap with</Label>
              <Select value={swapAssignmentBId} onValueChange={setSwapAssignmentBId}>
                <SelectTrigger data-testid="select-swap-driver">
                  <SelectValue placeholder="Select driver to swap with" />
                </SelectTrigger>
                <SelectContent>
                  {(assignments || [])
                    .filter(a => a.id !== swapDialog?.assignmentA.id)
                    .map(a => (
                      <SelectItem key={a.id} value={a.id.toString()} data-testid={`select-swap-option-${a.id}`}>
                        {getDriverName(a.driverId)} - {getVehicleName(a.vehicleId)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Notes (optional)</Label>
              <Textarea
                value={swapNotes}
                onChange={(e) => setSwapNotes(e.target.value)}
                placeholder="Reason for swap"
                data-testid="textarea-swap-notes"
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="swapTrips"
                checked={swapUpdateTrips}
                onCheckedChange={(v) => setSwapUpdateTrips(!!v)}
                data-testid="checkbox-swap-trips"
              />
              <Label htmlFor="swapTrips" className="text-sm">Update today's trips</Label>
            </div>
            <Button
              onClick={() => {
                if (!swapDialog || !swapAssignmentBId) return;
                swapMutation.mutate({
                  assignmentIdA: swapDialog.assignmentA.id,
                  assignmentIdB: parseInt(swapAssignmentBId),
                  updateTrips: swapUpdateTrips,
                  notes: swapNotes || undefined,
                });
              }}
              disabled={!swapAssignmentBId || swapMutation.isPending}
              className="w-full"
              data-testid="button-confirm-swap"
            >
              {swapMutation.isPending ? "Swapping..." : "Confirm Swap"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SchedulerTab({
  cityId,
  selectedDate,
  assignments,
  assignmentsLoading,
  assignmentsError,
  unassignedDrivers,
  activeDrivers,
  activeVehicles,
  getDriverName,
  getDriverPublicId,
  getVehicleName,
  getVehiclePlate,
  onReassign,
  onSwap,
  refetch,
}: {
  cityId: number | null;
  selectedDate: string;
  assignments: Assignment[];
  assignmentsLoading: boolean;
  assignmentsError: boolean;
  unassignedDrivers: DriverInfo[];
  activeDrivers: DriverInfo[];
  activeVehicles: VehicleInfo[];
  getDriverName: (id: number) => string;
  getDriverPublicId: (id: number) => string;
  getVehicleName: (id: number) => string;
  getVehiclePlate: (id: number) => string;
  onReassign: (a: Assignment) => void;
  onSwap: (a: Assignment) => void;
  refetch: () => void;
}) {
  if (!cityId) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground">
          <MapPin className="mx-auto h-8 w-8 mb-2 opacity-50" />
          Select a city to view assignments
        </CardContent>
      </Card>
    );
  }

  if (assignmentsLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (assignmentsError) {
    return (
      <Card data-testid="card-error">
        <CardContent className="p-6 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 mb-2 text-destructive" />
          <p className="text-sm text-destructive mb-2">Failed to load assignments</p>
          <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-retry">
            <RefreshCw className="mr-1 h-3 w-3" /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card data-testid="card-stat-assigned">
          <CardContent className="p-4 flex items-center gap-3">
            <UserCheck className="h-5 w-5 text-green-600 dark:text-green-400" />
            <div>
              <div className="text-2xl font-bold">{assignments.length}</div>
              <div className="text-xs text-muted-foreground">Assigned</div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-stat-unassigned">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            <div>
              <div className="text-2xl font-bold">{unassignedDrivers.length}</div>
              <div className="text-xs text-muted-foreground">Unassigned Drivers</div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-stat-vehicles">
          <CardContent className="p-4 flex items-center gap-3">
            <Truck className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            <div>
              <div className="text-2xl font-bold">{activeVehicles.length}</div>
              <div className="text-xs text-muted-foreground">Active Vehicles</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {unassignedDrivers.length > 0 && (
        <Card className="mt-3" data-testid="card-unassigned-alert">
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <CardTitle className="text-sm">Unassigned Drivers</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="flex flex-row flex-wrap gap-2">
              {unassignedDrivers.map(d => (
                <Badge key={d.id} variant="secondary" data-testid={`badge-unassigned-${d.id}`}>
                  {d.firstName} {d.lastName} ({d.publicId})
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="mt-3" data-testid="card-assignments-list">
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Assignments for {selectedDate}
          </CardTitle>
          <Badge variant="outline">{assignments.length} total</Badge>
        </CardHeader>
        <CardContent className="p-0">
          {assignments.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground">
              No assignments found for this date
            </div>
          ) : (
            <div className="divide-y">
              {assignments.map((a) => (
                <div
                  key={a.id}
                  className="flex flex-row flex-wrap items-center justify-between gap-3 p-4"
                  data-testid={`row-assignment-${a.id}`}
                >
                  <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex flex-row flex-wrap items-center gap-2">
                      <span className="font-medium" data-testid={`text-driver-name-${a.id}`}>
                        {getDriverName(a.driverId)}
                      </span>
                      <Badge variant="outline" className="text-xs">{getDriverPublicId(a.driverId)}</Badge>
                    </div>
                    <div className="flex flex-row flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      <Truck className="h-3 w-3" />
                      <span data-testid={`text-vehicle-name-${a.id}`}>{getVehicleName(a.vehicleId)}</span>
                      <span className="text-xs">({getVehiclePlate(a.vehicleId)})</span>
                    </div>
                    <div className="flex flex-row flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>Shift: {a.shiftStartTime}</span>
                      <Badge variant={a.assignedBy === "system" ? "secondary" : "default"} className="text-xs">
                        {a.assignedBy === "system" ? "Auto" : "Manual"}
                      </Badge>
                      <Badge
                        variant={a.status === "active" ? "default" : a.status === "reassigned" ? "secondary" : "destructive"}
                        className="text-xs"
                      >
                        {a.status}
                      </Badge>
                    </div>
                    {a.notes && (
                      <div className="text-xs text-muted-foreground italic">{a.notes}</div>
                    )}
                  </div>
                  <div className="flex flex-row flex-wrap items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onReassign(a)}
                      data-testid={`button-reassign-${a.id}`}
                    >
                      <Truck className="mr-1 h-3 w-3" />
                      Reassign
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onSwap(a)}
                      disabled={assignments.length < 2}
                      data-testid={`button-swap-${a.id}`}
                    >
                      <ArrowLeftRight className="mr-1 h-3 w-3" />
                      Swap
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function ManualAssignTab({ cityId, token }: { cityId: number | null; token: string | null }) {
  const { toast } = useToast();
  const [selectedTrip, setSelectedTrip] = useState<any | null>(null);
  const [showAllDrivers, setShowAllDrivers] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedDriverId, setSelectedDriverId] = useState<string>("");

  const unassignedTripsQuery = useQuery<any[]>({
    queryKey: ["/api/dispatch/trips", "unassigned", cityId],
    queryFn: () => apiFetch(`/api/dispatch/trips/unassigned`, token),
    enabled: !!token && !!cityId,
    refetchInterval: 15000,
  });

  const driverStatusQuery = useQuery<DriverStatusData>({
    queryKey: ["/api/dispatch/drivers/status", cityId],
    queryFn: () => apiFetch(`/api/dispatch/drivers/status${cityId ? `?city_id=${cityId}` : ""}`, token),
    enabled: !!token && !!cityId,
    refetchInterval: 15000,
  });

  const assignMutation = useMutation({
    mutationFn: ({ tripId, driverId, vehicleId }: { tripId: number; driverId: number; vehicleId?: number }) =>
      apiFetch(`/api/trips/${tripId}/assign`, token, {
        method: "PATCH",
        body: JSON.stringify({ driverId, vehicleId }),
      }),
    onSuccess: () => {
      toast({ title: "Driver assigned successfully" });
      setAssignDialogOpen(false);
      setSelectedTrip(null);
      setSelectedDriverId("");
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/trips"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dispatch/drivers/status"] });
    },
    onError: (err: any) => {
      toast({ title: "Assignment failed", description: err.message, variant: "destructive" });
    },
  });

  const unassignedTrips = unassignedTripsQuery.data || [];
  const driverStatus = driverStatusQuery.data || { available: [], on_trip: [], paused: [], hold: [], logged_out: [] };

  if (!cityId) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground">
          <MapPin className="mx-auto h-8 w-8 mb-2 opacity-50" />
          Select a city to use manual assign
        </CardContent>
      </Card>
    );
  }

  const availableDrivers = driverStatus.available || [];
  const allAssignable = showAllDrivers
    ? [...availableDrivers, ...(driverStatus.on_trip || []), ...(driverStatus.paused || []), ...(driverStatus.hold || [])]
    : availableDrivers;

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            Unassigned Trips Today
            <Badge variant="secondary">{unassignedTrips.length}</Badge>
          </h3>

          {unassignedTripsQuery.isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : unassignedTrips.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-sm text-muted-foreground" data-testid="text-no-unassigned">
                No unassigned trips
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
              {unassignedTrips.map((trip: any) => (
                <Card
                  key={trip.id}
                  className={`cursor-pointer transition-colors ${selectedTrip?.id === trip.id ? "ring-2 ring-primary" : ""}`}
                  onClick={() => setSelectedTrip(trip)}
                  data-testid={`card-unassigned-trip-${trip.id}`}
                >
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">{trip.publicId}</span>
                          {trip.pickupTime && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="w-3 h-3" /> {trip.pickupTime}
                            </span>
                          )}
                        </div>
                        {trip.patientName && (
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            <User className="w-3 h-3" /> {trip.patientName}
                          </div>
                        )}
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          <Navigation className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{trip.pickupAddress}</span>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedTrip(trip);
                          setAssignDialogOpen(true);
                        }}
                        data-testid={`button-manual-assign-${trip.id}`}
                      >
                        <UserPlus className="w-3.5 h-3.5 mr-1" />
                        Assign
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        <div>
          <h3 className="text-sm font-semibold mb-2">Driver Status Panel</h3>
          {driverStatusQuery.isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : (
            <div className="space-y-2">
              <ManualDriverSection
                title="Available"
                icon={<CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />}
                drivers={driverStatus.available}
                variant="available"
                selectedTrip={selectedTrip}
                onAssign={(driver) => {
                  if (selectedTrip) {
                    assignMutation.mutate({
                      tripId: selectedTrip.id,
                      driverId: driver.id,
                      vehicleId: driver.vehicle_id || undefined,
                    });
                  }
                }}
                assignPending={assignMutation.isPending}
              />
              <ManualDriverSection
                title="On Trip"
                icon={<Truck className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
                drivers={driverStatus.on_trip}
                variant="on_trip"
                selectedTrip={selectedTrip}
              />
              <ManualDriverSection
                title="Paused (GPS Idle)"
                icon={<PauseCircle className="w-4 h-4 text-orange-500 dark:text-orange-400" />}
                drivers={driverStatus.paused}
                variant="paused"
                selectedTrip={selectedTrip}
                onAssign={(driver) => {
                  if (selectedTrip) {
                    assignMutation.mutate({
                      tripId: selectedTrip.id,
                      driverId: driver.id,
                      vehicleId: driver.vehicle_id || undefined,
                    });
                  }
                }}
                assignPending={assignMutation.isPending}
              />
              <ManualDriverSection
                title="Hold / Break"
                icon={<Coffee className="w-4 h-4 text-amber-600 dark:text-amber-400" />}
                drivers={driverStatus.hold}
                variant="hold"
                selectedTrip={selectedTrip}
              />
              <ManualDriverSection
                title="Logged Out"
                icon={<LogOut className="w-4 h-4 text-muted-foreground" />}
                drivers={driverStatus.logged_out}
                variant="logged_out"
                selectedTrip={selectedTrip}
              />
            </div>
          )}
        </div>
      </div>

      <Dialog open={assignDialogOpen} onOpenChange={(open) => { if (!open) { setAssignDialogOpen(false); setSelectedDriverId(""); setShowAllDrivers(false); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Driver to {selectedTrip?.publicId}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">
                {showAllDrivers ? "All Online Drivers" : "Available Drivers Only"}
              </p>
              <Button variant="outline" size="sm" onClick={() => setShowAllDrivers(!showAllDrivers)} data-testid="button-toggle-show-all-manual">
                {showAllDrivers ? "Show Available Only" : "Show All"}
              </Button>
            </div>
            {allAssignable.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-no-drivers-manual">
                No {showAllDrivers ? "online" : "available"} drivers.
              </p>
            ) : (
              <Select value={selectedDriverId} onValueChange={setSelectedDriverId}>
                <SelectTrigger data-testid="select-manual-assign-driver">
                  <SelectValue placeholder="Choose a driver" />
                </SelectTrigger>
                <SelectContent>
                  {allAssignable.map((d) => (
                    <SelectItem key={d.id} value={d.id.toString()} data-testid={`option-manual-driver-${d.id}`}>
                      <span className="flex items-center gap-2">
                        <CircleDot className={`w-3 h-3 ${
                          d.dispatch_status === "available" ? "text-green-500" :
                          d.dispatch_status === "enroute" ? "text-blue-500" : "text-amber-500"
                        }`} />
                        {d.name} {d.vehicle_name ? `- ${d.vehicle_name}` : "(No Vehicle)"}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                if (!selectedDriverId || !selectedTrip) return;
                const driver = allAssignable.find(d => d.id === parseInt(selectedDriverId));
                assignMutation.mutate({
                  tripId: selectedTrip.id,
                  driverId: parseInt(selectedDriverId),
                  vehicleId: driver?.vehicle_id || undefined,
                });
              }}
              disabled={assignMutation.isPending || !selectedDriverId}
              data-testid="button-confirm-manual-assign"
            >
              {assignMutation.isPending ? "Assigning..." : "Assign Driver"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ManualDriverSection({
  title,
  icon,
  drivers,
  variant,
  selectedTrip,
  onAssign,
  assignPending,
}: {
  title: string;
  icon: React.ReactNode;
  drivers: DriverStatusInfo[];
  variant: "available" | "on_trip" | "paused" | "hold" | "logged_out";
  selectedTrip: any | null;
  onAssign?: (driver: DriverStatusInfo) => void;
  assignPending?: boolean;
}) {
  const isLoggedOut = variant === "logged_out";
  const canAssign = (variant === "available" || variant === "paused") && !!onAssign && !!selectedTrip;

  return (
    <Card data-testid={`manual-section-${variant}`}>
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
                  isLoggedOut ? "opacity-50" : ""
                }`}
                data-testid={`manual-driver-${d.id}`}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <CircleDot className={`w-3 h-3 flex-shrink-0 ${
                    variant === "available" ? "text-green-500" :
                    variant === "on_trip" ? "text-blue-500" :
                    variant === "paused" ? "text-orange-500" :
                    variant === "hold" ? "text-amber-500" :
                    "text-muted-foreground"
                  }`} />
                  <span className="font-medium truncate">{d.name}</span>
                  {d.vehicle_name && (
                    <span className="text-muted-foreground hidden lg:inline">
                      <Car className="w-3 h-3 inline mr-0.5" />
                      {d.vehicle_name.split("(")[0].trim()}
                    </span>
                  )}
                  {!d.vehicle_name && <Badge variant="outline" className="text-[10px] px-1.5 py-0">No Vehicle</Badge>}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {d.active_trip_public_id && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{d.active_trip_public_id}</Badge>
                  )}
                  {canAssign && (
                    <Button
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                      onClick={() => onAssign!(d)}
                      disabled={assignPending}
                      data-testid={`button-quick-assign-${d.id}`}
                    >
                      Assign
                    </Button>
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
