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
} from "lucide-react";
import type { Driver, Vehicle, Trip, Patient } from "@shared/schema";

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
  IN_PROGRESS: "hsl(142, 76%, 36%)",
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

  const cityId = selectedCity?.id;

  const { data: mapData, isLoading, refetch } = useQuery<MapData>({
    queryKey: ["/api/dispatch/map-data", cityId ? `?cityId=${cityId}` : ""],
    refetchInterval: 15000,
    enabled: true,
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
  const assignedTrips = mapData?.trips.filter((t) => t.status === "ASSIGNED") || [];
  const inProgressTrips = mapData?.trips.filter((t) => t.status === "IN_PROGRESS") || [];
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
                <p className="text-lg font-semibold" data-testid="text-active-count">{assignedTrips.length + inProgressTrips.length}</p>
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
              <Badge variant="secondary" className="text-xs">{assignedTrips.length + inProgressTrips.length}</Badge>
            </CardHeader>
            <CardContent className="p-2 space-y-2 max-h-96 overflow-y-auto">
              {assignedTrips.length === 0 && inProgressTrips.length === 0 && (
                <p className="text-xs text-muted-foreground p-2" data-testid="text-no-active-trips">No active trips</p>
              )}
              {[...assignedTrips, ...inProgressTrips].map((trip) => {
                const assignedDriver = mapData?.drivers.find((d) => d.id === trip.driverId);
                const assignedVehicle = mapData?.vehicles.find((v) => v.id === trip.vehicleId);
                return (
                  <div
                    key={trip.id}
                    className="flex items-center gap-3 p-3 rounded-md border bg-card"
                    data-testid={`active-trip-${trip.id}`}
                  >
                    <div
                      className="w-2 h-10 rounded-full flex-shrink-0"
                      style={{ backgroundColor: TRIP_STATUS_COLORS[trip.status] }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium">{trip.publicId}</span>
                        <Badge variant="outline" className="text-[10px]">{trip.status.replace("_", " ")}</Badge>
                        {trip.lastEtaMinutes && (
                          <Badge variant="secondary" className="text-[10px]">
                            <Clock className="w-3 h-3 mr-1" />
                            {trip.lastEtaMinutes} min
                          </Badge>
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
                  {Object.entries(TRIP_STATUS_COLORS).filter(([k]) => ["SCHEDULED", "ASSIGNED", "IN_PROGRESS"].includes(k)).map(([key, color]) => (
                    <div key={key} className="flex items-center gap-1.5 mb-0.5">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                      <span className="text-[10px]">{key.replace("_", " ")}</span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

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
                {availableVehicles.map((v) => (
                  <SelectItem key={v.id} value={v.id.toString()}>
                    {v.name} - {v.licensePlate}
                    {v.wheelchairAccessible ? " (WC)" : ""}
                  </SelectItem>
                ))}
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
                    .filter((d) => d.status === "ACTIVE" && d.vehicleId)
                    .map((d) => (
                      <SelectItem key={d.id} value={d.id.toString()}>
                        {d.firstName} {d.lastName}
                        {d.vehicle ? ` (${d.vehicle.name})` : ""}
                        {" - "}
                        {DISPATCH_STATUS_LABELS[d.dispatchStatus]}
                      </SelectItem>
                    ))}
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
    </div>
  );
}
