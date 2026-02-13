import { useState } from "react";
import { useAuth, authHeaders } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { apiFetch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

export default function FleetOpsPage() {
  const { token, cities, selectedCity } = useAuth();
  const { toast } = useToast();
  const [cityId, setCityId] = useState<number | null>(selectedCity?.id ?? null);
  const [assignDialog, setAssignDialog] = useState<{ driverId: number; driverName: string } | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>("");

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
    },
    onError: (err: any) => {
      toast({ title: "Unassign failed", description: err.message, variant: "destructive" });
    },
  });

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
              onClick={() => refetch()}
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

      {isLoading && cityId && (
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
