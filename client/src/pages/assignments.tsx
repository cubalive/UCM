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
  CheckCircle2,
  XCircle,
  Clock,
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

export default function AssignmentsPage() {
  const { token, user, cities, selectedCity } = useAuth();
  const { toast } = useToast();
  const [cityId, setCityId] = useState<number | null>(selectedCity?.id ?? null);

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

  const getVehiclePublicId = (vehicleId: number) => {
    const v = (vehiclesData || []).find(ve => ve.id === vehicleId);
    return v?.publicId || "";
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

      {!cityId && (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            <MapPin className="mx-auto h-8 w-8 mb-2 opacity-50" />
            Select a city to view assignments
          </CardContent>
        </Card>
      )}

      {cityId && assignmentsLoading && (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {cityId && assignmentsError && (
        <Card data-testid="card-error">
          <CardContent className="p-6 text-center">
            <AlertTriangle className="mx-auto h-8 w-8 mb-2 text-destructive" />
            <p className="text-sm text-destructive mb-2">Failed to load assignments</p>
            <Button variant="outline" size="sm" onClick={() => refetchAssignments()} data-testid="button-retry">
              <RefreshCw className="mr-1 h-3 w-3" /> Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {cityId && !assignmentsLoading && !assignmentsError && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card data-testid="card-stat-assigned">
              <CardContent className="p-4 flex items-center gap-3">
                <UserCheck className="h-5 w-5 text-green-600 dark:text-green-400" />
                <div>
                  <div className="text-2xl font-bold">{(assignments || []).length}</div>
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
            <Card data-testid="card-unassigned-alert">
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

          <Card data-testid="card-assignments-list">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Assignments for {selectedDate}
              </CardTitle>
              <Badge variant="outline">{(assignments || []).length} total</Badge>
            </CardHeader>
            <CardContent className="p-0">
              {(assignments || []).length === 0 ? (
                <div className="p-6 text-center text-muted-foreground">
                  No assignments found for this date
                </div>
              ) : (
                <div className="divide-y">
                  {(assignments || []).map((a) => (
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
                          onClick={() => {
                            setReassignDialog({
                              assignment: a,
                              driverName: getDriverName(a.driverId),
                              currentVehicleName: getVehicleName(a.vehicleId),
                            });
                            setReassignVehicleId("");
                            setReassignNotes("");
                          }}
                          data-testid={`button-reassign-${a.id}`}
                        >
                          <Truck className="mr-1 h-3 w-3" />
                          Reassign
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSwapDialog({
                              assignmentA: a,
                              driverAName: getDriverName(a.driverId),
                            });
                            setSwapAssignmentBId("");
                            setSwapNotes("");
                          }}
                          disabled={(assignments || []).length < 2}
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
      )}

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
