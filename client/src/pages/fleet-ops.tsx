import { useState } from "react";
import { useAuth, authHeaders } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { apiFetch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Users,
  Truck,
  UserCheck,
  AlertTriangle,
  RefreshCw,
  Link2Off,
  Link2,
  Wrench,
  CheckCircle2,
  XCircle,
  MapPin,
  ArrowLeftRight,
  Repeat2,
  Calendar,
} from "lucide-react";

interface FleetSummary {
  drivers_total: number;
  vehicles_total: number;
  drivers_assigned: number;
  drivers_unassigned: number;
  vehicles_assigned: number;
  vehicles_unassigned: number;
}

interface UnassignedDriver {
  id: number;
  publicId: string;
  name: string;
  phone: string;
  dispatchStatus: string;
}

interface UnassignedVehicle {
  id: number;
  publicId: string;
  name: string;
  licensePlate: string;
  capacity: number;
  wheelchairAccessible: boolean;
}

interface Conflict {
  type: string;
  message: string;
  driverId?: number;
  driverName?: string;
  driverPublicId?: string;
  vehicleId?: number;
  vehicleName?: string;
  vehiclePublicId?: string;
  vehicleStatus?: string;
  drivers?: { id: number; name: string; publicId: string }[];
}

interface FleetData {
  cityId: number;
  summary: FleetSummary;
  unassigned_drivers: UnassignedDriver[];
  unassigned_vehicles: UnassignedVehicle[];
  conflicts: Conflict[];
}

interface Assignment {
  id: number;
  driverId: number;
  vehicleId: number;
  date: string;
  cityId: number;
  shiftStartTime: string;
  assignedBy: string;
  status?: string;
  notes?: string;
}

interface VehicleInfo {
  id: number;
  name: string;
  publicId: string;
  licensePlate: string;
  status: string;
  active: boolean;
  wheelchairAccessible: boolean;
}

interface DriverInfo {
  id: number;
  firstName: string;
  lastName: string;
  publicId: string;
  phone: string;
  cityId: number;
  vehicleId?: number | null;
}

export default function FleetOpsPage() {
  const { token, cities, selectedCity } = useAuth();
  const { toast } = useToast();
  const [cityId, setCityId] = useState<number | null>(selectedCity?.id ?? null);
  const [activeTab, setActiveTab] = useState("readiness");
  const [assignDialog, setAssignDialog] = useState<{ driverId: number; driverName: string } | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>("");

  const [reassignDialog, setReassignDialog] = useState<{ assignment: Assignment; driverName: string; currentVehicleName: string } | null>(null);
  const [reassignVehicleId, setReassignVehicleId] = useState<string>("");
  const [reassignNotes, setReassignNotes] = useState("");
  const [reassignUpdateTrips, setReassignUpdateTrips] = useState(true);

  const [swapDialog, setSwapDialog] = useState<{ assignmentA: Assignment; driverAName: string } | null>(null);
  const [swapAssignmentBId, setSwapAssignmentBId] = useState<string>("");
  const [swapNotes, setSwapNotes] = useState("");
  const [swapUpdateTrips, setSwapUpdateTrips] = useState(true);

  const selectedCityData = cities.find((c) => c.id === cityId);
  const getLocalDate = () => {
    const tz = (selectedCityData as any)?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    return new Date().toLocaleDateString("en-CA", { timeZone: tz });
  };
  const today = getLocalDate();

  const { data: fleetData, isLoading, refetch } = useQuery<FleetData>({
    queryKey: ["/api/ops/fleet", cityId],
    queryFn: async () => {
      const res = await fetch(`/api/ops/fleet?city_id=${cityId}`, {
        headers: authHeaders(token),
      });
      if (!res.ok) throw new Error("Failed to load fleet data");
      return res.json();
    },
    enabled: !!token && !!cityId,
  });

  const { data: assignments, isLoading: assignmentsLoading, refetch: refetchAssignments } = useQuery<Assignment[]>({
    queryKey: ["/api/vehicle-assignments", cityId, today],
    queryFn: async () => {
      const res = await fetch(`/api/vehicle-assignments?cityId=${cityId}&date=${today}`, {
        headers: authHeaders(token),
      });
      if (!res.ok) throw new Error("Failed to load assignments");
      return res.json();
    },
    enabled: !!token && !!cityId && activeTab === "assignments",
  });

  const { data: allDrivers } = useQuery<DriverInfo[]>({
    queryKey: ["/api/drivers", cityId],
    queryFn: async () => {
      const res = await fetch(`/api/drivers?cityId=${cityId}`, {
        headers: authHeaders(token),
      });
      if (!res.ok) throw new Error("Failed to load drivers");
      return res.json();
    },
    enabled: !!token && !!cityId,
  });

  const { data: allVehicles } = useQuery<VehicleInfo[]>({
    queryKey: ["/api/vehicles", cityId],
    queryFn: async () => {
      const res = await fetch(`/api/vehicles?cityId=${cityId}`, {
        headers: authHeaders(token),
      });
      if (!res.ok) throw new Error("Failed to load vehicles");
      return res.json();
    },
    enabled: !!token && !!cityId,
  });

  const assignMutation = useMutation({
    mutationFn: async ({ driverId, vehicleId }: { driverId: number; vehicleId: number }) => {
      return apiFetch(`/api/drivers/${driverId}`, token, {
        method: "PUT",
        body: JSON.stringify({ vehicleId }),
      });
    },
    onSuccess: () => {
      toast({ title: "Vehicle assigned successfully" });
      setAssignDialog(null);
      setSelectedVehicleId("");
      queryClient.invalidateQueries({ queryKey: ["/api/ops/fleet"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicle-assignments"] });
    },
    onError: (err: any) => {
      toast({ title: "Assignment failed", description: err.message, variant: "destructive" });
    },
  });

  const unassignMutation = useMutation({
    mutationFn: async ({ driverId }: { driverId: number }) => {
      return apiFetch(`/api/drivers/${driverId}`, token, {
        method: "PUT",
        body: JSON.stringify({ vehicleId: null, unassignReason: "fleet_ops_conflict_resolution" }),
      });
    },
    onSuccess: () => {
      toast({ title: "Vehicle unassigned successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/fleet"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicle-assignments"] });
    },
    onError: (err: any) => {
      toast({ title: "Unassign failed", description: err.message, variant: "destructive" });
    },
  });

  const reassignMutation = useMutation({
    mutationFn: async (data: { assignmentId: number; newVehicleId: number; updateTrips: boolean; notes?: string }) => {
      const res = await fetch("/api/dispatch/assignments/reassign-vehicle", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(token) },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Reassignment failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Vehicle reassigned", description: data.tripsUpdated > 0 ? `${data.tripsUpdated} trip(s) updated` : undefined });
      setReassignDialog(null);
      setReassignVehicleId("");
      setReassignNotes("");
      setReassignUpdateTrips(true);
      queryClient.invalidateQueries({ queryKey: ["/api/vehicle-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/fleet"] });
    },
    onError: (err: any) => {
      toast({ title: "Reassignment failed", description: err.message, variant: "destructive" });
    },
  });

  const swapMutation = useMutation({
    mutationFn: async (data: { assignmentIdA: number; assignmentIdB: number; updateTrips: boolean; notes?: string }) => {
      const res = await fetch("/api/dispatch/assignments/swap-drivers", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(token) },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Swap failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Drivers swapped", description: data.tripsUpdated > 0 ? `${data.tripsUpdated} trip(s) updated` : undefined });
      setSwapDialog(null);
      setSwapAssignmentBId("");
      setSwapNotes("");
      setSwapUpdateTrips(true);
      queryClient.invalidateQueries({ queryKey: ["/api/vehicle-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/fleet"] });
    },
    onError: (err: any) => {
      toast({ title: "Swap failed", description: err.message, variant: "destructive" });
    },
  });

  const getDriverName = (driverId: number) => {
    const d = allDrivers?.find((d) => d.id === driverId);
    return d ? `${d.firstName} ${d.lastName}` : `Driver #${driverId}`;
  };

  const getVehicleName = (vehicleId: number) => {
    const v = allVehicles?.find((v) => v.id === vehicleId);
    return v ? v.name : `Vehicle #${vehicleId}`;
  };

  const getVehicleInfo = (vehicleId: number) => {
    return allVehicles?.find((v) => v.id === vehicleId);
  };

  const availableVehiclesForReassign = allVehicles?.filter((v) =>
    v.status === "ACTIVE" && v.active &&
    !(assignments || []).some((a) => a.vehicleId === v.id && a.id !== reassignDialog?.assignment.id)
  ) || [];

  const summary = fleetData?.summary;

  const summaryCards = summary
    ? [
        { label: "Active Drivers", value: summary.drivers_total, icon: UserCheck, sub: `${summary.drivers_assigned} assigned` },
        { label: "Active Vehicles", value: summary.vehicles_total, icon: Truck, sub: `${summary.vehicles_assigned} assigned` },
        { label: "Unassigned Drivers", value: summary.drivers_unassigned, icon: Users, sub: "Need vehicles" },
        { label: "Unassigned Vehicles", value: summary.vehicles_unassigned, icon: Truck, sub: "Available" },
      ]
    : [];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-fleet-title">
            Fleet Readiness
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage fleet assignments and resolve conflicts
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Select
            value={cityId?.toString() ?? ""}
            onValueChange={(v) => setCityId(parseInt(v))}
          >
            <SelectTrigger className="w-48" data-testid="select-fleet-city">
              <SelectValue placeholder="Select city" />
            </SelectTrigger>
            <SelectContent>
              {cities.map((c) => (
                <SelectItem key={c.id} value={c.id.toString()}>
                  {c.name}, {c.state}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {cityId && (
            <Button
              variant="outline"
              size="icon"
              onClick={() => { refetch(); refetchAssignments(); }}
              data-testid="button-refresh-fleet"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {!cityId && (
        <Card>
          <CardContent className="py-12 text-center">
            <MapPin className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground" data-testid="text-select-city-prompt">
              Select a city to view fleet readiness
            </p>
          </CardContent>
        </Card>
      )}

      {cityId && (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="readiness" data-testid="tab-readiness">
              <Truck className="w-4 h-4 mr-1.5" />
              Readiness
            </TabsTrigger>
            <TabsTrigger value="assignments" data-testid="tab-assignments">
              <Calendar className="w-4 h-4 mr-1.5" />
              Daily Assignments
            </TabsTrigger>
          </TabsList>

          <TabsContent value="readiness" className="space-y-6 mt-4">
            {isLoading && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((i) => (
                  <Card key={i}>
                    <CardContent className="p-4">
                      <Skeleton className="h-8 w-20 mb-2" />
                      <Skeleton className="h-4 w-32" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {!isLoading && !fleetData && cityId && (
              <Card>
                <CardContent className="py-16 text-center">
                  <Truck className="w-12 h-12 mx-auto mb-4 text-muted-foreground/40" />
                  <h3 className="text-lg font-semibold mb-2" data-testid="text-no-fleet-data">No fleet data available</h3>
                  <p className="text-sm text-muted-foreground max-w-md mx-auto">
                    There are no active drivers or vehicles registered for this city yet. Add drivers and vehicles in the Fleet section to see readiness information here.
                  </p>
                  <Button variant="outline" className="mt-4" onClick={() => refetch()} data-testid="button-retry-fleet">
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Retry
                  </Button>
                </CardContent>
              </Card>
            )}

            {fleetData && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {summaryCards.map((card) => (
                    <Card key={card.label}>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="text-sm text-muted-foreground">{card.label}</p>
                            <p className="text-2xl font-bold mt-1" data-testid={`text-${card.label.toLowerCase().replace(/\s+/g, "-")}`}>
                              {card.value}
                            </p>
                          </div>
                          <card.icon className="w-8 h-8 text-muted-foreground" />
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">{card.sub}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {summary && summary.drivers_total === 0 && summary.vehicles_total === 0 && fleetData.conflicts.length === 0 && (
                  <Card>
                    <CardContent className="py-12 text-center">
                      <Truck className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
                      <h3 className="text-base font-semibold mb-1" data-testid="text-fleet-empty">No drivers or vehicles in this city</h3>
                      <p className="text-sm text-muted-foreground max-w-md mx-auto">
                        This city does not have any active drivers or vehicles registered. Go to Drivers or Vehicles to add them, then come back here to manage fleet readiness and assignments.
                      </p>
                    </CardContent>
                  </Card>
                )}

                {fleetData.conflicts.length > 0 && (
                  <div className="space-y-3">
                    <h2 className="text-lg font-semibold flex items-center gap-2" data-testid="text-conflicts-heading">
                      <AlertTriangle className="w-5 h-5 text-destructive" />
                      Conflicts ({fleetData.conflicts.length})
                    </h2>
                    {fleetData.conflicts.map((conflict, idx) => (
                      <Card key={idx} className="border-destructive/30">
                        <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
                          <div className="flex items-start gap-3 min-w-0 flex-1">
                            <ConflictIcon type={conflict.type} />
                            <div className="min-w-0">
                              <p className="text-sm font-medium" data-testid={`text-conflict-message-${idx}`}>
                                {conflict.message}
                              </p>
                              <Badge variant="outline" className="mt-1">
                                {conflictTypeLabel(conflict.type)}
                              </Badge>
                            </div>
                          </div>
                          <ConflictActions
                            conflict={conflict}
                            onUnassign={(driverId) => unassignMutation.mutate({ driverId })}
                            isPending={unassignMutation.isPending}
                          />
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <h2 className="text-lg font-semibold flex items-center gap-2" data-testid="text-unassigned-drivers-heading">
                      <Users className="w-5 h-5" />
                      Unassigned Drivers ({fleetData.unassigned_drivers.length})
                    </h2>
                    {fleetData.unassigned_drivers.length === 0 ? (
                      <Card>
                        <CardContent className="py-8 text-center">
                          <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-500" />
                          <p className="text-sm text-muted-foreground" data-testid="text-all-drivers-assigned">All active drivers have vehicles</p>
                        </CardContent>
                      </Card>
                    ) : (
                      fleetData.unassigned_drivers.map((driver) => (
                        <Card key={driver.id}>
                          <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
                            <div className="min-w-0">
                              <p className="text-sm font-medium" data-testid={`text-driver-name-${driver.id}`}>
                                {driver.name}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {driver.publicId} &middot; {driver.phone}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="secondary">{driver.dispatchStatus}</Badge>
                              <Button
                                size="sm"
                                onClick={() => setAssignDialog({ driverId: driver.id, driverName: driver.name })}
                                data-testid={`button-assign-vehicle-${driver.id}`}
                              >
                                <Link2 className="w-3 h-3 mr-1" />
                                Assign Vehicle
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))
                    )}
                  </div>

                  <div className="space-y-3">
                    <h2 className="text-lg font-semibold flex items-center gap-2" data-testid="text-unassigned-vehicles-heading">
                      <Truck className="w-5 h-5" />
                      Unassigned Vehicles ({fleetData.unassigned_vehicles.length})
                    </h2>
                    {fleetData.unassigned_vehicles.length === 0 ? (
                      <Card>
                        <CardContent className="py-8 text-center">
                          <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-500" />
                          <p className="text-sm text-muted-foreground" data-testid="text-all-vehicles-assigned">All active vehicles are assigned</p>
                        </CardContent>
                      </Card>
                    ) : (
                      fleetData.unassigned_vehicles.map((vehicle) => (
                        <Card key={vehicle.id}>
                          <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
                            <div className="min-w-0">
                              <p className="text-sm font-medium" data-testid={`text-vehicle-name-${vehicle.id}`}>
                                {vehicle.name}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {vehicle.publicId} &middot; {vehicle.licensePlate} &middot; Cap: {vehicle.capacity}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              {vehicle.wheelchairAccessible && (
                                <Badge variant="secondary">WC</Badge>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="assignments" className="space-y-4 mt-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Calendar className="w-5 h-5" />
                Today's Assignments ({today})
              </h2>
            </div>

            {assignmentsLoading && (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Card key={i}>
                    <CardContent className="p-4">
                      <Skeleton className="h-6 w-48 mb-2" />
                      <Skeleton className="h-4 w-64" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {assignments && assignments.length === 0 && (
              <Card>
                <CardContent className="py-12 text-center">
                  <Calendar className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                  <p className="text-muted-foreground" data-testid="text-no-assignments">
                    No assignments for today
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Use the override feature or trigger auto-assign to create assignments
                  </p>
                </CardContent>
              </Card>
            )}

            {assignments && assignments.length > 0 && (
              <div className="space-y-3">
                {assignments.map((assignment) => {
                  const vehicleInfo = getVehicleInfo(assignment.vehicleId);
                  return (
                    <Card key={assignment.id}>
                      <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
                        <div className="flex items-center gap-4 min-w-0 flex-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <UserCheck className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate" data-testid={`text-assignment-driver-${assignment.id}`}>
                                {getDriverName(assignment.driverId)}
                              </p>
                            </div>
                          </div>
                          <ArrowLeftRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          <div className="flex items-center gap-2 min-w-0">
                            <Truck className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate" data-testid={`text-assignment-vehicle-${assignment.id}`}>
                                {getVehicleName(assignment.vehicleId)}
                              </p>
                              {vehicleInfo && (
                                <p className="text-xs text-muted-foreground">
                                  {vehicleInfo.licensePlate}
                                  {vehicleInfo.wheelchairAccessible && " (WC)"}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="text-xs">
                            {assignment.assignedBy}
                          </Badge>
                          {assignment.status && assignment.status !== "active" && (
                            <Badge variant="secondary" className="text-xs">
                              {assignment.status}
                            </Badge>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setReassignDialog({
                                assignment,
                                driverName: getDriverName(assignment.driverId),
                                currentVehicleName: getVehicleName(assignment.vehicleId),
                              });
                              setReassignVehicleId("");
                              setReassignNotes("");
                              setReassignUpdateTrips(true);
                            }}
                            data-testid={`button-reassign-${assignment.id}`}
                          >
                            <Repeat2 className="w-3 h-3 mr-1" />
                            Reassign
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSwapDialog({
                                assignmentA: assignment,
                                driverAName: getDriverName(assignment.driverId),
                              });
                              setSwapAssignmentBId("");
                              setSwapNotes("");
                              setSwapUpdateTrips(true);
                            }}
                            data-testid={`button-swap-${assignment.id}`}
                          >
                            <ArrowLeftRight className="w-3 h-3 mr-1" />
                            Swap
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}

      <Dialog open={!!assignDialog} onOpenChange={(open) => { if (!open) { setAssignDialog(null); setSelectedVehicleId(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Vehicle</DialogTitle>
            <DialogDescription>
              Choose an available vehicle for {assignDialog?.driverName}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <Select value={selectedVehicleId} onValueChange={setSelectedVehicleId}>
              <SelectTrigger data-testid="select-assign-vehicle">
                <SelectValue placeholder="Select vehicle" />
              </SelectTrigger>
              <SelectContent>
                {(fleetData?.unassigned_vehicles ?? []).map((v) => (
                  <SelectItem key={v.id} value={v.id.toString()}>
                    {v.name} &mdash; {v.licensePlate}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setAssignDialog(null); setSelectedVehicleId(""); }} data-testid="button-cancel-assign">
                Cancel
              </Button>
              <Button
                disabled={!selectedVehicleId || assignMutation.isPending}
                onClick={() => {
                  if (assignDialog && selectedVehicleId) {
                    assignMutation.mutate({
                      driverId: assignDialog.driverId,
                      vehicleId: parseInt(selectedVehicleId),
                    });
                  }
                }}
                data-testid="button-confirm-assign"
              >
                {assignMutation.isPending ? "Assigning..." : "Assign"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!reassignDialog} onOpenChange={(open) => { if (!open) { setReassignDialog(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reassign Vehicle</DialogTitle>
            <DialogDescription>
              Change the vehicle for {reassignDialog?.driverName} (currently: {reassignDialog?.currentVehicleName})
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>New Vehicle</Label>
              <Select value={reassignVehicleId} onValueChange={setReassignVehicleId}>
                <SelectTrigger data-testid="select-reassign-vehicle">
                  <SelectValue placeholder="Select new vehicle" />
                </SelectTrigger>
                <SelectContent>
                  {availableVehiclesForReassign.map((v) => (
                    <SelectItem key={v.id} value={v.id.toString()}>
                      {v.name} &mdash; {v.licensePlate}
                      {v.wheelchairAccessible ? " (WC)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea
                value={reassignNotes}
                onChange={(e) => setReassignNotes(e.target.value)}
                placeholder="Reason for reassignment..."
                className="resize-none"
                data-testid="input-reassign-notes"
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="reassign-update-trips"
                checked={reassignUpdateTrips}
                onCheckedChange={(checked) => setReassignUpdateTrips(checked === true)}
                data-testid="checkbox-reassign-update-trips"
              />
              <Label htmlFor="reassign-update-trips" className="text-sm">
                Also update today's trips with new vehicle
              </Label>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setReassignDialog(null)} data-testid="button-cancel-reassign">
                Cancel
              </Button>
              <Button
                disabled={!reassignVehicleId || reassignMutation.isPending}
                onClick={() => {
                  if (reassignDialog && reassignVehicleId) {
                    reassignMutation.mutate({
                      assignmentId: reassignDialog.assignment.id,
                      newVehicleId: parseInt(reassignVehicleId),
                      updateTrips: reassignUpdateTrips,
                      notes: reassignNotes || undefined,
                    });
                  }
                }}
                data-testid="button-confirm-reassign"
              >
                {reassignMutation.isPending ? "Reassigning..." : "Reassign Vehicle"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!swapDialog} onOpenChange={(open) => { if (!open) { setSwapDialog(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Swap Vehicles Between Drivers</DialogTitle>
            <DialogDescription>
              Swap the vehicle of {swapDialog?.driverAName} with another driver
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Swap With</Label>
              <Select value={swapAssignmentBId} onValueChange={setSwapAssignmentBId}>
                <SelectTrigger data-testid="select-swap-driver">
                  <SelectValue placeholder="Select driver to swap with" />
                </SelectTrigger>
                <SelectContent>
                  {(assignments || [])
                    .filter((a) => a.id !== swapDialog?.assignmentA.id)
                    .map((a) => (
                      <SelectItem key={a.id} value={a.id.toString()}>
                        {getDriverName(a.driverId)} ({getVehicleName(a.vehicleId)})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea
                value={swapNotes}
                onChange={(e) => setSwapNotes(e.target.value)}
                placeholder="Reason for swap..."
                className="resize-none"
                data-testid="input-swap-notes"
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="swap-update-trips"
                checked={swapUpdateTrips}
                onCheckedChange={(checked) => setSwapUpdateTrips(checked === true)}
                data-testid="checkbox-swap-update-trips"
              />
              <Label htmlFor="swap-update-trips" className="text-sm">
                Also update today's trips with swapped vehicles
              </Label>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSwapDialog(null)} data-testid="button-cancel-swap">
                Cancel
              </Button>
              <Button
                disabled={!swapAssignmentBId || swapMutation.isPending}
                onClick={() => {
                  if (swapDialog && swapAssignmentBId) {
                    swapMutation.mutate({
                      assignmentIdA: swapDialog.assignmentA.id,
                      assignmentIdB: parseInt(swapAssignmentBId),
                      updateTrips: swapUpdateTrips,
                      notes: swapNotes || undefined,
                    });
                  }
                }}
                data-testid="button-confirm-swap"
              >
                {swapMutation.isPending ? "Swapping..." : "Swap Vehicles"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ConflictIcon({ type }: { type: string }) {
  switch (type) {
    case "vehicle_city_mismatch":
      return <MapPin className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />;
    case "vehicle_not_active_but_assigned":
      return <Wrench className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />;
    case "duplicate_vehicle_assignments":
      return <XCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />;
    default:
      return <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />;
  }
}

function conflictTypeLabel(type: string): string {
  switch (type) {
    case "vehicle_city_mismatch":
      return "City Mismatch";
    case "vehicle_not_active_but_assigned":
      return "Inactive Vehicle";
    case "duplicate_vehicle_assignments":
      return "Duplicate Assignment";
    default:
      return type;
  }
}

function ConflictActions({
  conflict,
  onUnassign,
  isPending,
}: {
  conflict: Conflict;
  onUnassign: (driverId: number) => void;
  isPending: boolean;
}) {
  if (conflict.type === "vehicle_not_active_but_assigned" && conflict.driverId) {
    return (
      <Button
        size="sm"
        variant="destructive"
        disabled={isPending}
        onClick={() => onUnassign(conflict.driverId!)}
        data-testid={`button-fix-conflict-unassign-${conflict.driverId}`}
      >
        <Link2Off className="w-3 h-3 mr-1" />
        Unassign Vehicle
      </Button>
    );
  }

  if (conflict.type === "vehicle_city_mismatch" && conflict.driverId) {
    return (
      <Button
        size="sm"
        variant="destructive"
        disabled={isPending}
        onClick={() => onUnassign(conflict.driverId!)}
        data-testid={`button-fix-conflict-mismatch-${conflict.driverId}`}
      >
        <Link2Off className="w-3 h-3 mr-1" />
        Unassign Vehicle
      </Button>
    );
  }

  if (conflict.type === "duplicate_vehicle_assignments" && conflict.drivers) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        {conflict.drivers.slice(1).map((d) => (
          <Button
            key={d.id}
            size="sm"
            variant="destructive"
            disabled={isPending}
            onClick={() => onUnassign(d.id)}
            data-testid={`button-fix-duplicate-unassign-${d.id}`}
          >
            <Link2Off className="w-3 h-3 mr-1" />
            Unassign {d.name}
          </Button>
        ))}
      </div>
    );
  }

  return null;
}
