import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Truck, Search, Accessibility } from "lucide-react";
import { apiFetch } from "@/lib/api";

export default function VehiclesPage() {
  const { token, selectedCity } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const cityParam = selectedCity ? `?cityId=${selectedCity.id}` : "";

  const { data: vehicles, isLoading } = useQuery<any[]>({
    queryKey: ["/api/vehicles", selectedCity?.id],
    queryFn: () => apiFetch(`/api/vehicles${cityParam}`, token),
    enabled: !!token,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch("/api/vehicles", token, {
        method: "POST",
        body: JSON.stringify({ ...data, cityId: selectedCity?.id }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      setOpen(false);
      toast({ title: "Vehicle added" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const filtered = vehicles?.filter(
    (v: any) =>
      v.name?.toLowerCase().includes(search.toLowerCase()) ||
      v.licensePlate?.toLowerCase().includes(search.toLowerCase()) ||
      v.publicId?.toLowerCase().includes(search.toLowerCase())
  );

  const statusColors: Record<string, string> = { ACTIVE: "secondary", MAINTENANCE: "default", OUT_OF_SERVICE: "destructive" };

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Vehicles</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage fleet vehicles</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-vehicle"><Plus className="w-4 h-4 mr-2" />Add Vehicle</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Vehicle</DialogTitle></DialogHeader>
            <VehicleForm onSubmit={(d) => createMutation.mutate(d)} loading={createMutation.isPending} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Search vehicles..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" data-testid="input-search-vehicles" />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : !filtered?.length ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Truck className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No vehicles found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((v: any) => (
            <Card key={v.id}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <p className="font-medium" data-testid={`text-vehicle-name-${v.id}`}>{v.name}</p>
                    <p className="text-xs font-mono text-muted-foreground">{v.publicId}</p>
                    <p className="text-sm text-muted-foreground">{v.licensePlate}</p>
                    {v.make && <p className="text-sm text-muted-foreground">{v.year} {v.make} {v.model}</p>}
                    <p className="text-xs text-muted-foreground">Capacity: {v.capacity}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <Badge variant={statusColors[v.status] as any || "secondary"}>{v.status.replace("_", " ")}</Badge>
                    {v.wheelchairAccessible && (
                      <Badge variant="secondary"><Accessibility className="w-3 h-3 mr-1" />WC</Badge>
                    )}
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

function VehicleForm({ onSubmit, loading }: { onSubmit: (data: any) => void; loading: boolean }) {
  const [form, setForm] = useState({
    name: "", licensePlate: "", make: "", model: "", year: "", capacity: "4", wheelchairAccessible: false,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ ...form, year: form.year ? parseInt(form.year) : null, capacity: parseInt(form.capacity) });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Vehicle Name *</Label>
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="e.g. Van #1" data-testid="input-vehicle-name" />
      </div>
      <div className="space-y-2">
        <Label>License Plate *</Label>
        <Input value={form.licensePlate} onChange={(e) => setForm({ ...form, licensePlate: e.target.value })} required data-testid="input-vehicle-plate" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-2">
          <Label>Make</Label>
          <Input value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} data-testid="input-vehicle-make" />
        </div>
        <div className="space-y-2">
          <Label>Model</Label>
          <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} data-testid="input-vehicle-model" />
        </div>
        <div className="space-y-2">
          <Label>Year</Label>
          <Input type="number" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} data-testid="input-vehicle-year" />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Capacity</Label>
        <Input type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} data-testid="input-vehicle-capacity" />
      </div>
      <div className="flex items-center gap-3">
        <Switch checked={form.wheelchairAccessible} onCheckedChange={(v) => setForm({ ...form, wheelchairAccessible: v })} data-testid="switch-vehicle-wheelchair" />
        <Label>Wheelchair Accessible</Label>
      </div>
      <Button type="submit" className="w-full" disabled={loading} data-testid="button-submit-vehicle">
        {loading ? "Adding..." : "Add Vehicle"}
      </Button>
    </form>
  );
}
