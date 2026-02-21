import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
import {
  Zap,
  Play,
  XCircle,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  Edit,
  MapPin,
  Accessibility,
} from "lucide-react";
import { apiFetch } from "@/lib/api";

function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

interface Proposal {
  tripId: number;
  tripPublicId: string;
  scheduledDate: string;
  pickupTime: string;
  pickupZip: string | null;
  tripType: string;
  patientId: number;
  patientName: string;
  wheelchairRequired: boolean;
  approvalStatus: string;
  currentStatus: string;
  proposedDriverId: number | null;
  proposedDriverName: string | null;
  proposedVehicleId: number | null;
  proposedVehicleName: string | null;
  assignmentSource?: string;
  assignmentReason: string;
  canAssign: boolean;
  blockReason: string | null;
}

interface DriverOption {
  id: number;
  name: string;
  dispatchStatus: string;
}

interface VehicleOption {
  id: number;
  name: string;
  wheelchairAccessible: boolean;
}

export default function AutoAssignmentPage() {
  const { token, cities, selectedCity, setSelectedCity } = useAuth();
  const { toast } = useToast();
  const [date, setDate] = useState(getToday());
  const [activeBatchId, setActiveBatchId] = useState<number | null>(null);
  const [overrideTrip, setOverrideTrip] = useState<Proposal | null>(null);
  const [overrideDriverId, setOverrideDriverId] = useState<string>("");
  const [overrideVehicleId, setOverrideVehicleId] = useState<string>("");

  const nvCities = (cities || []).filter((c: any) =>
    ["Las Vegas", "Pahrump"].includes(c.name) && c.state === "NV"
  );

  const cityId = selectedCity?.id;
  const cityParam = cityId ? `&cityId=${cityId}` : "";

  const batchesQuery = useQuery<any[]>({
    queryKey: ["/api/assignment-batches", cityId, date],
    queryFn: () => apiFetch(`/api/assignment-batches?cityId=${cityId}&date=${date}`, token),
    enabled: !!token && !!cityId,
  });

  const proposalsQuery = useQuery<any>({
    queryKey: ["/api/assignment-batches/proposals", activeBatchId],
    queryFn: () => apiFetch(`/api/assignment-batches/${activeBatchId}/proposals`, token),
    enabled: !!token && !!activeBatchId,
  });

  const generateMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/assignment-batches/generate", token, {
        method: "POST",
        body: JSON.stringify({ cityId, date }),
      }),
    onSuccess: (data: any) => {
      toast({ title: "Plan generated", description: `${data.stats?.totalTrips || 0} trips processed` });
      setActiveBatchId(data.batchId);
      queryClient.invalidateQueries({ queryKey: ["/api/assignment-batches"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const applyMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/assignment-batches/${activeBatchId}/apply`, token, { method: "POST" }),
    onSuccess: (data: any) => {
      toast({ title: "Batch applied", description: `${data.applied} trips assigned` });
      queryClient.invalidateQueries({ queryKey: ["/api/assignment-batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/assignment-batches/proposals"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/assignment-batches/${activeBatchId}/cancel`, token, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Batch cancelled" });
      setActiveBatchId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/assignment-batches"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const overrideMutation = useMutation({
    mutationFn: ({ tripId, driverId, vehicleId }: { tripId: number; driverId: string; vehicleId: string }) =>
      apiFetch(`/api/assignment-batches/trips/${tripId}/override`, token, {
        method: "PATCH",
        body: JSON.stringify({ driverId: driverId || null, vehicleId: vehicleId || null, reason: "Manual override from Assignment Center" }),
      }),
    onSuccess: () => {
      toast({ title: "Override saved" });
      setOverrideTrip(null);
      queryClient.invalidateQueries({ queryKey: ["/api/assignment-batches/proposals"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const proposals: Proposal[] = proposalsQuery.data?.proposals || [];
  const driverOptions: DriverOption[] = proposalsQuery.data?.drivers || [];
  const vehicleOptions: VehicleOption[] = proposalsQuery.data?.vehicles || [];
  const batch = proposalsQuery.data?.batch;

  const handleCityChange = (val: string) => {
    const id = parseInt(val);
    const city = (cities || []).find((c: any) => c.id === id);
    if (city) {
      setSelectedCity(city);
      setActiveBatchId(null);
    }
  };

  const zipGroups: Record<string, Proposal[]> = {};
  for (const p of proposals) {
    const key = p.pickupZip || "Unknown ZIP";
    if (!zipGroups[key]) zipGroups[key] = [];
    zipGroups[key].push(p);
  }
  const parseTimeMinutes = (t: string | null): number => {
    if (!t) return 9999;
    const parts = t.split(":");
    return (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0);
  };
  for (const key of Object.keys(zipGroups)) {
    zipGroups[key].sort((a, b) => parseTimeMinutes(a.pickupTime) - parseTimeMinutes(b.pickupTime));
  }

  return (
    <div className="p-4 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <Zap className="w-6 h-6" />
        <h1 className="text-xl font-semibold" data-testid="text-auto-assignment-title">
          Auto Assignment Center
        </h1>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Label>City</Label>
          <Select value={cityId?.toString() || ""} onValueChange={handleCityChange}>
            <SelectTrigger className="w-48" data-testid="select-assignment-city">
              <SelectValue placeholder="Select city" />
            </SelectTrigger>
            <SelectContent>
              {nvCities.map((city: any) => (
                <SelectItem key={city.id} value={city.id.toString()}>
                  {city.name}, {city.state}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Label>Date</Label>
          <Input
            type="date"
            value={date}
            onChange={(e) => { setDate(e.target.value); setActiveBatchId(null); }}
            className="w-auto"
            data-testid="input-assignment-date"
          />
        </div>
        <Button
          onClick={() => generateMutation.mutate()}
          disabled={!cityId || generateMutation.isPending}
          data-testid="button-generate-plan"
        >
          <Zap className="w-4 h-4 mr-2" />
          {generateMutation.isPending ? "Generating..." : "Generate Plan"}
        </Button>
      </div>

      {cityId && batchesQuery.data && batchesQuery.data.length > 0 && !activeBatchId && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Previous Batches</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {batchesQuery.data.map((b: any) => (
                <div key={b.id} className="flex items-center justify-between gap-3 flex-wrap" data-testid={`row-batch-${b.id}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono">Batch #{b.id}</span>
                    <Badge variant={b.status === "applied" ? "default" : b.status === "cancelled" ? "destructive" : "secondary"}>
                      {b.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{b.tripCount} trips</span>
                  </div>
                  {b.status === "proposed" && (
                    <Button variant="outline" onClick={() => setActiveBatchId(b.id)} data-testid={`button-view-batch-${b.id}`}>
                      View
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {activeBatchId && proposalsQuery.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}

      {activeBatchId && batch && (
        <div className="space-y-4">
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-medium">Batch #{batch.id}</span>
                  <Badge variant={batch.status === "applied" ? "default" : batch.status === "cancelled" ? "destructive" : "secondary"} data-testid="badge-batch-status">
                    {batch.status}
                  </Badge>
                  <span className="text-sm text-muted-foreground">{proposals.length} trips</span>
                  <span className="text-sm text-muted-foreground">
                    {proposals.filter(p => p.canAssign).length} assignable / {proposals.filter(p => !p.canAssign).length} blocked
                  </span>
                </div>
                {batch.status === "proposed" && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      onClick={() => applyMutation.mutate()}
                      disabled={applyMutation.isPending}
                      data-testid="button-apply-batch"
                    >
                      <Play className="w-4 h-4 mr-2" />
                      {applyMutation.isPending ? "Applying..." : "Apply Batch"}
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => cancelMutation.mutate()}
                      disabled={cancelMutation.isPending}
                      data-testid="button-cancel-batch"
                    >
                      <XCircle className="w-4 h-4 mr-2" />
                      Cancel Batch
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {Object.entries(zipGroups).sort().map(([zip, groupProposals]) => (
            <Card key={zip}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <MapPin className="w-4 h-4" />
                  ZIP: {zip}
                  <Badge variant="secondary">{groupProposals.length} trips</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid={`table-proposals-${zip}`}>
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2 pr-2">Trip</th>
                        <th className="text-left py-2 px-2">Time</th>
                        <th className="text-left py-2 px-2">Patient</th>
                        <th className="text-left py-2 px-2">Type</th>
                        <th className="text-left py-2 px-2">Status</th>
                        <th className="text-left py-2 px-2">Driver</th>
                        <th className="text-left py-2 px-2">Vehicle</th>
                        <th className="text-left py-2 px-2">Reason</th>
                        <th className="text-right py-2 pl-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupProposals.map((p) => (
                        <tr key={p.tripId} className={`border-b last:border-0 ${!p.canAssign ? "opacity-60" : ""}`} data-testid={`row-proposal-${p.tripId}`}>
                          <td className="py-2 pr-2 font-mono text-xs">{p.tripPublicId}</td>
                          <td className="py-2 px-2">{p.pickupTime}</td>
                          <td className="py-2 px-2">
                            <div className="flex items-center gap-1">
                              {p.patientName}
                              {p.wheelchairRequired && (
                                <Accessibility className="w-3 h-3 text-blue-500" />
                              )}
                            </div>
                          </td>
                          <td className="py-2 px-2">
                            <Badge variant="outline" className="text-xs capitalize">{p.tripType.replace("_", " ")}</Badge>
                          </td>
                          <td className="py-2 px-2">
                            {!p.canAssign ? (
                              <Badge variant="destructive" className="text-xs">
                                <AlertTriangle className="w-3 h-3 mr-1" />
                                Blocked
                              </Badge>
                            ) : p.proposedDriverId ? (
                              <Badge variant="default" className="text-xs">
                                <CheckCircle className="w-3 h-3 mr-1" />
                                Assigned
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs">Unassigned</Badge>
                            )}
                          </td>
                          <td className="py-2 px-2">{p.proposedDriverName || "—"}</td>
                          <td className="py-2 px-2">{p.proposedVehicleName || "—"}</td>
                          <td className="py-2 px-2 text-xs text-muted-foreground max-w-[200px] truncate" title={p.assignmentReason || p.blockReason || ""}>
                            {p.blockReason || p.assignmentReason || ""}
                          </td>
                          <td className="py-2 pl-2 text-right">
                            {batch.status === "proposed" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1"
                                onClick={() => {
                                  setOverrideTrip(p);
                                  setOverrideDriverId(p.proposedDriverId?.toString() || "");
                                  setOverrideVehicleId(p.proposedVehicleId?.toString() || "");
                                }}
                                data-testid={`button-override-${p.tripId}`}
                              >
                                <Edit className="w-3 h-3" />
                                Edit
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!cityId && (
        <Card>
          <CardContent className="py-8 text-center">
            <MapPin className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-muted-foreground" data-testid="text-select-city-assignment">Select a city to begin auto assignment.</p>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!overrideTrip} onOpenChange={(open) => !open && setOverrideTrip(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Assignment - {overrideTrip?.tripPublicId}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <Label className="text-xs text-muted-foreground">Patient</Label>
                <p className="font-medium">{overrideTrip?.patientName}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Pickup Time</Label>
                <p className="font-medium">{overrideTrip?.pickupTime || "—"}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Type</Label>
                <p className="capitalize">{overrideTrip?.tripType?.replace("_", " ")}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">ZIP</Label>
                <p>{overrideTrip?.pickupZip || "—"}</p>
              </div>
            </div>
            {overrideTrip?.assignmentReason && (
              <div className="rounded-md bg-muted/50 px-3 py-2">
                <Label className="text-xs text-muted-foreground">Auto-assign reason</Label>
                <p className="text-sm">{overrideTrip.assignmentReason}</p>
              </div>
            )}
            <div className="space-y-2">
              <Label>Driver</Label>
              <Select value={overrideDriverId} onValueChange={setOverrideDriverId}>
                <SelectTrigger data-testid="select-override-driver">
                  <SelectValue placeholder="Select driver" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No driver</SelectItem>
                  {driverOptions
                    .filter((d) => d.dispatchStatus !== "hold")
                    .map((d) => (
                      <SelectItem key={d.id} value={d.id.toString()}>
                        {d.name} ({d.dispatchStatus})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Vehicle</Label>
              <Select value={overrideVehicleId} onValueChange={setOverrideVehicleId}>
                <SelectTrigger data-testid="select-override-vehicle">
                  <SelectValue placeholder="Select vehicle" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No vehicle</SelectItem>
                  {vehicleOptions.map((v) => (
                    <SelectItem key={v.id} value={v.id.toString()}>
                      {v.name} {v.wheelchairAccessible ? "(WC)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideTrip(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (overrideTrip) {
                  overrideMutation.mutate({
                    tripId: overrideTrip.tripId,
                    driverId: overrideDriverId === "none" ? "" : overrideDriverId,
                    vehicleId: overrideVehicleId === "none" ? "" : overrideVehicleId,
                  });
                }
              }}
              disabled={overrideMutation.isPending}
              data-testid="button-save-override"
            >
              {overrideMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
