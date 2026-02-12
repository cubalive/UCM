import { useState } from "react";
import { useAuth, authHeaders } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Plus, Route, Search } from "lucide-react";
import { apiFetch } from "@/lib/api";

export default function TripsPage() {
  const { token, selectedCity } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const cityParam = selectedCity ? `?cityId=${selectedCity.id}` : "";

  const { data: trips, isLoading } = useQuery<any[]>({
    queryKey: ["/api/trips", selectedCity?.id],
    queryFn: () => apiFetch(`/api/trips${cityParam}`, token),
    enabled: !!token,
  });

  const { data: patients } = useQuery<any[]>({
    queryKey: ["/api/patients", selectedCity?.id],
    queryFn: () => apiFetch(`/api/patients${cityParam}`, token),
    enabled: !!token,
  });

  const { data: drivers } = useQuery<any[]>({
    queryKey: ["/api/drivers", selectedCity?.id],
    queryFn: () => apiFetch(`/api/drivers${cityParam}`, token),
    enabled: !!token,
  });

  const { data: vehicles } = useQuery<any[]>({
    queryKey: ["/api/vehicles", selectedCity?.id],
    queryFn: () => apiFetch(`/api/vehicles${cityParam}`, token),
    enabled: !!token,
  });

  const { data: clinics } = useQuery<any[]>({
    queryKey: ["/api/clinics", selectedCity?.id],
    queryFn: () => apiFetch(`/api/clinics${cityParam}`, token),
    enabled: !!token,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch("/api/trips", token, {
        method: "POST",
        body: JSON.stringify({ ...data, cityId: selectedCity?.id }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trips"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      setOpen(false);
      toast({ title: "Trip created" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiFetch(`/api/trips/${id}/status`, token, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trips"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const filtered = trips?.filter(
    (t: any) =>
      t.publicId?.toLowerCase().includes(search.toLowerCase()) ||
      t.pickupAddress?.toLowerCase().includes(search.toLowerCase()) ||
      t.dropoffAddress?.toLowerCase().includes(search.toLowerCase())
  );

  const statusColors: Record<string, string> = {
    SCHEDULED: "secondary",
    ASSIGNED: "default",
    IN_PROGRESS: "default",
    COMPLETED: "secondary",
    CANCELLED: "destructive",
    NO_SHOW: "destructive",
  };

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Trips</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage transportation trips</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-trip">
              <Plus className="w-4 h-4 mr-2" />
              New Trip
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Schedule New Trip</DialogTitle>
            </DialogHeader>
            <TripForm
              patients={patients || []}
              drivers={drivers || []}
              vehicles={vehicles || []}
              clinics={clinics || []}
              onSubmit={(data) => createMutation.mutate(data)}
              loading={createMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search trips..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
          data-testid="input-search-trips"
        />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : !filtered?.length ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Route className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No trips found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((trip: any) => (
            <Card key={trip.id}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-mono font-medium" data-testid={`text-trip-id-${trip.id}`}>
                        {trip.publicId}
                      </span>
                      <Badge variant={statusColors[trip.status] as any || "secondary"}>
                        {trip.status.replace("_", " ")}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {trip.scheduledDate} at {trip.scheduledTime}
                    </p>
                    <p className="text-sm">
                      <span className="text-muted-foreground">From:</span> {trip.pickupAddress}
                    </p>
                    <p className="text-sm">
                      <span className="text-muted-foreground">To:</span> {trip.dropoffAddress}
                    </p>
                  </div>
                  <div className="flex-shrink-0">
                    <Select
                      value={trip.status}
                      onValueChange={(status) => updateStatusMutation.mutate({ id: trip.id, status })}
                    >
                      <SelectTrigger className="w-36" data-testid={`select-trip-status-${trip.id}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["SCHEDULED", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"].map((s) => (
                          <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function TripForm({
  patients,
  drivers,
  vehicles,
  clinics,
  onSubmit,
  loading,
}: {
  patients: any[];
  drivers: any[];
  vehicles: any[];
  clinics: any[];
  onSubmit: (data: any) => void;
  loading: boolean;
}) {
  const [form, setForm] = useState({
    patientId: "",
    driverId: "",
    vehicleId: "",
    clinicId: "",
    pickupAddress: "",
    dropoffAddress: "",
    scheduledDate: "",
    scheduledTime: "",
    notes: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...form,
      patientId: parseInt(form.patientId),
      driverId: form.driverId ? parseInt(form.driverId) : null,
      vehicleId: form.vehicleId ? parseInt(form.vehicleId) : null,
      clinicId: form.clinicId ? parseInt(form.clinicId) : null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Patient *</Label>
        <Select value={form.patientId} onValueChange={(v) => setForm({ ...form, patientId: v })}>
          <SelectTrigger data-testid="select-trip-patient"><SelectValue placeholder="Select patient" /></SelectTrigger>
          <SelectContent>
            {patients.map((p) => (
              <SelectItem key={p.id} value={p.id.toString()}>{p.firstName} {p.lastName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Date *</Label>
          <Input type="date" value={form.scheduledDate} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} required data-testid="input-trip-date" />
        </div>
        <div className="space-y-2">
          <Label>Time *</Label>
          <Input type="time" value={form.scheduledTime} onChange={(e) => setForm({ ...form, scheduledTime: e.target.value })} required data-testid="input-trip-time" />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Pickup Address *</Label>
        <Input value={form.pickupAddress} onChange={(e) => setForm({ ...form, pickupAddress: e.target.value })} required data-testid="input-trip-pickup" />
      </div>
      <div className="space-y-2">
        <Label>Dropoff Address *</Label>
        <Input value={form.dropoffAddress} onChange={(e) => setForm({ ...form, dropoffAddress: e.target.value })} required data-testid="input-trip-dropoff" />
      </div>
      <div className="space-y-2">
        <Label>Clinic</Label>
        <Select value={form.clinicId} onValueChange={(v) => setForm({ ...form, clinicId: v })}>
          <SelectTrigger data-testid="select-trip-clinic"><SelectValue placeholder="Select clinic (optional)" /></SelectTrigger>
          <SelectContent>
            {clinics.map((c) => (
              <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Driver</Label>
          <Select value={form.driverId} onValueChange={(v) => setForm({ ...form, driverId: v })}>
            <SelectTrigger data-testid="select-trip-driver"><SelectValue placeholder="Assign later" /></SelectTrigger>
            <SelectContent>
              {drivers.map((d) => (
                <SelectItem key={d.id} value={d.id.toString()}>{d.firstName} {d.lastName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Vehicle</Label>
          <Select value={form.vehicleId} onValueChange={(v) => setForm({ ...form, vehicleId: v })}>
            <SelectTrigger data-testid="select-trip-vehicle"><SelectValue placeholder="Assign later" /></SelectTrigger>
            <SelectContent>
              {vehicles.map((v) => (
                <SelectItem key={v.id} value={v.id.toString()}>{v.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label>Notes</Label>
        <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="input-trip-notes" />
      </div>
      <Button type="submit" className="w-full" disabled={loading} data-testid="button-submit-trip">
        {loading ? "Creating..." : "Schedule Trip"}
      </Button>
    </form>
  );
}
