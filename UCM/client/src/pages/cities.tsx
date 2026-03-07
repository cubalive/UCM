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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Plus, MapPin, Pencil, Power, Trash2, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api";

const FALLBACK_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Indiana/Indianapolis",
];

export default function CitiesPage() {
  const { token, user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editCity, setEditCity] = useState<any>(null);
  const [showInactive, setShowInactive] = useState(false);

  const isSuperAdmin = user?.role === "SUPER_ADMIN";

  const { data: cities, isLoading } = useQuery<any[]>({
    queryKey: ["/api/cities"],
    queryFn: () => apiFetch("/api/cities", token),
    enabled: !!token,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch("/api/cities", token, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cities"] });
      setOpen(false);
      toast({ title: "City added" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      apiFetch(`/api/cities/${id}`, token, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cities"] });
      setEditCity(null);
      toast({ title: "City updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      apiFetch(`/api/cities/${id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ active }),
      }),
    onSuccess: (_data: any, variables: { id: number; active: boolean }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cities"] });
      toast({ title: variables.active ? "City activated" : "City deactivated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/api/cities/${id}`, token, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cities"] });
      toast({ title: "City deleted" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const filteredCities = cities?.filter((c: any) => {
    if (showInactive) return true;
    return c.active !== false;
  });

  const activeCount = cities?.filter((c: any) => c.active !== false).length || 0;
  const inactiveCount = cities?.filter((c: any) => c.active === false).length || 0;

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cities</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage service areas</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-city"><Plus className="w-4 h-4 mr-2" />Add City</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add City</DialogTitle></DialogHeader>
            <CityForm onSubmit={(d) => createMutation.mutate(d)} loading={createMutation.isPending} />
          </DialogContent>
        </Dialog>
      </div>

      {isSuperAdmin && (
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Switch
              checked={showInactive}
              onCheckedChange={setShowInactive}
              data-testid="switch-show-inactive-cities"
            />
            <Label className="text-sm text-muted-foreground">Show inactive cities</Label>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary">{activeCount} active</Badge>
            {inactiveCount > 0 && <Badge variant="destructive">{inactiveCount} inactive</Badge>}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : !filteredCities?.length ? (
        <Card>
          <CardContent className="py-12 text-center">
            <MapPin className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No cities configured</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredCities.map((c: any) => (
            <Card key={c.id} className={c.active === false ? "opacity-60" : ""}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="font-medium" data-testid={`text-city-name-${c.id}`}>{c.name}</p>
                    <p className="text-sm text-muted-foreground">{c.state}</p>
                    <p className="text-xs text-muted-foreground" data-testid={`text-city-timezone-${c.id}`}>{c.timezone}</p>
                  </div>
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    <Badge variant={c.active !== false ? "secondary" : "destructive"} data-testid={`badge-city-status-${c.id}`}>
                      {c.active !== false ? "Active" : "Inactive"}
                    </Badge>
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setEditCity(c)}
                        data-testid={`button-edit-city-${c.id}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      {isSuperAdmin && (
                        <>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => toggleActiveMutation.mutate({ id: c.id, active: c.active === false })}
                            disabled={toggleActiveMutation.isPending}
                            title={c.active !== false ? "Deactivate city" : "Activate city"}
                            data-testid={`button-toggle-city-${c.id}`}
                          >
                            {toggleActiveMutation.isPending ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Power className={`w-4 h-4 ${c.active !== false ? "text-green-500" : "text-destructive"}`} />
                            )}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() => {
                              if (window.confirm(`Permanently delete city "${c.name}, ${c.state}"? This cannot be undone.`)) {
                                deleteMutation.mutate(c.id);
                              }
                            }}
                            disabled={deleteMutation.isPending}
                            title="Delete city"
                            data-testid={`button-delete-city-${c.id}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editCity} onOpenChange={(v) => !v && setEditCity(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit City</DialogTitle></DialogHeader>
          {editCity && (
            <CityForm
              initialData={editCity}
              onSubmit={(d) => updateMutation.mutate({ id: editCity.id, data: d })}
              loading={updateMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CityForm({
  initialData,
  onSubmit,
  loading,
}: {
  initialData?: any;
  onSubmit: (data: any) => void;
  loading: boolean;
}) {
  const { token } = useAuth();
  const isEdit = !!initialData;

  const { data: tzData, isLoading: tzLoading, isError: tzError } = useQuery<{ ok: boolean; items: string[] }>({
    queryKey: ["/api/timezones"],
    queryFn: () => apiFetch("/api/timezones", token),
    enabled: !!token,
  });

  const timezones = tzData?.items?.length ? tzData.items : (tzError ? FALLBACK_TIMEZONES : []);
  const useFallbackInput = tzError && !tzData?.items?.length;

  const [form, setForm] = useState({
    name: initialData?.name || "",
    state: initialData?.state || "",
    timezone: initialData?.timezone || "America/Los_Angeles",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = { ...form };
    if (!payload.timezone.trim()) payload.timezone = "America/Los_Angeles";
    onSubmit(payload);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>City Name *</Label>
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required data-testid="input-city-name" />
      </div>
      <div className="space-y-2">
        <Label>State *</Label>
        <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} required placeholder="e.g. TX" data-testid="input-city-state" />
      </div>
      <div className="space-y-2">
        <Label>Timezone *</Label>
        {tzLoading ? (
          <Skeleton className="h-9 w-full" />
        ) : useFallbackInput ? (
          <Input
            value={form.timezone}
            onChange={(e) => setForm({ ...form, timezone: e.target.value })}
            placeholder="America/Los_Angeles"
            data-testid="input-city-timezone"
          />
        ) : (
          <Select
            value={form.timezone}
            onValueChange={(v) => setForm({ ...form, timezone: v })}
          >
            <SelectTrigger data-testid="select-city-timezone">
              <SelectValue placeholder="Select timezone" />
            </SelectTrigger>
            <SelectContent>
              {timezones.map((tz) => (
                <SelectItem key={tz} value={tz}>{tz.replace(/_/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {useFallbackInput && (
          <p className="text-xs text-muted-foreground">Could not load timezone list. Enter a valid IANA timezone.</p>
        )}
      </div>
      <Button type="submit" className="w-full" disabled={loading} data-testid="button-submit-city">
        {loading ? (isEdit ? "Saving..." : "Adding...") : (isEdit ? "Save Changes" : "Add City")}
      </Button>
    </form>
  );
}
